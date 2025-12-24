// Default settings
const DEFAULT_SETTINGS = {
  syncInterval: 1000,
  allowedOffset: 0.3,
  toastEnabled: true,
  toastDuration: 1500,
};

// Load settings from storage
function loadSettings() {
  chrome.storage.sync.get(DEFAULT_SETTINGS, (settings) => {
    document.getElementById("syncInterval").value = settings.syncInterval;
    document.getElementById("allowedOffset").value = settings.allowedOffset;
    document.getElementById("toastEnabled").checked = settings.toastEnabled;
    document.getElementById("toastDuration").value = settings.toastDuration;
  });
}

// Save settings to storage
function saveSettings() {
  const settings = {
    syncInterval: parseInt(document.getElementById("syncInterval").value, 10),
    allowedOffset: parseFloat(document.getElementById("allowedOffset").value),
    toastEnabled: document.getElementById("toastEnabled").checked,
    toastDuration: parseInt(document.getElementById("toastDuration").value, 10),
  };

  chrome.storage.sync.set(settings, () => {
    // Show success message
    const status = document.getElementById("status");
    status.classList.add("success");
    setTimeout(() => {
      status.classList.remove("success");
    }, 2000);
  });
}

// Initialize
document.addEventListener("DOMContentLoaded", loadSettings);
document.getElementById("save").addEventListener("click", saveSettings);
