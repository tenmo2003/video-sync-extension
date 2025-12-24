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
  else if (msg.type === "VIDEO_EVENT" || msg.type === "VIDEO_CHANGED" || msg.type === "NO_VIDEO_DISCONNECT") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        sendToOffscreen({ ...msg, tabId: tabs[0].id });
      }
    });
  }
  // Query connection state for content script (needs async response)
  else if (msg.type === "GET_CONNECTION_STATE") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        sendToOffscreen({ type: "GET_CONNECTION_STATE", tabId: tabs[0].id });
      }
    });
    // Response will be sent via CONNECTION_STATE_RESPONSE message
  }
  // INIT_PEER needs nickname from storage
  else if (msg.type === "INIT_PEER") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.storage.sync.get(["nickname"], (result) => {
          sendToOffscreen({
            ...msg,
            tabId: tabs[0].id,
            tabUrl: tabs[0].url,
            nickname: result.nickname || ""
          });
        });
      }
    });
  }
  // Messages from popup that need tab info added
  else if (
    msg.type === "GET_PEER_INFO" ||
    msg.type === "CONNECT_TO" ||
    msg.type === "DISCONNECT_PEER" ||
    msg.type === "DISCONNECT_ALL" ||
    msg.type === "REQUEST_HOST" ||
    msg.type === "PROMOTE_PEER" ||
    msg.type === "UPDATE_NICKNAME"
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
        connected: msg.connected,
      });
    }
  }
  // Route peer events to content script
  else if (msg.type === "NOTIFY_PEER_JOINED" || msg.type === "NOTIFY_PEER_DISCONNECTED" || msg.type === "NOTIFY_PEER_REQUESTING_HOST") {
    const tabId = msg.tabId;
    if (tabId) {
      const eventType = msg.type.replace("NOTIFY_", "");
      chrome.tabs.sendMessage(tabId, {
        type: eventType,
        peerId: msg.peerId,
        nickname: msg.nickname,
      });
    }
  }
  // Route peer nickname updates to content script
  else if (msg.type === "NOTIFY_PEER_NICKNAME") {
    const tabId = msg.tabId;
    if (tabId) {
      chrome.tabs.sendMessage(tabId, {
        type: "PEER_NICKNAME",
        peerId: msg.peerId,
        nickname: msg.nickname,
      });
    }
  }
  // Route video navigation to content script
  else if (msg.type === "NOTIFY_VIDEO_NAVIGATE") {
    const tabId = msg.tabId;
    if (tabId) {
      chrome.tabs.sendMessage(tabId, {
        type: "VIDEO_NAVIGATE",
        url: msg.url,
      });
    }
  }
  // Route no video left notification to content script
  else if (msg.type === "NOTIFY_NO_VIDEO_LEFT") {
    const tabId = msg.tabId;
    if (tabId) {
      chrome.tabs.sendMessage(tabId, {
        type: "NO_VIDEO_LEFT",
        reason: msg.reason,
      });
    }
  }
  // Route connection state response to content script
  else if (msg.type === "CONNECTION_STATE_RESPONSE") {
    const tabId = msg.tabId;
    if (tabId) {
      chrome.tabs.sendMessage(tabId, {
        type: "CONNECTION_STATE",
        connected: msg.connected,
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
