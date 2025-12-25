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
  else if (
    msg.type === "VIDEO_EVENT" ||
    msg.type === "VIDEO_CHANGED" ||
    msg.type === "NO_VIDEO_DISCONNECT"
  ) {
    // Use sender.tab.id to get the actual tab that sent the message
    // This ensures sync works even when tab is not focused
    if (sender.tab?.id) {
      sendToOffscreen({ ...msg, tabId: sender.tab.id });
    }
  }
  // Query connection state for content script (needs async response)
  else if (msg.type === "GET_CONNECTION_STATE") {
    // Use sender.tab.id to get the actual tab that sent the message
    if (sender.tab?.id) {
      sendToOffscreen({ type: "GET_CONNECTION_STATE", tabId: sender.tab.id });
    }
    // Response will be sent via CONNECTION_STATE_RESPONSE message
  }
  // Auto-connect from invite link (from content script)
  else if (msg.type === "AUTO_CONNECT") {
    if (sender.tab?.id) {
      // First ensure peer is initialized, then connect
      chrome.storage.sync.get(["nickname"], (result) => {
        sendToOffscreen({
          type: "AUTO_CONNECT",
          tabId: sender.tab.id,
          tabUrl: sender.tab.url,
          hostId: msg.hostId,
          nickname: result.nickname || "",
        });
      });
    }
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
            nickname: result.nickname || "",
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
          tabUrl: tabs[0].url,
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
  else if (
    msg.type === "NOTIFY_PEER_JOINED" ||
    msg.type === "NOTIFY_PEER_DISCONNECTED" ||
    msg.type === "NOTIFY_PEER_REQUESTING_HOST"
  ) {
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
  // Handle video navigation - navigate the tab directly
  else if (msg.type === "NOTIFY_VIDEO_NAVIGATE") {
    const tabId = msg.tabId;
    const url = msg.url;
    if (tabId && url) {
      // Check if tab is already on this URL to avoid unnecessary refresh
      chrome.tabs.get(tabId, (tab) => {
        if (chrome.runtime.lastError) return;
        if (tab.url !== url) {
          // Navigate the tab directly using chrome.tabs.update
          // This works even on chrome:// pages where content scripts can't run
          chrome.tabs.update(tabId, { url: url });
        }
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

// Track tab URL changes to keep offscreen's tabData.url in sync
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url) {
    const newUrl = changeInfo.url;

    // Check if this is a restricted URL where content scripts can't run
    const isRestrictedUrl =
      newUrl.startsWith("chrome://") ||
      newUrl.startsWith("chrome-extension://") ||
      newUrl.startsWith("brave://") ||
      newUrl.startsWith("edge://") ||
      newUrl.startsWith("about:") ||
      newUrl.startsWith("chrome-search://");

    if (isRestrictedUrl) {
      // Content script can't run here, so we need to handle "no video" from background
      // This notifies offscreen to tell guests that host left video page
      sendToOffscreen({
        type: "HOST_ON_RESTRICTED_PAGE",
        tabId,
        url: newUrl,
      });
    } else {
      // Update offscreen's stored URL for this tab (if peer exists)
      sendToOffscreen({ type: "TAB_URL_CHANGED", tabId, newUrl });
    }
  }
});

// Initialize offscreen at startup
setupOffscreen();
