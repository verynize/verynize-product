# Fix 2: keyed frame labels and indexed selection (2026-11-05)

Fixes 2 and 3 from the [README ranking](README.md#measured-gains-ranked-by-cost-to-implement), the two hot paths the [opus review](reviews/opus-on-verynize-baseline.md) attributed with profiles: `drawFrameLabels` (forced style recalculation per top-level frame, on every camera move and every `render()`) and the all-node selection scans (`topSelected` → `descendants`, `rows`, `sizingMode`). The five `:has(:focus-visible)` rules (fix 1) are **not** removed in this branch, so the gains below are on top of today's CSS.

## What changed

**Frame labels** (`web/canvas-interactions.js` `drawFrameLabels`):

- Positions come from document geometry, never from `getBoundingClientRect`. A top-level frame's box is `x/y/w/h` (border-box) turned about its centre by `rotation`; the label goes 18 px above the top-left of that box's axis-aligned bounds, which is exactly what the old layout read returned. Only a rotated frame whose size layout can change (hug/fill, min/max, aspect ratio, % sizes) reads `offsetWidth/offsetHeight`, and every read happens before the first write.
- Labels are keyed by frame id and reused: a camera move or render only rewrites `left`/`top` (and class, text) that changed. The `pointerdown` handler reads the id from the element.
- Labels whose box (max 240 × 16 px) lies outside the viewport are detached. The viewport size is taken in the existing `#canvas-wrap` ResizeObserver, so a resize or a hidden canvas re-culls without a layout read.
- `drawClippedSelection` measures every clipped ring first and then writes once, instead of measuring after each append.

**Selection and structure** (new `web/node-index.js`, `window.VerynizeNodeIndex`, loaded before `selection-chrome.js`):

- Per node array, a cached id → slot map and parent → children lists. The editor mutates arrays in place without a revision counter, so `of(list)` checks every slot's node, id and parentId against the live array (one tight O(N) pass) and rebuilds on any structural change; `find(list, id)` is O(1) and verifies only the slot it returns. Results are never stale.
- `topmost(list)` returns the nodes without an ancestor in `list` by walking parents against a Set of selected ids: O(S·depth) instead of O(S²·N).
- Call sites, each a one-expression change: `descendants` (`app.js:14`), `sizingMode`'s parent lookup (`:18`), the legacy layer `rows()` (`:21`, one index per render passed down the recursion), the export roots (`:102`), `window.verynize.setSelection`; `find`, `topSelected` and `moveNodes` roots in `canvas-interactions.js`; `topSelected` in `selection-chrome.js`.
- The dead first `setSelection` key in the `window.verynize` literal is removed. The live (second) one keeps its behaviour, now with an O(1) lookup per id.

Not changed (other branches): `render()` rebuilds, `layerElement`, `updateNodes`, live drag `render()` calls, Tailwind `:has` rules, tiles.

## Measurements

Harness: `node eval/canvas-perf/bench-verynize.cjs --sizes 100,500,1000,2000 --runs 3 --no-profile` (same fixture as the baseline: seed 241104, 5% top-level frames, so label count grows with N). Apple M1, 8 GiB. Medians of three repeats, ms.

**The machine was shared with other benchmarking agents** (one-minute load average 8–13 during both runs below, against 4.3–5.3 for the idle sequential baseline). To control for that, the base commit (`5900c1d`) was rerun back to back with this branch under the same load. Read the interleaved column as the like-for-like comparison and the idle column as a conservative lower bound on the gain (the "after" run was loaded, the idle baseline was not). The lead should rerun both sequentially on an idle machine.

Raw files: [after](../../eval/canvas-perf/results/verynize-after-labels-selection.json) (`aa331b5`), [base interleaved](../../eval/canvas-perf/results/verynize-base-interleaved-labels-selection.json) (`5900c1d`), [idle sequential baseline](../../eval/canvas-perf/results/verynize-2026-11-04-sequential.json) (`022d40e`, same canvas code as `5900c1d`).

### 1,000 nodes

| Metric                          | Idle baseline | Base, interleaved |       **After** | Gain vs interleaved |
| ------------------------------- | ------------: | ----------------: | --------------: | ------------------: |
| Pan handler p50 / p95           |     167 / 185 |         210 / 334 | **12.0 / 19.6** |               17.5× |
| Pan frame p50                   |           167 |               233 |        **16.7** |               14.0× |
| Zoom handler p50 / p95          |     166 / 190 |         208 / 339 | **21.6 / 29.4** |                9.6× |
| Zoom frame p50                  |           169 |               217 |        **33.3** |                6.5× |
| Full render, sync               |           261 |               328 |         **108** |                3.1× |
| One-property edit, sync         |           282 |               374 |         **124** |                3.0× |
| Edit paint fence                |           316 |               415 |         **160** |                2.6× |
| Drag frame p50 / p95            |     283 / 585 |         350 / 733 |   **133 / 283** |                2.6× |
| All-node selection, sync        |         8,868 |            12,426 |         **406** |               30.6× |
| All-node selection, paint fence |         9,695 |            13,536 |       **1,560** |                8.7× |
| Load paint fence                |           505 |               744 |         **247** |                3.0× |

### 500 nodes

| Metric                          | Idle baseline | Base, interleaved |       **After** |
| ------------------------------- | ------------: | ----------------: | --------------: |
| Pan handler p50 / frame p50     |   46.7 / 50.0 |         114 / 117 |  **6.6 / 16.7** |
| Zoom handler p50 / frame p50    |   47.9 / 50.0 |        96.8 / 100 | **12.0 / 16.7** |
| Edit sync                       |          93.4 |               197 |        **63.4** |
| Drag frame p50                  |           100 |               200 |        **83.0** |
| All-node selection sync / fence | 1,223 / 1,585 |     2,630 / 3,270 |   **174 / 641** |

500-node pan and zoom now hold 60 Hz (frame p50 16.7 ms) even under load.

### 2,000 nodes

Before: all-node selection did not finish within the 60 s ceiling (idle and interleaved runs both), so the size never completed. After: all three repeats complete.

| Metric                                 | After (median) |
| -------------------------------------- | -------------: |
| All-node selection, sync / paint fence |  1,267 / 4,500 |
| Pan handler p50 / frame p50            |    29.7 / 50.0 |
| Zoom handler p50 / frame p50           |    55.8 / 82.6 |
| Edit sync                              |            367 |
| Drag frame p50                         |            333 |

The regression test `tests/canvas-frame-labels.cjs` selects 2,000 nodes (100 artboards, nested three deep) in **450 ms** through `window.design.setSelection` (budget 2 s).

### 100 nodes

Within noise: pan handler 5.6 → 2.7 ms, edit sync 15.7 → 15.5 ms; frame intervals stay at 16.7 ms. The 100-node load and all-node selection paint fences moved 20% in the wrong direction against the idle baseline only (42 vs 35 ms, 144 vs 116 ms), which is consistent with the 2–3× higher load during the after run; the interleaved base is slower on both.

## What is left

- Edit, render and drag are still dominated by the full `render()` rebuild and by the `:has(:focus-visible)` whole-workspace restyle of every DOM write (fix 1). The remaining camera cost at 1,000–2,000 nodes was not profiled; the likely remainder is `updateMeasurement` and the selection chrome reads, one forced recalc per camera change each instead of one per frame label.
- All-node selection's paint fence (1.6 s at 1,000) is now mostly `render()` building 4 handles per selected layer and React layer rows; the selection algorithms are no longer visible.
- When live drag stops calling `render()` (fix 4), whatever moves the frame must still call `drawFrameLabels` (labels read the document's `x/y`, not the element's transform).

## Validation

- Label placement equals the old layout-measured rule within 0.5 px: the label assertions of `tests/canvas-frame-labels.cjs` (pan, zoom, wheel, move, rotate, hug resize, rename, selection, `labelHidden`, hide, delete, undo, label drag) pass on both the base commit and this branch; only the culling and element-reuse assertions are new behaviour.
- `tests/node-index.cjs` checks the index against the previous whole-array scan implementations, in-place mutations (reparent, push, splice, replace, id change) and a parent cycle.
- Commands run, with results, are in the pull request.
