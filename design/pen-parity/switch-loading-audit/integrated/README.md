# Integrated switch loading proof

Captured from the merged build (Track A visuals + Track B coordinator) with `node design/pen-parity/switch-loading-audit/integrated/capture.cjs` from the repo root, on a temporary profile with two sample files. Real switches drive the visuals; only the waits are made artificial so the loading frames are visible (local switches finish in ~4 ms, under the 120 ms show delay, so normally nothing flashes).

- `tab-before` → `tab-loading` → `tab-after`: `fileLibrary.open()` with `documentLifecycle.prepareSwitch` delayed 2 s. Below the title bar only the Verynize mark shows (sidebar and inspector are covered, like Pen); tabs stay usable.
- `page-loading` → `page-after`: `design.setActivePage()` to a page marked unloaded through `pageLoader.reset()`, released after 2 s. The outgoing page stays rendered under the blur until the target page commits.

## Per-tab URLs (desktop and web)

`annotated/` adds an address-bar strip with the page's real `location.href` (recorded at capture time in `urls-desktop.json` / `urls-web.json`) above each screenshot, since Electron and Playwright screenshots have no address bar. Regenerate with `python3 -I annotate.py`.

- Desktop (`app://verynize`): `tab-before` / `tab-after` show `/editor/<fileId>` changing with the tab. During `tab-loading` the URL still names the outgoing file; it moves when the target commits.
- Web (`capture-web.mjs`, Node build of web-start + real local backend, throwaway account): `web-tab-a` → click → `web-tab-b` → Back → `web-back-to-a`; `web-deeplink-b` opens `/editor/<id>` directly; `web-unknown-id` lands on Files with a notice.
