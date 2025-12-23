let video = document.querySelector("video");
let isRemoteUpdate = false; // Flag to prevent infinite loops
let syncIntervalId = null;
let toastElement = null;
let toastTimeout = null;

// Default settings (will be overwritten by stored settings)
let settings = {
  syncInterval: 1000,
  allowedOffset: 0.5,
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
  if (!video || isRemoteUpdate) return;

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

function setupVideoListeners() {
  if (!video) return;

  // 1. LISTEN: Capture local user actions
  ["play", "pause", "seeked"].forEach((event) => {
    video.addEventListener(event, () => {
      if (isRemoteUpdate) return; // Ignore if we just applied a remote change

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
}

// 2. APPLY: Receive actions from friend & respond to status checks
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "CHECK_VIDEO_STATUS") {
    // Re-check for video element (it might have loaded dynamically)
    video = document.querySelector("video");
    sendResponse({ hasVideo: !!video });
    if (video) setupVideoListeners();
    return true;
  }

  if (msg.type === "APPLY_ACTION" && video) {
    const { action, time, paused } = msg.data;

    isRemoteUpdate = true; // Set flag so we don't send this back

    let didSync = false;

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
        showSyncToast("Paused by peer");
      }
      if (action === "play") {
        video.play();
        showSyncToast("Played by peer");
      }
      if (action === "seeked") {
        showSyncToast("Seeked by peer");
      }
    }

    if (Math.abs(video.currentTime - time) > settings.allowedOffset) {
      video.currentTime = time;
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
    if (msg.connected && video) {
      startSyncInterval();
    } else {
      stopSyncInterval();
    }
  }
});

// Initial setup if video already exists
if (video) {
  setupVideoListeners();
}
