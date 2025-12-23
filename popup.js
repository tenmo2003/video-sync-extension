let currentTabId = null;
let myPeerId = null;

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

function updatePeerList(peers) {
  const el = document.getElementById("peer-list");
  el.innerHTML = peers.map(p => `<div class="peer-item">${p}</div>`).join("");
}

function setMyId(id) {
  myPeerId = id;
  document.getElementById("my-id").innerText = id || "Generating...";
}

// Initialize - get current tab and request peer info
chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  if (tabs[0]) {
    currentTabId = tabs[0].id;

    // Check for video element
    chrome.tabs.sendMessage(
      tabs[0].id,
      { type: "CHECK_VIDEO_STATUS" },
      (response) => {
        if (chrome.runtime.lastError) {
          setVideoStatus(false);
        } else {
          setVideoStatus(response?.hasVideo || false);
        }
      }
    );

    // Initialize or get existing peer for this tab
    chrome.runtime.sendMessage({ type: "INIT_PEER" });
  }
});

// Listen for messages from background/offscreen
chrome.runtime.onMessage.addListener((msg) => {
  // Only handle messages for our tab
  if (msg.tabId && msg.tabId !== currentTabId) return;

  if (msg.type === "PEER_INFO") {
    setMyId(msg.id);
    updatePeerList(msg.connectedPeers || []);
  }
  if (msg.type === "CONNECTION_STATUS") {
    setConnectionStatus(msg.status, msg.statusType || "info");
  }
  if (msg.type === "CONNECTED_PEERS_UPDATE") {
    updatePeerList(msg.connectedPeers || []);
  }
});

// Copy button
document.getElementById("copy-btn").addEventListener("click", () => {
  if (!myPeerId) return;

  navigator.clipboard.writeText(myPeerId).then(() => {
    const btn = document.getElementById("copy-btn");
    btn.textContent = "Copied!";
    btn.classList.add("copied");
    setTimeout(() => {
      btn.textContent = "Copy";
      btn.classList.remove("copied");
    }, 2000);
  });
});

// Connect button
document.getElementById("connect-btn").addEventListener("click", () => {
  const friendId = document.getElementById("friend-id").value.trim();
  if (!friendId) {
    setConnectionStatus("Please enter a friend's ID", "warning");
    return;
  }
  setConnectionStatus("Connecting...", "info");
  chrome.runtime.sendMessage({ type: "CONNECT_TO", targetId: friendId });
});
