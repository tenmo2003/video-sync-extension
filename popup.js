// Tell background to wake up offscreen
chrome.runtime.sendMessage({ type: "INIT_PEER" });

// Listen for my ID
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "MY_ID") {
    document.getElementById("my-id").innerText = msg.id;
  }
});

document.getElementById("connect-btn").addEventListener("click", () => {
  const friendId = document.getElementById("friend-id").value;
  chrome.runtime.sendMessage({ type: "CONNECT_TO", targetId: friendId });
  alert("Connecting...");
});
