# Collaboration, API and caching: re-run and deeper audit (opus, 2026-11-08)

Read-only audit of `staging` at `2630c30`. This replaces the reconstructed summary of the first run. Everything marked **verified** was reproduced or measured in this run with local workerd (Miniflare, the built Worker bundle, `tests/cloud-harness.mjs`), real Electron 45 with a temporary `--user-data-dir`, and a raw WebSocket peer that speaks the room protocol. Nothing was mocked. **Suspected** means it follows from the code but was not reproduced. Production was not touched in this run: the production numbers quoted below come from the first run and from `astra-prod.md`, and are marked as such.

Evidence is in `opus/`: three screenshots, and `opus/repro/` with the two scripts and the scrubbed result JSON (room IDs replaced with `<room>`). Both scripts are uncommitted.

- `opus/repro/crash.mjs` tests what a Durable Object reset does to storage and to reconnecting clients. Run it with `FAULT=none|broadcast|midcommit|history`.
- `opus/repro/collab-electron.mjs` drives one Electron client plus a raw peer. `SCEN=diverge,gap,dupack,split,poison,gestures,timing,access,perf,perf2,perf3` picks the scenarios. Both scripts need `CLOUD_WORKER_BUNDLE` set to the built bundle (`vp build`).

Faults are injected the same way `tests/cloud-room-poison.mjs` does it: a subclass of `DesignRoom` placed in front of the production bundle. No production code was changed. Electron ran one instance at a time, in sequential runs, each with a fresh temporary profile, and each one quit at the end. Build outputs (`.cloudflare/`, `web/dist/`) were regenerated; both are gitignored.

## Headline

1. **The permanent divergence is a client bug, not a non-atomic server write.** In local workerd a reset anywhere in a batch rolls back everything: in the middle of `RoomStore.commit`, in `recordHistory`, and even after `transactionSync` returns, during `broadcast`. The divergence has two client-side causes, both reproduced with the exact production signature (same revision on both sides, different node counts, "Synced revision N", survives a reload):
   - **No gap check.** The client takes `revision = Math.max(revision, message.revision)` from any `ops` message (`web/cloud-panel.js:643`). If it misses one broadcast and then receives the next one, it holds the newer revision without the missed content. From then on, every reconnect answers `same: true` (`cloud/rooms.js:1161`).
   - **Duplicate receipts carry no ops.** A batch the server already applied is answered with `ops: []` (`cloud/rooms.js:397-411`), but the client treats that as a normal acknowledgement. It removes the batch from `pending` (`web/cloud-panel.js:653`) without adding it to `confirmed`, so `rebuild()` deletes the user's own edits locally while the server keeps them.
2. **The drop from 4,903 to 904 nodes is consistent with one logical change split into non-atomic batches.** `batchOps` cuts at 4,000 ops (`web/room-limits.js:29`), and each batch commits and broadcasts separately. Reproduced: a 4,900-node removal went out as 4,000 + 901 ops, and a peer saw 903 nodes at the intermediate revision. The exact production trigger is not established (see 1b).
3. **A poisoned batch is worse than "it holds later edits".** Every later local edit re-sends the poisoned content in a new batch number. That crashes the room again and drops every collaborator's socket each time (verified).
4. **Remote edits replace the whole document.** That cancels drags (2/2) and resizes (1/1) in progress, and moves the text caret to the start, so typing lands in the wrong place (" one" + remote edit + " two" became " two one").
5. **Commit cost is dominated by full-document `structuredClone`.** At 5K nodes a single property edit takes about 177 ms, of which about 118 ms is roughly 10 whole-document clones. An incoming one-op remote message takes about 200 ms. Each presence pointermove costs about 30 ms.
6. **`/api/me/state` is polled every 3 s.** `web/account-store.js:388` runs `setInterval(sync, 3000)`, and every `sync()` ends with a full `GET /api/me/state` (`:298`), which is about 4 MB decoded in production. The 2 `/access` calls per room open are confirmed locally.

## Verified vs suspected

| #   | Finding                                                                                                                                                            | Status                                                                                 | Evidence                                                                                                          |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| 1a  | Reset during a batch persists nothing (mid-commit, history, broadcast)                                                                                             | **Verified** (local workerd)                                                           | `crash.mjs`, all three faults: stored revision 1 / 3 nodes, retry answered "interrupted"                          |
| 1a  | Reset after commit with sockets dropped: clients converge                                                                                                          | **Verified**                                                                           | `diverge`: client 4,903 = server 4,903, before and after reload                                                   |
| 1a  | Missed broadcast + later op = permanent divergence                                                                                                                 | **Verified**                                                                           | `gap`: client 3 / server 503 at revision 2, "Synced revision 2", survives reload (`opus/gap-after-reload.png`)    |
| 1a  | Lost own ack + `flush()` over HTTP = own edits deleted locally, permanently                                                                                        | **Verified**                                                                           | `dupack`: client 503 → 3, "Saved shared revision 1", server 503, survives reload (`opus/dupack-after-reload.png`) |
| 1a  | What lost the broadcast in production (swallowed `socket.send` at `cloud/rooms.js:224-227`, or a reset after the commit turn while hibernated sockets stayed open) | Suspected                                                                              | not reproducible without production faults                                                                        |
| 1b  | One logical change is sent as non-atomic batches; peers see intermediate states                                                                                    | **Verified**                                                                           | `split`: sends `[4000, 901]` ops; broadcasts rev 1 = 4,000 removes (server 903), rev 2 = 900 removes + `doc:name` |
| 1b  | What produced the production 3,999 removals (undo, restore or reload of an old copy; the second batch never landed)                                                | Suspected                                                                              | 904 = 4,903 − 3,999, which matches a first group of 4,000 ops with one non-remove op                              |
| 1c  | Drag lost when a remote edit arrives mid-gesture                                                                                                                   | **Verified** 2/2 (controls 2/2 kept)                                                   | `gestures`                                                                                                        |
| 1c  | Resize lost when a remote edit arrives mid-gesture                                                                                                                 | **Verified** 1/1 (control kept)                                                        | `gestures`                                                                                                        |
| 1c  | Text editing survives, but the caret jumps to 0                                                                                                                    | **Verified** 1/1                                                                       | `" one"` → remote → `" two"` gives `" two one"`; control `" one two"`                                             |
| 1d  | Send timer restarts on every change; continuous edits are sent only when they stop                                                                                 | **Verified**                                                                           | 91 per-frame edits over 1.51 s → one send of 91 ops / 8.8 KB at +1.54 s                                           |
| 1e  | A rejected (poisoned) batch holds every later edit                                                                                                                 | **Verified**                                                                           | small edit `x: 555` never reached the server; status stays on the rejection text                                  |
| 1e  | Each later local edit re-sends the poisoned content and crashes the room again                                                                                     | **Verified**                                                                           | two crash/reconnect cycles in one run (statuses in `results-collab.json`); `opus/poison-held.png`                 |
| 1e  | The "interrupted" rejection does not open the size dialog                                                                                                          | **Verified**                                                                           | `#storage-limit-dialog` absent; the text does not match `SIZE_ERROR` (`web/storage-limits.js:329`)                |
| 1f  | 2 × `GET /access` + 1 × `GET /api/rooms/:id` per room open                                                                                                         | **Verified** (local); 2 also in production (astra)                                     | `access` scenario                                                                                                 |
| 1f  | `/api/me/state` (full account state) fetched every 3 s while visible, and on every focus                                                                           | **Verified by code**; production size about 4.08 MB decoded (astra)                    | `web/account-store.js:298`, `:381`, `:388-390`                                                                    |
| 1f  | Hashed bundles served `public, max-age=0, must-revalidate`                                                                                                         | Production verified by astra; cause verified by code (no `_headers`; platform default) | `cloudflare.config.ts` `assets`, `cloud/platform/node/static-assets.js:72`                                        |
| 2   | Per-edit and per-remote-message costs at 1K/5K                                                                                                                     | **Verified** (measured)                                                                | tables below; `.cpuprofile` files were kept in the scratchpad only                                                |

## 1. Collaboration correctness

### 1a. Divergence after a reset: root cause

**How the server behaves (verified).** `applyBatch` (`cloud/rooms.js:303-389`) works in this order:

1. It writes a `pending_batches` marker and makes it durable with `await ctx.storage.sync()` (`:333-336`).
2. It runs the whole apply inside `transactionSync(finish)` (`:383`). That covers the page commit (`room-store.js:212`), the stamps, `revision=revision+1` (`:483`), history, `clients.last_batch` and deleting the marker.
3. A reset at any point before the event-loop turn ends discards everything, including when it happens in `broadcast` after `transactionSync` returns: the implicit transaction is still open in the same turn.
4. The retry hits the durable marker and is rejected as "interrupted" (`:350-369`).

So "data persisted without the revision advancing" does not happen locally. Production could differ if an isolate reset is enforced after the commit turn finished. That is suspected, not shown.

**How a client ends up "same revision, different content" (verified, two paths).**

- **No gap check (receiver).** `receiveOps` applies `message.ops`, then sets `revision = Math.max(revision, message.revision)` (`web/cloud-panel.js:637-643`). It never checks `message.revision === revision + 1`. A client that misses revision N but receives N+1 jumps to N+1 without N's content. The outbox stores `{confirmed, revision}` (`:797-813`). After a reload the socket `sync` sends that revision (`:974-978`), and the room answers `same: true` (`cloud/rooms.js:1161-1170`), so the stale `confirmed` stands for good. Remote ops on nodes the client lacks are dropped silently by `Ops.apply`, so the gap never heals.

  The repro (fault: the broadcast is skipped while every socket stays open) gave exactly the production picture: client 3 nodes, server 503, both at revision 2, status "Synced revision 2", unchanged after reload.

- **Duplicate receipt without ops (sender).** If the server already applied a batch, `applyBatchNow` returns `{duplicate: true, ops: []}` with the current revision (`cloud/rooms.js:397-411`). The client treats it as success: `pending = pending.filter(b => b.n > message.batch)` (`web/cloud-panel.js:653`), `confirmed` unchanged, `revision` advanced, then `rebuild()` (`:672`) sets the editor to `confirmed + pending`. That deletes the user's own batch locally. The duplicate arrives through `flushOps` (`:699-736`): the room flush that runs before Home, a file switch or publish (`flushBeforeSwitch`, `:738-748`). It waits 5 s for the WebSocket ack, then re-POSTs every pending batch over HTTP.

  A large batch whose ack is slower than 5 s, or whose ack was lost, gets exactly this treatment. Repro: B added 500 nodes, the ack was dropped, `cloudWorkspace.flush()` ran, and B went to 3 nodes with "Saved shared revision 1" while the server kept 503. The state persists after reload through the outbox and the switch cache (`disconnect()`, `:840-848`).

**Where the production broadcast went (suspected).** Two candidates:

1. `broadcast` swallows every `socket.send` exception (`cloud/rooms.js:221-229`). The sender gets no ack either, and nothing on the client retries an unacked batch while the socket stays open: `sendPending` returns while `pending.some(b => b.sent)` (`web/cloud-panel.js:399`). That matches the first run's "status said Saved ~10 s while an edit was stuck".
2. A reset after the commit turn, with hibernatable sockets kept. Cloudflare reported 39 of the 46 CPU resets on hibernatable-WebSocket events (`sol-errors-limits.md`).

Either one, combined with the two client bugs, produces the production state. Without them it would heal on the next snapshot.

**Fix design.**

- **Protocol: sequence plus gap resync.** Every `ops` broadcast already carries `revision`.
  - Client: if `message.revision > revision + 1` (and the message is not this client's own duplicate), discard the message and send `{type: "sync", pages, revision}` without trusting the revision. Better, keep a `resync: true` flag so the server always sends a snapshot.
  - Server: add `baseRevision` (revision before apply) to the broadcast, so the client checks `message.baseRevision === revision` exactly.
  - Files: `cloud/rooms.js` `applyBatchNow` return value (`:485-493`), `web/cloud-panel.js` `receiveOps`.
- **Content hash on reconnect.** Store a per-page digest in `pages` (a SHA-256 of `head + nodes` computed in `RoomStore.commit`, which already has both texts at `room-store.js:240-246`). Return it in `index()`.
  - The client keeps the digest it last confirmed per page (the server sends digests with each `ops` broadcast for the pages it touched).
  - `sync` sends `{revision, digests}`. The server answers `same` only if the revision **and** every held page digest match; otherwise it sends those pages.
  - This also repairs clients already diverged in the field (the AUDIT room). Cost: one hash per committed page, which the batch stringifies anyway.
- **Duplicate receipts.** Either the server returns the applied ops for duplicates (needs a small `batch_log(client_id, batch, revision, ops_json)` table, pruned on the next ack), or the client treats `duplicate: true` with `ops: []` as "unknown outcome" and immediately requests a snapshot (`sync` with `resync`) before dropping `pending`. The second is a client-only change and is enough.
- **Broadcast failures.** Count `socket.send` failures in `broadcast`. Close a socket whose send failed with 1011, so it reconnects and resyncs instead of staying silently behind. Report the failure to telemetry.
- **Unacked-batch timeout.** If the in-flight batch has no ack after T (10–30 s, scaled by size), close and reopen the socket. The reconnect snapshot then resolves it through `acked`.

**Risks.**

- A digest mismatch for documents normalized differently on client and server (key order). Hash the server's stored text, not a client re-serialization, and have the client store the digest the server sent.
- Resync storms on a busy room. Throttle to one snapshot request in flight.

**Tests to add.**

- `tests/cloud-room-resync.mjs` (group `cloud`, lane `cloud`, covers `cloud/rooms.js`, `cloud/room-store.js`, `web/cloud-ops.js`). Raw sockets: skip one broadcast through a fault subclass. Assert that a client sending `sync` with matching revision but stale digests gets the page, and that `ops` messages carry `baseRevision`.
- `tests/cloud-desktop-divergence.mjs` (group `cloud`, Electron lane, covers `web/cloud-panel.js`). The `gap` and `dupack` scenarios from `opus/repro/collab-electron.mjs`, asserting client node count equals server node count after the next op and after reload.

### 1b. AUDIT room 4,903 → 904 by itself

**Verified mechanism.** `queueOps` → `VerynizeRoomLimits.batchOps` (`web/room-limits.js:22-35`) cuts any change into groups of at most 4,000 ops. `queueOps` merges into the unsent tail only up to 4,000 (`web/cloud-panel.js:461-470`). Each batch is applied, committed and broadcast on its own (`cloud/rooms.js:303`).

Repro: B held 4,903 nodes and loaded a 3-node copy with another name. It sent 4,000 ops (319 KB), then 901 ops. The peer saw revision 1 with 4,000 removes (server 903 nodes), then revision 2 with 900 removes plus `doc:name`. If the client goes away between the two acks, or the second batch is rejected, poisoned or held, the room stays half-changed. Peers and reloads see it as the room "changing by itself", and that client's outbox finishes the change whenever it reconnects, possibly much later.

**Production signature (suspected).** 3,999 removed means the first group of 4,000 contained one non-remove op. That happens when the diff's first op is a `doc`/`page`/`nodeOrder` op, for example the inverse of a large paste in collaborative undo, or a restore. Who issued it cannot be established from repository data. The room's version history (`cloud/room-history.js`) records batch authors per artboard only, and these were top-level rectangles. Note: a client diverged as in 1a (3 nodes, revision 37) cannot issue these removals, because its `confirmed` never held those nodes.

**Fix design.**

- Make a logical change atomic: send one `group` id and `part i/n` with each batch. The server stages parts in a `staged_batches` table and applies all of them in one `transactionSync` when the last part arrives (and rejects or discards incomplete groups after a timeout).
- Or raise the per-batch op cap and bound by decoded bytes and estimated work instead (`sol-errors-limits.md`).
- Show "N edits still syncing" whenever `pending.length > 1`.
- Add a confirmation for diffs that remove more than X% of a page's nodes and come from a whole-document load (`loadDocument`) rather than a user delete.

**Risks.** Staged parts use storage. Limit staging to MESSAGE_BYTES × n and expire it.

**Test.** `tests/cloud-room-atomic-groups.mjs` (cloud lane). Send part 1 of 2 and disconnect: assert the room is unchanged and peers saw nothing. Send both parts: assert one revision and one broadcast.

### 1c. Gestures discarded on remote edit

**Root cause (verified).** `receiveOps` → `rebuild()` → `apply(next)` → `window.design.setDocument` (`web/cloud-panel.js:307-319`). That is `loadDocument` (`web/app.js:1334-1345`), which replaces `design` with a new object, clears the selection, takes an undo checkpoint and re-renders.

A drag holds references to the old node objects (`free[].n`, `web/canvas-interactions.js:1661-1700`, `:1760-1807`). After the swap, every pointer move mutates detached objects, and the release render shows the new document. A resize behaves the same. Text editing keeps its editor element, but the re-render resets the caret.

**Measured.**

| Gesture | Without remote edit | With remote edit mid-gesture     |
| ------- | ------------------- | -------------------------------- |
| Drag    | moved (2/2)         | discarded (2/2)                  |
| Resize  | resized             | discarded                        |
| Text    | `" one two"`        | `" two one"` (caret jumped to 0) |

**Fix design.**

1. **Apply remote ops in place.** Add `window.design.applyRemote(ops)` in `web/app.js`. It applies the already-normalized ops to the live `design` through `VerynizeOps.apply` on the live object (or patches only the touched nodes), keeps object identity for untouched nodes, adds no undo checkpoint, keeps the selection and re-renders through the incremental path. `rebuild()` should use it when only remote ops changed `confirmed`, and fall back to `setDocument` for snapshots.
2. **Hold remote ops during a gesture.** `canvas-interactions.js` already exposes gesture state (`gesture(true)`). Publish `window.design.gestureActive()`. While it is true, `receiveOps` updates `confirmed` but defers `rebuild()` until the gesture ends. If the remote op touched a node being dragged, last-writer-wins applies after release, because the local drag ops get newer stamps.
3. **Text:** keep the editor's DOM selection offsets across re-render (save before, restore after) when the edited node's text did not change remotely. If it did change, rebase the offsets with the same range merge `cloud-ops` uses for `text` ops.

**Risks.**

- In-place apply must keep the `parentId` and index invariants that `normalize` enforces. Reuse `Ops.apply` with `normalize: true`.
- A deferred apply during a very long gesture delays remote content. Cap the hold at about 2 s and then apply in place.

**Test.** Extend `tests/cloud-desktop.mjs`, or add `tests/cloud-desktop-gestures.mjs` (Electron lane, covers `web/cloud-panel.js`, `web/app.js`, `web/canvas-interactions.js`): drag, resize and text with a raw-socket remote edit mid-gesture, asserting the final geometry and text. These are the three cases of the `gestures` scenario.

### 1d. Send debounce restarts on every change

**Root cause (verified).** `queueOps` ends with `clearTimeout(sendTimer); sendTimer = setTimeout(sendPending, 40)` (`web/cloud-panel.js:474-475`). Any change within 40 ms pushes the send back again.

Measured: 91 edits, one per frame, over 1.51 s produced a single send at about +1.54 s (91 ops, 8.8 KB). Peers see nothing for the whole gesture. Idle single-edit latency to a local peer was a median of about 56 ms (40 ms timer + outbox write). First-run production latency was a median of about 190 ms.

**Fix.**

- Fixed-rate throttle: send at most every 50 ms, measured from the last send. Never restart the timer.
- Coalesce consecutive `node` ops on the same `(id, key)` in the unsent tail, keeping the last value and the newest stamp.
- Drags currently commit to the document only on release (see `tests/canvas-drag-scale.cjs`: pointer moves never publish the document). Add a lightweight `bd:drag-preview` event that `cloud-panel` throttles into ephemeral presence messages (`{type: "presence", drag: {ids, dx, dy}}`, not stored), so peers see movement without per-move commits. Keep the final commit on release.

**Risk.** More messages per second. Presence deltas are small, and the server handles presence without storage.

**Test.** `tests/cloud-send-throttle.mjs` (Electron lane). Run 1.5 s of per-frame `updateNodes` and assert a raw peer receives at least 10 batches, the first within 150 ms, with coalesced op counts.

### 1e. A rejected batch blocks everything, and keeps re-crashing the room

**Root cause (verified).**

- `receiveOps`: when the rejection is size-like or `tooLarge` (the poisoned "interrupted" receipt sets `tooLarge: true`, `cloud/rooms.js:362`), it moves **all** pending batches into `retained` (`web/cloud-panel.js:645-655`).
- `sendPending` returns while `retained.length` (`:399`).
- Every later local change goes through `queueOps` → `retained.length` → `desired = confirmed + retained + ops` → `retryRetained()` (`:441-447`, `:422-438`). That re-diffs and re-queues the **whole** retained set, including the poisoned content, as a new batch number. The durable poison marker is keyed by `(client, batch)`, so the new batch runs again and crashes the room again.

In the repro, one small edit after the rejection caused a second reset. Each reset drops every collaborator's socket. The small edit itself never reached the server, and the status stayed "This batch interrupted room processing…".

That text does not match `SIZE_ERROR` (`web/storage-limits.js:329-330`), so no size dialog appears. Size classification still depends on text matching in `status()` (`web/cloud-panel.js:103-108`): any status text containing "exceeds", "too large", "larger than"… opens the blocking dialog. The two directions are the inverse of each other, and both are fragile.

**Fix design.**

- **Per-batch hold.** Keep `retained` per batch with its rejection code. Later batches that do not touch the same nodes or pages keep flowing. Only ops on the same `(page, id)` queue behind the held batch.
- **Never auto-retry an "interrupted" batch** at the same size. Split it (`batchOps` with a smaller cap, for example 250 ops or 512 KB) and send the parts one at a time. Stop after the first part that crashes again, and keep it retained with an explicit "Retry / Discard" choice.
- **Server: poison by content, not only by batch number.** Store a digest of the poisoned ops. Reject any batch containing the same `(id, value-digest)` set without applying it.
- **Error codes instead of text matching.** Add `code` to every rejection (`"too_large"`, `"interrupted"`, `"forbidden"`, `"invalid"`) in `cloud/rooms.js` and `cloud/room-store.js` (413 → `too_large`). Use only `code` in `receiveOps` and `status()` (`isSizeError` already accepts `code === "storage_limit"`). Keep the regex only for old servers.

**Risks.**

- Ordering: ops held behind a rejected batch can depend on it (an edit on a node the rejected batch adds). Track dependencies by node id, and hold dependents.
- Splitting can leave a partial import, so show it as such.

**Tests.**

- `tests/cloud-room-poison.mjs`: assert that the same ops under a new batch number are rejected without a reset.
- New `tests/cloud-desktop-held-batch.mjs` (Electron): a CRASHROLL node, then an unrelated `updateNodes`. Assert the unrelated edit reaches the server, and that the server resets at most once (count `webSocketClose` events through a fault subclass counter).

### 1f. Duplicate `/access` calls and `/api/me/state`

**`/access` (verified: 2 per open locally, 2 in production per astra).** Independent callers with no shared cache:

- `web/src/islands/collab/presence-engine.ts:270-282` (`loadVisibility`, on every room change)
- `web/cloud-share.js:118-122` (`access()`, triggered at `:225`)
- `web/cloud-panel.js:1876-1882` (`refreshAccess`, after member actions)

Fix: one `roomAccess(roomId)` store in `web/src/lib` (TanStack Query is already used for account data, see `tests/cloud-query-cache.mjs`), keyed by room and invalidated by the socket's `visibility`, `role` and `revoked` messages. Better still, send the access summary in the socket `welcome` (`cloud/rooms.js:853-862` already has role, and `accessSummary()` exists at `:723`). Test: count requests in `tests/cloud-share.mjs`, expecting one or zero `/access` per open.

**`/api/me/state` (verified by code).**

- `web/account-store.js:388-390`: `setInterval(() => { if (!document.hidden && !networkAttempts) void sync(); }, 3000)`.
- `sync()` always ends with `GET /api/me/state` (`:298`), and so do focus and online (`:376-381`) and every 409 (`:253`).
- The server returns **every** item, with chunked chats reassembled (`cloud/account-state.js:11-31`).

At about 556 KB encoded / 4.08 MB decoded (astra, production), that is up to about 80 MB decoded per minute per visible tab, and it explains "dozens of calls in a few minutes".

Fix: `GET /api/me/state?since=<cursor>`, returning only rows whose revision changed, using a per-account monotonically increasing `updated_seq` column (migration in `cloud/migrations`). Return `304`/empty when nothing changed. Drop the 3 s interval in favor of the account socket or a 30–60 s poll with `If-None-Match`. Fetch chat bodies lazily: list keys with revision, and load values on demand. Test: extend `tests/cloud-account-state.mjs`, asserting a no-change poll returns no items and stays under 1 KB.

**Caching of hashed assets (production verified by astra; cause verified here).** Static files come from Workers Static Assets (`cloudflare.config.ts`, `assets`), and there is no `_headers` file anywhere in `web-start/` or `web/`, so hashed bundles get the platform default `public, max-age=0, must-revalidate`. The Node runtime hard-codes the same value (`cloud/platform/node/static-assets.js:72`). Published apps already do it right: `public, max-age=31536000, immutable` for pinned versions (`cloud/worker.js:903`).

Fix:

- Add `_headers` to the Start client output with `/assets/*` → `Cache-Control: public, max-age=31536000, immutable`, and leave HTML and the unhashed legacy `web/*.js` on `no-cache` (or give them content hashes).
- In `static-assets.js`, choose `immutable` when the path matches the hashed-asset pattern.
- Test: `tests/cloud-node-server.mjs`, asserting the header on a hashed asset and `no-cache` on `/`.

## 2. Stutter: commit-path profile (measured)

Setup: Electron 45, synthetic document from `eval/canvas-perf/bench-verynize.cjs` (20-node groups: frames, rectangles, text, images), single page.

- Each edit is one `window.design.updateNodes([id], {x})`, measured synchronously.
- Global `structuredClone`, `JSON.stringify` and `Storage.setItem` were wrapped to time document-sized calls. A CDP sampling profile ran at 200 µs.
- "Shared" means the same document connected to a local room.

This is a quiet machine with no throttling, so absolute numbers are lower than production (first run: about 176 ms per edit at 4.9K in production Electron, a 3 MB file).

### Per local edit

|                                                                |            1K local |           1K shared |             5K local |            5K shared |
| -------------------------------------------------------------- | ------------------: | ------------------: | -------------------: | -------------------: |
| `updateNodes` median (12 edits)                                |             48.8 ms |             38.4 ms |             165.7 ms |             168.4 ms |
| Whole-document `structuredClone`                               | 10.3 calls, 34.0 ms | 11.2 calls, 28.1 ms | 10.3 calls, 116.2 ms | 11.2 calls, 129.1 ms |
| Whole-document `JSON.stringify`                                |   6.1 calls, 5.6 ms |              3.0 ms |               8.1 ms |              12.6 ms |
| `localStorage.setItem` > 10 KB                                 |      2/edit, 0.6 ms |              0.5 ms |       2/edit, 5.7 ms |               3.2 ms |
| `validateDocument` + `validateNode` (profile self time / edit) |              3.3 ms |              2.6 ms |              11.3 ms |              10.4 ms |
| `pageWorldBounds` / `extent`                                   |              2.4 ms |              1.8 ms |               7.8 ms |               8.3 ms |
| React island `$ue` (ui.js)                                     |                   – |              4.4 ms |                    – |              21.4 ms |
| `storage-limits` `walk` (debounced 700 ms, then once)          |         15 ms total |               14 ms |          25 ms total |                39 ms |

### Where each clone comes from (5K, per edit, from `perf2` stacks)

| Call site                                                                                          | Clones |                       ms |
| -------------------------------------------------------------------------------------------------- | -----: | -----------------------: |
| `render()` subscriber loop, `fn.length ? structuredClone(design)` (`web/app.js:505-507`)           |      7 | 75.8 local / 79.4 shared |
| `updateNodes` → `validate(structuredClone(design))` (`web/app.js:1213`)                            |      1 |              20.2 / 12.6 |
| `wonder-shell.js:892` `sync(window.design.getDocument())` (a subscriber that clones again)         |      1 |                11.2–11.5 |
| `wonder-shell.js:273` `file.document = structuredClone(document)` (file library save)              |      1 |                     10.4 |
| Shared only: `localChange` → `getDocument()` (`web/cloud-panel.js:482`), plus `shared()` stringify |      1 |                     11.7 |

`updateNodes` also serializes the whole document twice for undo and the world-bounds check: `JSON.stringify(design)` and `JSON.parse(before)` (`web/app.js:1206`, `:1214`).

### Remote and presence

|                                                    |                         1K |                            5K |
| -------------------------------------------------- | -------------------------: | ----------------------------: |
| Incoming one-op `ops` message, socket handler time | 48–59 ms (median about 57) | 198–218 ms (median about 205) |
| One `pointermove` while connected (presence path)  |                    3–12 ms |           18–33 ms (about 30) |
| `window.design.getDocument()` alone                |                 5.9–6.3 ms |                      19–30 ms |

At 5K, the 80 ms presence throttle (`web/cloud-panel.js:210`) spends about 30 ms of every 80 ms window on a whole-document clone just to read `activePage` (`:186`). The incoming-op cost is `rebuild()`'s full replace (1c) plus the subscriber clones.

**Fix design (incremental commit), with expected effect from the measurements.**

1. **Snapshot once per revision.** `render()` makes at most one frozen snapshot per document change, using `Object.freeze` lazily or a revision counter. Subscribers that ask for it get the same object. Today each takes its own clone, and 7 subscribers clone at 5K. Expected: −65 ms per edit at 5K.
2. **Change descriptors instead of documents.** `subscribe(fn)` receives `{revision, pages: Set, nodes: Set, meta}`.
   - `cloud-panel` `localChange` diffs only the touched nodes (`Ops.diff` per node) instead of `getDocument()` + `shared()` stringify of the whole document.
   - The file library saves per page and debounced on idle (IndexedDB), not as a whole-library `localStorage` blob every render.
   - The storage meter keeps per-page byte counts updated incrementally.
3. **Presence:** add `window.design.activePage()` (or read `getView().page`) instead of `getDocument().activePage` (`web/cloud-panel.js:157`, `:186`, `:2015`). Expected: −30 ms per pointermove tick at 5K.
4. **Validation:** validate only the patched nodes in `updateNodes` (the patch cannot invalidate others except through `parentId`; check those chains). Keep a `before` patch (the old node values, already in `old`) instead of a whole-document `JSON.stringify` for undo. Undo becomes patch-based per page (README Phase 2).
5. **Remote apply in place** (1c). Expected: the one-op remote message goes from about 205 ms to a few ms plus incremental render.

Target, as in the README: a single edit under 16 ms at 1K and at least 50% lower at 10K. Risk: subscribers that mutate their copy. Audit them before freezing: freeze in development, keep a copy-on-demand fallback API.

Test: extend `tests/canvas-drag-scale.cjs`, or add `tests/canvas-commit-scale.cjs` (canvas lane, covers `web/app.js`, `web/wonder-shell.js`, `web/cloud-panel.js`). Count whole-document clones and stringifies per `updateNodes` at 5K, expecting at most 1 each, and assert that a pointermove while connected clones nothing. This uses the same wrapping technique as `canvas-drag-scale.cjs`.

## 3. Server-side and protocol work (not re-measured here)

- **Per-batch page rewrite.** `applyBatchNow` loads every touched page and `RoomStore.commit` re-stringifies and rewrites each touched page's whole node array (`room-store.js:240-266`), so a one-property edit on a 5K-node page rewrites about 1 MB. The first run measured an ack of about 140 ms in production. Fix: node rows on the server (`nodes(page_id, id, json, stamp)`), with commit writing only changed rows. The page text becomes a derived cache for snapshots, or snapshots stream rows. That also bounds DO memory per batch, the remaining cause of resets (VERYNIZE-SERVER-5). Test: `tests/cloud-room-pages.mjs`, asserting rows written per one-property batch at most 2.
- **Presence fan-out.** Every presence message rebroadcasts the full peer list (`cloud/rooms.js:1197-1198`, `peers()` `:1113-1126`). Send the sender's delta only, `{type: "presence", peer}`, plus a full list on join and leave.
- **Broadcast of large batches.** The sender's own ack is the full broadcast, every applied op echoed back (`:1145`). For a 4,900-op import that is MBs to every socket, including the sender. Send the sender a compact ack (`{batch, revision, stamps}`, since the sender has the ops) and the others the ops.

## Corrections to the first-run summary

- "Data persisted without the revision advancing (non-atomic write)": **not supported locally.** Server writes are atomic across every reset point tested. The divergence comes from the client (no gap check; duplicate receipt without ops), triggered by a lost broadcast or ack.
- "Any status text matching exceeds|too large shows the 'File is too large to sync' banner": correct for texts that match, but the poisoned-batch rejection itself ("interrupted room processing") does **not** match, so it shows no dialog. Both are symptoms of text-based classification.
- "Drag discarded on remote edit" is confirmed (2/2). Resize discard is new and verified. Text editing is not discarded, but the caret jumps to 0 and later typing lands at the start.
- "4 duplicate /access calls" is not reproduced: 2 per open (locally and in production).
- Line references are re-checked against `2630c30`. `web/cloud-panel.js:311` (`setDocument`), `:399`, `:475` and `cloud/rooms.js:1161` still hold. The block that holds every pending batch is `:645-655` (the old `:653` falls inside it).

## Not done in this run

- No production work. The AUDIT room, Spaces and the owner's Chrome were not touched. Production-only claims (about 4 MB `/api/me/state`, cache headers, 2 × `/access`, 190 ms latency) come from `astra-prod.md` and the first run.
- What actually dropped the production broadcast or ack, and who issued the 3,999 removals: both stay suspected.
- Production-sized 10K profiles were not taken. The tables stop at 5K.
- The `.cpuprofile` files and raw per-run JSON stayed in the session scratchpad. `opus/repro/results-collab.json` holds the scrubbed collaboration results; the profile numbers are transcribed above.
