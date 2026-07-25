const appUrl = document.getElementById("appUrl");
const apiToken = document.getElementById("apiToken");
const status = document.getElementById("status");

chrome.storage.sync.get({ appUrl: "http://localhost:3000", apiToken: "" }).then((stored) => {
  appUrl.value = stored.appUrl;
  apiToken.value = stored.apiToken;
});

document.getElementById("save").addEventListener("click", async () => {
  await chrome.storage.sync.set({ appUrl: appUrl.value.trim(), apiToken: apiToken.value.trim() });
  status.textContent = "Saved.";
  setTimeout(() => (status.textContent = ""), 2500);
});

document.getElementById("test").addEventListener("click", async () => {
  status.textContent = "Testing…";
  await chrome.storage.sync.set({ appUrl: appUrl.value.trim(), apiToken: apiToken.value.trim() });
  const response = await chrome.runtime.sendMessage({ type: "api:listings" });
  status.textContent = response?.ok
    ? `Connected — ${response.result.listings.length} queued listing(s).`
    : `Failed: ${response?.error || "no response"}`;
});
