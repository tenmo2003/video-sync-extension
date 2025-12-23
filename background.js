let offscreenCreating = false;

// Ensure the offscreen document exists
async function setupOffscreen() {
  if (await chrome.offscreen.hasDocument()) return;
  if (offscreenCreating) return;
  offscreenCreating = true;
  await chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: ["WEB_RTC"],
    justification: "P2P Video Sync",
  });
  offscreenCreating = false;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Route messages from Offscreen -> Content Script
  if (msg.type === "INCOMING_ACTION") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, {
          type: "APPLY_ACTION",
          data: msg.data,
        });
      }
    });
  }
  // Route messages from Content Script -> Offscreen
  else if (msg.type === "VIDEO_EVENT") {
    chrome.runtime.sendMessage(msg).catch(() => {}); // Catch error if offscreen isn't ready
  }
  // Forward connection status from offscreen to popup
  else if (msg.type === "CONNECTION_STATUS") {
    // This message will be received by popup via chrome.runtime.onMessage
    // No additional routing needed as popup also listens to runtime messages
  }
});

// Initialize offscreen when extension icon is clicked
chrome.action.onClicked.addListener(setupOffscreen);
setupOffscreen();
