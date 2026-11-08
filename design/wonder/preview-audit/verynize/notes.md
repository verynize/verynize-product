# Preview parity audit: Verynize side (2026-10-31)

Checklist: `../CHECKLIST.md`. Architecture map for implementers: `architecture.md`. Harness: `capture.cjs` (Playwright `_electron`, 1440×870 content, `--force-device-scale-factor=2`, `--force-color-profile=srgb`, temp `--user-data-dir`, `VERYNIZE_SKIP_ONBOARDING=1`). Built with `npm run build:ui` at `f36d426` (branch `feat/preview-parity`, uncommitted audit files only). Every PNG has a `metrics.json` entry: rects and computed styles of the frame parts, the preview toolbar and the header button; open menus and dialogs with their items; the preview selection state; the camera; and every top-level node.

```sh
npm run build:ui
node design/wonder/preview-audit/verynize/capture.cjs            # whole flow, ≈2 min, 70 PNGs + metrics.json
node design/wonder/preview-audit/verynize/capture.cjs PS4 PM3    # flow always runs; only PNGs with these prefixes are written
node design/wonder/preview-audit/verynize/capture.cjs --keep     # keep the temp profile / worktrees
```

**Sandbox** (`/tmp/preview-sandbox-vz`, a git repo with 2 commits): `index.html` has an `h1#title` "Preview Sandbox", a lede, `button#counter` "Count: 0", a text input `#name` that echoes into `#echo` ("Hello, stranger."), a link `#about-link` to `/about/`, an image `hero.svg` (320×180) and a 1200 px tall section for scrolling. It also has `about/index.html`, `style.css` and `scripts/setup.py`, a fake install that prints 8 "Installing dependency i/8…" lines 0.7 s apart. It is served by the supported Python fallback, `python3 -u -m http.server 5199 --bind 127.0.0.1`. Port 5199 is used so it does not collide with other servers. The sandbox name differs from the checklist's `/tmp/preview-sandbox` so the Wonder pass can use that one in parallel.

**How the flow is driven.** The repository is added through Code › Add repository › Open, with the native dialog stubbed. Verynize then creates a chat worktree under a temp `VERYNIZE_WORKSPACES_DIR`, so the preview root is that worktree and not `/tmp/preview-sandbox-vz` itself. The chat agent is the deterministic fake `codex` from `tests/fixtures`. The agent's proposal is delivered through the real MCP bridge tool `propose_preview`, as `tests/code-workspace.cjs` does. Everything after that is real clicks, real processes and real HTTP.

**Wonder evidence.** `../wonder/` was empty when this pass finished. The only Wonder evidence is `docs/wonder-preview-reference.md`: four user screenshots from 2026-10-29 and a list of preload API names. Every "vs. Wonder" statement below is checked against that document only, and none of them is pixel-measured.

**Zoom caveat.** A preview frame is 1200×800 world px. With the chat dock (499 px) and the inspector open, "fit" zoom is 41.7%. At that zoom the in-frame toolbar and cards are 5 to 6 px text, because they scale with the canvas. States that need reading therefore have an extra `-100` shot at 100% zoom, centred in the visible canvas. `PF2-toolbar-left/right.png` are crops (rectangles in `metrics.json`).

**Common tokens measured** (dark theme):

- Text: `rgb(212,212,212)`, muted `rgb(144,144,144)`.
- Surfaces: panels and menus `rgb(28,28,28)`, inputs `rgb(43,43,43)`, hover/muted `rgb(38,38,38)`.
- Primary: `rgb(162,69,211)`; the selection handle stroke is `rgb(185,60,219)`.
- Font: Inter.

---

## PS. Starting a preview

### PS1 Start preview split button (`PS1-idle`, `PS1-hover`, `PS1-arrow-hover`, `PS1-menu`)

**Steps.** Design mode with the chat dock open and the repository attached. Hover the label, hover the arrow, then click the arrow.

**What Verynize shows.**

- **Where it sits.** On the dock's second row (`h-10`, 40 px), right-aligned, next to "No changes".
- **Label segment** `#chat-start-preview`:
  - "▶ Start preview", 119.4×26 at (346.6, 46.5).
  - Padding 0 10 0 8, radius 6 on the left. Text 13px/18px Inter, `rgb(212,212,212)`.
  - The play icon is 12 px and filled.
  - Hover background `rgb(38,38,38)`.
- **Arrow segment** `#chat-preview-menu`: 22×26, `aria-label="Preview options"`.
- **Outer border.** 1 px `card-border`, `bg-settings`, radius 6. There is a 1 px divider between the segments.
- **No tooltip** on either segment: no `title`, no Radix tip. The hover shots show only the background change.
- **Arrow menu** (Radix menu): 224×244 at (265, 78.5), background `rgb(28,28,28)`, 1 px `rgb(46,46,46)`, radius 10, padding 4, shadow `0 12px 32px rgba(0,0,0,.4)`. Rows are 24 px. Items in order:
  1. Set up the Preview
  2. Preview configuration…
  3. Preview in a separate window (wraps to 2 lines at w-56)
  4. Open a local URL…
  5. (separator)
  6. Capture app to canvas
  7. Export PDF
  8. Implement selection in code
  9. (separator)
  10. Git status
  11. Create worktree…

  While the server runs, "Stop dev server" is added after item 4.

- **Label states.** "Start preview", "Starting…" (spinner) while the IPC call is pending, and "Stop preview" (square icon) when running or starting. The label follows a 4 s status poll, so it lags. `PF1-selected`, taken about 1 s after the frame started running, still says "Start preview". During the setup command it stays "Start preview" (`PS3-*`).

**Source.**

- `web/src/islands/chat/header.tsx:192-197` mounts `PreviewButton` with `idPrefix="chat"`.
- `web/src/islands/code/topbar.tsx`: `PreviewButton` 128-235; label 171; menu 189-231; poll interval 98 (4000 ms).

**Fix sketch.**

- Add a Radix tooltip to both segments: "Start preview" and "Preview options".
- Trim the menu to preview items: setup, configuration, separate window, stop. Capture, PDF, git and worktree belong elsewhere; the Wonder screenshots show a preview-only split.
- Drive the label from the `bd:preview-state` / setup events, not only the 4 s poll, so it reads "Stop preview" during startup, as in the Wonder screenshot.

Verdict: present (same split control and strings). Gaps: no tooltips, an overloaded menu, and a label that lags or stays "Start preview" during setup.

### PS2 First start with no saved config (`PS2-first-start`, `PS2-card`, `PS2-edit`, `PS2-config-dialog`)

**Steps.** Click "Start preview" with no saved config. Then open the manual dialog through the arrow › "Preview configuration…" and close it. The agent proposal arrives over MCP; click Edit, then Done.

**What Verynize shows.**

- **First click** (`PS2-first-start`).
  - No dialog opens. The click dispatches `bd:setup-preview`.
  - The chat then attaches a hidden "Preview setup" text context and sends a user message "Set up the Preview". The bubble shows an "Untitled" document chip and the text. The chat title changes to "Set up the Preview".
  - The agent is expected to call `propose_preview`. The fake codex just echoes, so its reply is noise in this capture.
- **Proposal card** `#preview-proposal` (`PS2-card`), rendered inside the dock above the composer.
  - Size and frame: 474×312 at (12, 430). Background `rgb(26,26,26)`, 1 px `rgb(46,46,46)`, radius 10, padding 16.
  - Header: a ▶ icon, the title "Proposed Preview configuration" (13px/500) and the subtitle "The agent suggests how to run your app in the Preview." (13px, `rgb(144,144,144)`). A Dismiss ✕ (28×28, `aria-label="Dismiss preview proposal"`) sits on the right.
  - A rounded `bg-input` table holds three rows: Setup `python3 -u scripts/setup.py`, Run `python3 -u -m http.server 5199 --bind 127.0.0.1`, Port `5199`.
    - Labels are 48 px wide, `rgb(164,164,173)`.
    - Values are monospace 13px. Rows are 35 px with padding 8/12 and 1 px dividers.
    - Long values wrap mid-token ("127.0." / "0.1").
  - Buttons, right-aligned:
    - "Edit": outline, 43×28, radius 6, 12px.
    - "Save & start preview": 136×28, background `rgb(162,69,211)`, white.
- **Edit state** (`PS2-edit`).
  - The values become 24 px inputs (`aria-label="Preview Setup|Run|Port"`, background `rgb(43,43,43)`, 12px).
  - "Edit" becomes "Done" (52×28, background `rgb(38,38,38)`).
- **Validation.** "Port must be between 1 and 65535." and "Enter a run command." appear in a `role=status` line under the table.
- **After saving.** The card collapses to a one-line "▷ Preview setup Saved ›" row (`PS5-paused`, `PM5-context`).
- **Manual alternative** (`PS2-config-dialog`), a Verynize-only modal dialog of 512×486.
  - Title "Preview configuration", description "Choose how to run your local app. Commands run in this chat's repository."
  - Three labelled 24 px inputs:
    - Setup (placeholder "npm install (optional)").
    - Run, prefilled with the _detected_ command, which shows the absolute interpreter path `/Users/…/PhpWebStudy/env/node/bin/python3 -u -m http.server 8000 --bind 127.0.0.1`.
    - Port (placeholder "Detect from app output").
  - Note "Quote arguments containing spaces. Shell operators and environment assignments are not supported."
  - Buttons "Save" and "Save & start preview".

**Source.**

- `web/src/islands/code/topbar.tsx:146` routes to setup when there is no config.
- `web/src/islands/chat/preview-setup.tsx`: listener 21-27; the agent prompt text 24; `ProposalCard` 33-86; saved row 78.
- `web/src/islands/code/preview-configuration.tsx:36-46`.
- `integrations/shell-tools.mjs:53-56` (`propose_preview`), `desktop/dev-server.cjs:192-208` (`propose`), `:243-254` (`detectStatic`, absolute path at 250).

**Fix sketch.**

- Show the card as the agent's message in the transcript, not pinned above the composer. In the Wonder screenshot it is part of the conversation.
- Keep each value on one line (`truncate` with a title) instead of `break-all`.
- Make `detectStatic` return the bare `python3` (resolved only at launch) so the dialog does not leak the absolute interpreter path.

Verdict: present (Setup/Run/Port card with Edit and "Save & start preview", as in Wonder). Gaps: placement (pinned card vs. transcript message), value wrapping, and the absolute-path prefill in the manual dialog.

### PS3 Startup state on the frame (`PS3-starting`, `PS3-starting-100`, `PS3-logs`, `PS3-logs-100`)

**Steps.** Click "Save & start preview" on the card. The frame is created at x = (right edge of the content) + 100, y = 100, and the setup script runs.

**What Verynize shows.**

- **Frame toolbar during setup.** The state text reads "Setting up preview…" (12px). The toggle reads "⊙ Stop".
- **Centred card**: 340 px wide, background `rgb(28,28,28)`, 1 px border, radius 8, padding 16, font 12px.
  - Title "Starting your app" (12px/700).
  - Project "Preview Sandbox" (10px).
  - Message: first "Running setup command…", then the live setup tail (`PS3-logs-100`: "Installing dependency 1/8 … 4/8" lines, 12px, `rgb(144,144,144)`, pre-wrap, max-height 180, scrollable).
  - A "▶ Start preview" button (106×24). It is wrong in this state: clicking it calls `toggle`, which **stops** the preview.
- **No spinner.** No progress indicator and no elapsed time.
- **Dock card at the same time.** Its primary button reads "Setting up preview…" (disabled), its status line reads "Setting up preview…", and Edit and ✕ are disabled.
- **Run-command output.** After setup, the dev-server output is not shown. The message switches to "Waiting for the local application to be ready…" until the URL answers.
- **Header button.** Stays "Start preview" throughout.

**Source.**

- `web/live-preview.js`: `paint` 25-33 (all strings at 28-31); `bd:preview-setup-state` listener 195; status poll 205-214 (setup tail at 209).
- `preview-setup.tsx:60-69` dispatches the setup and start events.

**Fix sketch.**

- During `starting`, hide or rename the card button: "Stop", or none. Add a spinner.
- Stream the run command's tail too: `devServer.status().tail` is already returned.
- Render logs as a monospace, bottom-anchored log box like Wonder's startup log view.

Verdict: partial (progress text and setup logs exist). Gaps: a mislabelled "Start preview" button that stops the run, no spinner, no run-command logs, and the header not switching to "Stop preview".

### PS4 Error states (`PS4-error`, `PS4-error-100`, `PS4-port-busy`, `PS4-port-busy-100`)

**Steps.**

- **Non-zero exit.** Save a run command that prints "Starting sandbox…" and "Error: Cannot find module ./server.js" to stderr, then exits 3. Click the card's Start.
- **Busy port.** Hold 127.0.0.1:5199 with another HTTP server, restore the real run command, and click Start.

**What Verynize shows.**

- **Non-zero exit.**
  - Toolbar state "Preview failed", toggle "▶ Start".
  - Card title "Unable to start preview", project "Preview Sandbox", message = the process tail ("Starting sandbox… / Error: Cannot find module ./server.js"), button "▶ Start preview".
  - The Navigate / Edit / Capture toolbar is disabled (opacity .45).
- **Busy port.** The message reads "Error invoking remote method 'desktop:devServerStart': Error: Preview address http://localhost:5199/ is already in use. Stop the existing server or choose another port before starting this preview."
  - The Electron IPC prefix leaks into the user-facing text.
  - **Intermittent:** in 2 of 4 runs, the busy-port message was replaced within about 0.25 s by the _previous_ failed process tail ("Cannot find module…") and stayed. `metrics.json` › `PS4-port-busy.png.messageTimeline` records 5 s of it. The likely cause is the 1.5 s status poll repainting from the old failed process record, which `dev-server.cjs` keeps per root until a new process replaces it. The mechanism is not confirmed.
- **No fix affordances.** Retry is the same "Start preview" button. There is no "Edit configuration", "Ask agent to fix", "Show logs" or "Choose another port".

**Source.**

- `web/live-preview.js`: `toggle` 42-56 (error message at 53/55); poll 211.
- `desktop/dev-server.cjs:286` (busy-port check before launch), `:265-275` (`describe`: `failed`/`exited` + `tail`).

**Fix sketch.**

- Strip the `Error invoking remote method …: Error:` prefix in one renderer helper (the same as `errorMessage` in `code/api.ts`).
- Ignore stale `failed` records whose `startedAt` predates the click.
- Add buttons "Edit configuration" (open `PreviewConfiguration`) and "Fix with agent" (attach the tail to chat).

Verdict: partial (explicit error state with the tail). Gaps: a raw IPC error string, an intermittent stale-message race, and no retry/fix affordances beyond Start.

### PS5 Paused frame (`PS5-paused`, `PS5-paused-100`, `PS5-paused-selected`, plus `PP2-stopped`)

**Steps.** Stop the preview, reload the window (equivalent to reopening the file), and select the frame.

**What Verynize shows.**

- **Never auto-runs on reopen.**
- **Toolbar.** State "Preview paused", path "/", toggle "▶ Start" (61×25 at 100%).
- **Card.** Title "Ready to start your preview" (12px/700), "Preview Sandbox" (10px), "Start this preview to connect to your local app." (12px, `rgb(144,144,144)`), button "▶ Start preview" (106×24, background `rgb(38,38,38)`, 1 px border, radius 5).
- **Card position.** 340 px wide, centred in the 762 px viewport area.
- **Selected.** The Navigate / Edit / Capture toolbar shows, but all three are disabled.

**Source.** `web/live-preview.js:28-31` (strings), 125 (markup), 162 and 203-204 (reset to paused, no auto-run); `web/live-preview.css:12-14`.

**Fix sketch.** Visual only: Wonder's card is centred with a primary Start action. Use the shadcn `Button` (primary) and the 13px/500 title instead of 12px/700 bold. Drop the unicode "▶" glyphs and use lucide `PlayIcon`.

Verdict: present (same "Ready to start your preview" card and behaviour). Gap: styling, since it uses legacy unicode buttons and not the island tokens.

### PS6 Start preview from the Code workspace (`PS6-code`, `PS6-code-menu`)

**Steps.** Code mode with the repository open.

**What Verynize shows.**

- The same `PreviewButton`, as `#code-start-preview` / `#code-preview-menu`, in the Code toolbar row (119.4×26 at (868.6, 46.5)). It sits next to the status line and the panel toggle (`#code-panel-toggle`).
- The same menu.
- With no config it triggers the same agent setup.
- When running, it calls `showPreview`. That runs `workspace.openChat()`, which leaves Code mode, then `livePreview.show(url, {name: "<repo> › <chat>"})`, which focuses the canvas frame.
- So Code mode has no embedded preview of its own; it hands off to the canvas frame. "Preview in a separate window" opens a separate `BrowserWindow` instead (`previewApp`).

**Source.** `web/src/islands/code/topbar.tsx:121-126` (`showPreview`), 253-271 (`Toolbar`); `web/desktop-panel.js:203` (`openChat` → `setCodeMode(false)`); `desktop/preview.cjs:44-59` (`previewApp` window).

**Fix sketch.** Nothing required unless Wonder shows a code-side preview pane. The Wonder static evidence lists preview ownership APIs, which suggests a single canvas frame as in Verynize.

Verdict: present (code toolbar control that hands off to the canvas frame). The separate-window option is Verynize-only.

## PF. The preview frame on the canvas

### PF1 Running frame (`PF1-running`, `PF1-selected`)

**What Verynize shows.**

- **Frame node.** A top-level `frame` named "Preview Sandbox · Preview", 1200×800 world px, colour `#191919`, radius 8, `preview: {root, name, chatId, url}`.
- **DOM.** The frame element gets class `canvas-preview`: background `rgb(28,28,28)`, shadow `0 10px 24px #0005`, radius 8.
- **Breadcrumb above the frame.** "Preview Sandbox" (12px, `rgb(147,147,147)`) followed by a **"Local"** badge: 10px, padding 2/5, radius 4, background `rgb(38,38,38)`. It is 8 px above and 8 px in from the frame's left edge.
- **Breadcrumb content.** Only the app name (`node.preview.name`). There is no repo/chat breadcrumb in this path; "repo › chat" appears only when started from the Code toolbar, via `showPreview`'s name.
- **Selected.**
  - Purple outline and 4 corner handles: 8×8, white fill, 2 px `rgb(185,60,219)`, `aria-label="Resize nw|ne|sw|se"`.
  - Size badge "1200 x 800" below: 75×22, background `rgb(162,69,211)`, white 12px, radius 4.
  - The regular frame name label (`#selection-name`) is hidden for preview frames.
  - Selecting the frame also adds a "# Preview Sandbox · Preview" context chip to the chat composer.
- **Mouse input.** The iframe gets `pointer-events: none` until Navigate is pressed.

**Source.**

- `web/live-preview.js`: `ensure` 171-182 (defaults at 179); `renderNode` 158-169; markup 125.
- `web/live-preview.css:1-3, 18`; `web/app.js:20` (`layerElement` → `livePreview.renderNode`), `:7` (`validate`: preview only on top-level frames).

**Fix sketch.** Show "repo / chat" consistently. Pass `name: <repo> › <chat title>` from `ensure()` in `preview-setup.tsx:56`, or render both parts from `root` and `chatId`. Wonder's breadcrumb is repository/chat plus Local.

Verdict: present (frame, Local badge, size badge, purple selection). Gap: the breadcrumb shows only the app name, not repo/chat.

### PF2 Frame toolbar (`PF2-toolbar`, `PF2-toolbar-left`, `PF2-toolbar-right`, `PF2-<control>-hover`, `PF2-path-focus`, `PF2-path-typed`, `PF2-back-result`, `PF2-forward-result`)

**What Verynize shows** (at 100% zoom).

- **Bar.** A 38 px bar, background `rgb(28,28,28)`, padding 4/6, gap 4, 1 px bottom border. It is part of the frame and scales with zoom (15.8 px tall at 41.7%).
- **Controls**, left to right. Each is a legacy unicode-glyph button: 25 px tall, background `rgb(38,38,38)`, 1 px `rgb(38,38,38)`, radius 5, padding 4/8, 13px.
  1. "‹" (23 px, `aria-label` "Back")
  2. "›" (23, "Forward")
  3. "↻" (28.6, "Reload preview")
  4. A state text slot: empty when running; otherwise "Setting up preview…", "Preview failed" or "Preview paused".
  5. The path input "/": flexible width, transparent, 13px, `aria-label` "Preview path".
  6. "⊙ Stop" (59.7)
  7. "⬚" (31, "Pick capture region", `title` "Capture a region")
  8. "⤢" (25.2, "Expand preview", `aria-pressed`)
- **No Publish button.**
- **Tooltips.** None, except the native `title` on ⬚. The hover shots show no change, because legacy buttons have no hover style.
- **Path field.**
  - It is a real input: typing "/about/" and Enter navigates (`PF2-path-typed`).
  - The camera shifted by 136.5 px when Playwright hovered the path field (`camera.x` −955 → −1091.5). That is most likely Playwright scrolling the partly off-screen 969 px input into view, not app behaviour. Treat it as unverified.
  - The field does **not** follow in-app navigation. After clicking the app's link to /about/ (`PM2-link`), the field still shows "/" and `getSelectionState().url` is still `http://localhost:5199/`.
- **Back and Forward** work (`PF2-back-result`, `PF2-forward-result` load the app history).
- **Reload** re-sets `src`.

**Source.** `web/live-preview.js:125` (markup), 139-145 (handlers), 34-41 (`navigate`); `desktop/preview.cjs:92-97` (`previewNavigate`); `web/live-preview.css:5-8`.

**Fix sketch.**

- Rebuild the bar with island-style icon buttons: lucide ChevronLeft, ChevronRight, RotateCw, Square and Maximize2, each `size-4` with a Radix tooltip.
- Add a **Publish** button left of Stop, wired to `cloudAppPublish` (see PP1).
- Keep the bar a fixed screen-pixel height (counter-scale by 1/zoom), as the selection chrome does.
- Update the path from `did-frame-navigate` (already observed in `preview.cjs:259`) via an IPC event or a 500 ms `frame.url` check.

Verdict: partial. Back, forward, reload, path, Stop and expand exist and work; Publish is missing. There are no tooltips, legacy glyph styling, a zoom-scaled bar and a stale path after in-app navigation.

### PF3 Expand (`PF3-expanded`)

**What Verynize shows.**

- "⤢" toggles `aria-pressed` and only re-fits the camera to the frame (zoom 41.7% → 46.7%). It is not a fullscreen/focus mode.
- Pressing ⤢ again restores the previous view.
- No Esc handling and no visual change of chrome.

**Source.** `web/live-preview.js:145-150`.

**Fix sketch.** Make expand a real focus mode: hide the panels (`left-collapsed`/`right-collapsed` plus the chat dock), fill the canvas, add an exit button and Esc. Restore on exit.

Verdict: partial (control exists; behaviour is a camera fit, not fullscreen).

### PF4 Resize (`PF4-handle-hover`, `PF4-resize`, `PF4-resized`)

**What Verynize shows.**

- 4 corner handles; the cursor is `nwse-resize` on the se handle.
- Dragging resizes the frame live (badge "858 x 608"). The app reflows: iframe viewport 858×570, since the bar takes 38 px.
- No size presets or device sizes on the frame. The inspector W/H fields work as for any frame.
- Edge handles do not exist (corners only).

**Source.** `web/app.js:20` (`layerElement` handles); `web/live-preview.css:10` (iframe 100%).

**Fix sketch.** If Wonder offers device presets, add a size menu to the frame toolbar or the contextual toolbar. Verynize already has a viewport list (`#capture-web-size`: Desktop 1280×800, Tablet 768×1024, Mobile 390×844) to reuse.

Verdict: present (resize with reflow). Presets are not observable in Wonder evidence; Verynize has none.

### PF5 Right-click on the preview frame (`PF5-context`)

**What Verynize shows.** The generic canvas layer menu (`#canvas-menu`): 191×405, background `rgb(28,28,28)`, 1 px `rgb(38,38,38)`, radius 12, rows 25 px. Items in order:

1. Add context ⌘L
2. Copy ⌘C
3. Copy as ›
4. Copy link to selection
5. Select layer ›
6. Paste ⌘V (disabled)
7. Paste to replace ⌘⇧R (disabled)
8. Paste over selection ⌘⇧V (disabled)
9. Duplicate ⌘D
10. Hide ⌘⇧H
11. Lock ⌘⇧L
12. Hide label
13. Arrange ›
14. Layout ›

There are no preview-specific items (Start/Stop, Reload, Open in browser, Capture).

**Source.** `web/src/islands/context-menu/model.ts:205` and its builder; `CanvasContextMenu.tsx`.

**Fix sketch.** When the target node has `preview`, prepend a group: Start/Stop preview, Reload, Open in browser, Capture to canvas. Consider hiding "Copy as" and "Layout", which make no sense for a live frame.

Verdict: generic menu only; preview actions are missing (Wonder's menu is not in the evidence).

### PF6 Inspector with the preview frame selected (`PF6-inspector`)

**What Verynize shows.**

- The normal frame inspector:
  - Position (X 995, Y 100, rotation, constraints Left/Top, Z Auto).
  - Layout (Display, W 1200 px, H 800 px).
  - Appearance (Opacity 100%, Corner radius 8, Clip content checked).
  - Background Fill `191919` 100%.
  - Border, Outline, Shadow, Filters, Mask and Export (collapsed "+").
- No preview section: no URL, run command, port or status.

**Source.** The inspector island has no `preview` branch (grep `web/src/islands/inspector`).

**Fix sketch.** Add a "Preview" section for `node.preview`: repository/chat, URL/port, state, Start/Stop, "Configuration…". Hide fills, effects and Export that don't apply to a live iframe.

Verdict: generic frame inspector; no preview-specific fields.

### PF7 Layers row (`PF7-layers`)

**What Verynize shows.**

- The row "Preview Sandbox · Preview": 268×30, radius 6, selected background `rgb(67,39,82)`, 12px.
- It uses the generic frame (#) icon.
- The captured layers ("Captured region"), when present, sit above it.

**Source.** The sidebar island renders `node.type==='frame'`; there is no preview icon.

**Fix sketch.** Use a distinct icon (lucide `MonitorPlay`/`AppWindow`) for `node.preview`, and drop the " · Preview" suffix if the icon carries the meaning.

Verdict: present (row exists); generic frame icon.

### PF8 Second preview of the same repo (`PF8-second`)

**Steps.** `window.livePreview.ensure({root, chatId:"audit-second-chat", name:"Preview Sandbox › Second chat"})`. This is what starting a preview from a second chat on the same root does.

**What Verynize shows.**

- A second frame "Preview Sandbox › Second chat · Preview" (1200×800) is added to the right, at x = 3575.
- Both frames share **one** dev server per root (`ProcessManager.servers` is keyed by root). The second shows "Ready to start your preview".
- Only one frame can be "active" (`#live-frame` / `verynize-live-preview`) at a time; `activate()` moves the ids.
- In normal UI each chat has its own worktree root, so each chat gets its own server.

**Source.** `web/live-preview.js:15-24` (`activate`), 171-182 (`ensure` keyed by root + chatId); `desktop/dev-server.cjs:280-282`.

Verdict: reachable (API-driven here); multiple frames are supported, but only one is interactive at a time.

## PM. Modes

### PM1 Contextual toolbar (`PM1-toolbar`, `PM1-<button>-hover`, `PM1-more-menu`)

**What Verynize shows.**

- **Placement.** `#preview-toolbar` (`role=toolbar`, `aria-label="Preview tools"`), **fixed in screen space** at canvas bottom-centre: 303×40 at (677, 762), bottom 68 px, directly above the main canvas toolbar. It is not attached to the frame.
- **Box.** Background `rgb(28,28,28)`, `--toolbar-edge` border, radius 12, padding 4, toolbar shadow.
- **Buttons.** 32 px tall, padding 0/8, radius 8, 14px/20px Inter, colour `rgb(144,144,144)`; hover background `rgb(38,38,38)`, text `rgb(232,232,232)`:
  - "Navigate" (MousePointerSquareDashed icon, 96.5 px)
  - "Edit" (Target icon, 63 px)
  - "Capture" (Scan icon, 90.7 px)
- **Divider**, then "⋯" `#preview-more` (32×32, `aria-label` "More preview options").
- **Active state.** `aria-pressed=true` only changes the text to `rgb(232,232,232)`; there is no background.
- **No tooltips or shortcuts** on any button.
- **More menu** `#preview-options-menu` opens upward: 185×66, radius 10, rows 28 px, 14px. Items:
  - "Send all input to app": checkbox, with `title` "Send keyboard input to the app. Press Command/Ctrl+Shift+Escape to return to the canvas."
  - "Open in browser"
- **Visibility.** Shown only while a single preview frame is selected. Disabled unless the state is `running`.

**Source.** `web/src/islands/chrome/PreviewToolbar.tsx:42-57`; `preview-toolbar.css:2-17`; mounted at `chrome/CanvasOverlays.tsx:87`.

**Fix sketch.**

- Anchor the toolbar beneath the selected frame's screen rect. Recompute on camera and selection change from `design.subscribe`, not React pointer-move. Keep it zoom-independent.
- Give the pressed mode a `bg-muted` pill.
- Add Radix tooltips with shortcuts, if Wonder has them (not in the evidence).

Verdict: present (same three modes). Gaps: position (screen-bottom vs. beneath the frame), weak active state, and no tooltips.

### PM2 Navigate (`PM2-navigate`, `PM2-typed`, `PM2-scrolled`, `PM2-link`, `PM2-input-captured`)

**What Verynize shows.**

- **Before Navigate.** A click selects the frame, and the wheel does not scroll the app.
- **After Navigate.**
  - Three clicks on the app's button give "Count: 3".
  - Clicking the input and typing "Adam" works: the echo reads "Hello, Adam." and focus is in `#name`.
  - The wheel scrolls the app (scrollY 960).
  - The link navigates to /about/.
- **Release.** Clicking outside the frame or deselecting resets the mode to select.
- **Send all input to app.** A checked menu item. It routes all keys, including shortcuts, to the app until ⌘⇧Esc or a window blur. There is no on-canvas indicator while input is captured, other than the checked item.

**Source.** `web/live-preview.js:187-193`; `desktop/preview.cjs:70-90` (`previewInput`, `before-input-event` release).

**Fix sketch.** Show a visible "Input captured · ⌘⇧Esc to release" pill on the frame while `inputToApp` is on. Make the path field follow navigation (PF2).

Verdict: present and working. Gap: no capture indicator.

### PM3 Edit (`PM3-edit`, `PM3-hover`, `PM3-select`, `PM3-inspector`, `PM3-edited`, `PM3-undone`)

**What Verynize shows.**

- **Edit opens a selector-driven form** inside the frame's top-right: 280 px wide, background `rgb(28,28,28)`, radius 8, padding 12. It scales with zoom: 117×173 at 41.7%, illegible.
  - Fields: "Element selector" (default "body") with [Inspect], "Text", "Text color" (placeholder "#ffffff"), "Background" (placeholder "#171717"), "Font size" (placeholder "16px").
  - Buttons [Apply] [Undo] and a status line.
- **No hover highlight in the app** (`PM3-hover`).
- **Clicking an element does not select it** (`PM3-select`: the selection stays the frame).
- **Inspect** with `#title` fills Text = "Preview Sandbox". Colour and background are filled only in computed form.
- **Apply** (text "Edited in Verynize", colour `#d946ef`) changes the live DOM to `rgb(217,70,239)`, with the status "Applied to the running page."
- **Undo** reverts the DOM, but the form keeps the edited text.
- **The source file is untouched** (`sourceUntouched: true`). Edits are transient and never sync back to code.
- **The right inspector does not reflect the element.**

**Source.** `web/live-preview.js:125` (form markup), 151-154 (`inspect`/`apply`/`undo`), 188 (`editMode`); `desktop/preview.cjs:10-39` (`editPreviewElement`), 64-69, 98-99.

**Fix sketch.** This is the largest gap.

- Hovering in Edit mode should outline the DOM element under the pointer. `previewElementAt` already exists (`preview.cjs:62`) and powers the capture picker's highlight.
- A click should select it and show its styles in the right inspector, not in a floating form.
- Edits should go through an undoable history.
- Optionally offer "Apply to code" by sending the diff to the agent.

Verdict: partial (transient selector-based edits with undo). There is no hover highlight, no click-to-select and no inspector integration. Edits do not persist.

### PM4 Capture (`PM4-capture`, `PM4-result`, `PM4-pick`)

**What Verynize shows.**

- **Capture** (`#live-capture`) snapshots the live DOM into editable layers.
  - It inserts a new top-level frame "Captured region", 1200×762 (the iframe viewport), 80 px right of the preview at the same y.
  - 15 nodes were added: text, rectangles, image.
  - The button label shows "Capturing…" while it runs.
  - The frame message reads "Captured editable layers beside the preview." It is visible only when not running.
- **Region picker** (the frame toolbar's ⬚) overlays the frame.
  - A pill hint "Click an element or drag a region · Esc to cancel" (12px, radius 999).
  - Hover highlights the element under the pointer: 2 px `--ring` border, 12% purple fill and a label tag "button#counter" (11px, white on `rgb(162,69,211)`).
  - Click captures that element; dragging captures a rectangle.
- **Not reachable from the contextual toolbar.**

**Source.** `web/live-preview.js:57-80` (`capture`/`insertCaptured`), 84-123 (`pickRegion`); `desktop/preview.cjs:60, 112-122`; `desktop/capture-core.cjs`.

**Fix sketch.**

- Put the region picker behind the Capture button (click = whole viewport, or a split with "Pick region").
- Name the result after the page title or path (e.g. "Preview Sandbox · /") instead of "Captured region".
- Select the new frame and pan to it.

Verdict: present (capture to editable layers beside the preview). Naming and picker placement differ.

### PM5 Add to chat (`PM5-context`)

**What Verynize shows.**

- Selecting the preview frame puts a chip "# Preview Sandbox · Preview" in the chat composer. ⌘L and the context menu's "Add context ⌘L" add the selection explicitly.
- The chip references the **frame layer**, not the running page: no URL, DOM element or screenshot is attached.
- There is no ⊕ chip on the frame itself.
- Agents can read the page through the MCP `preview_snapshot`/`preview_screenshot` tools.

**Source.** `web/src/islands/context-menu/CanvasContextMenu.tsx:65-80` (⌘L), `model.ts:205`; `integrations/shell-tools.mjs:58-96`.

**Fix sketch.** When the selected node is a preview, add `{url, path, selected element selector}` to the context payload, and let Edit-mode element selection produce an element chip.

Verdict: partial (frame-level context only).

## PP. Publish and stop

### PP1 Publish (`PP1-publish`)

**What Verynize shows.**

- There is no Publish on the preview frame.
- The only publishing UI is Share (`#cloud-dialog`, 328 px side dialog) › "Publish app":
  - "No build script found; the output folder is published as is."
  - "App name" input (prefilled with the worktree name "oriole" etc.)
  - "Output folder" (placeholder "Detected after build (dist, build, out)")
  - Buttons "Build & publish" and "Unpublish app"
- It requires a cloud sign-in. Nothing was published.

**Source.** `web/cloud-panel.js:52-59`, 1718; `desktop/app-publish.cjs` (`cloudAppDetect`, `cloudAppPublish`).

**Fix sketch.** Add a "Publish" button to the frame toolbar that opens a popover with the same fields and actions, reusing `cloudAppPublish`. Show the published URL in the popover and on the frame (badge "Published").

Verdict: missing on the preview frame (a backend exists under Share).

### PP2 Stop (`PP2-stopped`, `PP2-stopped-100`)

**What Verynize shows.**

- The frame toolbar's "⊙ Stop" stops the process group.
- The frame returns to paused ("Preview paused", "Ready to start your preview", "▶ Start").
- The contextual toolbar buttons become disabled.
- The header button changes back to "Start preview" after its 4 s poll.

**Source.** `web/live-preview.js:47-48`; `desktop/agent-shell.cjs:207` → `dev-server.cjs:312-318`.

Verdict: present.

### PP3 Open in browser (`PP3-open`)

**What Verynize shows.**

- ⋯ › "Open in browser" (ExternalLink icon) calls `shell.openExternal` on the current frame URL (localhost only). It was not clicked during capture.
- The chat/code split menu also has "Preview in a separate window", which opens an Electron window.

**Source.** `PreviewToolbar.tsx:52`; `web/live-preview.js:190`; `desktop/preview.cjs:91`.

Verdict: present (in the overflow menu, not as a frame toolbar control).

## X. Extra findings

- **X1.** The header and Code `PreviewButton` poll every 4 s, while the frame polls every 1.5 s. The two disagree for up to 4 s: `PF1-selected` shows a running frame with a header reading "Start preview".
- **X2.** The in-frame chrome (breadcrumb, bar, cards, edit form) is plain DOM inside the scaled layer. It becomes unreadable below about 70% zoom, while the contextual toolbar is screen-fixed. Wonder's frame chrome appears constant-size in the screenshots (not measured).
- **X3.** The legacy `#show-live-preview` ("Running app") and `#capture-webpage` ("Capture web page") buttons are created next to `#preview` (`web/live-preview.js:215, 288-290`). They live in the hidden legacy dock and are reachable only via code or menu ids.
- **X4.** No page errors were logged during the whole run (`metrics.json.pageErrors` = []).
