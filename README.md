# SSD Vinted Assistant

Chrome side-panel extension that autofills Vinted's sell form from your
Style Savvy Div listings. You review every field and click Upload yourself —
the assistant never submits anything.

## Install (unpacked)

1. Open `chrome://extensions`, enable **Developer mode**.
2. **Load unpacked** → pick this `extension/` directory.
3. Click the extension's icon → the side panel opens. First run: paste the
   API token from your Style Savvy Div account settings (Account settings →
   Browser extension → Generate token) into the panel and hit **Connect**.

The host is automatic: an unpacked/development load talks to
`http://localhost:3000`; a packed/published build talks to
`https://ssdvinted.com` (via `chrome.management.getSelf().installType`).
The "Connect to production" toggle on the token screen overrides this, so
an unpacked copy can point at ssdvinted.com.

## Flow

1. In Style Savvy Div, set a listing's status to **Queued** — it appears in
   the panel.
2. On vinted.com, open the sell form (the panel's **Open sell form** button
   does this), pick the listing, hit **Autofill**.
3. The report shows what filled and what needs your hands (with copy
   buttons). Review, then click **Upload** on Vinted.
4. When Vinted lands on the new item page, the listing flips to
   **Published** in the app automatically, with its Vinted item id.

## Layout

- `background.js` — service worker; the only piece that talks to the app
  (env host, token auth, listing fetches, image bytes, the published
  callback).
- `panel/` — the side panel UI (token entry, queued list, detail, autofill
  report). Token entry lives here — no separate options page.
- `content/vinted.js` — the autofill engine on vinted.com; selector map
  ported from the app's dry-run rehearsals. Every step degrades to
  "manual" in the report instead of aborting.

No build step: plain ES modules, load-unpacked, edit → reload.
