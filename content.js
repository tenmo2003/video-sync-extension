let video = document.querySelector("video");
let isRemoteUpdate = false; // Flag to prevent infinite loops
let syncIntervalId = null;
let toastElement = null;
let toastTimeout = null;
let isHost = false; // Only host can send video events
let peersConnected = false; // Track if we have peers
let peerNicknames = {}; // peerId -> nickname for display in toasts
let videoListenersSetup = false; // Flag to prevent duplicate listener registration

function getPeerDisplayName(peerId, nickname) {
  return nickname || peerNicknames[peerId] || peerId;
}

// Default settings (will be overwritten by stored settings)
let settings = {
  syncInterval: 1000,
  allowedOffset: 0.3,
  toastEnabled: true,
  toastDuration: 1500,
};

// Load settings from storage
function loadSettings() {
  chrome.storage.sync.get(settings, (stored) => {
    settings = { ...settings, ...stored };
    // Restart sync interval if running with new interval
    if (syncIntervalId) {
      stopSyncInterval();
      startSyncInterval();
    }
  });
}

// Listen for settings changes
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync") {
    for (const key in changes) {
      if (key in settings) {
        settings[key] = changes[key].newValue;
      }
    }
    // Restart sync interval if running with new interval
    if (syncIntervalId && changes.syncInterval) {
      stopSyncInterval();
      startSyncInterval();
    }
  }
});

// Load settings on startup
loadSettings();

// Create and show a toast notification anchored to the video
function showSyncToast(message) {
  if (!video || !settings.toastEnabled) return;

  // Create toast if it doesn't exist
  if (!toastElement) {
    toastElement = document.createElement("div");
    toastElement.style.cssText = `
      position: fixed;
      background: rgba(255, 255, 255, 1);
      color: black;
      padding: 8px 16px;
      border-radius: 4px;
      font-family: sans-serif;
      font-size: 13px;
      z-index: 999999;
      pointer-events: none;
      transition: opacity 0.3s ease;
      opacity: 0;
    `;
    document.body.appendChild(toastElement);
  }

  // Position toast near the video (bottom-right corner)
  const rect = video.getBoundingClientRect();
  const viewportHeight = window.innerHeight;
  const viewportWidth = window.innerWidth;

  toastElement.style.bottom = `${viewportHeight - rect.bottom + 20}px`;
  toastElement.style.right = `${viewportWidth - rect.right + 10}px`;

  // Update message and show
  toastElement.textContent = message;
  toastElement.style.opacity = "0.8";

  // Clear previous timeout
  if (toastTimeout) clearTimeout(toastTimeout);

  // Fade out after delay (use setting)
  toastTimeout = setTimeout(() => {
    if (toastElement) toastElement.style.opacity = "0";
  }, settings.toastDuration);
}

function sendVideoState() {
  if (!video || isRemoteUpdate || !isHost) return;

  chrome.runtime.sendMessage({
    type: "VIDEO_EVENT",
    data: {
      action: "sync",
      time: video.currentTime,
      paused: video.paused,
      timestamp: Date.now(),
    },
  });
}

function startSyncInterval() {
  if (syncIntervalId) return;
  syncIntervalId = setInterval(sendVideoState, settings.syncInterval);
}

function stopSyncInterval() {
  if (syncIntervalId) {
    clearInterval(syncIntervalId);
    syncIntervalId = null;
  }
}

function getPageUrl() {
  return window.location.href;
}

function sendCurrentVideoUrl() {
  if (!isHost || !peersConnected) return;

  // Send current URL to peers - they will decide if they need to navigate
  chrome.runtime.sendMessage({
    type: "VIDEO_CHANGED",
    data: {
      newUrl: getPageUrl(),
    },
  });
}

function setupVideoListeners() {
  if (!video || videoListenersSetup) return;
  videoListenersSetup = true;

  // 1. LISTEN: Capture local user actions (only send if host)
  ["play", "pause", "seeked"].forEach((event) => {
    video.addEventListener(event, () => {
      if (isRemoteUpdate || !isHost) return; // Ignore if remote update or not host

      chrome.runtime.sendMessage({
        type: "VIDEO_EVENT",
        data: {
          action: event,
          time: video.currentTime,
          timestamp: Date.now(),
        },
      });
    });
  });

  // Listen for video source changes (for sites that change video without page reload)
  video.addEventListener("loadeddata", () => {
    if (isHost && peersConnected) {
      sendCurrentVideoUrl();
    }
  });
}

// 2. APPLY: Receive actions from host & respond to status checks
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "CHECK_VIDEO_STATUS") {
    if (video) {
      // avoid setting up twice
      sendResponse({ hasVideo: !!video });
      return true;
    }
    // Re-check for video element (it might have loaded dynamically)
    video = document.querySelector("video");
    sendResponse({ hasVideo: !!video });
    if (video) setupVideoListeners();
    return true;
  }

  if (msg.type === "APPLY_ACTION" && video) {
    const { action, time, paused, timestamp } = msg.data;

    isRemoteUpdate = true; // Set flag so we don't send this back

    let didSync = false;

    // Calculate adjusted time based on network latency
    // If video is playing, add elapsed time since message was sent
    let adjustedTime = time;
    if (timestamp && !paused) {
      const elapsed = (Date.now() - timestamp) / 1000; // Convert to seconds
      adjustedTime = time + elapsed;
    }

    // Handle sync action
    if (action === "sync") {
      if (paused && !video.paused) {
        video.pause();
        didSync = true;
      }
      if (!paused && video.paused) {
        video.play();
        didSync = true;
      }
    } else {
      if (action === "pause") {
        video.pause();
        showSyncToast("Paused by host");
      }
      if (action === "play") {
        video.play();
        showSyncToast("Played by host");
      }
      if (action === "seeked") {
        showSyncToast("Seeked by host");
      }
    }

    if (Math.abs(video.currentTime - adjustedTime) > settings.allowedOffset) {
      video.currentTime = adjustedTime;
      didSync = true;
    }

    if (didSync) {
      showSyncToast("Synced");
    }

    // Reset flag after a short delay
    setTimeout(() => {
      isRemoteUpdate = false;
    }, 500);
  }

  // Start/stop sync interval based on connection status
  if (msg.type === "PEERS_CONNECTED") {
    peersConnected = msg.connected;
    if (msg.connected && video) {
      startSyncInterval();
      lastVideoUrl = getPageUrl(); // Track current URL when connected
    } else {
      stopSyncInterval();
      isHost = false; // Reset host status when disconnected
      peersConnected = false;
    }
  }

  // Update host role and connection status
  if (msg.type === "ROLE_UPDATE") {
    isHost = msg.isHost || false;
    if (msg.connected !== undefined) {
      peersConnected = msg.connected;
    }
    if (isHost) {
      showSyncToast("You are now the host");
    } else {
      showSyncToast("You are now a guest");
    }
  }

  // Peer events
  if (msg.type === "PEER_JOINED") {
    const displayName = getPeerDisplayName(msg.peerId, msg.nickname);
    showSyncToast(`${displayName} joined`);
  }
  if (msg.type === "PEER_DISCONNECTED") {
    const displayName = getPeerDisplayName(msg.peerId, msg.nickname);
    showSyncToast(`${displayName} disconnected`);
    // Clean up nickname
    delete peerNicknames[msg.peerId];
  }
  if (msg.type === "PEER_REQUESTING_HOST") {
    const displayName = getPeerDisplayName(msg.peerId, msg.nickname);
    showSyncToast(`${displayName} is requesting control`);
  }
  // Peer nickname update
  if (msg.type === "PEER_NICKNAME") {
    peerNicknames[msg.peerId] = msg.nickname;
  }

  // Host left video page
  if (msg.type === "NO_VIDEO_LEFT") {
    showSyncToast("Host left the video page - disconnected");
    peersConnected = false;
    isHost = false;
  }

  // Connection state response from offscreen
  if (msg.type === "CONNECTION_STATE") {
    handleConnectionState(msg.connected, msg.isHost);
  }
});

// Initial setup if video already exists
if (video) {
  setupVideoListeners();
}

// Query connection state from offscreen on page load
function queryConnectionState() {
  chrome.runtime.sendMessage({ type: "GET_CONNECTION_STATE" });
}

// Handle connection state response
function handleConnectionState(connected, hostStatus) {
  peersConnected = connected;
  isHost = hostStatus;

  // Check for video
  video = document.querySelector("video");

  // If no video but was connected, disconnect
  if (!video && peersConnected) {
    chrome.runtime.sendMessage({
      type: "NO_VIDEO_DISCONNECT",
    });
    return;
  }

  // If connected with video, start sync interval and setup listeners
  if (peersConnected && video) {
    setupVideoListeners();
    startSyncInterval();
    lastVideoUrl = getPageUrl();

    // If host, notify guests of current URL
    if (isHost) {
      chrome.runtime.sendMessage({
        type: "VIDEO_CHANGED",
        data: {
          newUrl: getPageUrl(),
        },
      });
    }
  }
}

// Check for invite link parameter and auto-connect
function checkInviteLink() {
  const url = new URL(window.location.href);
  const hostId = url.searchParams.get("videosync_host");

  if (hostId) {
    // Remove the parameter from URL to clean it up (without reload)
    url.searchParams.delete("videosync_host");
    window.history.replaceState({}, document.title, url.toString());

    // Show toast about auto-connecting
    showSyncToast("Joining sync room...");

    // Send auto-connect request to background
    chrome.runtime.sendMessage({
      type: "AUTO_CONNECT",
      hostId: hostId,
    });
  }
}

// Run state query after page is fully loaded
if (document.readyState === "complete") {
  queryConnectionState();
  checkInviteLink();
} else {
  window.addEventListener("load", () => {
    queryConnectionState();
    checkInviteLink();
  });
}
