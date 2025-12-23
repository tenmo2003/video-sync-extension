let video = document.querySelector("video");
let isRemoteUpdate = false; // Flag to prevent infinite loops
let syncInterval = null;

const ALLOWED_OFFSET = 0.5; // NOTE: 0.5 seconds for RTT
const SYNC_INTERVAL = 1000;

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
  if (syncInterval) return;
  syncInterval = setInterval(sendVideoState, SYNC_INTERVAL);
}

function stopSyncInterval() {
  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
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

    // Handle sync action
    if (action === "sync") {
      if (paused && !video.paused) video.pause();
      if (!paused && video.paused) video.play();
    } else {
      if (action === "pause") video.pause();
      if (action === "play") video.play();
    }

    if (Math.abs(video.currentTime - time) > ALLOWED_OFFSET) {
      video.currentTime = time;
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
