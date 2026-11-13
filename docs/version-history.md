# Version history

Per-artboard version history for local files and shared rooms. An artboard is a top-level frame (`type: "frame"`, no `parentId`); a version is a snapshot of its subtree. Restoring replaces the artboard with the snapshot as ordinary edits, so collaborators converge and undo works.

## One implementation of the rules

`web/version-history-core.js` (`globalThis.VerynizeVersions`; Node: `integrations/version-core.mjs`) holds the capture rules, pruning and restore. Four places use it:

| Where the document lives                                                              | Captured by                                            | Stored in                                                                                       |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| Native file `NAME.verynize.json` (desktop)                                            | the editor (`web/version-history.js`)                  | sidecar `NAME.verynize.history/` (main process, `desktop/design-files.cjs`)                     |
| Native file edited headlessly (stdio MCP, desktop bridge for files that are not open) | the store backend (`integrations/design-tools.mjs`)    | the same sidecar (`integrations/version-store.mjs`)                                             |
| Library document (browser storage)                                                    | the editor                                             | IndexedDB `verynize-versions` (stores `meta` and `snapshots`, keyed `<file key>\|<version id>`) |
| Shared room                                                                           | the room (`cloud/room-history.js` in `cloud/rooms.js`) | the room's SQLite (`history_versions`, `history_parts`, `history_last`)                         |

## When a version is captured

For every edit, the artboards whose subtree changed are compared with who edited them last (`last`: author, time, hash of what they left) and with the newest stored version (`latest`).

- **Editor switch.** When the person, an agent or another collaborator edits an artboard that someone else edited last, the state before this edit (the previous editor's work) is stored in the previous editor's name (`reason: "switch"`). If the artboard changed since the last edit the history saw (an external tool, another app), the state is stored as an unknown editor's.
- **Idle.** After two minutes without edits to an artboard (`IDLE_MS`), its current state is stored in its last editor's name (`reason: "idle"`). The editor runs a timer; rooms use the Durable Object alarm; the headless store applies the rule on its next write.
- **Agent safety net.** When an agent edits an artboard the history has no record of (for example right after opening a file), its state is stored first (`reason: "agent"`). A deletion stores the deleted state when it is not stored yet (`reason: "delete"`).
- **Restore.** The state a restore replaces is always stored first (`reason: "restore"`), so a restore is itself listed and can be undone from the history.
- **Finish.** `finish_artboard` stores the finished state as a milestone (`reason: "finish"`). The panel's Save version stores the current state (`reason: "manual"`).

A burst of edits by one editor is one version: nothing is stored while the same editor keeps editing. Apart from restores, a snapshot identical to the artboard's newest version is not stored again. Loading a document (opening a file, reloading it from disk) is not an edit: the editor starts over from the loaded document.

Authors are `{kind, name}`: `user` (the person; in rooms the account's display name or the presence name), `agent` (MCP edits and agent commits; `name` from the client, "Agent" by default) or `unknown`. In rooms the author id combines the account (or client) and, for agents, the agent name, so "Alice" and "Alice's agent" are different editors.

### Who is editing (the editor)

`web/version-history.js` treats every edit as the person's, except edits made inside `window.versionHistory.as(author, fn)`: agent commits from the MCP bridge (`web/agent-bridge.js` `commit`) and restores. In a shared room the editor captures nothing itself; `web/cloud-panel.js` asks `versionHistory.batchActor()` for every queued batch and sends it as `actor` (`{kind: "agent", name}` or `{kind: "user", restore: <version id>}`). Batches of different editors never merge, and the actor is kept in the IndexedDB outbox with its batch.

## Retention

At most 50 versions per artboard (`MAX_VERSIONS`). The newest 20 are always kept. Older versions are thinned by time buckets that double in length going back from the newest version (1 h, 2 h, 4 h, …): the newest plain version of each bucket and every milestone (`finish`, `restore`) are preferred. Only the excess is dropped, in this order: the other plain versions (oldest first), then the oldest preferred plain versions, then the oldest milestones. Rooms also cap snapshot bytes at 1 GiB per room (`HISTORY_BYTES`, a Durable Object holds 10 GB); beyond it the oldest versions go, never an artboard's newest one.

## Storage details

- **Sidecar.** `NAME.verynize.history/index.json` holds `{format: 1, last, versions: [meta]}`; each snapshot is `<version id>.json`. Writers take `index.json.lock` (exclusive create, stale after a minute) and replace the index atomically. The document and its 20 MiB limit are unaffected. The desktop main process only accepts the sidecar of the file open in its window (the renderer names the path; any other path is refused). When the folder is created it gets a `.gitignore` containing `*`, so the history of a design kept in a git repository stays local and never shows in `git status` (git already versions committed files, and a shared index would conflict on every branch). To commit the history, delete that `.gitignore`; Verynize does not write it again.
- **Rooms.** `history_versions (id, artboard_id, page_id, at, bytes, meta)`, snapshots in `history_parts` rows of at most 256 Ki UTF-16 units (a Durable Object SQLite row holds at most 2 MB), `history_last` per artboard. The room compares only the artboards holding the nodes a batch touched (node-level operations), else the touched pages. History failures are logged and never fail an edit.

## Restore

`restore(doc, snapshot, {asCopy})` replaces the artboard's subtree with the snapshot at the artboard's position on its page:

- a deleted artboard is re-created on its page (or the active page, or the first page) at its old index;
- snapshot node ids used elsewhere in the document are renamed (and component copies adopted through `VerynizeComponents.adoptCopies`);
- **Restore as copy** renames every id and places the copy 80 px right of the artboard, named "… (restored)".

Locally the new document is loaded with `setDocument` inside `as()`: one undo step. In a room the same call produces ordinary operations through the client's queue (`web/cloud-panel.js`), honoring retained and rejected batches, so every client converges and collaborative undo reverts it. The room never receives a whole-document overwrite.

## API

### Editor (`window.versionHistory`, `web/version-history.js`)

`list(artboardId)`, `get(id)`, `preview(id)` (renders the restored document with `presentDocument`, without changing it; any real render ends the preview), `endPreview()`, `restore(id, {asCopy})`, `capture(artboardId, {reason, label})`, `as(author, fn, force)`, `batchActor()`, `target()` (`{kind: native|local|room, key}`), `flush()`, and `configure({idleMs, debounceMs})` for tests. Events: `verynize:versions-changed` `{artboardIds}`, `verynize:version-preview` (`{id, artboardId}` or `null`).

### Desktop preload (`desktop/preload.cjs`, capability `versionHistory`)

`versionsList({path, artboardId?})` → `{versions, last}`, `versionsGet({path, id})` → `{meta, snapshot}` or null, `versionsAdd({path, entries, last?})`.

### Rooms (`cloud/rooms.js`, routed by `cloud/worker.js`)

- `GET /api/rooms/:id/versions` (viewer) → `{artboards: [{artboardId, pageId, name, versions, latest}]}`.
- `GET /api/rooms/:id/versions?artboard=<id>` (viewer) → `{artboardId, versions: [meta]}` newest first.
- `GET /api/rooms/:id/versions/:versionId` (viewer) → `{version, snapshot}` or 404.
- `POST /api/rooms/:id/versions` `{artboard, label?}` (editor) stores the artboard's current state.
- Batches (`ops` socket messages, `POST /ops`) accept an optional `actor`; hosted MCP edits are agent edits.
- RPC for the hosted MCP: `historyList`, `historyGet`, `historyCapture`; `agentApply` takes `actor`.
- `VERSION_IDLE_MS` (environment) shortens the idle time in tests.

### MCP (`integrations/design-tools.mjs`)

- `list_versions {artboard?, limit?}`: one artboard's versions (`version`, `at`, `author`, `reason`, `summary`), or without `artboard` the artboards of the page (and deleted ones, by long id) that have versions.
- `restore_version {artboard, version, asCopy?}`: one undoable edit; the replaced state becomes a version.

Backends implement `versions: {list(ref, artboardId), get(ref, id), capture(ref, artboardId, {reason, label})}` and accept `transact(ref, fn, {actor, force, artboardId, label})`: the store backend through the sidecar, the desktop bridge through the open editor (or the sidecar for files that are not open), the hosted backend through the room.

## UI

![Version history panel](version-history-panel.png)

The history island (`web/src/islands/history.tsx`, `history/version-panel.tsx`) is a floating panel left of the inspector, opened from an artboard's context menu (Version history, `menu.versionHistory`) or with `bd:open-version-history` `{detail: {artboardId}}`. While open it follows the selected artboard. Rows show author, time, reason and summary with Preview, Restore and Restore as copy; Save version stores the current state. Viewers of a room can preview but not restore. Test ids: `#version-history[data-artboard][data-target]`, `li[data-version][data-reason][data-author-kind]`, `[data-version-preview|restore|restore-copy=<id>]`, `[data-version-save]`, `[data-version-close]`, `#version-preview-banner`, `#version-preview-restore`, `#version-preview-exit`, `#version-history-empty`, `#version-history-error`.

## Tests

- `node --test integrations/version-history.test.mjs`: capture rules, pruning, restore (in place, deleted artboard, id collisions, copy), the sidecar, and `list_versions` / `restore_version` / `finish_artboard` over the store backend.
- `node tests/cloud-version-history.mjs` (also on Node: `CLOUD_RUNTIME=node`): room captures with authors, viewer/editor permissions, restore as operations with two-client convergence, a deleted artboard re-created, the idle alarm, chunked snapshots and the hosted MCP tools.
- `node tests/version-history.cjs` (Electron): person/agent switches through the real MCP bridge, the idle timer, the panel, preview, restore with undo, restore as copy, a deleted artboard and the native sidecar with live MCP tools.
- `node tests/cloud-version-history-desktop.mjs` (two Electron clients): room captures from a collaborator and an agent, the panel on room versions, restore through the op queue, convergence and collaborative undo.

## Limits

- Thumbnails are not stored; Preview renders the snapshot on the canvas instead.
- A file saved for the first time keeps the versions it had as a library document in IndexedDB; versions captured afterwards go to the sidecar.
- Headless writes (the stdio server) see the person's edits only as an unknown editor's change.
- Only top-level frames have a history; changes to other top-level layers, page settings or tokens are not versioned.
