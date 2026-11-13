# Wonder preview reference

Inspected on 2026-10-29 for the Verynize preview implementation. This records reference evidence, not a claim of feature parity.

## Screenshot observations

The four user-supplied screenshots dated 2026-10-29 show:

- A split **Start preview** control in the chat header, changing to **Stop preview** during startup.
- An agent-proposed configuration card with **Setup**, **Run**, and **Port** rows, plus **Edit** and **Save & start preview** actions. The example uses port 5173; it is not evidence of a universal default.
- A persistent canvas preview frame. When paused, it contains a centered **Ready to start your preview** card and Start action. During startup, it displays setup progress and logs. A running frame contains the interactive application.
- A repository/chat breadcrumb and **Local** badge above the frame. The running frame toolbar contains back, forward, reload, and path controls, with Publish, Stop, and expand controls on the right.
- Purple selection bounds and a contextual **Navigate / Edit / Capture** toolbar beneath the selected preview frame.

The screenshots establish visible states and controls, not the success of every action behind them.

## Installed application: static evidence

Artifact: `/Applications/Wonder.app/Contents/Resources/app.asar`.

- SHA-256: `4076474dda29f320111b0aaa414ca82283f868e3a20c44607afb099d94294c47`.
- REA parent evidence: `ev_c6bea908c3648e77c784f45e68cd0a7c833938e3914e548cd772521b2d0178dc`.
- Selected source: `dist-electron/preload.js`; other application sources were not analyzed in this pass.

Preload declarations expose API candidates for run profiles, saved run configuration and suggestions; server start/stop, statuses, logs and terminal input; port and preview-address selection; preview ownership and setup holds. Preview declarations also include navigation/reload, inspection and edits with undo/redo, capture, and publishing.

These declarations do not establish runtime registration, reachability, successful execution, or complete behavior. The app was not launched or driven in this investigation. Two native-member integrity contradictions were recorded with the record-and-continue policy; those members remain observed-untrusted. The current artifact hash differs from the earlier observation in `installed-wonder.md`; that earlier record describes a different artifact snapshot.

## Implementation priorities

Use the visible setup/run/port review flow, explicit startup/error/paused/running states, actionable logs, and persistent canvas placement as the core interaction reference. Preserve Verynize's own implementation and security boundaries. Treat inspection, capture, and publishing as separate capabilities requiring working backends and their own validation before claiming support.

## Live reference (2026-10-31)

Wonder's preview was later driven live against a sandbox repository (`/tmp/preview-sandbox`).

- Steps, exact strings, measurements and per-id verdicts are in `design/wonder/preview-audit/wonder/notes.md`; read its "Do not use" list before relying on a screenshot.
- The live pass refines this page:
  - In Auto access the agent saves the run profile directly, as a "Preview setup / Saved by auto mode" transcript card, and does not start the server.
  - Stop asks "Discard preview edits?" when Edit-mode changes are staged.
  - Capture of an element creates an editable Text layer 100 px right of the preview.
  - Expand opens a separate internal Preview tab.
- The Setup/Run/Port card above was not observed in Auto mode, but this does not refute it for other access levels.

Verynize's side is in `design/wonder/preview-audit/README.md`: before and after pairs (`pairs/`, `pairs-after/`), per-id verdicts (Match / Close / Deliberate difference / Not observable in Wonder), the integration seam checks and the remaining gaps.
