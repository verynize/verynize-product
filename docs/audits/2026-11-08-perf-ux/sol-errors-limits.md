# Cloudflare, screenshot failure and size limits (sol, 2026-11-08)

Reconstructed summary. The original report was lost when the scratchpad was wiped; the facts below were read from it before that happened. Read-only audit of `chore/node24-deps` (Electron 45.2.3).

## Cloudflare Worker `verynize` (2026-11-01 to 2026-11-08)

Queried with `cf o11y telemetry query` (preview, no saved query).

| Metric | Count |
| --- | ---: |
| DO CPU-limit resets | 46 (39 on hibernatable WebSockets) |
| DO memory-limit resets | 23 (19 on hibernatable WebSockets) |
| Canceled outcomes | 323 |
| Response stream disconnected | 881 |
| HTTP 413 | 28 |
| HTTP 500 | 35 |
| Status 0 / missing | 649 |

Of 18,593 responses with a status: 4xx 8.30%, 5xx 0.188%. Error groups: "Durable Object exceeded its CPU time limit and was reset", "isolate exceeded its memory limit", "Durable Object is overloaded". Also 39 `Session is not fresh` on `/api/me`.

Source paths involved: op batches load touched pages (`cloud/rooms.js:440`), legacy snapshot writes load the whole document (`cloud/rooms.js:277`), inline migration can load a whole legacy document (`cloud/rooms.js:685`), per-page commits stringify node arrays (`cloud/room-store.js:228`), up to 5,000 ops per batch (`cloud/rooms.js:309`). Poison-batch persistence already exists (`cloud/rooms.js:330`). Raising the CPU budget cannot fix memory resets; bound batches by decoded bytes and work, not only op count.

## Screenshot failure (`ERR_FAILED verynize-render://document/` after Mojo `UNKNOWN_METHOD`)

- Path: `desktop/render.cjs:249` handler, hidden sandboxed BrowserWindow (`:178`), per-window session protocol (`:281`, `:297`), `capturePage` (`:220`). MCP fallback uses the same renderer (`desktop/mcp-bridge.cjs:225`).
- `tests/render-export.cjs` and sequential harnesses pass on Electron 42 and 45.2.3 with fresh profiles. Installed main/helper/framework hashes match the 45.2.3 distribution. Not a general Electron 45 regression.
- Leading suspicion (unverified): the running main process predates the `node_modules/electron` replacement and spawns children from the new runtime, so Chromium kills them for an IPC interface mismatch.
- Fix proposal: fully quit and relaunch; add a startup render smoke probe and runtime fingerprint check ("restart required"); log `render-process-gone` / `child-process-gone` / `did-fail-load` for the render window without user content. Keep sandbox/CSP.

## Size limits

| Boundary | Limit | Source |
| --- | --- | --- |
| Desktop HTML import | 5 MiB UTF-8 | `desktop/html-import.cjs:9` |
| MCP HTML | 5,000,000 string units | `integrations/design-tools.mjs:2897`, `integrations/codec-html.mjs:183` |
| Import resources | 2 MiB each, 12 MiB total, 4 MiB image | `integrations/codec-html.mjs:45` |
| Native document | 20 MiB | `integrations/design-store.mjs:9` |
| Nodes | 10,000/page, 50,000/document | `web/document-core.js:25` |
| Shared room | 20 MiB doc/page, 2 MiB metadata, 21 MiB message | `web/room-limits.js:11` |
| Render input | 20 MiB HTML; 8192 px/side, 32 MP | `desktop/render.cjs:12`, `desktop/render-limits.cjs:2` |

Root cause of "too large": the HTML importer emits a base64 data URL per node (`integrations/codec-html.mjs:1367`), so a 34 KiB avatar used 90 times costs ~4 MiB. Room assets already have SHA-256 dedupe and R2 storage (`cloud/assets.js:221`, `:260`, `:297`; upload in `web/cloud-assets.js:234`), but local/MCP imports never reach it, and render re-inlines assets as data URIs (`web/cloud-assets.js:368` → `web/app.js:1670`).

Proposal: storage-neutral `asset:<sha256>` references with a manifest, one blob per hash (files / IndexedDB / R2), MCP `upload_asset`, resumable staged import, render resolving hashes through a narrow protocol. Estimated: the repeated avatar shrinks 98.8–99.0%; 73 MB of images stop costing ~97 MB of base64 inside the JSON.

## Agent tooling gaps from the `.pen` session

- `desktop/figma.cjs:1037` rejects `.pen` by filename and claims encryption (`:1025`) without inspecting the file. A direct importer should keep components, instances, overrides, variables, icons (`lucide:*`) and hidden state, targeting existing `create_component` / `create_instance` (`integrations/design-tools.mjs:1725`, `:1770`).
- `import_html` already accepts a local path and resolves sibling images (`integrations/design-tools.mjs:2892`), so the local HTTP server workaround was avoidable; agents need a preflight that says so.
- `finish_artboard` has no fidelity mode (`integrations/design-tools.mjs:1961`); critical contrast blocks (`integrations/design-lint.mjs:753`); after three blocked attempts it returns unverified (`integrations/src/verification.mts:58`, `:185`). Proposal: `intent: "faithful-import"` that waives quality blockers only, keeps schema/asset/screenshot checks.
