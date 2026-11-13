# Review: `verynize-baseline.md` (adversarial validation)

Reviewer: Opus, 4 November 2026. This is a read-only review. I ran no benchmarks, Electron or browser sessions. Inputs: worktree at `022d40e` (the measured commit), `eval/canvas-perf/{bench-verynize,profile-verynize,renderer}.cjs`, `results/verynize-2026-11-04.json`, the partial in-progress `verynize-2026-11-04-sequential.json` (100 × 5 and 500 × 3 repeats when read), and all 18 `profile-*.json.gz` traces. I parsed the traces with throwaway scripts (`/tmp/vnrev/{prof,trace,byfile}.js`). Inclusive CPU time = sampled time with the function anywhere on the stack. All "saved ms" figures are **estimates** derived from profile shares. None of them is a measured speedup.

## Verdict summary

| Claim                                                                      | Verdict                                                                                                                                                   | Key evidence                                                                                                                                                                                                                                |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Misses 60 Hz at 500 nodes (pan/zoom p50 50 ms)                             | **Confirmed for this fixture.** **Overstated as a general node-count threshold.**                                                                         | Pan handler p50 46.4 ms (`summary[1].pan.handlerMs.p50`). Sequential rerun: 500-node repeats give handler 46.6–47.7 ms and edit 92.8–94.7 ms, within 5% of the contended run. The cost scales with the number of top-level frames (see F2). |
| Edit 94.7 ms sync at 500                                                   | **Confirmed**                                                                                                                                             | `summary[1].edit.syncMs.p50` = 94.70                                                                                                                                                                                                        |
| All-node selection > 60 s at 2,000                                         | **Confirmed. The workload is a worst case, not a strawman.**                                                                                              | `ceiling = {n:2000, run:0, "Ceiling 60000ms: selectAll"}`. Keyboard Select All at 1K selects about 50 roots (`canvas-interactions.js:1361–1364`), not 1,000 nodes.                                                                          |
| (1) `drawFrameLabels` interleaved reads force style recalc on camera moves | **Confirmed but under-scoped.** It is also the largest cost of edit, render, drag and selection. The multiplier per read is not explained (F1).           | Pan: 2,000 of 2,090 ms in `applyCamera` is inside `drawFrameLabels → worldRect → getBoundingClientRect`, and there are 640 `UpdateLayoutTree` events over about 13 inputs.                                                                  |
| (2) `descendants` / pairwise selection scans                               | **Confirmed for all-node selection only**                                                                                                                 | `topSelected` (`selection-chrome.js:124`) is 5,888 ms inclusive of 10,179 ms. It costs nothing with one selected node.                                                                                                                      |
| (3) Full `render()` rebuild plus subscriber clones dominate edit/drag      | **Overstated / partly wrong.** The rebuild is real, but `drawFrameLabels` inside `afterRender` is most of `render()`. Clones and serialization are small. | Edit at 1K: `render` 261.7 ms, of which `drawFrameLabels` is 165.1 ms. `updateNodes` work outside `render` is 17.7 ms. `structuredClone` is barely sampled.                                                                                 |
| "Paint/raster/compositor much smaller"                                     | **Confirmed**                                                                                                                                             | Pan: Paint 7.6 ms, raster 2.4 ms vs style recalc 2,048 ms                                                                                                                                                                                   |
| At 100 nodes, "% >16.7 ms" of 44.6% (pan) / 32.2% (zoom)                   | **Wrong as a jank signal.** It is vsync timestamp jitter.                                                                                                 | The 100-node pan histogram is all 15.7–17.7 ms. Counting intervals > 25 ms (excluding the first) gives **0%** for pan and zoom and **13.2%** for drag.                                                                                      |

## Findings

**F1. One hot path dominates every operation, not only camera moves.** `afterRender` (`canvas-interactions.js:1708`) calls `drawFrameLabels`, so every `render()` pays for it. Inclusive `drawFrameLabels` at 1K (detailed pass):

| Op               |    Op total (ms) | `drawFrameLabels` (ms) | Share | `UpdateLayoutTree` events | Elements per recalc (p50) | ms per recalc (p50) |
| ---------------- | ---------------: | ---------------------: | ----: | ------------------------: | ------------------------: | ------------------: |
| pan (≈13 inputs) |            2,090 |                  2,000 |   96% |           640 (≈49/frame) |                     1,368 |                3.15 |
| zoom             |                — |         1,790 (`gBCR`) |     — |                       594 |                     1,369 |                3.10 |
| render           |              263 |                    165 |   63% |                        52 |                     1,350 |                3.04 |
| edit             |              279 |                    165 |   59% |                        52 |                     1,350 |                3.08 |
| drag (≈8 moves)  | 2,288 (`render`) |                  1,401 |   61% |                       427 |                     1,372 |                3.21 |
| all-node select  | 8,780 (`render`) |                  2,562 |   29% |                        56 |                 **5,350** |            **50.6** |

The report gets the _count_ mechanism right: `replaceChildren` (`:1130`), then for each frame `worldRect` → `getBoundingClientRect`, then `append` (`:1136`). The result is about one forced recalc per top-level frame per call. What it does not explain is the _breadth_. Each forced recalc after a single `<span>` is appended to `#canvas-overlay .frame-labels` restyles ≈ the whole `#workspace` subtree: about 200 / 711 / 1,348 elements at 100 / 500 / 1,000 nodes. That matches layers + text/image children + about 70 chrome elements. With every node selected it is 5,350 elements, because each selected layer adds 4 `.handle` children. A correctly scoped invalidation would restyle about one element.

**Unverified hypothesis** for the breadth: `#workspace:has(.canvas-preview.selected) …` (`live-preview.css:18`, `preview-frame-chrome.css:343`) makes `#workspace` a `:has()` anchor. Blink merges `:has` invalidation sets, and Tailwind's `:where(.group):has(…) *` (universal descendant) and `:has(>:not([hidden]))` in `dist/ui.css` can turn that into whole-subtree invalidation on any insert or remove under `#workspace`. The trace lacks `invalidationTracking`, so this cannot be confirmed from the data. Experiment: replace the two `#workspace:has()` rules with a JS-toggled class, then re-trace pan with `disabled-by-default-devtools.timeline.invalidationTracking`. The expected elements per recalc fall from about 1,350 to under 10. If the hypothesis holds, it is a CSS-only fix for every DOM write under `#workspace` (hover box, guides, selection chrome, labels).

**F2. The fixture inflates the camera cost quadratically.** `synthetic()` makes 5% of nodes top-level frames (`k===0`), so the label count grows with N: 5 / 25 / 50 / 100. Forced recalcs per frame ∝ N/20 and elements per recalc ∝ N, so pan cost ∝ N². A real 1K document with about 5 artboards would do about 5 recalcs/frame (≈ 16 ms, _estimate_) instead of 49. Other limits that understate other paths:

- Every node is `fixed`, so the `offsetWidth` reflow loop in `render` is skipped.
- Depth is at most 3.
- There is no flow layout and only one page.

The headline "misses 60 Hz at 500" is valid for this fixture's artboard density. It is not a DOM node-count threshold. The report says "one fixture", but it should name this specific scaling.

**F3. Why the app is about 35× slower than A2 at 1K.** A2 emulates the container transform and `--iz`, but has no frame labels, overlay or `:has()` rules (`renderer-options.md:25`). At 1K, ≈49 × 3.2 ms ≈ 157 ms of the 166 ms pan handler is the forced, broad style recalc in F1. The remaining ≈ 7 ms is `selection-chrome draw → screenFrame → getBoundingClientRect` (43 ms over the profile) plus `updateMeasurement`. Correction to `renderer-options.md:62`: the cost is forced **style recalculation** (2,048 ms), not layout (48 ms).

**F4. All-node selection: the report lists the parts but omits two of them.** Of 8,792 ms in `setSelection`:

- `topSelected` 5,888 ms (`descendants` scan callback 3,493 + pairwise 1,572 + `descendants` 770 + others; the report's figures match exactly)
- `drawFrameLabels` 2,562 ms (missing from the report's selection attribution)
- React `ui.js` ≈ 550 ms self (`Hd` 636 ms inclusive)
- GC 82 ms

`topSelected` is O(S²·N) in the worst case:

- Every root and early ancestor scans `list.some` across all selected nodes.
- `descendants` (`app.js:14`) is a fixed-point loop of full `nodes()` scans.

The live `setSelection` is the second, duplicate key in the `window.verynize` literal (`app.js:85` char ≈3092; the first definition at ≈2926 is dead). It filters with `nodes().some`, which is O(S·N) and cheap here (≈7 ms).

**F5. Edit/drag "clones" are not material at 1K.**

- `updateNodes` outside `render`: 17.7 ms. That covers `JSON.stringify`/`parse` ×2, `validate` 5.1 ms and `preflightChange` 6.3 ms.
- `save` 1.3 ms.
- Eight `design.subscribe` callers each receive a `structuredClone`, which is not visible in the edit samples.
- `render` self time is 35 ms and includes inlined builtins and DOM construction.
- `rows` (`app.js:21` char ≈1270) is 18.9 ms. It filters the whole page for every node, which is O(N²). The report's description is correct.
- `sizingMode` default `find` (`app.js:18`) is 20.0 ms.

During drag, `startMove` calls `ed.render()` on every free move (`canvas-interactions.js:832`/`837` region). The report is correct here, at ≈286 ms per move, 61% of it labels.

**F6. Harness soundness.**

The harness drives the real code paths:

- Wheel events go to the `#workspace` listener, pointer events to the layer and `window`, and edits and selection go through the public API.
- The product never checks `isTrusted` (0 matches in `app.js`, `canvas-interactions.js`, `selection-chrome.js`).
- One input per rAF is a fair model of the coalesced input stream.
- Edits use `updateNodes`, not the inspector form path. Inspector edits were not verified to be equivalent.

The paint fence (`setTimeout(0)` + 2 rAF) is a reasonable upper bound, with a floor of about 2 vsyncs: the 100-node edit fence minus its sync time is 32 ms. For first-pixel timing, use the trace's `DrawFrame`/presentation events.

Quantisation:

- At ≥500 nodes it adds at most one frame: 46.4 ms of handler time shows as 50.0 ms. It does not distort the conclusion.
- At 100 nodes it creates the false 44.6% / 32.2% figures.
- Use a > 25 ms or missed-vsync count instead. Missed vsyncs per second, median: 0 / 0 / 7 at 100 nodes, ≈40–50 at 500, ≈54–57 at 1K.

Contention: the supplemental profile ran with 105 MiB free RAM and a load average of 7.1 (`supplementalMachine`). Ratios are robust to this, absolute values less so. The partial sequential rerun reproduces the 100- and 500-node medians within about 5%.

The load paint fence (497 ms vs 282 ms sync at 1K) was not profiled. Its post-sync ≈ 216 ms is unattributed, most likely React layer-row mounting (4,009 `#layer-panel button` at 1K).

## Spot-check of tables against raw JSON (27 cells, all match)

Table 1:

- 100 row: all 10 cells.
- 500: 167.2/174.0, 94.7/98.2, 1592.3/1628.8.
- 1000: 258.3/269.6, 9600.8/9660.9.

Frames:

- 100 pan 16.7/17.6/44.6.
- 500 zoom 50.0/66.7/97.4.
- 1000 drag 283.3/566.6/85.7.

Heap: 34.5 / 73.5 / 127.1 MiB (`heapUsedBytes`/2²⁰).

DOM: 15,547 / 58,288 / 57,364; connected 41,466.

2K partial: 1,678.0, 940.6, 978.4/1,016.6, with 3 pan and 2 drag handler samples.

Trace table: render (158.9, 4.8, 4.7, 0.4/0.2, 0.2, GC 1.6+3.0), selectAll (2,929.3, 56.2, GC 67.2+15.1=82.3), pan, zoom and drag style/layout.

CPU leaders: 3,492.9 / 1,571.6 / 769.6.

Load-average range: 4.34–8.20.

Line references check out: `:275`, `:1129`, `:307`, `app.js:14` char 21/96, `app.js:20` char 22, `app.js:21` char 16/1270, `selection-chrome.js:124–126`, `bridge.ts:89`.

## Ranked fixes with estimated savings at 1K nodes (estimates, from profile shares)

| Rank | Fix                                                                                                                                          | Pan/zoom per frame                                                                                 | Edit / render                            | Drag per move                         | All-node select                       |
| ---: | -------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ---------------------------------------- | ------------------------------------- | ------------------------------------- |
|    1 | Frame labels: position from document geometry (top-level free frames already have world x/y), keyed and reused, no DOM reads; cull offscreen | −150 ms (166 → ≈15)                                                                                | −160 ms (280 → ≈120)                     | −175 ms                               | −2.5 s                                |
|   1b | Verify, then remove the `#workspace:has()` rules (F1 hypothesis)                                                                             | If confirmed, similar to #1 alone (each recalc ≈3 ms → <0.1 ms), and protects other overlay writes | similar                                  | similar                               | similar                               |
|    2 | `topSelected` via ancestor walk over a selected-id set plus a cached id→node / parent→children map. Also fixes `rows()` and `sizingMode`     | ≈0                                                                                                 | −38 ms (`rows` + `sizingMode`)           | −38 ms                                | −5.9 s                                |
|    3 | No `render()` during live drag; commit on pointer-up                                                                                         | —                                                                                                  | —                                        | remaining ≈110 ms after #1 → a few ms | —                                     |
|    4 | Keyed layer patching instead of rebuilding (edit)                                                                                            | —                                                                                                  | remaining ≈80–100 ms → ≈10 ms            | —                                     | —                                     |
|    5 | Virtualize React layer rows; stop building hidden legacy rows                                                                                | ≈0                                                                                                 | <5 ms (React) plus part of `render` self | —                                     | −0.5 s; large connected-DOM reduction |
|    6 | Coalesce persistence, validation and clones                                                                                                  | ≈0 (storage-limits ≈11 ms per profile)                                                             | ≈ −15 ms                                 | small                                 | small                                 |
|    7 | Culling / `content-visibility`                                                                                                               | unmeasured; reassess after #1 and #1b                                                              |                                          |                                       |                                       |

Compared with the report's ranking:

- The report's #1 is correct, but its expected gain is understated: it also helps edit, drag and selection.
- The report's #5 (persistence and clones, "medium") should be **low**.
- The report's #4 (React rows) is medium at most, and only for large selections and memory.
- Add #1b as the cheapest experiment.
