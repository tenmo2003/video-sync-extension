// Tell background to wake up offscreen
chrome.runtime.sendMessage({ type: "INIT_PEER" });

// Status display helpers
function setVideoStatus(hasVideo) {
  const el = document.getElementById("video-status");
  if (hasVideo) {
    el.className = "status success";
    el.innerText = "Video detected";
  } else {
    el.className = "status error";
    el.innerText = "No video found on this page";
  }
}

function setConnectionStatus(status, type = "info") {
  const el = document.getElementById("connection-status");
  el.className = `status ${type}`;
  el.innerText = status;
}

// Check for video element in the active tab
chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  if (tabs[0]) {
    chrome.tabs.sendMessage(
      tabs[0].id,
      { type: "CHECK_VIDEO_STATUS" },
      (response) => {
        if (chrome.runtime.lastError) {
          setVideoStatus(false);
        } else {
          setVideoStatus(response?.hasVideo || false);
        }
      },
    );
  }
});

// Listen for messages from background/offscreen
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "MY_ID") {
    document.getElementById("my-id").innerText = msg.id;
  }
  if (msg.type === "CONNECTION_STATUS") {
    setConnectionStatus(msg.status, msg.statusType || "info");
  }
});

document.getElementById("connect-btn").addEventListener("click", () => {
  const friendId = document.getElementById("friend-id").value.trim();
  if (!friendId) {
    setConnectionStatus("Please enter a friend's ID", "warning");
    return;
  }
  setConnectionStatus("Connecting...", "info");
  chrome.runtime.sendMessage({ type: "CONNECT_TO", targetId: friendId });
});
