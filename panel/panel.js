// Side panel: the queued-listings work list and the autofill trigger. All
// app traffic goes through the service worker, which holds the token.

const view = document.getElementById("view");
let currentListing = null;

function send(message) {
  return chrome.runtime.sendMessage(message).then((response) => {
    if (!response?.ok) throw new Error(response?.error || "No response — reload the extension.");
    return response.result;
  });
}

function template(id) {
  return document.getElementById(id).content.cloneNode(true);
}

function show(node) {
  view.replaceChildren(node);
}

function toast(text) {
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = text;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

// --- views -----------------------------------------------------------------

async function renderList() {
  currentListing = null;
  try {
    const { listings } = await send({ type: "api:listings" });
    if (!listings.length) return show(template("tpl-empty"));

    const wrap = document.createDocumentFragment();
    listings.forEach((listing) => {
      const card = template("tpl-listing-card");
      const button = card.querySelector(".listing-card");
      card.querySelector(".title").textContent = listing.title;
      card.querySelector(".price").textContent = priceLabel(listing);
      const cover = card.querySelector(".cover");
      if (listing.cover_url) cover.src = listing.cover_url; else cover.removeAttribute("src");
      button.addEventListener("click", () => renderDetail(listing.id));
      wrap.appendChild(card);
    });
    show(wrap);
  } catch (error) {
    renderError(error);
  }
}

async function renderDetail(listingId) {
  try {
    const { listing } = await send({ type: "api:listing", listingId });
    currentListing = listing;

    const node = template("tpl-detail");
    node.querySelector(".title").textContent = listing.title;
    node.querySelector(".price").textContent = priceLabel(listing);
    const cover = node.querySelector(".cover");
    if (listing.photo_urls?.length) cover.src = listing.photo_urls[0];

    const fields = node.querySelector(".fields");
    fieldRows(listing).forEach(([label, value]) => {
      if (!value) return;
      const row = document.createElement("div");
      row.className = "row";
      const dt = document.createElement("dt");
      dt.textContent = label;
      const dd = document.createElement("dd");
      dd.textContent = value;
      const copy = document.createElement("button");
      copy.className = "copy-btn";
      copy.textContent = "Copy";
      copy.addEventListener("click", () => navigator.clipboard.writeText(value));
      row.append(dt, dd, copy);
      fields.appendChild(row);
    });

    node.querySelector("[data-action=back]").addEventListener("click", renderList);
    node.querySelector("[data-action=open-sell-form]").addEventListener("click", openSellForm);
    node.querySelector("[data-action=autofill]").addEventListener("click", (event) =>
      runAutofill(listing, event.currentTarget));

    show(node);
  } catch (error) {
    renderError(error);
  }
}

function renderError(error) {
  const node = template(error.message.includes("Not configured") ? "tpl-setup" : "tpl-error");
  node.querySelector(".error-text")?.append(error.message);
  node.querySelector("[data-action=open-options]")?.addEventListener("click", () => chrome.runtime.openOptionsPage());
  node.querySelector("[data-action=retry]")?.addEventListener("click", renderList);
  show(node);
}

function fieldRows(listing) {
  return [
    ["Title", listing.title],
    ["Description", listing.description],
    ["Category", listing.category],
    ["Brand", listing.brand],
    ["Condition", listing.condition],
    ["Size", listing.size],
    ["Price", priceLabel(listing)],
    ["Photos", photoLabel(listing)]
  ];
}

function priceLabel(listing) {
  return listing.price ? `${listing.price} ${listing.currency || ""}`.trim() : "";
}

function photoLabel(listing) {
  const gallery = listing.photo_urls?.length || 0;
  const proofs = listing.authenticity_photo_urls?.length || 0;
  if (!gallery && !proofs) return "";
  return proofs ? `${gallery} + ${proofs} authenticity proofs` : `${gallery}`;
}

// --- actions -----------------------------------------------------------------

const SELL_URL = "https://www.vinted.com/items/new";

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function openSellForm() {
  const tab = await activeTab();
  if (tab?.url?.startsWith("https://www.vinted.com")) {
    await chrome.tabs.update(tab.id, { url: SELL_URL });
  } else {
    await chrome.tabs.create({ url: SELL_URL });
  }
}

async function runAutofill(listing, button) {
  const tab = await activeTab();
  if (!tab?.url?.startsWith(SELL_URL)) {
    toast("Open vinted.com/items/new in the active tab first.");
    return;
  }

  button.disabled = true;
  button.textContent = "Filling…";
  try {
    const report = await send({ type: "autofill", listingId: listing.id, tabId: tab.id });
    renderReport(report);
    toast("Autofill finished — review the form, then click Upload on Vinted.");
  } catch (error) {
    toast(`Autofill failed: ${error.message}`);
  } finally {
    button.disabled = false;
    button.textContent = "Autofill";
  }
}

function renderReport(report) {
  const box = view.querySelector(".report");
  const list = view.querySelector(".report-list");
  if (!box || !list) return;

  list.replaceChildren();
  report.forEach(({ field, status, note }) => {
    const li = document.createElement("li");
    const badge = document.createElement("span");
    badge.className = `badge badge-${status}`;
    badge.textContent = status;
    const name = document.createElement("strong");
    name.textContent = field;
    li.append(badge, name);
    if (note) {
      const noteEl = document.createElement("span");
      noteEl.className = "note";
      noteEl.textContent = note;
      li.appendChild(noteEl);
    }
    list.appendChild(li);
  });
  box.hidden = false;
}

// --- wiring ------------------------------------------------------------------

document.getElementById("refresh").addEventListener("click", renderList);

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "listing-published") {
    toast(`Published on Vinted — item #${message.vintedItemId}. Status updated in the app.`);
    renderList();
  }
});

renderList();
