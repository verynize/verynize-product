# Drag cost at document scale — 2026-11-06

Branch `perf/drag-scale`, on top of `fix/large-design-import` (PR #28, `d76bd31`). Goal: a pointer move during a drag
costs work proportional to what moves and what is visible, not to the page or the document.

## Profile first: what a drag move cost

Tool: [`eval/canvas-perf/profile-drag-scale.cjs`](../../eval/canvas-perf/profile-drag-scale.cjs) (new). It drags the
benchmark's layer `n1` (the [`bench-verynize.cjs`](../../eval/canvas-perf/bench-verynize.cjs) fixture and trajectory,
but a fixed number of moves, one per frame), wraps each pointer move in a User Timing measure and records a CDP trace
(`devtools.timeline`, user timing, GC; optionally Blink invalidation tracking or extra categories) and a 200 µs CPU
profile. It reports per-move handler times, the pointerdown/pointerup handlers, trace totals and sampled inclusive
time for the steady moves, the three slowest moves, and the main-thread work between moves. Like `bench-node-cap.cjs`
it lifts `NODE_LIMITS` in `web/document-core.js` only for the run.

```sh
node eval/canvas-perf/profile-drag-scale.cjs --n 20000 [--nodes-per-page 5000] [--moves 60] [--node n19981]
  [--trace] [--invalidations] [--categories blink,blink.debug] [--css "<rules>"] [--no-images] [--output <json>]
```

The machine was shared with five other agents running Electron suites: one-minute load averages between 4 and 53
during this work (each result records its own `uptime`). Absolute times below are therefore inflated and noisy; the
breakdowns (which work happens per move, and how much of it scales with the page) are what drove the fixes.

### Findings (before, `d76bd31`)

Per steady move (trace totals ÷ moves, 60 moves, load ≈ 9; raw: `eval/canvas-perf/results/drag-scale-profile-*`):

| Case (before)              | Handler p50 / p95 | First move | Hit test | Style recalc | Layout | pointerdown | pointerup |
| -------------------------- | ----------------: | ---------: | -------: | -----------: | -----: | ----------: | --------: |
| 20,000, one page, `n1`     |       17.4 / 23.6 |      1,230 |      6.0 |          5.8 |    1.6 |        52.5 |     1,024 |
| 20,000, one page, `n19981` |       19.9 / 27.3 |      1,129 |      5.7 |          5.0 |    1.5 |        46.7 |       997 |
| 50,000, 10 pages of 5,000  |         6.2 / 9.4 |      2,736 |      2.0 |          1.8 |    0.6 |       159.9 |     2,571 |

- **Steady move, 20K page (~17 ms):** `elementsFromPoint` in `dropTarget` (hit test of the whole page) plus three
  forced style/layout passes from the selection chrome (`updateMeasurement` → `getBoundingClientRect`, twice in
  `selection-chrome.js`). The style passes recalculated only ~6 elements but took 4–5 ms each (see `:has()` below).
  A layer late in the page added ~4 ms of `canvas.querySelector('[data-id=…]')` walks.
- **First move (1.1–2.7 s, the p95 of the benchmark):** the fixture's `n1` lies under the nested frame `n10`, so the
  first move re-parents it and called `render()`: at 50K/10 pages 2.4 s of it, mostly whole-document work (7 subscriber
  clones inside `render`, file-library `sync` + `getDocument` + `persist`, storage meter, layer rows). At 20K one page
  also a 213 ms style recalc and 134 ms of hidden legacy layer rows.
- **pointerdown:** the undo snapshot `JSON.stringify(design)` of the whole document (47–160 ms), also on a plain click.
- **pointerup:** one full commit render (unchanged by this work, see below).
- **Between moves:** the file library's `persist`, the storage meter's `measure` (`storage-limits.js`) and the agent
  bridge's `getDocument`, scheduled by those mid-drag renders (1.2 s of `storage-limits.js` in one 40-move run at 50K).
- **Starting a drag at 50K on one page:** 845 ms of style recalc for the `moving` class on `#workspace`: five
  `.moving #canvas … .layer…` rules restyle every layer (5,062 elements on a 5,000-layer page, traced).

The suspects from the code reading, checked against the profile:

| Suspect                                                  | Verdict                                                                                                                                                                                                                                                                                                                                                                                                                    |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `elementsFromPoint` right after the `translate` write    | **Real**, two costs. The hit test itself walks the whole page (HitTest 6 ms/move at 20K, load 9). The forced style recalc was the bigger part, but not because of the translate: see the next row.                                                                                                                                                                                                                         |
| (not on the list) `:has()` rules anchored on ancestors   | **Top cause.** `#workspace:has(.canvas-preview.selected) …` and `#canvas-wrap:has(#canvas .layer[data-text-editing]) …`: every DOM change in the canvas (the chrome redrawn each move) schedules a :has() invalidation on `#workspace`/`#canvas-wrap`, and Blink walks their whole subtree. Invalidation tracking shows `UpdateLayoutTree` of 4.6 ms touching **6 elements**; 5–9 ms of style per move at 20K (load 9–12). |
| O(N) children filter per move (`dropTarget` stack index) | Only for auto-layout targets (`ed.nodes().filter(parentId)`), not in this trajectory; cheap (<0.3 ms at 20K). Left as is.                                                                                                                                                                                                                                                                                                  |
| Whole-document `JSON.stringify` at gesture start         | **Real, but per gesture**: 60–150 ms at pointerdown (20K–50K), including clicks that never drag.                                                                                                                                                                                                                                                                                                                           |
| Snap targets measured across siblings at drag start      | Per gesture, siblings only (10 in the fixture, ~1,000 top-level frames for an artboard drag). Not a per-move cost. Left as is (offscreen siblings are snap targets by design).                                                                                                                                                                                                                                             |
| No CSS containment                                       | The overlay chrome redrawn per move dirtied layout up to the root: two full-tree layouts per move (Layout 2 ms/move at 20K). Containing `#canvas-overlay` drops that to 0.1 ms. Artboards were not the issue.                                                                                                                                                                                                              |
| (not on the list) `.moving` on `#workspace`              | **Real at drag start**: rules under the class restyled every layer (above). Per gesture, not per move.                                                                                                                                                                                                                                                                                                                     |
| (not on the list) reparent in mid-drag = full `render()` | **The p95 outlier.** The fixture's `n1` sits under the nested frame `n10`, so the first move re-parents it, and `render()` ran the whole commit path: legacy layer rows, inspector, `save()`, 7 subscriber `structuredClone`s of the whole document, the file library sync (`getDocument` + `localStorage`), the storage meter. 1.1–3.1 s at 20K on one page and 2.7–3.6 s at 50K split, depending on load.                |
| (not on the list) attribute queries                      | `elementOf` and `updateMeasurement` found the selected element with `canvas.querySelector('[data-id=…]')`, a walk of the page per call (3–5 calls per move). Free for `n1` (first in the DOM), ~4 ms/move for a layer late in a 20K page. `chosen()` was a page scan too.                                                                                                                                                  |

## Fixes

1. **No `:has()` anchored on the canvas' ancestors** (`dffd915`). `#canvas-overlay[data-preview-selected]` (set by the
   selection chrome when a selected layer is a live preview) and `.clipped-selection[data-text-editing]` (set and
   cleared with the text editor) replace the two rules; they change only when that state changes.
   `tests/canvas-css-invalidation.cjs` now fails on any loaded rule whose `:has()` subject is `#canvas` or an
   ancestor (with self-checks of the detector).
2. **Drop-target hit cache** (`cdc1fec`, new `web/canvas-drop-hits.js`). Visible frames' boxes (clipped by their
   ancestors; culled boards skipped) are measured once per camera, viewport and render. Each move computes which boxes
   contain the pointer (O(visible frames), plain arithmetic); a set seen before reuses its `elementsFromPoint`
   answer. Rotated/scaled frames, ellipses, rounded-corner zones and points within 1 px of an edge always hit-test, so
   the answer is the one `elementsFromPoint` gives (verified on a 49,000-point grid in the new test).
3. **Canvas-only render for a mid-drag re-parent** (`b517ae1`). `renderCanvas()` in `web/app.js` runs the canvas part
   of `render()` (renderer, sizing, measurement, `afterRender`) and skips panels, inspector, save and subscribers. The
   release's render publishes the result (one undo step, one save, one cloud diff with the final position); the
   Layers tree shows the new parent meanwhile through the existing `bd:layer-preview`. `render()` also stops building
   the hidden legacy `#layers` rows that the sidebar island deletes at once (`data-island-owned`).
4. **Per-move chrome without page-sized work** (`ba97bc1`): layer elements through the renderer's map
   (`canvasRender.layerOf`), `chosen()` through the node index, no label/badge measurement when the selection chrome
   positions them by CSS, `contain: size layout` on `#canvas-overlay`, and the move gesture's undo snapshot taken when
   it commits (a click without a drag no longer serializes the document).
5. **Drag state on the overlay and the dragged layers** (`44aa430`): `#canvas-overlay[data-moving]` and
   `.layer[data-dragging]` (selected layers only, re-marked after a mid-drag render, kept out of the renderer's dirty
   tracking) replace the `.moving` rules; the class stays on `#workspace` for the scripts that test it.

Unchanged behavior, checked by the existing suites: snapping and guides, re-parent on drop and mid-drag, auto-layout
reorder and Escape cancel, Alt-drag copies, multi-select, undo/redo (one step per drag), the Layers tree preview,
frame labels, clipped selection rings.

## Before / after

Harness: `bench-verynize.cjs --runs 3 --skip selectAll,render,edit,pan,zoom --no-profile` (two-second drag, one
`pointermove` per frame through the production handlers; `NODE_LIMITS` lifted to 100,000 in the measured worktree
only, as `bench-node-cap.cjs` does). "Before" is a worktree of `d76bd31`, "after" this branch at `44aa430`, same
build of the harness. Handler percentiles pool every move of the three runs; frame p95 is the median of the runs'
p95 frame intervals. One-minute load average at the start of each run in the last column (the machine was shared;
loads 5–45).

| Layout       |  Nodes | Version | Drag handler p50 / p95 (ms) | Max (ms) | Frame p95 (ms) | Moves per run | Load at start of runs 1 / 2 / 3 |
| ------------ | -----: | ------- | --------------------------: | -------: | -------------: | ------------: | ------------------------------- |
| one page     |  5,000 | before  |                   4.4 / 6.0 |    355.2 |           17.5 |      90/96/95 | 11.70 / 11.33 / 10.90           |
| one page     |  5,000 | after   |                   1.1 / 1.6 |     44.4 |           17.6 |   110/111/113 | 5.24 / 5.41 / 5.62              |
| one page     | 20,000 | before  |              15.7 / 1,477.7 |  1,477.7 |        1,950.5 |        3/3/10 | 10.43 / 11.61 / 25.78           |
| one page     | 20,000 | after   |                   2.5 / 5.8 |    383.4 |           33.4 |      63/42/62 | 5.57 / 6.90 / 10.26             |
| 5,000 / page | 20,000 | before  |                   4.2 / 6.8 |    887.4 |          302.0 |      35/33/43 | 13.80 / 17.45 / 16.78           |
| 5,000 / page | 20,000 | after   |                   1.3 / 2.7 |    118.3 |           18.6 |      91/86/90 | 44.84 / 40.57 / 35.32           |
| 5,000 / page | 50,000 | before  |           1,933.7 / 2,039.7 |  2,039.7 |        2,399.8 |         1/1/1 | 16.08 / 12.74 / 10.41           |
| 5,000 / page | 50,000 | after   |                   1.2 / 1.7 |    192.2 |           33.3 |      60/55/67 | 34.98 / 33.51 / 31.55           |
| one page     | 30,000 | after   |                  3.8 / 25.3 |    470.9 |          500.0 |      53/26/34 | 27.65 / 22.37 / 24.35           |
| one page     | 50,000 | after   |                 4.9 / 472.7 |    800.2 |          783.3 |       2/12/37 | 38.44 / 24.71 / 21.48           |

Raw: `eval/canvas-perf/results/drag-scale-{before,after}-{single,pages}-2026-11-06.json`,
`drag-scale-after-single-large-2026-11-06.json` (30K/50K also ran pan and zoom).

**Target (drag handler p95 ≤ 16 ms): met at 20K split pages (2.7 ms) and 20K on one page (5.8 ms)**, and at 50K split
(1.7 ms). Not met at 50K on one page in this harness: the p95 there is the first move (the re-parent's canvas render
and the drag-start snapshot, 0.47–0.8 s) because only 2–37 moves fit into a two-second run after a 8.7 s load at
load ≈ 25–38. The fixed-count profiler, which samples 60 moves regardless, gives steady handler p50 / p95 / first move:

| Case (after, 60 moves)     | Handler p50 / p95 | First move | Style recalc / move | Hit test / move | pointerdown | pointerup | Load |
| -------------------------- | ----------------: | ---------: | ------------------: | --------------: | ----------: | --------: | ---: |
| 20,000, one page, `n1`     |         2.1 / 2.5 |        177 |                0.18 |  0 (cache hits) |         6.6 |       766 | 16.7 |
| 20,000, one page, `n19981` |         2.1 / 2.7 |        178 |                0.18 |  0 (cache hits) |         6.8 |       742 | 18.7 |
| 50,000, 10 pages of 5,000  |         1.0 / 1.3 |        168 |                0.12 |  0 (cache hits) |         5.3 |     1,753 | 17.7 |
| 50,000, one page           |         4.8 / 6.1 |        469 |                0.27 |  0 (cache hits) |        16.3 |     1,991 | 18.5 |

The first move is now the drag-start undo snapshot (44 ms at 20K, 115 ms at 50K: whole document, see below), the
canvas-only render of the re-parent (61 ms at 20K, 152 ms at 50K one page: the renderer's O(page) comparison and the
re-parented layer's style/layout) and one hit test. It occurs once per drag, and only when the drag starts by
entering another frame (the fixture's `n1` lies under `n10`); a drag that stays in its frame pays only the snapshot.

**Frame p95 stays above 16.7 ms at 20K+ on one page (33 ms)** although the handler takes 2–6 ms: between moves the
renderer does a hover hit test after each layout (Chromium's fake mouse move, `HitTest` ~6 ms per frame at 20K under
load) and layerization (~3 ms per frame), both O(page) and outside the script. With 5,000 per page the frame p95 is at
the 60 Hz quantum (17.6–18.6 ms; intervals of 16.8 ms are timestamp jitter, see `eval/canvas-perf/README.md`).

## Remaining whole-document work (not changed here)

These are per commit or per gesture, not per move, and are where large documents still pay:

- **Release (`pointerup`): one full commit `render()`: 0.74–0.77 s at 20K, 1.75 s at 50K split, 2.0 s at 50K on one
  page.** At 50K split: subscribers' whole-document `structuredClone`s inside `render` (7 subscribers take a parameter,
  ~1.5 s together), the file library subscriber (`getDocument` clone + `sync` + `persist` of the library to
  `localStorage`, ~0.55 s), then the storage meter and the agent bridge's `getDocument` after it. Remedies, in order of
  payoff: hand subscribers one shared, frozen or structurally shared snapshot instead of a clone each (needs an audit
  of the seven: `bridge.ts`, `sidebar/hooks.ts`, `live-preview.js` ×2, `canvas-tiles.js`, `agent-bridge.js`, …); move
  the file library's per-render `sync`/`persist` of the whole document behind the idle `save()`; page-scoped dirty
  tracking for the storage meter.
- **Drag-start undo snapshot:** `JSON.stringify(design)` of the whole document (44 ms at 20K, 115 ms at 50K). Now paid
  only by a drag, not a click. Page-scoped or patch-based undo history would remove it (shared with the version-history
  work).
- **Canvas renderer per render:** the keyed renderer still compares every node of the page (`compare`/`visit`,
  ~0.1 s at 50K one page; fix 3's "dirty marks" item).
- **Per-frame hover hit test and layerization** (above): Chromium work proportional to the page while anything
  re-lays out under a stationary pointer.

## Node limits

Recommendation only; `NODE_LIMITS` is unchanged (`perPage: 5000, perDocument: 50000`).

- **Drag no longer bounds `perPage`.** Steady drag handlers stay under 7 ms at 50,000 on one page and under 3 ms at
  20,000; the one slow move per drag is 0.18 s at 20,000 and 0.47 s at 50,000.
- **Zoom and load do.** From the same 30K/50K run (after): zoom handler p50 / p95 39.6 / 61.1 ms at 30,000 and
  76.4 / 150.6 ms at 50,000, load-to-paint 4.4 s / 8.7 s (loads 21–38). The node-cap measurement had zoom p95 20.7 ms at
  10,000 and 37.8 ms at 20,000 per page under similar contention. These paths are untouched here.
- So: **raising `perPage` to 10,000 is defensible if the lead accepts zoom p95 ≈ 21 ms (contended) at that size;**
  20,000 per page needs zoom work first (and the release cost above), whatever drag does. Keep `perDocument` at 50,000:
  with 5,000 per page every per-move cost is now flat in the document size (50K split p95 1.7 ms); what grows with the
  document is the release commit (1.75 s at 50K) and edits.

## Validation

Machine as above (Apple M1, shared with sibling agents). Electron tests were run one at a time.

| Command                                                                                        | Result                                                                                                                                                                                                             |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm run build:ui`, `npm run lint`, `npm run lint:ui`, `npm run typecheck:ui`, `npm run check` | pass (lint: 0 errors, no warnings in the new files)                                                                                                                                                                |
| `npm run test:changed -- --base origin/fix/large-design-import`                                | **232 passed, 0 failed, 0 skipped** (761 s)                                                                                                                                                                        |
| `node tests/canvas-drag-scale.cjs` (new)                                                       | pass; on `d76bd31` it fails (click snapshots the document; moves: 11 stringify, 27 clones, 3 subscriber rounds, 30 full hit tests for 30 in-frame moves; 5,062 elements restyled by the first move against 52 now) |
| `node tests/canvas-css-invalidation.cjs` (extended)                                            | pass; its detector flags both removed rules                                                                                                                                                                        |
| `node tests/preview-frame-chrome.cjs`, `node tests/canvas-selection-marks.cjs` (extended)      | pass                                                                                                                                                                                                               |

`tests/canvas-clipboard.cjs` failed 2 of 19 runs on this branch during this work, both in its Alt-drag copy step
(once the copy stopped part-way, once no copy was made) and both at load ≈ 34; it passed 19 of 19 on `d76bd31`
(interleaved with the branch, six runs each under ten extra busy loops) and passed in the full changed suite. No
cause was found and no failure reproduced at lower load or under the busy loops; it is listed as an open item rather
than called flaky.
