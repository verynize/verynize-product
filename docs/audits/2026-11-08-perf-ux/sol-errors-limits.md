# Verynize errors, limits, assets and agent tooling — fresh audit

Audit date: 2026-11-08. Research only; no application/source changes, deployment, commit, push, Electron launch or Sentry access. `CLAUDE.md` was read first. Reviewed the reconstructed sol report, overall README, opus report and relevant astra production/renderer findings in the separate audit-docs checkout.

## Evidence and scope

The shared checkout is **staging**, HEAD `2630c307c834bae2d61b2dc1b42689397c3f3e0d`; requested `chore/node24-deps` points to `61750be06a4e586969630f15c650f39262d0901a`. I did not switch it. `git diff chore/node24-deps -- cloud desktop integrations web` is empty: the audited application sources match the requested branch. File:line citations below refer to those sources. A production deployment/source match was not established.

**Verified** means directly read in code, freshly queried telemetry, or reproduced with an in-memory Node harness. **Prior observation** means an earlier agent's measurement, not rerun here. **Suspected/estimate/proposed** are explicitly labeled. No private document contents, credentials, account identifiers, room identifiers or editor identifiers are included. Telemetry was processed in memory; only sanitized aggregates are recorded here.

## 1. Cloudflare: fresh seven-day telemetry

Used the `cf-cli` skill, command/schema discovery, a dry-run, then only `cf o11y telemetry query --preview`. No saved query or resource mutation. Requested window: **2026-11-01 15:30:26.887 UTC through 2026-11-08 15:30:26.887 UTC**. Cloudflare clamps the oldest edge to its rolling retention boundary (moving by seconds/minutes between queries); the reported failure clusters are well inside that boundary.

Important query details: `parameters.filterCombination: "and"`, filter `$workers.scriptName eq verynize`, `parameters.limit: 1000`, and for invocation counts also `$metadata.type eq cf-worker-event`. Default group limits return only ten groups; querying all datasets without the event-type filter mixes OpenTelemetry spans, logs and invocation events and creates misleading totals. The numeric status group displays absent status as `0`; it is not an HTTP response code. **Calculation values are Cloudflare's sampling-adjusted aggregates, not necessarily counts of retained event rows.** For example, outer `/ops` HTTP 500 has aggregate 24 with `sampleInterval: 1.6`, while the event query retains 15 such rows. Treat HTTP totals/table entries as telemetry estimates where sampled. CPU/memory resets were also retrieved as individual events: all 46/27 are present.

Reproduction shape (fill the two timestamps with the window above):

```json
{
  "queryId": "audit-readonly",
  "view": "calculations",
  "chartType": "aggregate",
  "timeframe": { "from": 1793547026887, "to": 1794151826887 },
  "parameters": {
    "filterCombination": "and",
    "filters": [
      { "key": "$workers.scriptName", "operation": "eq", "type": "string", "value": "verynize" },
      { "key": "$metadata.type", "operation": "eq", "type": "string", "value": "cf-worker-event" }
    ],
    "calculations": [{ "operator": "count" }],
    "groupBys": [{ "type": "string", "value": "$workers.outcome" }],
    "limit": 1000
  }
}
```

Pass the JSON as `--body` together with `--preview`. For route breakdown add groups for `$workers.event.request.url`, method and response status; sanitize paths and strip queries before retaining results. For reset events use `view: events` and filter the outcome. Hibernatable message events do not carry their original upgrade URL.

### Verified invocation outcomes

| Outcome                    | Fresh count | Detail                                                |
| -------------------------- | ----------: | ----------------------------------------------------- |
| exceededCpu                |          46 | 39 hibernatable WebSocket, 4 fetch, 3 RPC             |
| exceededMemory             |          27 | 23 hibernatable WebSocket, 4 fetch                    |
| canceled                   |         323 | 320 fetch, 2 alarm, 1 RPC                             |
| responseStreamDisconnected |         897 | Fetch; 467 outer room sockets, 430 internal `/socket` |
| exception                  |           1 | Outer room socket                                     |

All 46 CPU resets fall in **Nov 7, 01:00–01:59 UTC**. The four fetch reset paths are internal `/access`. All four memory-reset fetch paths are internal `/ops`. Memory resets by hour: Nov 7 06h: 9, 07h: 11; Nov 8 02h: 2, 10h: 1, 13h: 3, 15h: 1. These are event counts, not unique people or documents. Socket disconnection records can describe both sides of the same connection and must not be summed into unique user failures.

The earlier 46 CPU resets is confirmed; 23 memory resets is now **27**, and 881 disconnected streams is now **897**. Different query cutoff/data arrival is sufficient to explain changing totals; these are not contradictory fixed-window reproductions.

### Verified HTTP endpoint breakdown

Counts below use invocation events. Outer public endpoints and internal DO routes are separate events; counting both double-counts a request's processing chain.

| Public endpoint / method             |   200 | 201 | 400 | 413 | 500 | Absent/0 |
| ------------------------------------ | ----: | --: | --: | --: | --: | -------: |
| `/api/me/state` GET                  | 9,648 |   — |   — |   — |   — |        9 |
| `/api/me/state/:key` PUT             |   154 |   — |   — |  21 |   — |        1 |
| `/api/rooms/:room/ops` POST          |    16 |   — |   — |   7 |  24 |        — |
| `/api/rooms/:room/socket` GET        |     — |   — |   — |   — |  15 |      624 |
| `/api/rooms/:room` GET               |   167 |   — |   3 |   — |   5 |        — |
| `/api/rooms/:room/assets` POST       |    78 | 300 |   4 |   — |   — |        — |
| `/api/rooms/:room/assets/:asset` PUT |   300 |   — |   — |   — |   — |        — |
| `/api/rooms/:room/assets/:asset` GET |   734 |   — |   — |   — |   — |        — |

Socket upgrades are not ordinary 200 responses; absent status is not proof of failure. `/api/me` still has 39 HTTP 400 responses; the prior attribution to session freshness is supported by matching error logs, not by the HTTP code alone.

Across public and internal invocation events: **35 HTTP 413**, comprising 21 account-state PUTs, seven outer operation POSTs and seven internal operation POSTs; the event query independently returns 35 records. Thus the prior “28 HTTP 413” must not be reused as 28 distinct room-size failures. **Estimated 44 HTTP 500**: aggregate 24 outer operations, 15 socket opens, five room reads. The previous aggregate 35 has increased; sampling prevents interpreting the difference as nine newly retained failures. I do not reuse the earlier overall 4xx/5xx percentages: spans, bot probes, internal calls and missing statuses need a defined denominator first.

An additional error-text query found **43 log/span-event records containing overload**, clustered Nov 7 at 06h, 07h, 16h and 17h. These include multiple records for the same failure; 43 is not a unique-request count. Route-bearing overload records include outer `/ops`, room read and socket open. Report unique failures by request correlation, not error-line count.

### Timing and payload correlation: verified facts and limits

- HTTP operation POSTs declare **3,717,408, 4,028,605 or 4,054,795 bytes**. Both success and failure occur at these sizes: 4,028,605-byte requests have 200, 413 and 500 responses. A blanket HTTP-body cap alone does not explain them; the request limit is 21 MiB.
- Nov 7 06:40:10 UTC: a 4,054,795-byte outer operation POST returns 500, during the 06h memory-reset cluster. Nov 7 07h contains further roughly 4 MB POSTs with 413/500 during the largest memory-reset cluster.
- Nov 8 02:06:08 and 02:06:10: 4,028,605-byte operations return 413; 02:06:29 returns 500; 02:10:21 the same declared size returns 200. That hour has two memory resets. This is temporal association, not proof that any specific batch reset an isolate.
- Asset registration POSTs cluster in the CPU-reset hour (57 created plus four 400s on Nov 7 01h), the Nov 7 06h memory hour (28 created, 50 deduplicated), and Nov 8 10h (79 created, ten deduplicated). **All 300 observed binary PUTs succeed**, largest declared upload 2,260,036 bytes, aggregate declared bytes 24,021,320. Registration and binary upload are different endpoints; registration bodies are only about 118 bytes.
- November 7 overload at 16h/17h also accompanies large POSTs, but not a fresh CPU/memory-reset cluster. Queue pressure and CPU/memory termination should remain separate incident classes.

There is no op count, touched-page byte count, WebSocket batch size, transaction phase or allocation measurement in the reset records. These queries cannot establish that the prior **4,900-node / 3.6 MB** audit action is the exact terminating invocation. Add bounded numeric phase telemetry rather than logging payloads.

## 2. Why a legal 20 MiB document can exhaust an isolate

Cloudflare documents a **128 MB per-isolate memory limit**, not a 128 MB document allowance. `transactionSync` rolls back on an exception; the callback must remain synchronous. Current docs were fetched through Context7: [SQLite storage API](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/), [DO memory metrics](https://developers.cloudflare.com/durable-objects/observability/metrics-and-analytics/). Multiple objects can share an isolate; headroom must include runtime/storage/socket state.

### Verified allocations and estimated peaks

Let **S = 20 MiB serialized JSON** for the touched page or document. An ASCII JSON string may occupy approximately S in V8; two-byte representation can approach 2S. Parsed objects have no fixed JSON-to-heap ratio: field names, object counts, maps and strings change it greatly. The estimates below assume roughly S–2S per parsed representation and substantial transient overlap. They are capacity models, **not measured workerd heap profiles**, lower bounds, or exact sums of every allocation ever made. GC can release some temporaries; external buffers and engine overhead can add more.

| Path                                               | Verified overlapping representations                                                                                                                                                                                                                                                                                                               | Estimated pressure at S=20 MiB                                                                                                                                            |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ordinary operation touching a large existing page  | `RoomStore.text` materializes SQL rows then joins; `load` retains original node JSON and parses it (`cloud/room-store.js:79`, `:151`). `Ops.apply` JSON-roundtrip clones the loaded document (`web/cloud-ops.js:30`, `:286`). `commit` stringifies new nodes and UTF-8 encodes them for size (`cloud/room-store.js:228`, `web/room-limits.js:19`). | Roughly 100–180+ MiB before large batch/history amplification; no safe 128 MB headroom.                                                                                   |
| Large add/addPage/root batch                       | Request/message text + parsed operation payload; stamped array; two separate value clones for an added node (new document and applied receipt: `web/cloud-ops.js:435`, `:443`), or root clone/receipt (`:370`). Existing document/state texts remain; response/broadcast stringifies accepted values (`cloud/rooms.js:221`).                       | Roughly 120–240+ MiB when both prior state and incoming material approach S. Small op count can still be expensive.                                                       |
| Legacy snapshot PUT/update                         | Incoming document; old full document and old texts; `Ops.diff` cloned values; `Ops.apply` clone whose result is discarded; `commit` strings; then `snapshot()` reads the new document again and broadcast/Response serialize it (`cloud/rooms.js:267–290`, `:93`).                                                                                 | Roughly 140–280+ MiB at a large old/new document, depending on lifetimes.                                                                                                 |
| Reconnect, full GET, page GET, public read/publish | Store chunks + joined text + parsed document + serialized response/socket message. `publish()` reads the entire document then stringifies it (`cloud/room-store.js:282`). `/pages` collects requested pages first (`cloud/rooms.js:121`) even though it sends separate messages.                                                                   | Roughly 60–140+ MiB. Lazy pages reduce scope, but a single legal 20 MiB page is still large.                                                                              |
| Inline migration                                   | Stored page text scanned, then dirty pages loaded and serialized across RPC (`cloud/rooms.js:685–701`); outer Worker holds original doc, extracted blob bytes, rewritten value and diff (`cloud/inline-binaries.js:94`, `:160`); room reapplies diff through normal batch.                                                                         | DO phase roughly 60–140+ MiB; subsequent batch has its own peak. Outer Worker memory is separate, not added to one DO invocation.                                         |
| History during any successful op                   | `recordHistory` executes inside the batch before returning (`cloud/rooms.js:484`, `:510`). `V.changes` clones before/after artboard subtrees and repeatedly stringifies comparisons (`web/version-history-core.js:127–153`); history state and snapshot serialization add more (`cloud/room-history.js:65`, `:96`, `:156`).                        | Can add several S-scale objects/strings when one artboard spans the page: another roughly 60–160 MiB of temporary pressure. Not every edit captures every representation. |

**Important correction:** `cloud/assets.js` is routed by the outer Worker (`cloud/worker.js:547–563`), not executed inside the room DO. A binary PUT buffers chunks plus a contiguous byte array (`cloud/http.js:56–80`), hashes/sniffs, and writes R2 (`cloud/assets.js:339–344`). At the 20 MiB asset limit that is at least about **40 MiB binary buffering**, potentially more in hashing/R2 internals, in that Worker isolate. Asset GET streams R2 (`cloud/assets.js:376–379`). Asset registration calls the DO only to authorize `/access`. Therefore asset POST CPU errors can reflect a busy/resetting room; they do not prove R2 bytes were loaded into the DO.

**New contributor omitted from the prior report: history.** Its whole-artboard cloning/comparison happens in the same synchronous batch invocation, even for one property change. Bounds on operation bytes alone cannot protect a nearly-full page if processing still clones that page and its history. Bound touched-state work and move toward incremental node storage/history.

`RoomStore.commit` validates page, total and node limits before its document writes (`cloud/room-store.js:198–246`). The dangerous allocation occurs before/while checking those limits. Splitting SQLite into small rows solves row-size constraints, not heap-size constraints.

## 3. Equal revisions with different contents: server atomicity versus client loss

### What current code guarantees

`applyBatch` persists a pending marker and **awaits `storage.sync()`** before expensive work (`cloud/rooms.js:330–339`). It rechecks revision/dedup state after that yield. The `finish` closure wraps document commit, stamp flush, revision increment, receipt/last-batch and pending-marker deletion in **`ctx.storage.transactionSync(finish)`** (`:342–383`; actual document/revision writes `:461–483`). No `await` separates document writes from revision increment within that callback.

A normal exception after `store.commit` must roll back the SQL transaction. The pending marker intentionally survives because it was synchronized beforehand. On replay it becomes a durable **rejected** receipt (`:351–380`), not an acknowledgement of accepted edits. The current `tests/cloud-room-poison.mjs:15–20` aborts **before** `super.applyBatchNow`; it verifies marker recovery, not termination halfway through page/stamp/revision writes. I read this test but did not run it because it builds/writes temporary artifacts.

`update` (legacy snapshots), constructor migration, creation and publication do not use the same explicit wrapper (`cloud/rooms.js:68`, `:200`, `:267`, `:899`). Cloudflare automatically coalesces synchronous writes without intervening awaits. Therefore **absence of an explicit transaction alone is not proof of partial persistence**. Explicit wrappers and fault tests would nevertheless make these invariants clearer. History's catch-and-log is a separate concern: a recoverable history error is swallowed (`:531`), so partial history work can accompany an otherwise accepted document transaction; do not confuse that with revision/data separation.

**Correction to earlier interpretation:** the production observation “server revision 37, 4,903 nodes; client revision 37, three nodes” does **not establish that the server document changed without revision advancement**. It establishes equal-revision divergence. Current source has a concrete client path that explains this class of observation without broken SQL atomicity.

### Verified new bug: empty duplicate receipt discards accepted edits

1. Client confirmed state is revision 36 with three nodes; it has pending batch N adding nodes.
2. Server commits batch N as revision 37; its accepted-op receipt is lost in transit.
3. Client retries N. Server's duplicate branch returns **current revision, `ops: []`, `duplicate: true`** (`cloud/rooms.js:394–412`). It does not return the original accepted operations or a snapshot.
4. `receiveOps` applies nothing, sets revision to 37 (`web/cloud-panel.js:636–643`), removes all pending batches through N (`:655`), says **“Saved shared revision 37”** (`:666`), and rebuilds from the old confirmed document.
5. On reconnect, server sends `same:true` based only on revision equality (`cloud/rooms.js:1161`). Client retains its old contents (`web/cloud-panel.js:985–998`).

**Fresh in-memory Node reproduction:** extracted the repository's actual `receiveOps` function into a VM with synthetic documents and inert UI/network/storage hooks; used the real `VerynizeOps` implementation. After an empty successful duplicate receipt: **server four nodes, client three nodes, revision 37, pending zero, status “Saved shared revision 37”**. This reproduces the mechanism at minimal scale; no production room or Electron instance was touched. It does not prove the lost receipt occurred in the earlier 4,900-node incident.

Another verified weakness: accepted remote operations targeting missing nodes return `Missing node` (`web/cloud-ops.js:464`, `:483`), but `receiveOps` takes only `.doc`, ignores rejected operations and still advances revision (`web/cloud-panel.js:637–643`). A second pure Node check returned applied zero/rejected `Missing node`, with unchanged contents. There is also no contiguous-revision check before accepting a newer op message.

### Concrete repair

- `cloud/rooms.js`, `web/cloud-panel.js`: treat a duplicate receipt as acknowledgement metadata, never evidence that accepted changes are already in confirmed state. If the client cannot prove it applied that receipt's outcome, force a page snapshot before retiring authored operations. Do not blindly replay pending operations: server normalization, rejected subsets and concurrent edits can differ.
- Persist a bounded outcome descriptor (commit revision, affected page hashes, accepted/rejected counts). For small batches replay the actual receipt; for large receipts return `resyncRequired` with affected pages. Distinguish current room revision from the batch's original commit revision.
- `cloud/room-store.js`: store content hashes for metadata, page header/nodes and page order atomically with revision. Hash canonical data; include fields beyond node count/byte length. Avoid re-hashing the full document for every sync read.
- Handshake: send hashes for the client's **confirmed** loaded pages, not optimistic local edits; grant `same:true` only when content and epoch agree. Missing hashes/old clients receive snapshots. Preserve outbox until authoritative state plus rejected receipts have been reconciled.
- Reject revision gaps and unexpected `Missing node/page/parent` during accepted-op replay into a loaded page; pause and resync. Exempt intentionally unloaded pages, whose deferred-op mechanism has different semantics.
- Fault tests must terminate after page writes, after stamp flush, after revision increment, and before receipt delivery; restart from persistence and assert a single invariant across document/hash/revision/last-batch. Add lost-ack duplicate and same-revision hash-mismatch tests. The current poison test covers only the initial boundary.

## 4. `/api/me/state`: why it is large and frequent

**Verified handler:** `cloud/worker.js:302–304` calls `readAccountState`. `cloud/account-state.js:11–33` selects **all account rows**, builds a map including chunks, joins every chunked record, then responds with every logical item including tombstones. No key/prefix filter, pagination, ETag, global cursor or change feed. Values are JSON **strings inside JSON**, adding escaping. A single logical value may be 20 MiB (`cloud/account-state.js:5`); there is no total-account response cap here.

These are not room document snapshots. They include complete individual chat transcripts (`web/account-store.js:142–165`), drafts, preferences and library organization. Machine session fields are removed, but message/tool histories remain. The report cannot identify the largest private record because no account contents were read. **Prior observation:** astra measured about 556 KB encoded / 4.08 MB decoded; I verified the serialization mechanism, not that private payload's exact current composition.

**Verified callers, all in `web/account-store.js`:**

| Trigger                                   | Code       | Consequence                                                              |
| ----------------------------------------- | ---------- | ------------------------------------------------------------------------ |
| Initial hydration                         | `:203`     | Full fetch, then the same `sync()` continues to `:298` and fetches again |
| Successful sync, even zero pending writes | `:298`     | Unconditional full refresh                                               |
| Visible window timer                      | `:388–390` | Full refresh every **3 seconds**, up to 20/min/window                    |
| Local changes                             | `:57–67`   | 150 ms debounced sync; writes followed by full refresh                   |
| Any 409 on any one record                 | `:251–255` | Downloads all records to find one key                                    |
| Focus/online                              | `:375–381` | Another refresh                                                          |
| Explicit `flush`                          | `:364–368` | Up to five sync attempts; even a clean flush refreshes                   |

Only concurrent invocations share the `syncing` promise; sequential timer/focus/write/flush calls do not share a freshness window. Thus nine requests during an initial capture is plausible without nine separate Files components mounting. It is not proof of nine simultaneous duplicate startup requests. **Fresh telemetry: 9,648 successful GETs versus 154 successful record PUTs** in the window. At the prior 4.08 MB payload size, 20 refreshes/minute is about **81.6 MB decoded/minute/window**; this is a conditional estimate, not measured total production transfer. `cloud/http.js:12–17` sets `no-store`.

### Proposed fix, staged

1. **Immediate client patch (`web/account-store.js`):** one initial fetch; separate write flushing from remote refresh; keep acknowledged PUT results; no unconditional post-write full GET. Coalesce focus/online refresh with a freshness window, suspend while hidden, replace 3-second polling with invalidation or a much slower temporary poll. Fetch only the conflicted key and preserve existing three-way file merge/conflict-copy behavior. Same-tick dedup alone is insufficient.
2. **Scoped API (`cloud/account-state.js`, `cloud/worker.js`):** `GET .../state/:key` and bounded `prefix`/cursor support. Files requests folders/file organization only. Chat list requests lightweight chat metadata; transcript bodies load when opened, by key or page. Ensure the consumer (`getItem`/chat selectors) does not mistake unloaded transcripts for deleted or empty ones.
3. **Change feed:** new monotonically increasing account change sequence allocated atomically with head/chunk writes, not just `updatedAt` timestamps; `GET .../state/changes?after=...&limit=...` returns bounded changes including tombstones and `nextCursor`. Capture a high-water mark so pagination is consistent. Cursor expiry requires a scoped resnapshot. A no-change response is tiny; authenticated private ETags can complement this. Do not put the existing sensitive full response into a public cache.
4. **Storage migration:** keep current chunked records readable, backfill chat metadata, progressively move clients to lazy body access. Large heads must not force an unbounded transcript download during bootstrap. Test chunks plus pagination, deletion, concurrent writes, stale cursors, account switching and offline outbox recovery.

## 5. Limits: verified map and gaps

| Boundary                              | Actual limit / behavior                                                                                                 | Citation                                                                |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Desktop HTML file/text                | 5 MiB UTF-8 bytes                                                                                                       | `desktop/html-import.cjs:9`, `:50`, `:63`                               |
| MCP inline HTML/parser                | 5,000,000 JS string units                                                                                               | `integrations/design-tools.mjs:2897`; `integrations/codec-html.mjs:183` |
| MCP HTML local file                   | 5,000,000 **bytes** before UTF-8 read                                                                                   | `integrations/design-tools.mjs:2925–2930`                               |
| Import external resources             | Default 2 MiB/resource, 4 MiB/image, 12 MiB total; 8 s fetch timeout, 48 sheets, depth 8, external resource counter 192 | `integrations/codec-html.mjs:45–52`, `:411`, `:428`, `:454`             |
| Native headless document              | 20 MiB, including serialized-byte check plus newline                                                                    | `integrations/design-store.mjs:9`, `:16–19`                             |
| Nodes                                 | 10,000/page; 50,000/document                                                                                            | `web/document-core.js:25`                                               |
| Room document / one page              | Both 20 MiB; pages share the document budget                                                                            | `web/room-limits.js:11–13`                                              |
| Room metadata / unstructured document | 2 MiB                                                                                                                   | `cloud/room-store.js:181–189`, `:201`                                   |
| Room body/socket message              | 21 MiB; byte size check may allocate an encoded copy                                                                    | `web/room-limits.js:16–20`; `cloud/rooms.js:1130`                       |
| Room op batches                       | Server max 5,000 ops; client splits at 4,000 and 21 MiB minus 64 KiB envelope                                           | `cloud/rooms.js:309`; `web/room-limits.js:28–30`                        |
| Room assets                           | 20 MiB each, max 2,000 registrations/room; 10 minute upload grant                                                       | `web/storage-limits.js:24`; `cloud/assets.js:29–31`                     |
| Inline binary threshold               | 8 KiB data URL string; SVG exception up to 256 KiB                                                                      | `web/storage-limits.js:26–28`, `:78–83`                                 |
| Account value/request                 | 20 MiB UTF-8 value; request 40 MiB + 1,024 bytes for escaped string envelope                                            | `cloud/account-state.js:5–8`                                            |
| Raster input/dimensions               | HTML 20 MiB; CSS sides 1–10,000 and requested scale .01–100                                                             | `desktop/render.cjs:8–27`                                               |
| Physical capture                      | 8,192/side; **32,000,000** pixels, including device scale; screenshot mode downscales, export mode rejects              | `desktop/render-limits.cjs:2–33`                                        |
| Export save                           | 200 MiB decoded output                                                                                                  | `desktop/render.cjs:417` (the size check in `saveRequest`)              |

**New gap:** `Loader.load` returns early for `data:` resources (`integrations/codec-html.mjs:405–409`), bypassing its per-resource/aggregate accounting. Direct `<img src="data:image/...">` is also accepted unchanged (`:1852–1853`). Source HTML limits still constrain input, but the advertised 4 MiB image / 12 MiB resource budgets are not uniformly enforced. Check decoded size/type before allocation and count inline data against the same resource budget. Resource limits do not bound repeated output serialization.

### Base64 duplication: confirmed, with a correction

`embedImage` caches **by URL** (`integrations/codec-html.mjs:1367–1389`), so the importer does not necessarily download or encode a repeated URL ninety times. It still emits the cached **data URL string in every resulting node** (`:1381`, `:1861–1864`), so serialized JSX/JSON repeats the bytes. Different URLs for identical bytes are not content-deduplicated. A 34 KiB image repeated 90 times contributes about **4.0 MiB** of base64 strings, before node/JSON overhead. Replacing each occurrence by a 70-character `asset:` reference reduces that repeated source field by about **99.85%**; counting one stored blob too gives about **99.0%**, depending on manifest/path overhead. State what is counted before quoting savings.

Cloud room sharing already externalizes binaries: client `web/cloud-assets.js`, server HTTP extraction and open-time migration in `cloud/inline-binaries.js`. Do not describe this as missing everywhere. The gap is **storage-neutral local/import/MCP references**, plus render/export behavior. Raster export currently re-inlines room URLs (`web/app.js:1670–1671`; `web/cloud-assets.js:353–374`) and caches data URLs indefinitely in its `inline` map. Repeated HTML replacements also copy the growing export string.

## 6. Proposed `asset:<sha256>` architecture

This is a design, not implemented functionality. A hash reference must describe bytes, not carry credentials or act as authorization. Current validation rejects it (`web/document-core.js:569–573`, image fills at `:398`), and HTML export currently filters it out (`integrations/export-html.mjs:38–41`); updating only the importer would break the document.

### End-to-end contract

- Document source: `asset:` followed by exactly 64 lowercase SHA-256 hex characters. Manifest keyed by hash contains immutable MIME, byte size and optional intrinsic dimensions; no absolute machine paths or signed URLs in portable document state. References cover image nodes, image fills, font faces and future video. Decide which fields are supported before declaring arbitrary string replacement a migration.
- **Local files:** companion `NAME.verynize.assets/<hash>` directory, hash-verified writes via temporary file and atomic rename. Write blobs before publishing the JSON reference. Save As/copy/export copies reachable assets; missing sidecars yield explicit recoverable diagnostics. A portable archive is a separate export option. Root containment and symlink checks use existing project file-access rules.
- **Web/IndexedDB:** Blob store keyed by hash, plus document reachability and pending-upload pins. Store blobs before committing document references. Resolve to bounded/revoked object URLs for canvas display, not base64. Garbage collect only unreferenced/unpinned assets after a grace period; include undo, history, outbox and unpublished offline documents.
- **Cloud/R2:** retain existing per-room SHA dedupe and R2 objects (`cloud/assets.js:199`, `:221–258`). Add a room-scoped hash lookup/manifest mapping; `asset:<hash>` never gives cross-room access. Registration/upload remains small JSON then raw bytes. Publish freezes asset reachability/authorization with its snapshot. Existing signed-URL documents remain readable; export/import must not silently retain someone else's room bearer URLs.
- **MCP:** `upload_asset({document,path,contentType?})` streams a permitted local file, sniffs/validates/hash-checks, stores through backend `assets.put`, returns `{ref,sha256,size,contentType,width?,height?}`. Optional small base64 input gets a separate strict encoded/decoded cap; do not return the binary in tool text. Add backend `assets.get/stat/put` for file mode, desktop bridge and hosted cloud backend. Hosted mode cannot read a desktop path: declare capabilities and support a staged authenticated binary upload handle there.
- **Import:** inject an asset sink into `codec-html.mjs` and other importers, sanitize SVG **before hashing**, return references and a staged manifest. Preflight source size, decoded unique bytes, emitted node count, resulting document bytes and unsupported features. Commit bounded node batches only after required assets are ready; durable import handle tracks progress, cancellation and resume. Failure leaves the old document intact and staged blobs collectible.
- **Canvas/render:** shared resolver maps hash to local/IDB/cloud bytes with deduped in-flight requests. For hidden raster/PDF windows, pass a per-render allowlist and serve assets from the window's own narrow protocol namespace, e.g. `verynize-render://document/assets/<hash>`. Main process validates the hash and allowlist, streams bytes with correct MIME; no arbitrary path/network lookup. Extend `serveRenderPage`, request filter and `img-src/font-src` deliberately. Font assets need the same resolver, replacing mandatory base64 embedding. Keep sandbox and navigation restrictions.
- **Export:** portable HTML can explicitly inline each required asset when requested; normal raster/PDF avoids base64. Folder/archive export writes files and relative URLs. A reference-only JSON is not a complete portable deliverable unless accompanied by its assets.

### Concrete file-level changes and migration order

1. `web/document-core.js`, `web/document-safety.js`, `integrations/document-core.mjs`: reference/manifest schema and compatibility diagnostics. `web/cloud-ops.js`/room metadata accounting must treat manifest changes consistently. Add a minimum-reader/feature flag so older clients cannot silently strip or overwrite new references.
2. New `integrations/asset-store.mjs`, `desktop/assets.cjs`, `web/asset-store.js`: file/IPC/IDB storage and resolver contracts. Wire `desktop/preload.cjs`, `desktop/main.cjs`, project containment and save/copy paths in `desktop/design-files.cjs` and `integrations/design-store.mjs`.
3. `cloud/assets.js`, `cloud/schema.js`, a new D1 migration if a hash-index API needs schema additions, `cloud/worker.js`, `cloud/inline-binaries.js`, `web/cloud-assets.js`: authenticated hash mapping, dedupe, compatibility migration and upload pinning. Preserve ready/pending distinction.
4. `integrations/design-tools.mjs`, `integrations/mcp-server.mjs`, `desktop/mcp-bridge.cjs`, `cloud/design-backend.js`: upload tool/backend capabilities. `integrations/codec-html.mjs`, `desktop/html-import.cjs` and Figma conversion: shared asset sink.
5. `web/app.js`, shared image/fill/font URL serialization, `integrations/export-html.mjs`, `desktop/render.cjs`: resolve for canvas/export/render. Search all `src`/paint/font paths; do not make assets an image-node-only feature.
6. Opt-in conversion reads one page at a time, hashes unique decoded bytes, persists/verifies blobs, then swaps references and commits. Keep a recoverable original until completion. Room conversion uses revision-checked operations and snapshots/hash reconciliation. Never delete the old blobs/URLs merely because current canvas no longer references them: undo/history/public snapshots may still do so.

Tests: repeated URL and different-URL/same-bytes dedupe; inline limit bypass; SVG sanitized hash; hash mismatch; interrupted upload/import; Save As and archive roundtrip; offline reopen; missing sidecar; authorized cloud lookup; restart; rendered image **and image fill and font** parity; old-client compatibility. Add new `tests/` entries to `scripts/test-manifest.mjs`; integration tests are auto-discovered. Do not raise 20 MiB limits until peak memory is measured.

## 7. Screenshot failure: code review and diagnostics

**Verified code path:** `renderHTML` serializes raster requests in a promise queue (`desktop/render.cjs:159–168`); `renderNow` creates a hidden, sandboxed window with a fresh session partition (`:178–196`), registers a session-local protocol, loads `verynize-render://document/`, settles fonts/images and captures (`:206–240`). Handler validates 20 MiB HTML and physical dimensions first. `serveRenderPage` allows only the exact document URL plus data/blob requests and returns a CSP-restricted response (`:281–310`). Cleanup unregisters the protocol and destroys the window in `finally`.

`desktop/mcp-bridge.cjs:225–243` offscreen fallback uses this renderer, so MCP has no independent Chromium implementation. **Additional verified gap:** fallback passes exported HTML directly, while the renderer forbids HTTP assets. Unlike the main export path, this fallback does not call `cloudAssets.inlineHtml`. Room URL images can therefore be blocked/missing in offscreen screenshots even when protocol navigation succeeds. Fix through the shared resolver above and surface asset readiness; do not call this the cause of `ERR_FAILED` navigation.

No `render-process-gone`, `child-process-gone` or `did-fail-load` diagnostics were found in the desktop sources. Font/image decode errors are caught and a four-second timeout can proceed to capture (`desktop/render.cjs:224`); a returned PNG does not prove every asset loaded. Raster queue is serialized but unbounded; PDF renders do not use that queue (`:345`). Consider a shared bounded capture scheduler.

**Prior-only evidence:** reconstructed report says fresh-profile tests passed on Electron 42 and 45.2.3 and installed helpers matched distribution hashes. I did not rerun Electron, inspect running-process binaries, or independently re-establish those hashes. Consequently “not a general Electron regression” is stronger than this run can prove.

**Suspected stale-runtime mechanism:** a long-lived main process can retain old loaded framework code while helpers/resources at the on-disk executable paths are replaced by dependency installation. A newly spawned renderer/network child then speaks a different Mojo interface; `UNKNOWN_METHOD` is consistent with such an ABI mismatch. Matching current on-disk hashes alone does not identify what a running process originally mapped. Other process crashes/protocol failures remain possible. `ERR_FAILED` is generic and cannot identify this cause by itself. A complete restart is a diagnostic action for the owner, not something this audit performed.

**Concrete diagnostics (`desktop/render.cjs`, `desktop/main.cjs`, `desktop/telemetry.cjs` if that is the chosen logging owner):**

- Capture a render correlation number and phase timestamps: queued, window created, protocol handler entered, response returned, navigation committed, fonts/assets settled, capture complete. Log only dimensions, byte counts, missing-asset count and error categories; never HTML, asset URLs or document identifiers.
- Attach `did-fail-load`, `render-process-gone`, `unresponsive`, and app-level `child-process-gone` **before navigation**. Record sanitized error code, main-frame flag, child type/reason/exit code. Protocol callback errors and teardown failures need their own phase.
- Capture startup runtime fingerprint (`process.versions.electron/chrome/node`, app version, packaged flag, executable/helper/framework stat/hash fingerprints). Compare on disk before capture, rate-limited. If changed, surface an actionable restart-required error; version-string equality alone is insufficient. Avoid hashing entire frameworks on every screenshot.
- Optional tiny startup/first-use smoke capture with a deadline, after app readiness and when no user render is running; separate diagnostics from a global permanent block. A renderer crash should not hang the queue indefinitely. Serialize or bound PDF/raster work together, cancel when parent closes, and avoid retaining many 20 MiB queued HTML strings.
- Owner-run verification later: cold start after dependency changes, deliberate resource replacement warning, protocol handler failure, renderer crash, timeout recovery and images/fonts through the same resolver. Keep CSP/sandbox; disabling them would obscure the failure and enlarge risk.

## 8. Agent tooling: `.pen` and faithful import

### Verified gaps

`desktop/figma.cjs:1024–1037` rejects by `.pen` **filename**, claiming encryption without inspecting bytes. File picker only offers `.fig` (`:1044–1047`). Existing tests assert refusal (`tests/figma-binary.cjs:381`, `tests/figma-paste.cjs:148`); they do not establish the format is encrypted. `docs/pen-reference.md:13–15` explicitly says compatibility/schema is not established. No representative `.pen` fixture was available in the repository for fresh format validation, so this report does not claim a universal public schema or successful import.

MCP HTML import **already accepts an absolute local path and sibling resources** (`integrations/design-tools.mjs:2892`, `:2925`). An import preflight/help response should explain this before an agent starts a local HTTP server.

`finish_artboard` has no intent field (`integrations/design-tools.mjs:1961–1973`). Contrast can be critical (`integrations/design-lint.mjs:766–772`), as can placeholder copy, missing images and unresolved assets (`:606–626`). Three blocked finish attempts consume the repair budget; a later call can finish **unverified**, even without real repairs (`integrations/src/verification.mts:58`, `:185–206`; `integrations/design-tools.mjs:2001–2012`). This is a budget on attempts, not proof of three repairs. Taste/contrast gates can encourage unwanted redesign of an imported reference.

### Proposed `.pen` import

Add `integrations/codec-pen.mjs` with bounded format sniffing, version dispatch and a documented supported subset; no execution of embedded scripts. If a supplied format is unsupported, report its actual signature/version instead of “encrypted” based on the extension. Start with a user-authorized specimen or documented interchange contract and independently authored fixtures. Unsupported component/paint/text behavior must produce structured losses, never silent flattening.

Two-pass conversion: allocate stable source-to-target IDs and dependency graph first, then materialize nodes/components/instances and apply overrides. Preserve hidden state, hierarchy, stacking order, constraints/layout, clipping, variables/themes and mixed text. Resolve `lucide:*` through the existing icon system where supported; report unresolved icons instead of substituting unrelated ones. Detect reference cycles, cap expansion/decompression and reject path traversal. Use the shared asset sink; preserve unsupported fields in bounded inert provenance metadata where the native schema allows it. Do not invent native semantics for unsupported properties.

Expose `import_design`/`import_pen` plus `preflight_import`, sharing conversion between desktop and headless tools; integrate `desktop/figma.cjs` or a new import router, preload, drop/file picker and `integrations/design-tools.mjs`. Leverage existing component/instance transforms (`design-tools.mjs:1725`, `:1770`) rather than manually duplicating every instance. Return counts, assets, feature losses and fidelity status. Support staged imports, cancellation and resume. Tests cover overrides, nested instances, hidden children, variables, icons and unsupported-version behavior before replacing refusal tests.

### Proposed faithful-import finish contract

Add `intent: "new-design" | "faithful-import"` to `finish_artboard` and receipt metadata, with explicit source provenance/reference digest from the import pipeline. Default behavior remains the current new-design policy.

For faithful import, classify findings by rule ID (not message regex): **structural/render integrity** stays blocking (invalid schema, corrupt/missing required assets, unrenderable output, unsafe references); **source-preserved quality findings** such as low contrast, placeholder copy present in the reference or intentional clipping become disclosed warnings. Waivers must identify exact findings/nodes and source evidence. Do not globally suppress all critical lint, and do not waive importer-caused geometry loss.

Extend `integrations/src/verification.mts`, `integrations/design-lint.mjs`, `integrations/design-tools.mjs` and `integrations/design-knowledge/` workflows: output separate `renderVerified`, `fidelityStatus` (`verified|partial|unverified`), `qualityFindings`, `waivers`, `unsupportedFeatures`. A real current-revision screenshot plus review can verify the render; only comparison against source can verify fidelity. Never call an unavailable/stale screenshot faithful. Repair exhaustion must not promote integrity failures or quality waivers to verification. Keep source colors/content untouched unless the user asks for redesign.

## 9. Ranked file-level implementation plan

| Rank     | Work and files                                                                                                                                                                      | Acceptance evidence                                                                                                                                                                           |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **P0.1** | Repair empty duplicate receipt loss and revision-gap handling: `web/cloud-panel.js`, `cloud/rooms.js`; persist bounded outcome/hash metadata in `cloud/room-store.js`               | Lost receipt + retry cannot drop accepted authored nodes; outbox remains until authoritative reconciliation; unexpected missing-node replay triggers resync                                   |
| **P0.2** | Hash/epoch reconnect handshake: same files, page-load/deferred-op client module; cached metadata/page digests committed with revision                                               | Equal revision/different content repairs itself; old client/hash omission forces snapshot; unloaded pages remain lazy                                                                         |
| **P0.3** | Bound server work and split imports: `web/room-limits.js`, `cloud/rooms.js`, `cloud/room-store.js`, `cloud/room-history.js`, `web/version-history-core.js`; numeric phase telemetry | Byte/operation/touched-state budgets reject before large allocations; 4,900-node staged import resumes after failure; measure workerd CPU/memory; no acknowledgement before committed outcome |
| **P0.4** | Add atomicity fault coverage around all batch phases; extend `tests/cloud-room-poison.mjs` or new manifested cloud test                                                             | Restart proves document/hash/revision/stamps/last-batch consistency at every injected boundary, including lost delivery                                                                       |
| **P1.1** | Stop full-state 3-second refresh and post-write rereads: `web/account-store.js`; scoped/key reads in `cloud/account-state.js`, `cloud/worker.js`                                    | Bootstrap one fetch; idle unchanged window transfers no transcript; one-record conflict fetches only that record; no transcript loss on lazy loading                                          |
| **P1.2** | Capture diagnostics, runtime fingerprint, bounded scheduler and blocked-asset reporting: `desktop/render.cjs`, `desktop/main.cjs`, `desktop/mcp-bridge.cjs`                         | Owner-run cold-start screenshot and crash/timeout recovery tests; precise sanitized phase failure; no misleading complete capture with missing assets                                         |
| **P1.3** | Fix inline resource budget bypass and add import preflight: `integrations/codec-html.mjs`, `integrations/design-tools.mjs`, `desktop/html-import.cjs`                               | Same decoded budgets for data/file/network; repeated assets forecast output; no partial import on capacity failure                                                                            |
| **P1.4** | Asset schema/storage/resolver, then MCP/import/cloud/render integration: file list in section 6                                                                                     | Deduped portable save/open and offline recovery; room publication/undo/history asset reachability; faithful screenshots without HTML base64 growth                                            |
| **P2.1** | Account change cursor + chat metadata/lazy body migration: `cloud/account-state.js`, schema/migration, `cloud/worker.js`, `web/account-store.js`, chat consumers                    | Bounded incremental reads with tombstones, stable pagination and account-switch isolation                                                                                                     |
| **P2.2** | Faithful-import finish mode: `integrations/src/verification.mts`, `integrations/design-lint.mjs`, `integrations/design-tools.mjs`, design knowledge and tests                       | Source-preserved contrast does not require redesign; missing assets/invalid receipts remain honestly unverified or blocked; explicit fidelity evidence                                        |
| **P2.3** | `.pen` sniffing/subset importer and UI/tool routing: new `integrations/codec-pen.mjs`, import router, desktop picker/drop/preload, tools and fixtures                               | Independent representative fixtures roundtrip supported components/overrides/hidden state; unsupported features explicitly reported                                                           |
| **P3**   | Incremental node/page storage and patch-based history; reduce document cloning in `web/cloud-ops.js`, `cloud/room-store.js`, history core                                           | Large-page single-property edit no longer allocates/copies the whole page repeatedly; limits revisited only after measured headroom                                                           |

No source fixes or test/build artifacts were written by this audit. Fresh executable checks were two read-only in-memory Node reproductions (missing-node replay and duplicate-receipt divergence); Cloudflare queries were preview-only. Full Electron/render tests and destructive/fault experiments remain implementation acceptance work, not claimed validation here.
