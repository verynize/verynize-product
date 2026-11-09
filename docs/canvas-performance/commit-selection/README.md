# Commit snapshots, large selection, and library persistence

Branch: `perf/commit-selection`, based on staging `2630c30`. Measurements: 9 November 2026, Apple M1 / 8 GiB, Electron 45.2.3. This implements audit P1 #9–13 and evaluates the two associated P2 proposals. It does not change remote-operation application or `cloud/`.

## Results

The original audit measurement harness is preserved in `eval/canvas-perf/measure-renderer.cjs`, with its repository-relative paths adjusted. Each size launches a fresh Electron profile. Before and after use the same synthetic document, measurement wrappers, edit count, and paint fence. Runs were sequential under the Mac `/tmp/verynize-electron.lock`. Raw JSON includes machine load, timings, attribution, and counters. The `commit` field names the starting HEAD because after measurements were taken before committing the working tree.

| Metric                                                 |                           Before |     After |
| ------------------------------------------------------ | -------------------------------: | --------: |
| 1K edit, synchronous color median                      |                          51.5 ms |   17.7 ms |
| 5K edit, synchronous color median                      |                         205.0 ms |   45.1 ms |
| 10K edit, synchronous color median                     |                         447.8 ms |   66.5 ms |
| 1K uninstrumented position edit median                 |                          74.3 ms |   17.2 ms |
| 5K uninstrumented position edit median                 |                         229.7 ms |   57.2 ms |
| 10K uninstrumented position edit median                |                         445.3 ms |   73.2 ms |
| 1K select-all through paint fence                      |                         786.4 ms |   42.6 ms |
| 5K select-all through paint fence                      |                       5,639.2 ms |  133.6 ms |
| 10K select-all through paint fence                     |                      13,745.0 ms |  298.3 ms |
| Whole-document clones per color commit                 | 10 synchronous / 14 through idle |     1 / 1 |
| Select-all bounding-client-rect reads, 1K / 5K / 10K   |                100 / 500 / 1,000 | 0 / 0 / 0 |
| Synchronous whole-library localStorage writes per edit |                                1 |         0 |

Sources: `before.json`, `after.json`. `after-repeat.json` retains a preceding run rather than hiding variation: 1K/5K/10K color edits were 19.2/53.9/94.4 ms, selection fences 42.5/130.9/230.1 ms. These are synthetic measurements on a shared, loaded machine, not universal latency guarantees. The 1K <16 ms target is **not met consistently**; 5K <50 ms is met by the final color median but not by uninstrumented position edits or every repeat.

`commit-selection.cjs` adds PerformanceObserver long tasks and forced-GC heap measurements. Final 5K selection was 123.6 ms through the fence, longest task 85 ms; a preceding run was 184.4 ms / 128 ms. Thus <1 second is comfortably met, but **no task >100 ms is not yet a reliable guarantee**. Final 10K was 305.8 ms / longest task 230 ms. Further splitting DOM selection/style work is still needed for a strict frame budget. The extra harness includes obtaining a mutable document before selecting; the standard harness's synchronous timing covers the selection call itself.

## Changes and API contracts

- **#9:** `commit-state.js` owns one lazily created, deeply frozen snapshot per committed document. Subscribers receive the same object. `design.getSnapshot()` returns it without cloning; treat it as read-only. `getDocument()` intentionally retains the mutable-copy contract used by existing editing integrations. Library, version history, fonts, and React's initial bridge read use the snapshot where safe. Snapshots are frozen in production too, so accidental subscriber writes cannot silently corrupt another consumer. A subsequent commit has a new snapshot identity; selection-only notifications retain document identity. `commit-validation.js` reuses successful schema validation for stable local node edits, falling back to the shared full validator for structural/component changes. Geometry validation remains enforced.
- **#10:** multi-selection chrome resolves world geometry from the document model. CSS-flow children use batched layout offsets, with no per-node `getBoundingClientRect`. Single-node interaction paths remain intact.
- **#11:** selection-only renders retain existing canvas layers and content. Large selections show the bounds/count before deferred subscriber work. The inspector offers explicit detailed inspection above 200 nodes, color rows expand in batches, and large layer trees mount at most 60 rows. Clearing selection avoids a canvas rebuild. Small/offscreen selections still uncull their ancestors. Bulk selection no longer reveals every offscreen board. Deletion indexes descendants once rather than scanning the page per selected node.
- **#12:** `library-storage.js` stores one IDB record per file plus library metadata. Idle-coalesced writes only put changed files. `fileLibrary.list()` copies metadata and returns frozen document references without clone/validation on every call. `ready()`, `isReady()`, and `flush()` describe asynchronous hydration/durability. The lifecycle flushes before a file switch; router restore and cloud startup reconnect wait for hydration. Legacy `verynize-library-v1` is retained unchanged as a recovery copy. Migration writes all records and metadata in one atomic transaction. Corrupt legacy JSON or IDB read failure prevents overwriting the stored library; the UI reports the failure. Existing invalid documents are retained and marked. The separate `verynize-v2` current-document recovery save remains; this change does not remove all full-document serialization.
- **#13 / P2 undo:** retained history is reverse patches scoped to changed page/node/property paths. Structural changes retain collection order and inserted/deleted records. Redo captures inverse patches. Gestures retain their rollback checkpoint until pointer release, then compact it. Legacy mutation entrypoints can still transiently create a full checkpoint; they no longer retain 100 complete documents. History ordering remains document-wide, preserving cross-page undo behavior; this is not an independent undo cursor for each page.
- **P2 lazy pages:** valid, non-component documents prepare only the active page. Inactive pages are normalized on first activation, including pages restored by undo. Strict validation still checks all pages before accepting external data. Repairable legacy documents and component documents deliberately use the eager safety path. Parsing, storage loading, and snapshots still include inactive pages: this is lazy preparation/rendering, not on-demand disk paging.

`getSnapshot()` and `VerynizeCommitState.diff(before, after)` are available to the gesture agent's per-node application work. The diff helper currently produces reverse history patches; it is not a forward network-operation protocol. No changes were made to `loadDocument` or cloud remote-op application.

## Retained heap and history

The extra harness loads 5K nodes, performs 170 edits in batches with rendering fences, forces GC through CDP before/after, and measures renderer JS heap. Baseline uses an archive of `2630c30` with the same harness (only its absent `fileLibrary.flush` is guarded).

| Metric                      |            Before |           After |
| --------------------------- | ----------------: | --------------: |
| Heap before 170 edits       |        515.57 MiB |       40.22 MiB |
| Heap after 170 edits        |        803.85 MiB |       31.07 MiB |
| Retained history entries    |               100 |             100 |
| Serialized history payload  | 370,330,601 bytes |     7,501 bytes |
| Serialized current document |   3,112,779 bytes | 3,112,779 bytes |

Sources: `heap-before.json`, `heap-after.json`; earlier repeats are included. This reproduces full-document checkpoint retention as a major contributor and proves that retained history falls for the same workload. It does **not** reproduce the audit's exact 1.75 GB desktop-process RSS figure or establish that every Electron process leak is fixed. JS heap after forced GC and OS process RSS are different measurements.

## Canvas2D tile evaluation

Fresh profiles, identical 10K document, overview zoom 0.15, three motion trials each. Only the existing opt-in `verynize.canvasTiles` flag changes. Late means RAF interval >25 ms. Raw results: `tiles.json`.

| Mode                   | RAF p95, three trials (ms) | Late frames, three trials |
| ---------------------- | -------------------------- | ------------------------- |
| Existing DOM rendering | 17.7 / 17.2 / 18.7         | 3.57% / 0% / 1.68%        |
| Canvas2D tiles         | 33.7 / 32.1 / 35.1         | 8.08% / 7.02% / 26.14%    |

**Keep tiles disabled.** The existing implementation is slower in this comparison. These values do not promise to reproduce the audit's 33 ms p95 / 13–17% late on every run; the heap harness also observed DOM p95 up to 33 ms under a different load. There is no measured case here supporting enabling tiles by default.

## Validation and reproduction

New regression tests are registered in `scripts/test-manifest.mjs`:

- `tests/commit-state.cjs`: snapshot sharing/isolation, 170 revisions, inverse correctness across insert/delete/reorder/page metadata, bounded structural patches, lazy page safety, world limits, hinted edits and CSS readback.
- `tests/renderer-commit-performance.cjs`: real Electron, one document clone per 5K commit, shared frozen snapshot, invalid updates rejected, O(1) rect reads, bounded layer rows, retained layer DOM on clear, no legacy library writes, atomic IDB migration/changed-file writes, and undo across a forced mid-drag render. The 1.5-second synchronous CI ceiling catches large regressions without pretending slower CI can meet the Mac product target.
- Existing document-safety/library tests now inspect the real IDB store and explicitly reset IDB when seeding a legacy migration. Assertions about preserving invalid user data remain.

Local: build UI, JavaScript/asset checks, full lint, UI lint/typecheck, component and commit-state tests (32/32 passed). React Doctor's changed-file scan flags a browser global in legacy `app.js`; this file is intentionally a browser-only classic script. No SSR import was introduced.

Instabox `coba`, slot `perf`, Electron serial under the shared lock:

- Initial targeted report `/data/test-results/verynize/perf-20261109T000431Z`: 4 passed (canvas, library, document safety, renderer regression).
- Initial broad report `/data/test-results/verynize/perf-20261109T000609Z`: 70 passed / 5 failed. Offscreen selection culling, synchronous open cancellation, and restore-before-hydration failures were fixed. The inspector export toast timeout passed in the final run without weakening its assertion.
- Final broad report: `/data/test-results/verynize/perf-20261109T001832Z`: **74 passed / 1 failed**, 499.6 seconds. Full output is preserved in `validation.log`. All five previous failures passed, including home-first-opening, both culling tests, storage-limits, and inspector-parity. The remaining `tests/settings.cjs` failure is a toast intercepting the `[data-mode-option="auto"]` click at line 281. Baseline `/data/test-results/verynize/base-20261108T234818Z/runner.log` fails on the same selector and cause. It is not treated as a green suite or fixed in this branch. The new renderer test (including mid-drag undo) passed in this final run.

Reproduce Mac measurements after `npm run build:ui` with one Electron under the audit lock:

```sh
node eval/canvas-perf/measure-renderer.cjs --sizes 1000,5000,10000 --out /tmp/renderer.json
node eval/canvas-perf/commit-selection.cjs --out /tmp/heap.json
node eval/canvas-perf/commit-selection.cjs --tiles --out /tmp/tiles.json
```

## Merge risks and remaining work

Coordinate changes around `app.js` render/history/updateNodes with gesture work. The only `cloud-panel.js` change is startup reconnect waiting for library hydration; the remote application path is untouched. The IDB `fileLibrary.ready()` contract also affects shell router restore and existing tests that seed localStorage. `getDocument()` remains mutable for compatibility, while any consumer mutating a subscription payload or `list().document` must switch to an editing API or explicitly clone it. Virtualization changes which offscreen layer rows exist in DOM; selectors should reveal/scroll the row first. Remaining product targets are strict edit/frame latency, true disk-paged inactive documents, and independent per-page history if that UX is desired.
