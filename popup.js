let currentTabId = null;
let currentTabUrl = null;
let myPeerId = null;
let isHost = false;
let hostRequests = [];
let myNickname = "";
let peerNicknames = {}; // peerId -> nickname
let connectedPeersList = []; // Track connected peers

// Status display helpers
let hasVideoOnPage = false;

function setVideoStatus(hasVideo) {
  hasVideoOnPage = hasVideo;
  const el = document.getElementById("video-status");
  const mainContent = document.getElementById("main-content");

  // Always show main content so users can join as guest
  mainContent.style.display = "block";

  if (hasVideo) {
    el.style.display = "none";
  } else {
    el.style.display = "block";
    el.className = "status warning";
    el.innerText = "No video on this page - you can still join a room as guest";
  }

  updateInviteButton();
}

function setConnectionStatus(status, type = "info") {
  const el = document.getElementById("connection-status");
  el.className = `status ${type}`;
  el.innerText = status;
}

function formatPeerDisplay(peerId) {
  const nickname = peerNicknames[peerId];
  if (nickname) {
    return `<span class="peer-nickname" data-peer-id="${peerId}" title="${peerId}">${nickname}</span>`;
  }
  return peerId;
}

function updatePeerList(peers) {
  const el = document.getElementById("peer-list");
  const disconnectAllBtn = document.getElementById("disconnect-all");
  const requestHostBtn = document.getElementById("request-host-btn");
  const connectSection = document.getElementById("connect-section");

  if (peers.length === 0) {
    el.innerHTML = "";
    disconnectAllBtn.style.display = "none";
    requestHostBtn.style.display = "none";
    connectSection.classList.remove("hidden");
  } else {
    el.innerHTML = peers
      .map((p) => {
        const isRequesting = hostRequests.includes(p);
        const itemClass = isRequesting ? "peer-item requesting" : "peer-item";
        const promoteBtn = isHost
          ? `<button class="promote-btn" data-peer-id="${p}">Promote</button>`
          : "";
        const requestLabel = isRequesting ? " (requesting)" : "";
        return `
        <div class="${itemClass}">
          <span class="peer-id">${formatPeerDisplay(p)}${requestLabel}</span>
          ${promoteBtn}
          <button class="disconnect-btn" data-peer-id="${p}">X</button>
        </div>
      `;
      })
      .join("");
    disconnectAllBtn.style.display = "block";

    // Update button text, style, and heading based on role
    const peersHeading = document.getElementById("peers-heading");
    if (isHost) {
      disconnectAllBtn.innerText = "End Party";
      disconnectAllBtn.classList.add("end-party");
      connectSection.classList.add("hidden"); // Hide connect section for host
      peersHeading.innerText = "Connected Peers:";
    } else {
      disconnectAllBtn.innerText = "Leave Room";
      disconnectAllBtn.classList.remove("end-party");
      connectSection.classList.remove("hidden"); // Show connect section for guests
      peersHeading.innerText = "Connected Room:";
    }

    // Show request host button only for guests
    requestHostBtn.style.display = isHost ? "none" : "block";

    // Add click handlers for disconnect buttons
    el.querySelectorAll(".disconnect-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const peerId = btn.getAttribute("data-peer-id");
        chrome.runtime.sendMessage({ type: "DISCONNECT_PEER", peerId });
      });
    });

    // Add click handlers for promote buttons (host only)
    el.querySelectorAll(".promote-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const peerId = btn.getAttribute("data-peer-id");
        chrome.runtime.sendMessage({ type: "PROMOTE_PEER", peerId });
      });
    });

    // Add click handlers for nickname spans to copy peer ID (host only)
    if (isHost) {
      el.querySelectorAll(".peer-nickname").forEach((span) => {
        span.style.cursor = "pointer";
        span.addEventListener("click", () => {
          const peerId = span.getAttribute("data-peer-id");
          navigator.clipboard.writeText(peerId).then(() => {
            const originalText = span.textContent;
            span.textContent = "Copied guest ID!";
            setTimeout(() => {
              span.textContent = originalText;
            }, 1500);
          });
        });
      });
    }
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
    el.innerText = "HOST MODE";
    requestHostBtn.style.display = "none";
  } else {
    el.className = "guest";
    el.innerText = "GUEST MODE";
    requestHostBtn.style.display = "block";
  }
}

function truncateId(id, startChars = 6, endChars = 6) {
  if (!id || id.length <= startChars + endChars + 3) return id;
  return `${id.slice(0, startChars)}...${id.slice(-endChars)}`;
}

function setMyId(id) {
  myPeerId = id;
  const el = document.getElementById("my-id");
  if (id) {
    el.innerText = truncateId(id);
    el.title = id;
  } else {
    el.innerText = "Generating...";
    el.title = "";
  }
  updateInviteButton();
}

// Initialize - get current tab and request peer info
chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  if (tabs[0]) {
    currentTabId = tabs[0].id;
    currentTabUrl = tabs[0].url;

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
      },
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
    peerNicknames = msg.peerNicknames || {};
    connectedPeersList = msg.connectedPeers || [];
    updatePeerList(connectedPeersList);
    updateRoleIndicator(connectedPeersList.length > 0);
    updateInviteButton();
  }
  if (msg.type === "CONNECTION_STATUS") {
    setConnectionStatus(msg.status, msg.statusType || "info");
  }
  if (msg.type === "CONNECTED_PEERS_UPDATE") {
    peerNicknames = msg.peerNicknames || peerNicknames;
    connectedPeersList = msg.connectedPeers || [];
    updatePeerList(connectedPeersList);
    updateRoleIndicator(connectedPeersList.length > 0);
    updateInviteButton();
  }
  if (msg.type === "ROLE_UPDATE") {
    isHost = msg.isHost || false;
    hostRequests = msg.hostRequests || [];
    // Re-render peer list with updated role info
    const peerListEl = document.getElementById("peer-list");
    const currentPeers = Array.from(
      peerListEl.querySelectorAll(".disconnect-btn"),
    ).map((el) => el.getAttribute("data-peer-id"));
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

// Generate invite link with host ID
function generateInviteLink() {
  if (!myPeerId || !currentTabUrl) return null;

  try {
    const url = new URL(currentTabUrl);
    url.searchParams.set("videosync_host", myPeerId);
    return url.toString();
  } catch (e) {
    return null;
  }
}

// Update invite button state based on connection status and peer initialization
function updateInviteButton() {
  const btn = document.getElementById("invite-btn");
  // Show invite button only when:
  // 1. There's a video on the page (can't host without video)
  // 2. AND (not connected OR is host)
  const canInvite = hasVideoOnPage && (connectedPeersList.length === 0 || isHost);
  btn.style.display = canInvite ? "block" : "none";
  // Disable until peer is initialized
  btn.disabled = !myPeerId;
}

// Invite button - copy invite link
document.getElementById("invite-btn").addEventListener("click", () => {
  const inviteLink = generateInviteLink();
  if (!inviteLink) {
    setConnectionStatus("Cannot generate invite link", "error");
    return;
  }

  navigator.clipboard.writeText(inviteLink).then(() => {
    const btn = document.getElementById("invite-btn");
    btn.textContent = "Link Copied!";
    btn.classList.add("copied");
    setTimeout(() => {
      btn.textContent = "Copy Invite Link";
      btn.classList.remove("copied");
    }, 2000);
  });
});

// Connect button
document.getElementById("connect-btn").addEventListener("click", () => {
  const hostId = document.getElementById("host-id").value.trim();
  if (!hostId) {
    setConnectionStatus("Please enter a host's ID", "warning");
    return;
  }
  setConnectionStatus("Connecting...", "info");
  chrome.runtime.sendMessage({ type: "CONNECT_TO", targetId: hostId });
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

// Nickname handling
const nicknameInput = document.getElementById("nickname-input");
const nicknameSaveBtn = document.getElementById("nickname-save-btn");

// Load saved nickname
chrome.storage.sync.get(["nickname"], (result) => {
  if (result.nickname) {
    myNickname = result.nickname;
    nicknameInput.value = myNickname;
  }
});

// Save nickname function
function saveNickname() {
  myNickname = nicknameInput.value.trim();
  chrome.storage.sync.set({ nickname: myNickname });
  // Notify offscreen about nickname change
  chrome.runtime.sendMessage({ type: "UPDATE_NICKNAME", nickname: myNickname });
  // Visual feedback
  nicknameSaveBtn.textContent = "Saved!";
  nicknameSaveBtn.classList.add("saved");
  setTimeout(() => {
    nicknameSaveBtn.textContent = "Save";
    nicknameSaveBtn.classList.remove("saved");
  }, 1500);
}

// Save on button click
nicknameSaveBtn.addEventListener("click", saveNickname);

// Save on Enter key
nicknameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    saveNickname();
  }
});
