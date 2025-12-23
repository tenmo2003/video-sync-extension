// Store peers and connections per tab URL
// tabId -> { peer, url, connections: Map<peerId, conn>, isHost: boolean, hostRequests: Set<peerId> }
const tabPeers = new Map();

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
  } else if (msg.type === "DISCONNECT_PEER") {
    if (!msg.tabId) return;
    disconnectPeer(msg.tabId, msg.peerId);
  } else if (msg.type === "DISCONNECT_ALL") {
    if (!msg.tabId) return;
    disconnectAll(msg.tabId);
  } else if (msg.type === "REQUEST_HOST") {
    if (!msg.tabId) return;
    requestHost(msg.tabId);
  } else if (msg.type === "PROMOTE_PEER") {
    if (!msg.tabId) return;
    promotePeer(msg.tabId, msg.peerId);
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
      isHost: tabData.isHost,
      hostRequests: Array.from(tabData.hostRequests || []),
    });
  }
}

function sendRoleUpdate(tabId) {
  const tabData = tabPeers.get(tabId);
  if (tabData) {
    chrome.runtime.sendMessage({
      type: "ROLE_UPDATE",
      tabId,
      isHost: tabData.isHost,
      hostRequests: Array.from(tabData.hostRequests || []),
    });
    // Notify content script about role
    chrome.runtime.sendMessage({
      type: "NOTIFY_CONTENT_ROLE",
      tabId,
      isHost: tabData.isHost,
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
  const tabData = {
    peer,
    url: tabUrl,
    connections: new Map(),
    isHost: false, // Will be set when connection is established
    hostRequests: new Set(),
    hostPeerId: null, // The host's peer ID (for redirecting new connections)
  };
  tabPeers.set(tabId, tabData);

  peer.on("open", (id) => {
    chrome.runtime.sendMessage({
      type: "PEER_INFO",
      tabId,
      id,
      connectedPeers: [],
      isHost: false,
      hostRequests: [],
    });
  });

  peer.on("connection", (conn) => {
    const currentTabData = tabPeers.get(tabId);

    // If we are a guest (have connections but not host), redirect the connecting peer to the host
    if (
      currentTabData &&
      currentTabData.connections.size > 0 &&
      !currentTabData.isHost &&
      currentTabData.hostPeerId
    ) {
      conn.on("open", () => {
        conn.send({
          type: "REDIRECT_TO_HOST",
          hostPeerId: currentTabData.hostPeerId,
        });
        sendStatus(tabId, `Redirected ${conn.peer} to host`, "info");
        // Close connection after a short delay to ensure message is sent
        setTimeout(() => conn.close(), 1000);
      });
      return;
    }

    // If we're already the host (promoted), accept this as a guest reconnecting
    if (currentTabData && currentTabData.isHost) {
      setupConnection(tabId, conn, true); // Keep host status
      sendStatus(tabId, `${conn.peer} connected!`, "success");
      return;
    }

    // First incoming connection means we become the host
    setupConnection(tabId, conn, true);
    sendStatus(tabId, `${conn.peer} connected! You are the host.`, "success");
  });

  peer.on("error", (err) => {
    sendStatus(tabId, `Error: ${err.type}`, "error");
  });
}

function connectToPeer(tabId, targetId, isRedirect = false) {
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
  let redirectHandled = false;

  conn.on("open", () => {
    // Listen for redirect message before setting up connection
    conn.on("data", (data) => {
      if (
        data.type === "REDIRECT_TO_HOST" &&
        data.hostPeerId &&
        !redirectHandled
      ) {
        redirectHandled = true;
        sendStatus(tabId, `Redirecting to host...`, "info");
        conn.close();
        // Connect to the actual host
        setTimeout(() => {
          connectToPeer(tabId, data.hostPeerId, true);
        }, 100);
      }
    });

    // Wait a moment to see if we get a redirect
    setTimeout(() => {
      if (!redirectHandled && conn.open) {
        // Outgoing connection means we are a guest
        setupConnection(tabId, conn, false);
        const statusMsg = isRedirect
          ? "Connected to host! You are a guest."
          : "Connected! You are a guest.";
        sendStatus(tabId, statusMsg, "success");
      }
    }, 200);
  });

  conn.on("error", (err) => {
    sendStatus(tabId, `Connection error: ${err}`, "error");
  });
}

function notifyPeersConnected(tabId, connected) {
  chrome.runtime.sendMessage({
    type: "NOTIFY_CONTENT_PEERS",
    tabId,
    connected,
  });
}

function setupConnection(tabId, conn, becomeHost = false) {
  const tabData = tabPeers.get(tabId);
  if (!tabData) return;

  const wasEmpty = tabData.connections.size === 0;
  tabData.connections.set(conn.peer, conn);

  // Set host status if this is the first connection
  if (wasEmpty) {
    tabData.isHost = becomeHost;
    // If we're a guest, store the host's peer ID for redirecting future connections
    if (!becomeHost) {
      tabData.hostPeerId = conn.peer;
    } else {
      // If we're the host, our own ID is the host
      tabData.hostPeerId = tabData.peer.id;
    }
    sendRoleUpdate(tabId);
  }

  // Notify about updated connected peers list
  chrome.runtime.sendMessage({
    type: "CONNECTED_PEERS_UPDATE",
    tabId,
    connectedPeers: Array.from(tabData.connections.keys()),
  });

  // Notify content script to start sync if this is the first connection
  if (wasEmpty) {
    notifyPeersConnected(tabId, true);
  }

  // Notify content script about peer join
  chrome.runtime.sendMessage({
    type: "NOTIFY_PEER_JOINED",
    tabId,
    peerId: conn.peer,
  });

  conn.on("data", (data) => {
    // Handle role-related messages
    if (data.type === "HOST_REQUEST") {
      // A guest is requesting host control
      tabData.hostRequests.add(conn.peer);
      sendRoleUpdate(tabId);
      sendStatus(tabId, `${conn.peer} is requesting host control`, "warning");
      // Notify content script
      chrome.runtime.sendMessage({
        type: "NOTIFY_PEER_REQUESTING_HOST",
        tabId,
        peerId: conn.peer,
      });
    } else if (data.type === "HOST_GRANTED") {
      // We have been promoted to host
      tabData.isHost = true;
      tabData.hostPeerId = tabData.peer.id; // We are now the host
      tabData.hostRequests.clear();

      // Store old host's peer ID (the sender) - they will stay connected as a guest
      const oldHostPeerId = data.oldHostPeerId || conn.peer;

      // Log the guests we're expecting to connect
      if (data.guestPeerIds && data.guestPeerIds.length > 0) {
        sendStatus(
          tabId,
          `You are now the host! Expecting ${data.guestPeerIds.length} guest(s) to reconnect.`,
          "success",
        );
      } else {
        sendStatus(tabId, "You are now the host!", "success");
      }

      sendRoleUpdate(tabId);
    } else if (data.type === "HOST_REVOKED") {
      // We are no longer host, the sender is the new host
      tabData.isHost = false;
      tabData.hostPeerId = conn.peer; // The peer who sent this is the new host
      sendRoleUpdate(tabId);
      sendStatus(tabId, "You are now a guest", "info");
    } else if (data.type === "RECONNECT_TO_NEW_HOST") {
      // The host has changed, we need to disconnect and reconnect to the new host
      const newHostPeerId = data.newHostPeerId;
      tabData.hostPeerId = newHostPeerId;

      sendStatus(tabId, `Host changed. Reconnecting to new host...`, "info");

      // Close current connection and connect to new host
      conn.close();
      tabData.connections.clear();

      // Connect to the new host after a short delay
      setTimeout(() => {
        connectToPeer(tabId, newHostPeerId, true);
      }, 300);
    } else if (data.type === "HOST_CHANGED") {
      // The host has changed to a different peer (info update only)
      tabData.hostPeerId = data.newHostPeerId;
      sendStatus(tabId, `Host changed to ${data.newHostPeerId}`, "info");
    } else {
      // Regular video sync data
      chrome.runtime.sendMessage({ type: "INCOMING_ACTION", tabId, data });
    }
  });

  conn.on("close", () => {
    const peerId = conn.peer;
    tabData.connections.delete(peerId);
    tabData.hostRequests.delete(peerId);

    chrome.runtime.sendMessage({
      type: "CONNECTED_PEERS_UPDATE",
      tabId,
      connectedPeers: Array.from(tabData.connections.keys()),
    });

    // Notify content script about peer disconnect
    chrome.runtime.sendMessage({
      type: "NOTIFY_PEER_DISCONNECTED",
      tabId,
      peerId,
    });

    // Notify content script to stop sync if no more connections
    if (tabData.connections.size === 0) {
      notifyPeersConnected(tabId, false);
      tabData.isHost = false;
      tabData.hostPeerId = null;
      tabData.hostRequests.clear();
    }

    sendRoleUpdate(tabId);
    sendStatus(tabId, `${peerId} disconnected`, "warning");
  });
}

function disconnectPeer(tabId, peerId) {
  const tabData = tabPeers.get(tabId);
  if (!tabData) return;

  const conn = tabData.connections.get(peerId);
  if (conn) {
    conn.close();
    tabData.connections.delete(peerId);

    chrome.runtime.sendMessage({
      type: "CONNECTED_PEERS_UPDATE",
      tabId,
      connectedPeers: Array.from(tabData.connections.keys()),
    });

    if (tabData.connections.size === 0) {
      notifyPeersConnected(tabId, false);
      sendStatus(tabId, "Disconnected", "info");
    } else {
      sendStatus(tabId, `Disconnected from ${peerId}`, "info");
    }
  }
}

function disconnectAll(tabId) {
  const tabData = tabPeers.get(tabId);
  if (!tabData) return;

  tabData.connections.forEach((conn) => conn.close());
  tabData.connections.clear();

  chrome.runtime.sendMessage({
    type: "CONNECTED_PEERS_UPDATE",
    tabId,
    connectedPeers: [],
  });

  notifyPeersConnected(tabId, false);
  tabData.isHost = false;
  tabData.hostPeerId = null;
  tabData.hostRequests.clear();
  sendRoleUpdate(tabId);
  sendStatus(tabId, "Disconnected from all peers", "info");
}

function requestHost(tabId) {
  const tabData = tabPeers.get(tabId);
  if (!tabData || tabData.isHost) return;

  // Send host request to all connected peers (the host will receive it)
  tabData.connections.forEach((conn) => {
    if (conn.open) {
      conn.send({ type: "HOST_REQUEST" });
    }
  });
  sendStatus(tabId, "Host control requested", "info");
}

function promotePeer(tabId, peerId) {
  const tabData = tabPeers.get(tabId);
  if (!tabData || !tabData.isHost) return;

  const targetConn = tabData.connections.get(peerId);
  if (!targetConn || !targetConn.open) return;

  // Collect all guest peer IDs (excluding the new host)
  const guestPeerIds = Array.from(tabData.connections.keys()).filter(
    (id) => id !== peerId,
  );

  // Notify the target peer they are now host, include list of guests
  targetConn.send({
    type: "HOST_GRANTED",
    guestPeerIds: guestPeerIds,
    oldHostPeerId: tabData.peer.id,
  });

  // Notify all other guests to reconnect to the new host
  tabData.connections.forEach((conn, id) => {
    if (id !== peerId && conn.open) {
      conn.send({ type: "RECONNECT_TO_NEW_HOST", newHostPeerId: peerId });
    }
  });

  // We are no longer the host, update our hostPeerId
  tabData.isHost = false;
  tabData.hostPeerId = peerId;
  tabData.hostRequests.delete(peerId);

  // Close all connections - we'll reconnect to the new host
  tabData.connections.forEach((conn, id) => {
    if (id !== peerId) {
      conn.close();
    }
  });

  // Keep only connection to new host
  const newHostConn = tabData.connections.get(peerId);
  tabData.connections.clear();
  if (newHostConn) {
    tabData.connections.set(peerId, newHostConn);
  }

  sendRoleUpdate(tabId);
  sendStatus(tabId, `Promoted ${peerId} to host. You are now a guest.`, "info");

  // Notify popup about updated peer list
  chrome.runtime.sendMessage({
    type: "CONNECTED_PEERS_UPDATE",
    tabId,
    connectedPeers: Array.from(tabData.connections.keys()),
  });
}
