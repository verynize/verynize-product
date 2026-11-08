# Verynize preview: end-to-end map (2026-10-31, `f36d426`)

This map is for implementation agents. Line numbers are against `f36d426`.

## 1. Pieces at a glance

```
chat header / Code toolbar            agent (Claude/Codex)                  canvas
PreviewButton (code/topbar.tsx)  ──►  bd:setup-preview ─► chat message ─►  MCP propose_preview
        │ (configured)                (chat/preview-setup.tsx)              (integrations/shell-tools.mjs:53)
        │                                     ▲                                   │
        ▼                                     │ devServer.status().proposal        ▼
window.desktop.devServer.* ──IPC──► desktop/agent-shell.cjs registerDevServerIPC ─► desktop/dev-server.cjs ProcessManager
        │                                                                     (spawn argv, ring log, URL detect, probe)
        ▼
window.livePreview (web/live-preview.js) ─ frame node `preview` ─ <iframe name="verynize-live-preview">
        │                                                         │
        ├─ PreviewToolbar island (chrome/PreviewToolbar.tsx) ─ Navigate / Edit / Capture / ⋯
        └─ window.desktop.preview* ──IPC──► desktop/preview.cjs (navigate, input, inspect/edit, capture, open browser,
                                                                 agent automation for MCP preview_* tools)
```

## 2. IPC surface

The preload contract is in `desktop/preload.cjs` (lines 50-64) and `desktop/README.md`. Every handler goes through `main.cjs` `handle()`, which checks that the sender is the main frame.

| Preload                                                             | IPC name                   | Main-process implementation                                                                                                                      |
| ------------------------------------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `devServer.status({root?})`                                         | `devServerStatus`          | `agent-shell.cjs:172-178` → `ProcessManager.status` (`dev-server.cjs:276-279`). Returns `{state, url, tail, config, detected, proposal, setup?}` |
| `devServer.configure({root, command, setup?, url?})`                | `devServerConfigure`       | `agent-shell.cjs:179` → `configure` (`dev-server.cjs:214-225`). Persisted per root in the config JSON                                            |
| `devServer.setup({root})`                                           | `devServerSetup`           | `agent-shell.cjs:181-205`. Runs `config.setup` as a background job (10 min), with pnpm ignored-builds recovery                                   |
| `devServer.start({root})`                                           | `devServerStart`           | `agent-shell.cjs:206` → `start` (`dev-server.cjs:280-306`). Rejects a busy fixed port (:286), waits ≤20 s for a URL and probe                    |
| `devServer.stop({root})`                                            | `devServerStop`            | `agent-shell.cjs:207`. Kills a pending setup, then `stop` (`dev-server.cjs:312-318`); process-group kill                                         |
| `devServer.dismissProposal({root, saved?})`                         | `devServerDismissProposal` | `agent-shell.cjs:180` → `propose(root,{command:null}` or `{saved:true})`                                                                         |
| `previewNavigate({direction})`                                      | same                       | `preview.cjs:92-97`: back, forward or reload inside the frame                                                                                    |
| `previewInput({enabled})`                                           | same                       | `preview.cjs:70-90`: keyboard capture; released by ⌘/Ctrl⇧Esc (`before-input-event`) or window blur, then emits `bd:preview-input-released`      |
| `previewOpenBrowser()`                                              | same                       | `preview.cjs:91`: `shell.openExternal` on the frame URL (localhost only)                                                                         |
| `previewInspect` / `previewEdit({selector, text?, styles?, undo?})` | same                       | `preview.cjs:64-69, 98-99` + in-page `editPreviewElement` (10-39). Transient DOM edits, 50-step undo                                             |
| `previewElementAt({x,y})`                                           | same                       | `preview.cjs:62`: element box under a point (used by the region picker's hover highlight)                                                        |
| `captureLivePreview({url, region?})`                                | same                       | `preview.cjs:60, 112-122` → `capture-core.cjs` `snapshotDocument`/`finishSnapshot`. Returns a document of nodes and font faces                   |
| `previewApp({url, width?, height?, capture?})`                      | same                       | `preview.cjs:44-59`: separate sandboxed `BrowserWindow` ("Preview in a separate window"), or a hidden capture                                    |

Agent side: the MCP shell tools are defined in `integrations/shell-tools.mjs`:

- `get/start/stop/configure_dev_server` and `propose_preview` (`devPropose` → `ProcessManager.propose`, `dev-server.cjs:192-208`);
- `preview_open/snapshot/screenshot/click/type/scroll/console`;
- `capture_preview_to_canvas`.

They are dispatched in `agent-shell.cjs` (`call` around line 78, using `previewAutomation(win)`) to `createPreviewAutomation` (`preview.cjs:253-392`). That function drives the embedded frame with trusted CDP input, falling back to synthetic DOM events.

Security posture: localhost-only URLs (`localURL`, `preview.cjs:4-8`; renderer `valid`, `live-preview.js:4-8`; schema check in `app.js` `validate`). Commands are argv only, never a shell (`checkArgv`, `dev-server.cjs:71-81`). The iframe is `sandbox="allow-scripts allow-forms allow-same-origin allow-downloads"`.

## 3. Document schema: the preview frame node

A normal top-level `frame` node with an extra `preview` object (`web/app.js:7` `validate`):

```js
{ type: 'frame', parentId: null /* required: preview only on top-level frames */,
  name: '<App> · Preview', x, y, w: 1200, h: 800, color: '#191919', radius: 8, padding: 0,
  preview: { root: '<abs repo or worktree path>', name?: string, chatId?: string, url?: 'http://localhost:…' } }
```

- The node is created by `livePreview.ensure()` (`live-preview.js:171-182`), placed at (max right edge + 100, 100). It is reused when a node with the same `root` and `chatId` exists.
- `url` is remembered on navigation (`navigate`, 34-41).
- The process state is **not** stored in the document. Reopening a file always shows the paused state (`renderNode` 162; no auto-run, 203-204).
- Rendering: `app.js:20` `layerElement` reuses `livePreview.nodeElement(id)` and calls `livePreview.renderNode(node, el)`. The canvas render is imperative and the frame DOM persists across renders.
- Keep `integrations/design-store.mjs` `validateDocument` in sync if the `preview` shape changes.

## 4. Renderer state machine (`web/live-preview.js`)

One `entry` per preview node (`entries` Map): `{el, node, controls, frame (iframe), url, state, mode, inputToApp, settingUp, capturing}`.

**`state`**, painted by `paint()` (25-33). That function sets every string, toggles the placeholder and iframe, resets the mode and emits `bd:preview-state`.

| state      | toolbar state text  | card title                  | card message                                                | toggle  |
| ---------- | ------------------- | --------------------------- | ----------------------------------------------------------- | ------- |
| `paused`   | Preview paused      | Ready to start your preview | Start this preview to connect to your local app.            | ▶ Start |
| `starting` | Setting up preview… | Starting your app           | Waiting for the local application to be ready… / setup tail | ⊙ Stop  |
| `running`  | (empty)             | — (iframe shown)            | —                                                           | ⊙ Stop  |
| `error`    | Preview failed      | Unable to start preview     | error / process tail                                        | ▶ Start |

Transitions:

- `toggle()` (42-56): paused/error → starting → `devServer.start` → `navigate()` → running. Running/starting → `stop` → paused.
- `bd:preview-setup-state` events from the proposal card (195): setting-up/starting → `starting`; failed → `error`.
- The 1.5 s poll (205-214) applies the setup tail, promotes starting → running when the URL is ready, and demotes to paused/error when the process stops or exits.
- `renderNode` (162) resets to paused when root, chatId or the open file changes.

**`mode`**: `select` (default; iframe `pointer-events:none`), `navigate` (iframe interactive), `edit` (selector form shown).

- Set by `navigateMode`/`editMode` (187-188). Reset on deselect (`design.subscribe`, 196-202) and on any non-running paint.
- `inputToApp` is toggled by `sendAllInput` (189), and released by an outside pointerdown, a postMessage from the frame, or `bd:preview-input-released` (191-193).

Only one entry is **active** (`activate`, 15-24). It owns the DOM ids `#live-preview`, `#live-frame`, `live-url`, `live-reload`, `live-pick`, `live-expand` and the iframe name `verynize-live-preview`. Main-process code finds the frame by that name (`preview.cjs:132, 246-251`).

Public API (`window.livePreview`, 194): `show(url, opts)`, `hide`, `reveal`, `ensure(opts)`, `renderNode`, `getSelectionState()`, `navigateMode`, `editMode`, `captureSelected`, `captureRegion`, `pickRegion`, `insertCaptured`, `sendAllInput`, `openInBrowser`, `nodeElement`, `getURL`, `getNodeId`.

## 5. UI surfaces

| Surface                                                            | File                                                                      | Notes                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Start preview split button + menu                                  | `web/src/islands/code/topbar.tsx` `PreviewButton` 128-235                 | Mounted in the chat dock (`chat/header.tsx:192-197`, ids `chat-*`) and the Code toolbar (`Toolbar` 253-271, ids `code-*`). Own 4 s status poll (`useDevServer` 84-119). No config → `bd:setup-preview` (146)                                           |
| Agent setup + proposal card                                        | `web/src/islands/chat/preview-setup.tsx`                                  | The `bd:setup-preview` listener attaches the prompt (24) and queues "Set up the Preview". `ProposalCard` 33-86: Setup/Run/Port, Edit/Done, Save & start → `configure` → `ensure` → `setup` → `start` → `show`. Collapses to "Preview setup Saved" (78) |
| Manual configuration dialog                                        | `web/src/islands/code/preview-configuration.tsx`                          | Setup/Run/Port, Save / Save & start. `parsePreviewCommand` (`preview-command.ts`) turns text into argv                                                                                                                                                 |
| Frame chrome (breadcrumb, Local, bar, placeholder card, edit form) | `web/live-preview.js:124-157` markup and handlers; `web/live-preview.css` | Legacy DOM inside the scaled canvas layer                                                                                                                                                                                                              |
| Contextual Navigate / Edit / Capture toolbar + ⋯ menu              | `web/src/islands/chrome/PreviewToolbar.tsx`, `preview-toolbar.css`        | Mounted in `chrome/CanvasOverlays.tsx:87`. Screen-fixed bottom-centre (bottom 68 px). Visible when exactly one preview node is selected                                                                                                                |
| Region picker overlay                                              | `live-preview.js:84-123` `pickRegion`                                     | Also used by the "Capture web page" dialog (236-291)                                                                                                                                                                                                   |
| Legacy menu actions                                                | `web/desktop-panel.js:224, 254-255`                                       | `actions.livePreview` (ask for a URL → `show`) and `captureApp`                                                                                                                                                                                        |
| Publish (not on the frame)                                         | `web/cloud-panel.js:52-59`, `desktop/app-publish.cjs`                     | Share › Publish app (`cloudAppDetect`/`cloudAppPublish`)                                                                                                                                                                                               |

## 6. Capture path

Capture (button or `captureSelected`) runs as follows:

1. `live-preview.js` `capture()` (68-80) calls `desktop.captureLivePreview({url, region?})`.
2. `preview.cjs` `captureLiveFrame` (112-122) finds the `verynize-live-preview` frame, checks the origin and runs `capture-core.cjs` `snapshotDocument` inside the page (computed styles → nodes, images and fonts embedded).
3. `finishSnapshot` returns `{document}`.
4. The renderer `insertCaptured` (58-67) re-ids the nodes, places them at (preview.x + w + 80, preview.y), merges `fontFaces` and calls `setDocument`.

The region variant goes through `pickRegion` first, using `previewElementAt` for hover. The MCP `capture_preview_to_canvas` tool uses the same `captureLiveFrame`.

## 7. Tests covering each part

| Area                                                                                                                                       | Test                                                                                                                         | What it asserts                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| ProcessManager (spawn, URL detection, persistence, proposals, busy port, toolchains)                                                       | `tests/dev-server.cjs` (`node --test`)                                                                                       | Includes "preview proposal persists without configuring or executing until accepted" (153) and "occupied preview port fails before launching" (232) |
| Setup IPC lifecycle                                                                                                                        | `tests/preview-setup-lifecycle.cjs`                                                                                          | Setup logs, process-group cancel on stop, registered-root boundary                                                                                  |
| Start button → setup flow, manual config dialog, MCP `propose_preview` card (Edit, validation, failed start keeps the card, frame created) | `tests/code-workspace.cjs` lines 159-207                                                                                     |                                                                                                                                                     |
| Navigate gating, click/scroll blocked until Navigate, deselect reset, drag only with a held button                                         | `tests/preview-interaction.cjs`                                                                                              |                                                                                                                                                     |
| Contextual toolbar placement/zoom independence, modes, ⋯ menu keyboard/focus, Send-all-input + ⌘⇧Esc, Capture, paused single-click select  | `tests/preview-toolbar.cjs`                                                                                                  |                                                                                                                                                     |
| Live capture fidelity / states / remote capture / region pickers / fonts                                                                   | `tests/capture-core.cjs`, `capture-live-state.cjs`, `capture-fidelity.cjs`, `capture-remote.cjs`, `capture-export-fonts.cjs` |                                                                                                                                                     |
| MCP preview automation (start the dev server, snapshot, click, type, scroll, console, screenshot, capture)                                 | `tests/mcp-shell.cjs`                                                                                                        |                                                                                                                                                     |
| MCP tool list / schemas                                                                                                                    | `integrations/mcp.test.mjs` (SHELL_TOOLS line 15)                                                                            |                                                                                                                                                     |

All of these run in `npm run test:desktop` / `test:integrations` (see `package.json`). Electron tests need `npm run build:ui` first.

## 8. Known gaps (from `notes.md`), with the file to change

| Gap                                                                                       | File to change                                                                                    |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Frame chrome scales with zoom; unicode-glyph buttons; no tooltips; no Publish             | `live-preview.js:125`, `live-preview.css`                                                         |
| Contextual toolbar fixed at screen bottom, not beneath the frame                          | `PreviewToolbar.tsx`, `preview-toolbar.css:2`                                                     |
| Edit mode is a selector form (no hover/select/inspector; transient)                       | `live-preview.js:151-154, 188`; `preview.cjs:10-39` (`previewElementAt` already exists for hover) |
| Path field does not follow in-app navigation                                              | `live-preview.js` `navigate`; `preview.cjs` `did-frame-navigate` (259)                            |
| Raw IPC error text; stale-tail race on retry; "Start preview" button shown while starting | `live-preview.js:28-31, 53-55, 205-214`                                                           |
| Header button lags (4 s poll), stays "Start preview" during setup                         | `code/topbar.tsx:84-119, 171`                                                                     |
| Expand is a camera fit only                                                               | `live-preview.js:145-150`                                                                         |
| No preview items in the context menu or inspector; generic layers icon                    | `context-menu/model.ts`, inspector island, sidebar island                                         |
| Breadcrumb shows only the app name, not repo/chat                                         | `chat/preview-setup.tsx:56`, `live-preview.js:165`                                                |
