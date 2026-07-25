// Service worker: the only piece that talks to the SSD Vinted app. It holds
// the token (chrome.storage), fetches listings and image bytes, relays
// autofill jobs to the content script, and receives the loop-closer ping
// when an Upload lands on a new Vinted item page.

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

async function config() {
  const stored = await chrome.storage.sync.get({ appUrl: "http://localhost:3000", apiToken: "" });
  return { appUrl: stored.appUrl.replace(/\/+$/, ""), apiToken: stored.apiToken };
}

async function api(path, options = {}) {
  const { appUrl, apiToken } = await config();
  if (!apiToken) throw new Error("Not configured — set the app URL and API token in the extension options.");

  const response = await fetch(`${appUrl}${path}`, {
    ...options,
    headers: {
      "Authorization": `Token ${apiToken}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  if (!response.ok) throw new Error(`App API ${response.status} on ${path}`);
  return response.json();
}

// Vinted's sell form needs real files; images ride from here to the content
// script as base64 (extension messages are JSON).
async function fetchImage(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Image fetch ${response.status}`);
  const type = response.headers.get("content-type") || "image/jpeg";
  const bytes = new Uint8Array(await response.arrayBuffer());
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  const name = decodeURIComponent(url.split("/").pop() || "photo.jpg").split("?")[0];
  return { name, type, dataB64: btoa(binary) };
}

async function runAutofill({ listingId, tabId }) {
  const { listing } = await api(`/api/v1/listings/${listingId}`);
  const images = [];
  for (const url of listing.photo_urls || []) images.push(await fetchImage(url));
  const proofs = [];
  for (const url of listing.authenticity_photo_urls || []) proofs.push(await fetchImage(url));

  const report = await chrome.tabs.sendMessage(tabId, { type: "autofill", listing, images, proofs });
  return report;
}

async function markPublished({ listingId, vintedItemId }) {
  const result = await api(`/api/v1/listings/${listingId}/published`, {
    method: "POST",
    body: JSON.stringify({ vinted_item_id: vintedItemId })
  });
  // Let an open panel refresh its list.
  chrome.runtime.sendMessage({ type: "listing-published", listingId, vintedItemId }).catch(() => {});
  return result;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const handlers = {
    "api:listings": () => api("/api/v1/listings"),
    "api:listing": () => api(`/api/v1/listings/${message.listingId}`),
    "autofill": () => runAutofill(message),
    "published-detected": () => markPublished(message)
  };
  const handler = handlers[message.type];
  if (!handler) return false;

  handler()
    .then((result) => sendResponse({ ok: true, result }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));
  return true; // async sendResponse
});
