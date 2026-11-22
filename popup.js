const toggle = document.getElementById("yx-toggle");

chrome.storage.sync.get({ yxEnabled: true }, (result) => {
  toggle.checked = result.yxEnabled !== false;
});

toggle.addEventListener("change", () => {
  chrome.storage.sync.set({ yxEnabled: toggle.checked });
});
