// Store peers and connections per tab URL
const tabPeers = new Map(); // tabId -> { peer, url, connections: Map<peerId, conn> }

// Listen for messages from the Background script
chrome.runtime.onMessage.addListener((msg) => {
  // Only process messages that have tabId (i.e., routed through background.js)
  // This prevents double-processing when popup sends directly
  if (msg.type === "INIT_PEER") {
    if (!msg.tabId) return; // Ignore messages without tabId
    initOrGetPeer(msg.tabId, msg.tabUrl);
  } else if (msg.type === "GET_PEER_INFO") {
    if (!msg.tabId) return;
    sendPeerInfo(msg.tabId);
  } else if (msg.type === "CONNECT_TO") {
    if (!msg.tabId) return;
    connectToPeer(msg.tabId, msg.targetId);
  } else if (msg.type === "VIDEO_EVENT") {
    if (!msg.tabId) return;
    // Forward video events to all connected peers for this tab
    const tabData = tabPeers.get(msg.tabId);
    if (tabData && tabData.connections.size > 0) {
      tabData.connections.forEach((conn) => {
        if (conn.open) conn.send(msg.data);
      });
    }
  } else if (msg.type === "TAB_CLOSED") {
    cleanupTab(msg.tabId);
  }
});

function sendStatus(tabId, status, statusType = "info") {
  chrome.runtime.sendMessage({
    type: "CONNECTION_STATUS",
    tabId,
    status,
    statusType,
  });
}

function sendPeerInfo(tabId) {
  const tabData = tabPeers.get(tabId);
  if (tabData && tabData.peer && tabData.peer.id) {
    const connectedPeers = Array.from(tabData.connections.keys());
    chrome.runtime.sendMessage({
      type: "PEER_INFO",
      tabId,
      id: tabData.peer.id,
      connectedPeers,
    });
  }
}

function initOrGetPeer(tabId, tabUrl) {
  const existing = tabPeers.get(tabId);

  // If peer exists for this tab with same URL, reuse it
  if (
    existing &&
    existing.url === tabUrl &&
    existing.peer &&
    !existing.peer.destroyed
  ) {
    // Just send back the existing peer info
    sendPeerInfo(tabId);
    sendStatus(
      tabId,
      existing.connections.size > 0 ? "Connected" : "Not connected",
      existing.connections.size > 0 ? "success" : "info",
    );
    return;
  }

  // URL changed or no peer exists, create new one
  if (existing) {
    cleanupTab(tabId);
  }

  setupPeer(tabId, tabUrl);
}

function cleanupTab(tabId) {
  const tabData = tabPeers.get(tabId);
  if (tabData) {
    tabData.connections.forEach((conn) => conn.close());
    if (tabData.peer && !tabData.peer.destroyed) {
      tabData.peer.destroy();
    }
    tabPeers.delete(tabId);
  }
}

function setupPeer(tabId, tabUrl) {
  const peer = new Peer(); // Auto-generates an ID from PeerJS cloud server
  const tabData = { peer, url: tabUrl, connections: new Map() };
  tabPeers.set(tabId, tabData);

  peer.on("open", (id) => {
    chrome.runtime.sendMessage({
      type: "PEER_INFO",
      tabId,
      id,
      connectedPeers: [],
    });
  });

  peer.on("connection", (conn) => {
    setupConnection(tabId, conn);
    sendStatus(tabId, `${conn.peer} connected!`, "success");
  });

  peer.on("error", (err) => {
    sendStatus(tabId, `Error: ${err.type}`, "error");
  });
}

function connectToPeer(tabId, targetId) {
  const tabData = tabPeers.get(tabId);
  if (!tabData || !tabData.peer) {
    sendStatus(tabId, "No peer available", "error");
    return;
  }

  // Don't connect if already connected to this peer
  if (tabData.connections.has(targetId)) {
    sendStatus(tabId, "Already connected to this peer", "warning");
    return;
  }

  const conn = tabData.peer.connect(targetId);

  conn.on("open", () => {
    setupConnection(tabId, conn);
    sendStatus(tabId, "Connected!", "success");
  });

  conn.on("error", (err) => {
    sendStatus(tabId, `Connection error: ${err}`, "error");
  });
}

function setupConnection(tabId, conn) {
  const tabData = tabPeers.get(tabId);
  if (!tabData) return;

  tabData.connections.set(conn.peer, conn);

  // Notify about updated connected peers list
  chrome.runtime.sendMessage({
    type: "CONNECTED_PEERS_UPDATE",
    tabId,
    connectedPeers: Array.from(tabData.connections.keys()),
  });

  conn.on("data", (data) => {
    chrome.runtime.sendMessage({ type: "INCOMING_ACTION", tabId, data });
  });

  conn.on("close", () => {
    tabData.connections.delete(conn.peer);
    chrome.runtime.sendMessage({
      type: "CONNECTED_PEERS_UPDATE",
      tabId,
      connectedPeers: Array.from(tabData.connections.keys()),
    });
    sendStatus(tabId, `${conn.peer} disconnected`, "warning");
  });
}
