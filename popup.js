let currentTabId = null;
let myPeerId = null;
let isHost = false;
let hostRequests = [];

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
  const disconnectAllBtn = document.getElementById("disconnect-all");
  const requestHostBtn = document.getElementById("request-host-btn");

  if (peers.length === 0) {
    el.innerHTML = "";
    disconnectAllBtn.style.display = "none";
    requestHostBtn.style.display = "none";
  } else {
    el.innerHTML = peers.map(p => {
      const isRequesting = hostRequests.includes(p);
      const itemClass = isRequesting ? "peer-item requesting" : "peer-item";
      const promoteBtn = isHost ? `<button class="promote-btn" data-peer-id="${p}">Promote</button>` : "";
      const requestLabel = isRequesting ? " (requesting)" : "";
      return `
        <div class="${itemClass}">
          <span class="peer-id">${p}${requestLabel}</span>
          ${promoteBtn}
          <button class="disconnect-btn" data-peer-id="${p}">X</button>
        </div>
      `;
    }).join("");
    disconnectAllBtn.style.display = "block";

    // Show request host button only for guests
    requestHostBtn.style.display = isHost ? "none" : "block";

    // Add click handlers for disconnect buttons
    el.querySelectorAll(".disconnect-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const peerId = btn.getAttribute("data-peer-id");
        chrome.runtime.sendMessage({ type: "DISCONNECT_PEER", peerId });
      });
    });

    // Add click handlers for promote buttons (host only)
    el.querySelectorAll(".promote-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const peerId = btn.getAttribute("data-peer-id");
        chrome.runtime.sendMessage({ type: "PROMOTE_PEER", peerId });
      });
    });
  }
}

function updateRoleIndicator(hasConnections) {
  const el = document.getElementById("role-indicator");
  const requestHostBtn = document.getElementById("request-host-btn");

  if (!hasConnections) {
    el.style.display = "none";
    requestHostBtn.style.display = "none";
    return;
  }

  el.style.display = "block";
  if (isHost) {
    el.className = "host";
    el.innerText = "You are the Host (you control the video)";
    requestHostBtn.style.display = "none";
  } else {
    el.className = "guest";
    el.innerText = "You are a Guest (video is controlled by host)";
    requestHostBtn.style.display = "block";
  }
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
    isHost = msg.isHost || false;
    hostRequests = msg.hostRequests || [];
    const peers = msg.connectedPeers || [];
    updatePeerList(peers);
    updateRoleIndicator(peers.length > 0);
  }
  if (msg.type === "CONNECTION_STATUS") {
    setConnectionStatus(msg.status, msg.statusType || "info");
  }
  if (msg.type === "CONNECTED_PEERS_UPDATE") {
    const peers = msg.connectedPeers || [];
    updatePeerList(peers);
    updateRoleIndicator(peers.length > 0);
  }
  if (msg.type === "ROLE_UPDATE") {
    isHost = msg.isHost || false;
    hostRequests = msg.hostRequests || [];
    // Re-render peer list with updated role info
    const peerListEl = document.getElementById("peer-list");
    const currentPeers = Array.from(peerListEl.querySelectorAll(".peer-id")).map(el => el.textContent.replace(" (requesting)", ""));
    updatePeerList(currentPeers);
    updateRoleIndicator(currentPeers.length > 0);
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

// Settings link
document.getElementById("settings-link").addEventListener("click", (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

// Disconnect all button
document.getElementById("disconnect-all").addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "DISCONNECT_ALL" });
});

// Request host button
document.getElementById("request-host-btn").addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "REQUEST_HOST" });
});
