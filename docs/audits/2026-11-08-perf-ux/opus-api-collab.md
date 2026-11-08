# Opus collab/API audit — summary (original report lost; reconstructed from the agent's final message)

Tested on production with two clients in throwaway room "AUDIT collab test (delete me)".

1. Permanent divergence: one batch (4,900 nodes, 3.6 MB) crashed the room Durable Object and dropped all sockets. Afterwards server = revision 37 / 4,903 nodes, desktop = revision 37 / 3 nodes showing "Synced revision 37", even after reload. Reconnect answers `same:true` when revisions match (cloud/rooms.js:1161). Remote ops touching unknown nodes are silently dropped. Data persisted without revision advancing (non-atomic write or prod != staging; needs local repro).
2. "Too large": after the crash the room rejected the next batch ("This batch interrupted room processing… retry a smaller import"); client then holds back all pending edits and sends nothing while any is held (web/cloud-panel.js:399, :653). Any status text matching exceeds|too large shows "File is too large to sync" banner, even for non-size errors.
3. Drag discarded when a remote edit arrives mid-drag (2/2; controls 2/2 ok): remote edit replaces whole document (web/cloud-panel.js:311 -> web/app.js:1334).
4. Not live: send timer restarts on every change (web/cloud-panel.js:475, 40 ms debounce) — 1.5 s of per-frame edits sent nothing; 90 ops (15 KB) arrived at +1.83 s. Drags/text sent only on release. One-way latency median ~190 ms, max 675 ms.
5. Stutter (desktop, 3 MB / 4.9K-node unshared file): one property edit ~176 ms, continuous edits ~5 fps. Costs: render() walks every node, file library writes whole library to localStorage per render, validation, size metering, ~6 full-document clones per render (web/app.js:507 structuredClone per subscriber). In rooms, a full-document clone every 80 ms on pointer move just to read active page (web/cloud-panel.js:186). Estimated ~100 ms per local edit, ~150 ms per incoming remote batch at 5K.
6. Server/caching: each batch re-reads and rewrites the whole page; edit ack ~140 ms vs 25 ms connect. HTTP room load ~1.25 s to first byte. All scripts incl. hashed bundle served `max-age=0, must-revalidate`.
Reconnect after drop converges, but status said "Saved" ~10 s while an edit was stuck. Offline edit lost to a later one with only a status notice.
Unconfirmed: text edit/resize lost mid-gesture, 4 duplicate /access calls on join, clock skew, non-atomic write cause.
