let peer;
let conn;

// Listen for messages from the Background script
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "INIT_PEER") {
    setupPeer();
  } else if (msg.type === "CONNECT_TO") {
    connectToPeer(msg.targetId);
  } else if (msg.type === "VIDEO_EVENT" && conn) {
    // Forward video events to the connected friend
    conn.send(msg.data);
  }
});

function sendConnectionStatus(status, statusType = "info") {
  chrome.runtime.sendMessage({ type: "CONNECTION_STATUS", status, statusType });
}

function setupPeer() {
  peer = new Peer(); // Auto-generates an ID from PeerJS cloud server

  peer.on("open", (id) => {
    // Send my ID back to the popup so I can share it
    chrome.runtime.sendMessage({ type: "MY_ID", id: id });
  });

  peer.on("connection", (c) => {
    conn = c;
    sendConnectionStatus("Friend connected!", "success");
    setupConnection();
  });

  peer.on("error", (err) => {
    sendConnectionStatus(`Error: ${err.type}`, "error");
  });
}

function connectToPeer(id) {
  conn = peer.connect(id);

  conn.on("open", () => {
    sendConnectionStatus("Connected!", "success");
    setupConnection();
  });

  conn.on("error", (err) => {
    sendConnectionStatus(`Connection error: ${err}`, "error");
  });
}

function setupConnection() {
  // Listen for incoming data from friend
  conn.on("data", (data) => {
    // Send it to the Background script to be forwarded to the video
    chrome.runtime.sendMessage({ type: "INCOMING_ACTION", data: data });
  });

  conn.on("close", () => {
    sendConnectionStatus("Disconnected", "warning");
  });
}
