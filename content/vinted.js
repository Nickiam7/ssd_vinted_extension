// Autofill engine for Vinted's sell form (/items/new). Ported selector-for-
// selector from the SSD Vinted dry-run rehearsals (2026-07). Every step is
// independent: a failure marks that field "manual" in the report instead of
// aborting, so a Vinted markup change degrades gracefully.
//
// Also hosts the loop-closer: after an autofill, the tab watches for the
// user's Upload click landing on /items/<id> and reports it back.

(() => {
  const SEL = {
    photosInput: '[data-testid="add-photos-input"]',
    mediaGrid: '[data-testid="media-upload-grid"]',
    title: '[data-testid="title--input"]',
    description: '[data-testid="description--input"]',
    categoryInput: '[data-testid="catalog-select-dropdown-input"]',
    categoryDropdown: '[data-testid="catalog-select-dropdown-content"]',
    cellTitle: ".web_ui__Cell__title",
    brandPrefix: "brand-select-dropdown",
    conditionPrefix: "category-condition-single-list",
    packageRadios: "[data-testid^='package_type_selector_'][data-testid$='--input']",
    packageRecommendedRadio: '[data-testid="package_type_selector_1--input"]',
    price: '[data-testid="price-input--input"]',
    colorInput: '[data-testid="color-select-dropdown-input"]',
    colorDropdown: '[data-testid="color-select-dropdown-content"]',
    materialInput: '[data-testid="category-material-multi-list-input"]',
    materialDropdown: '[data-testid="category-material-multi-list-content"]'
  };

  const PENDING_KEY = "ssdv-pending-listing";
  const PENDING_TTL_MS = 30 * 60 * 1000;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  async function waitFor(selector, timeoutMs = 5000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const el = document.querySelector(selector);
      if (el) return el;
      await sleep(150);
    }
    return null;
  }

  // React tracks input state internally — assigning .value directly is
  // invisible to it. Mimic a real entry: focus, native-set, a typed-looking
  // InputEvent, change, then blur. The blur matters — Vinted's price field
  // parses on commit, and without it the form validates against the old
  // (empty) internal value even though the new one is displayed.
  function setNativeValue(el, value) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    el.focus();
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
    el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.blur();
  }

  function b64ToFile({ name, type, dataB64 }) {
    const binary = atob(dataB64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return new File([bytes], name, { type });
  }

  function exactCell(container, text) {
    return [...container.querySelectorAll(SEL.cellTitle)]
      .find((el) => el.textContent.trim() === text);
  }

  async function openDropdown(inputSelector, contentSelector) {
    const input = document.querySelector(inputSelector);
    if (!input) return null;
    input.click();
    let content = await waitFor(contentSelector, 2500);
    if (!content) {
      input.click();
      content = await waitFor(contentSelector, 4000);
    }
    return content;
  }

  function closeDropdowns() {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  }

  // Vinted's pickers don't toggle on input clicks while open — the chevron
  // (.c-input__icon) is the real toggle. Escalate: chevron, outside click,
  // Escape; report whether the dropdown actually went away.
  async function closePicker(inputSel, contentSel) {
    const stillOpen = () => Boolean(document.querySelector(contentSel));
    if (!stillOpen()) return true;

    const icon = document.querySelector(inputSel)?.closest(".c-input__content")?.querySelector(".c-input__icon");
    if (icon) {
      icon.click();
      await sleep(300);
      if (!stillOpen()) return true;
    }
    document.body.click();
    await sleep(300);
    if (!stillOpen()) return true;

    closeDropdowns();
    await sleep(300);
    return !stillOpen();
  }

  // --- steps -------------------------------------------------------------

  async function fillPhotos(images, proofs, report) {
    const all = [...images, ...proofs];
    const label = proofs.length ? `photos (${images.length} + ${proofs.length} proofs)` : "photos";
    if (!all.length) return report.push({ field: "photos", status: "skipped", note: "No photos on the listing." });

    const input = document.querySelector(SEL.photosInput);
    if (!input) return report.push({ field: "photos", status: "manual", note: "Photo input not found." });

    const transfer = new DataTransfer();
    all.forEach((image) => transfer.items.add(b64ToFile(image)));
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));

    const deadline = Date.now() + 90 * 1000;
    let count = 0;
    while (Date.now() < deadline) {
      count = document.querySelector(SEL.mediaGrid)?.children.length || 0;
      if (count >= all.length) break;
      await sleep(1000);
    }
    if (count >= all.length) {
      report.push({ field: "photos", status: "filled", note: `${all.length} uploaded (${label}).` });
    } else {
      report.push({ field: "photos", status: "manual", note: `Only ${count}/${all.length} processed — check the grid.` });
    }
  }

  function fillText(field, selector, value, report) {
    if (!value) return report.push({ field, status: "skipped", note: "No value on the listing." });
    const el = document.querySelector(selector);
    if (!el) return report.push({ field, status: "manual", note: "Field not found on the page." });
    setNativeValue(el, value);
    report.push({ field, status: "filled" });
  }

  async function fillCategory(segments, report) {
    if (!segments?.length) return report.push({ field: "category", status: "skipped", note: "No category on the listing." });

    const dropdown = await openDropdown(SEL.categoryInput, SEL.categoryDropdown);
    if (!dropdown) return report.push({ field: "category", status: "manual", note: "Category picker didn't open." });

    for (const segment of segments) {
      const cell = exactCell(document.querySelector(SEL.categoryDropdown) || dropdown, segment);
      if (!cell) {
        closeDropdowns();
        return report.push({ field: "category", status: "manual", note: `"${segment}" not found in the picker.` });
      }
      cell.click();
      await sleep(700);
    }

    const chosen = document.querySelector(SEL.categoryInput)?.value || "";
    if (chosen) {
      report.push({ field: "category", status: "filled", note: chosen });
    } else {
      closeDropdowns();
      report.push({ field: "category", status: "manual", note: "Path didn't reach a leaf — pick by hand." });
    }
  }

  async function fillFromDropdown(field, prefix, value, report) {
    if (!value) return report.push({ field, status: "skipped", note: "No value on the listing." });

    const inputSel = `[data-testid="${prefix}-input"]`;
    const contentSel = `[data-testid="${prefix}-content"]`;
    if (!document.querySelector(inputSel)) {
      return report.push({ field, status: "manual", note: "Field not present — it may need the category first." });
    }

    const content = await openDropdown(inputSel, contentSel);
    if (!content) return report.push({ field, status: "manual", note: "Dropdown didn't open." });

    const cell = exactCell(content, value);
    if (!cell) {
      closeDropdowns();
      return report.push({ field, status: "manual", note: `"${value}" not in the list.` });
    }
    cell.click();
    await sleep(500);
    report.push({ field, status: "filled", note: value });
  }

  // Colors and material are checkbox multi-selects in the same component
  // family: clicking a titled cell toggles it, the dropdown stays open, and
  // the input echoes the picks. Collapse by toggling the input when done.
  async function fillMultiPick(field, inputSel, contentSel, values, report, { max } = {}) {
    if (!values?.length) return report.push({ field, status: "skipped", note: "No value on the listing." });
    const picks = max ? values.slice(0, max) : values;

    if (!document.querySelector(inputSel)) {
      return report.push({ field, status: "manual", note: "Field not present — it may need the category first." });
    }
    const content = await openDropdown(inputSel, contentSel);
    if (!content) return report.push({ field, status: "manual", note: "Dropdown didn't open." });

    const missing = [];
    for (const value of picks) {
      const cell = exactCell(content, value);
      if (cell) {
        cell.click();
        await sleep(300);
      } else {
        missing.push(value);
      }
    }
    const closed = await closePicker(inputSel, contentSel);

    const chosen = document.querySelector(inputSel)?.value || "";
    if (missing.length) {
      report.push({ field, status: "manual", note: `Not in the list: ${missing.join(", ")}. Picked: ${chosen || "none"}.` });
    } else {
      const note = closed ? (chosen || picks.join(", ")) : `${chosen || picks.join(", ")} — dropdown wouldn't close, click elsewhere.`;
      report.push({ field, status: "filled", note });
    }
  }

  async function dismissAuthenticityModal(report) {
    const heading = [...document.querySelectorAll("h1, h2, h3")]
      .find((el) => el.textContent.trim() === "Proof of authenticity");
    if (!heading) return;

    const close = [...document.querySelectorAll("button")]
      .find((el) => el.textContent.trim() === "Close");
    if (close) close.click();
    else closeDropdowns();
    await sleep(500);
    report.push({ field: "authenticity", status: "filled", note: "Reminder modal closed — proofs ride in the photo set." });
  }

  async function fillPackage(report) {
    const anyChecked = () => [...document.querySelectorAll(SEL.packageRadios)].some((el) => el.checked);
    const radio = document.querySelector(SEL.packageRecommendedRadio);
    if (!radio) return report.push({ field: "package", status: "skipped", note: "No package section (yet)." });
    if (anyChecked()) return report.push({ field: "package", status: "filled", note: "Already selected." });

    radio.click();
    await sleep(300);
    if (anyChecked()) {
      report.push({ field: "package", status: "filled", note: "Recommended size." });
    } else {
      report.push({ field: "package", status: "manual", note: "Radio didn't register — pick one." });
    }
  }

  // --- pipeline ----------------------------------------------------------

  async function autofill({ listing, images, proofs }) {
    const report = [];

    if (!location.pathname.startsWith("/items/new")) {
      return [{ field: "page", status: "manual", note: "Open vinted.com/items/new first." }];
    }
    if (!(await waitFor(SEL.title, 10000))) {
      return [{ field: "page", status: "manual", note: "Sell form didn't load — is it showing an error?" }];
    }

    await fillPhotos(images, proofs, report);
    fillText("title", SEL.title, listing.title, report);
    fillText("description", SEL.description, listing.description, report);
    await fillCategory(listing.category_segments, report);
    await sleep(800); // detail sections re-render after the category lands
    await fillFromDropdown("brand", SEL.brandPrefix, listing.brand, report);
    await dismissAuthenticityModal(report);
    await fillFromDropdown("condition", SEL.conditionPrefix, listing.condition, report);
    await fillMultiPick("colors", SEL.colorInput, SEL.colorDropdown, listing.color_list, report, { max: 2 });
    await fillMultiPick("material", SEL.materialInput, SEL.materialDropdown, listing.material_list, report);
    fillText("price", SEL.price, listing.price, report);
    await fillPackage(report);
    await dismissAuthenticityModal(report);

    armLoopCloser(listing.id);
    return report;
  }

  // --- loop-closer ---------------------------------------------------------

  function armLoopCloser(listingId) {
    sessionStorage.setItem(PENDING_KEY, JSON.stringify({ listingId, armedAt: Date.now() }));
  }

  function pendingListing() {
    try {
      const pending = JSON.parse(sessionStorage.getItem(PENDING_KEY) || "null");
      if (!pending) return null;
      if (Date.now() - pending.armedAt > PENDING_TTL_MS) {
        sessionStorage.removeItem(PENDING_KEY);
        return null;
      }
      return pending;
    } catch {
      return null;
    }
  }

  setInterval(() => {
    const pending = pendingListing();
    if (!pending) return;

    const match = location.pathname.match(/^\/items\/(\d+)/);
    if (!match) return;

    sessionStorage.removeItem(PENDING_KEY);
    chrome.runtime.sendMessage({
      type: "published-detected",
      listingId: pending.listingId,
      vintedItemId: match[1]
    }).catch(() => {});
  }, 1000);

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type !== "autofill") return false;
    autofill(message)
      .then((report) => sendResponse(report))
      .catch((error) => sendResponse([{ field: "page", status: "manual", note: `Autofill crashed: ${error.message}` }]));
    return true;
  });
})();
