let offscreenCreating = false;
let offscreenReady = false;

// Ensure the offscreen document exists
async function setupOffscreen() {
  if (offscreenReady) return;
  if (await chrome.offscreen.hasDocument()) {
    offscreenReady = true;
    return;
  }
  if (offscreenCreating) return;
  offscreenCreating = true;
  await chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: ["WEB_RTC"],
    justification: "P2P Video Sync",
  });
  offscreenCreating = false;
  offscreenReady = true;
}

// Helper to send message to offscreen after ensuring it exists
async function sendToOffscreen(msg) {
  await setupOffscreen();
  chrome.runtime.sendMessage(msg).catch(() => {});
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Route messages from Offscreen -> Content Script (with tabId)
  if (msg.type === "INCOMING_ACTION") {
    const tabId = msg.tabId;
    if (tabId) {
      chrome.tabs.sendMessage(tabId, {
        type: "APPLY_ACTION",
        data: msg.data,
      });
    }
  }
  // Notify content script about peer connection status
  else if (msg.type === "NOTIFY_CONTENT_PEERS") {
    const tabId = msg.tabId;
    if (tabId) {
      chrome.tabs.sendMessage(tabId, {
        type: "PEERS_CONNECTED",
        connected: msg.connected,
      });
    }
  }
  // Route messages from Content Script -> Offscreen (add tabId)
  else if (msg.type === "VIDEO_EVENT") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        sendToOffscreen({ ...msg, tabId: tabs[0].id });
      }
    });
  }
  // Messages from popup that need tab info added
  else if (
    msg.type === "INIT_PEER" ||
    msg.type === "GET_PEER_INFO" ||
    msg.type === "CONNECT_TO" ||
    msg.type === "DISCONNECT_PEER" ||
    msg.type === "DISCONNECT_ALL" ||
    msg.type === "REQUEST_HOST" ||
    msg.type === "PROMOTE_PEER"
  ) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        sendToOffscreen({
          ...msg,
          tabId: tabs[0].id,
          tabUrl: tabs[0].url
        });
      }
    });
  }
  // Route role updates to content script
  else if (msg.type === "NOTIFY_CONTENT_ROLE") {
    const tabId = msg.tabId;
    if (tabId) {
      chrome.tabs.sendMessage(tabId, {
        type: "ROLE_UPDATE",
        isHost: msg.isHost,
      });
    }
  }
  // Forward these messages directly (popup listens to runtime messages)
  // PEER_INFO, CONNECTION_STATUS, CONNECTED_PEERS_UPDATE are handled by popup
});

// Clean up peers when tabs are closed
chrome.tabs.onRemoved.addListener((tabId) => {
  sendToOffscreen({ type: "TAB_CLOSED", tabId });
});

// Initialize offscreen at startup
setupOffscreen();
