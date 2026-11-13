# Files home boot boundary

The Start host interprets `data-boot="home"` in `web/index.html`. That document remains the asset/order manifest and Electron continues to execute it normally. Asset paths are unchanged. The parser's only additional output is the stylesheet's `boot` attribute.

## Dependency map

| Home dependency                      | Owner and reason                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `verynizePlatform`, `shellRequest`   | `platform.js`, `shell-request.js`: capabilities and hosted navigation                                                                                                                                                                                                                                                             |
| `VerynizeDocument`, `documentSafety` | `document-core.js`, `lazy-document.js`, `room-limits.js`, `storage-limits.js`, `document-safety.js`: validate stored files without repairing/overwriting invalid documents. Validation also requires `shaders.js`, `node-style.js`, `vector-geometry.js` (pure model utilities, not canvas interaction/rendering).                |
| `VerynizeCommitState`                | `commit-state.js`: immutable document snapshots returned by the library                                                                                                                                                                                                                                                           |
| `switchCoordinator`, `switchCache`   | File/navigation coordination used by the library and shell router; no canvas startup                                                                                                                                                                                                                                              |
| `accountStore`                       | `account-store.js`: preferences, folders, file metadata                                                                                                                                                                                                                                                                           |
| `cloudAccount`, `cloudWorkspace`     | `cloud-panel.js`, `cloud-share.js`: account/org switcher, room listing, rename/duplicate/upload APIs. This module still contains room synchronization code; its existing `VerynizeOps`, `VerynizeRoomSync`, `remoteApply`, and `pageLoader` dependencies remain in the Home set. Room connection requires a real design instance. |
| `appPreferences`, `appSettings`      | `settings.js`: persisted theme/display name and navigation requests                                                                                                                                                                                                                                                               |
| `fileLibrary`                        | `library-storage.js`, `wonder-shell.js`: IndexedDB library, cards/thumbnails, folders, search, archive, file actions. One instance survives the editor boot.                                                                                                                                                                      |
| `design`                             | **Not required for Home.** `wonder-shell.js` attaches its subscription on `verynize:editor-started`; it does not sync the editor's startup placeholder over the library. Create/open/import await the editor when necessary.                                                                                                      |
| React Home                           | `web-home.tsx`: HomeArea, lightweight chrome, text prompt/toasts, onboarding, hosted router. `web-app.tsx` mounts editor islands only through `startEditorUi()`.                                                                                                                                                                  |

`app.js`, canvas interactions/rendering/tiles, selection UI, clipboard/image drop, vector editing, desktop/chat runtime, previews, agents, history, and editor islands are deferred. Only `dist/ui.css` is needed initially; the 11 legacy stylesheets are installed in manifest order before editor scripts execute. The shared island CSS contains Home's pre-editor layout rules.

The editor boot promise is shared by route transitions and file actions. Previously loaded scripts/styles are skipped. Home keeps its library and DOM host; it neither reconstructs the library nor reloads the document. For already initialized editors, opening a file keeps the existing synchronous cancellation boundary.

After Home is ready, a 1.5-second idle callback prefetches remaining classic scripts/styles without evaluating them. File-card pointerover/pointerdown requests the same prefetch immediately. The editor route-component module is warmed separately; importing it does not mount editor islands. A bundler-generated modulepreload URL warms the editor-island chunk without executing it.

## Validation

`tests/helpers/web-home-boot.mjs`, called by the real-account Cloudflare browser suite, checks the cold Home boundary, idle prefetch, new-file creation, repeated SPA file navigation, object identity/state retention, one canvas script insertion, and absence of browser dialogs/errors. The existing router/first-opening suite continues checking cancellation and the first loading-cover paint. Desktop UX tests run separately on instabox.

## Local measurements

Production Cloudflare build served with `vp preview`, Chrome headless, local real account/backend, three fresh pages with the same one-file fixture. Times are navigation-to-visible-file-card; bytes are decoded resource bytes for script/link/CSS resource entries at that point, including Start/React, not compressed wire bytes. No artificial network throttling. Background prefetch is excluded by measuring before idle.

Baseline: 55 legacy scripts; 3,386,041 / 3,410,493 / 3,386,041 decoded bytes; 1,182.7 / 1,679.6 / 1,217.2 ms (median 1,217.2 ms).

After: 23 legacy scripts; 1,067,660 decoded bytes in all three runs; 691.2 / 270.0 / 154.8 ms (median 270.0 ms). That is 58% fewer legacy scripts, 68% fewer decoded bytes, and 78% lower median time in this local sample. The first run improved from 1,182.7 to 691.2 ms. These are local measurements, not a production-network guarantee. All three after samples had no page errors.

## Test results

- `node tests/web-cloudflare.mjs`: passed in dev and production-preview modes, including the new deferred-Home regression and existing account/link/router scenarios. Optional WebKit checks skipped because its browser binary is not installed. The final production run measured 272.7 ms and 1,068,006 decoded bytes at Home readiness.
- Freestyle `p1-boot`: 9 passed, 0 failed, 0 skipped (99.7 seconds): shell-router, wonder-shell, ui-ready, web-platform, shell-router-file, home-first-opening, library-implicit-files, library-unload-persistence, account-store-network.
- Previously queued instabox run: 7 passed, 0 failed (42.4 seconds), the same set excluding unload persistence and account-store network.
- Mac build/UI build, full lint (zero warnings), UI lint, UI/Start type checks, syntax/entry asset checks, and touched-file formatting checks: passed.
- Freestyle VM deleted after retrieving the report.
- React Doctor could not scan without installing its project integration; no score was produced.

The remaining shared Home cost is the account/library service code, including cloud-panel's room code and the combined island stylesheet. This change does not claim a fully extracted account service. `legacy-web.mjs` changes only retain the Home stylesheet marker and expose a bundler-generated modulepreload reference; merge those with the separate legacy-asset hashing changes. `account-store.js` adds only a once-only initial DOMContentLoaded listener, so Home and editor phases do not start account synchronization twice.
