# SSD Vinted Assistant

Chrome side-panel extension that autofills Vinted's sell form from your
Style Savvy Div listings. You review every field and click Upload yourself —
the assistant never submits anything.

## Install (unpacked)

1. Open `chrome://extensions`, enable **Developer mode**.
2. **Load unpacked** → pick this `extension/` directory.
3. Click the extension's icon → the side panel opens. First run: open
   **Settings** and enter the app URL (`http://localhost:3000`) and the API
   token from Rails credentials (`extension.api_token`).

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
  (token auth, listing fetches, image bytes, the published callback).
- `panel/` — the side panel UI (queued list, detail, autofill report).
- `content/vinted.js` — the autofill engine on vinted.com; selector map
  ported from the app's dry-run rehearsals. Every step degrades to
  "manual" in the report instead of aborting.
- `options/` — app URL + API token settings.

No build step: plain ES modules, load-unpacked, edit → reload.
