const video = document.querySelector("video");
let isRemoteUpdate = false; // Flag to prevent infinite loops

if (video) {
  // 1. LISTEN: Capture local user actions
  ["play", "pause", "seeked"].forEach((event) => {
    video.addEventListener(event, () => {
      if (isRemoteUpdate) return; // Ignore if we just applied a remote change

      chrome.runtime.sendMessage({
        type: "VIDEO_EVENT",
        data: {
          action: event,
          time: video.currentTime,
          timestamp: Date.now(),
        },
      });
    });
  });

  // 2. APPLY: Receive actions from friend
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "APPLY_ACTION") {
      const { action, time } = msg.data;

      isRemoteUpdate = true; // Set flag so we don't send this back

      if (action === "pause") video.pause();
      if (action === "play") video.play();
      if (Math.abs(video.currentTime - time) > 0.5) {
        video.currentTime = time;
      }

      // Reset flag after a short delay
      setTimeout(() => {
        isRemoteUpdate = false;
      }, 500);
    }
  });
}
