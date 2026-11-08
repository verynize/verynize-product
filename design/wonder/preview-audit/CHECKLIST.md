# Preview parity audit: capture checklist (2026-10-31)

Shared checklist for two capture passes of the **preview** feature (running a repository's dev server and showing it as a live frame on the canvas):

- Wonder: the live app (`/Applications/Wonder.app`), saved to `wonder/`.
- Verynize: Electron, saved to `verynize/`.

Existing evidence to confirm or refute: `docs/wonder-preview-reference.md` (four screenshots from 2026-10-29 and preload API names).

Name every screenshot `<id>-<state>.png` with the ids below, so the two sides pair up by filename (`pairs/`). Capture at native 2×, full window (1440×870 CSS) unless a tight crop is clearer; record any crop rectangle.

For every id the notes must give: the steps; exact visible strings (labels, tooltips, menu items in order, shortcuts, disabled state); measurements in CSS px (heights, widths, padding, radius, font size); sampled RGB values; and a final line `Verdict: …` or `Verdict: not observable — …`.

Use the same sandbox project on both sides: a tiny Vite or plain `index.html` app in `/tmp/preview-sandbox` (a git repo with a heading, a button that increments a counter, a text input, a link to `/about`, and an image).

## PS. Starting a preview

- PS1 Chat header **Start preview** split button: idle, hover tooltip, and the split-arrow dropdown contents (PS1-idle, PS1-menu).
- PS2 First start with no saved config: what happens (agent proposal card? dialog?). Capture the **Setup / Run / Port** card with Edit and Save & start (PS2-card) and its edit state (PS2-edit).
- PS3 Startup state on the canvas frame: progress text, logs, spinner, Stop control (PS3-starting, PS3-logs).
- PS4 Error state: a run command that exits non-zero or a busy port (PS4-error); the retry/fix affordances.
- PS5 Paused frame after reopening the file or stopping: "Ready to start your preview" card (PS5-paused).
- PS6 Start preview from the Code workspace (if it exists in Wonder) and how it relates to the canvas frame (PS6-code).

## PF. The preview frame on the canvas

- PF1 Running frame, unselected (PF1-running) and selected (PF1-selected): frame label, breadcrumb repo/chat, **Local** badge, size badge.
- PF2 Frame toolbar: back, forward, reload, path field, Publish, Stop, expand — tooltip per control (PF2-toolbar, PF2-<control>-hover). What does clicking the path field do; can you type a path?
- PF3 Expand / fullscreen state and how to leave it (PF3-expanded).
- PF4 Resizing the frame: handles, size presets / device sizes, does the app reflow (PF4-resize).
- PF5 Right-click on the preview frame: context menu items (PF5-context).
- PF6 Inspector (right panel) when the preview frame is selected: sections and fields (PF6-inspector).
- PF7 Layers panel row for the preview frame: icon, name (PF7-layers).
- PF8 Multiple previews / a second preview of the same repo (PF8-second) — only if reachable.

## PM. Modes (contextual toolbar beneath/above the selected frame)

- PM1 The **Navigate / Edit / Capture** toolbar: position, sizes, active state, tooltips + shortcuts (PM1-toolbar).
- PM2 Navigate: clicking the app's button and link, typing in the input, scrolling; how input capture is entered/released (PM2-navigate, PM2-typed).
- PM3 Edit: hover highlight of DOM elements, selecting an element, what the inspector shows, editing text/styles, undo/redo, and whether edits persist/sync back to code (PM3-hover, PM3-select, PM3-inspector, PM3-edited).
- PM4 Capture: what gets created on the canvas (layers? image?), naming, position relative to the preview (PM4-capture, PM4-result).
- PM5 Add to chat / context from the preview (⊕ chip, Add context ⌘L) (PM5-context).

## PP. Publish and stop

- PP1 Publish: dialog/popover contents, states (PP1-publish). Do NOT actually publish anything public; capture the UI and cancel.
- PP2 Stop preview: frame state after stopping, header button state (PP2-stopped).
- PP3 Open in browser / external link (PP3-open) if present.

## X. Extra findings

- X1… anything preview-related not listed above.
