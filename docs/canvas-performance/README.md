# Canvas performance: research synthesis (2026-11-04)

See [node-cap-2026-11-06.md](node-cap-2026-11-06.md) for the larger-document measurements, page/document limits, and tiles re-evaluation.

Question: is Verynize's DOM-based canvas "the brutal mistake" described on X, and what is the real, measured performance gain from each way of fixing it, including FigCraft's approach?

All numbers are from one Apple M1 (8 GiB, DPR 2), Electron 42 / Chromium 148, unless marked otherwise. "Measured" means a run in this worktree; everything else is labelled.

> **Implemented (2026-11-05).** Fixes 1–5 are merged on `perf/canvas-integration`; measured sequentially, 1,000-node pan handler 166.9 → 1.2 ms, drag frame p95 585 → 17.8 ms, edit 282 → 45 ms, all-node selection 9.7 s → 1.0 s, and 5,000-node documents now pan, zoom and drag at 60 Hz. See [integration-results-2026-11-05.md](integration-results-2026-11-05.md).

## Documents

| File                                                   | Content                                                                                                                       | Author / validator                    |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| [x-threads-2026-11-04.md](x-threads-2026-11-04.md)     | The four X threads with replies (Jesse Vermeulen, Amichai Mantinband ×2, JuliaScript), captured from the logged-in T3 browser | lead                                  |
| [verynize-baseline.md](verynize-baseline.md)           | Current Verynize canvas in the real app, 100–2,000 nodes, CDP attribution                                                     | sol (gpt-6.1-sol) → reviewed by opus  |
| [renderer-options.md](renderer-options.md)             | Seven renderer strategies on identical scenes, 1K–100K nodes, fidelity diffs                                                  | opus (Opus 5.5) → reviewed by astra   |
| [figcraft.md](figcraft.md)                             | FigCraft (storytold/figcraft, ArtCraft) architecture and published numbers                                                    | astra (gpt-6-astra) → reviewed by sol |
| [fix-2-labels-selection.md](fix-2-labels-selection.md) | Fixes 2–3 implemented: keyed frame labels from geometry, indexed selection; before/after                                      | opus (Opus 5.5)                       |
| [reviews/](reviews/)                                   | Three adversarial cross-reviews                                                                                               | astra, sol, opus                      |

Validation done by the lead: every benchmark was rerun **sequentially on an idle machine** (the first runs overlapped). Baseline cells moved 1–7%, prototype headline cells 5–10%; no ranking changed. Raw files: `eval/canvas-perf/results/*-sequential*.json`. The lead also ran the `:has()` experiment below and built and benchmarked FigCraft locally.

## Answer in one paragraph

The X claim is right about **naive** DOM canvases (rewriting every node's style per camera change: 85 ms pan frames at 13K, 608 ms at 100K) and right that Verynize today misses 60 Hz at a few hundred layers. It is wrong about the cause for Verynize. **Verynize's slowness is not DOM rendering. It is five Tailwind `:has(:focus-visible)` rules that turn every DOM insert into a whole-workspace style recalculation, multiplied by a frame-label routine that inserts and measures once per frame.** Removing those five rules makes 1,000-node pan/zoom go from 166.7 ms to 16.7 ms per frame (measured). Beyond that, an optimized DOM renderer holds 13K–100K nodes with flat edit/drag cost and zero pixel difference, a tiled Canvas 2D layer wins zoom/overview, and a GPU renderer (PixiJS) did not beat either in these measurements while losing fidelity. FigCraft's speed (reproduced locally: 9.4 ms fit-all at 50K) comes from CPU raster + culling + retained pixels + damage + LOD; without LOD the same view costs 80 ms. Those techniques transfer; its renderer and non-CSS layout do not.

## Root cause: five `:has(:focus-visible)` rules

Hypothesis from [the opus review](reviews/opus-on-verynize-baseline.md): each forced style recalculation in `drawFrameLabels` restyles about 1.35 × N elements, so something makes any insert under `#workspace` invalidate the whole subtree. Test: `eval/canvas-perf/experiment-has.cjs` removes style rules at runtime through CSSOM (no product file changed), on the baseline fixture, 3 fresh app launches per cell, median.

| Nodes | Rules removed                | Pan handler ms | Pan frame ms | Zoom handler ms | Edit sync ms | Drag frame ms |
| ----: | ---------------------------- | -------------: | -----------: | --------------: | -----------: | ------------: |
|   500 | none (base)                  |           46.7 |         50.0 |            47.8 |         95.9 |         100.0 |
|   500 | 2 `#workspace:has(...)`      |           46.6 |         50.0 |            47.7 |         97.2 |         100.0 |
|   500 | **5 `:has(:focus-visible)`** |        **5.1** |     **16.7** |         **5.4** |     **63.6** |      **50.9** |
|   500 | all 24 `:has()`              |            3.5 |         16.7 |             3.8 |         57.7 |          50.0 |
| 1,000 | none (base)                  |          164.4 |        166.7 |           164.0 |        276.5 |         283.3 |
| 1,000 | 2 `#workspace:has(...)`      |          160.9 |        166.7 |           162.6 |        275.6 |         283.3 |
| 1,000 | **5 `:has(:focus-visible)`** |       **10.9** |     **16.7** |        **11.4** |    **146.1** |     **133.3** |
| 1,000 | all 24 `:has()`              |            6.8 |         16.7 |             7.2 |        137.7 |         116.7 |

Frame intervals are vsync-capped (16.7 ms = on time at 60 Hz); handler time is the uncapped main-thread cost. Raw: `eval/canvas-perf/results/experiment-has-2026-11-04.json`.

- The review's suspects, the two `#workspace:has()` rules, are **not** the cause (no change).
- The five `:has(:focus-visible)` rules account for **93% of pan cost at 1,000 nodes** (164.4 → 10.9 ms, 15×) and roughly half of edit and drag cost.
- They come from five Tailwind classes in islands: `group-has-focus-visible:flex` (`web/src/islands/sidebar/LayersSection.tsx:104`), `group-has-focus-visible/dir:` (`chat/attach-menu.tsx:245`), `group-has-focus-visible/chip:` and `has-focus-visible:opacity-100` (`chat/composer.tsx:238,240`), `has-focus-visible:ring-1 ring-ring` (`inspector/paints.tsx:504`).
- Mechanism (inferred, not traced with invalidation tracking): Chromium cannot scope `:has()` invalidation for a pseudo-class argument such as `:focus-visible`, so a mutation can affect any ancestor that might match; with `group-has-*` the subject is any descendant (`:where(.group):has(:focus-visible) *`). Bisecting showed that removing either the two `group-` rules or the three plain ones already removes most of the cost, so the interaction between them is not fully understood; removing all five is the measured fix.
- Candidate fix (not implemented here): replace them with `focus-within:` / `group-focus-within:` (different semantics: also on mouse focus), a JS-toggled class, or `:focus-visible` on the element itself. Add a lint rule that forbids `has-*focus*` variants in `web/src`.

## Measured gains, ranked by cost to implement

Gains at 1,000 nodes are measured in the real app unless noted. Gains at 13K/100K come from the prototypes, which are synthetic and exclude the app's selection, labels, panels and persistence.

| #   | Change                                                                                                       | Cost      | Measured / estimated gain                                                                                                                                                                                                                                                                                                          |
| --- | ------------------------------------------------------------------------------------------------------------ | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Remove the five `:has(:focus-visible)` Tailwind variants                                                     | Hours     | **Measured:** pan/zoom handler 164 → 11 ms (15×), edit 277 → 146 ms (1.9×), drag 283 → 133 ms at 1,000 nodes; 500 nodes reach 60 Hz pan                                                                                                                                                                                            |
| 2   | `drawFrameLabels`: keyed labels positioned from document geometry, no interleaved `getBoundingClientRect`    | Days      | _Estimated_ by opus from profiles: −150 ms pan, −160 ms edit at 1,000 before #1. After #1 the remaining label cost is unmeasured; rerun the baseline                                                                                                                                                                               |
| 3   | Selection: id/children maps, `topSelected` by ancestor walk                                                  | Days      | _Estimated:_ −5.9 s of the 9.6 s all-node selection at 1,000; 2,000-node selection currently exceeds 60 s (measured)                                                                                                                                                                                                               |
| 4   | No `render()` during live drag; keyed per-node patches instead of full rebuilds                              | 1–2 weeks | **Measured in prototypes** (A2 → B): edit 122 → 5.6 ms at 13K (22×), 1,561 → 8.2 ms at 100K; drag frames 147 → 2.3 ms at 13K                                                                                                                                                                                                       |
| 5   | Optimized DOM renderer (B): artboard culling, budgeted mounting, `contain: strict`, thumbnails below 8% zoom | Weeks     | **Measured in prototypes:** first frame 155 → 36 ms (13K), 959 → 57 ms (100K); pan p95 ≤ 5.5 ms to 100K; **0% pixel difference**. Weak spot: zoom at 100K (p95 62 ms)                                                                                                                                                              |
| 6   | Tile Canvas 2D layer for zoom/overview only (B + C)                                                          | Weeks     | _Estimated_ (B and C measured separately, never combined): zoom p95 near C's 10–14 ms vs B's 25–62 ms; costs 9–39% unrendered tiles while zooming and 0.8% pixel difference at overview                                                                                                                                            |
| 7   | GPU renderer (PixiJS 8.22 WebGL/WebGPU)                                                                      | Months    | **Not better in these measurements:** pan p95 3.8–28 ms, first frame 230–330 ms, JS heap 240 MB at 13K / 1.1 GB at 100K, 3.4% pixel difference (mixed text runs and backdrop blur lost). The review notes the prototype's thumbnail policy inflates its overview cost; a better Pixi build would do better by an unmeasured amount |

## The X claims, checked against Verynize

| Claim (thread)                                                                           | Verdict                                                                                                                                                                  | Evidence                                          |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------- |
| DOM canvas "falls apart past a few hundred layers" (Jesse)                               | **True for Verynize today, false as a DOM limit.** Verynize misses 60 Hz at 500 nodes, but 93% of that is five CSS rules. An optimized DOM pans 100K nodes at p95 5.5 ms | baseline; `:has()` experiment; renderer-options B |
| Cost is style recalc on every pan/zoom, not Chromium (Jesse)                             | **True**, with a precise cause: forced recalcs in `drawFrameLabels`, made whole-tree by `:has(:focus-visible)`                                                           | baseline CDP traces; experiment                   |
| Paper "struggles at 2-5K plain rectangles"; real files are 13K–100K+ (Amichai)           | Not testable on Paper. For DOM in general: naive DOM fails from 5K (pan p50 26 ms); optimized DOM does not at 100K                                                       | renderer-options A vs B                           |
| Slowness was UI reading 4,000 selected elements, not DOM rendering (Vlad Moroz, Paper)   | **True for Verynize too:** all-node selection at 1,000 takes 9.6 s, dominated by `descendants`/pairwise scans                                                            | baseline; opus review                             |
| Virtualise offscreen, proxies, caches (Shane, adircode, dt_sqr)                          | **True:** B's culling and thumbnails give flat first frame and edit cost from 1K to 100K                                                                                 | renderer-options B                                |
| Tile-based Canvas 2D with DOM text metrics (Whimsical)                                   | **Best zoom/overview numbers measured** (zoom p95 ≤ 14 ms to 100K), at the cost of incomplete tiles during zoom and reimplementing CSS painting                          | renderer-options C                                |
| Rust/WebGPU/WASM is "the only way" (Jesse, Amichai, MrCollison)                          | **Not supported here.** PixiJS GPU did not beat B or C; FigCraft, the open-source "fast" reference, renders on the **CPU** (tiny-skia) and uses the GPU only to present  | renderer-options D; figcraft.md                   |
| Agents generate better HTML/CSS; file format ≠ renderer (samlibo, notionsmith, Daafdaan) | Consistent with keeping HTML/CSS as Verynize's model and export; B keeps 0% pixel difference to export                                                                   | renderer-options fidelity audit                   |
| Keep DOM for text input, IME, accessibility (safelibra)                                  | Holds for every option measured: C/D/E need DOM overlays for editing and a parallel accessibility tree                                                                   | renderer-options capability table                 |

## FigCraft (ArtCraft) in one table

| Aspect                                        | Finding                                                                                                                                                                                                                                                                                                                                  |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Renderer                                      | CPU tiny-skia pixmaps, presented as a wgpu texture. Not a GPU vector renderer (read in code, confirmed by review)                                                                                                                                                                                                                        |
| Why it is fast                                | Retained viewport pixels shifted on pan, damage rectangles on edit (full redraw above 60% damage), effect-aware culling, LOD splats/bars when zoomed out, Rayon bands natively, latest-request render worker                                                                                                                             |
| Fidelity model                                | Own layout and text engine (HarfRust, skrifa), Figma-style auto layout. Not CSS; adopting it would drop HTML fidelity                                                                                                                                                                                                                    |
| Published numbers                             | ~8 ms full render at 50K layers with LOD; 7–15 ms at 10K; 0.2 ms one-layer re-render (upstream, October, hardware unspecified)                                                                                                                                                                                                           |
| Local measurement (lead, 5 processes, median) | **Upstream claim reproduced:** fit-all with LOD 9.4 ms at 50K, 16.0 ms at 100K. **Without LOD: 80 ms at 50K, 148 ms at 100K.** Full render at 100% 3–4 ms from 1K to 100K; retained pan ~1 ms; one-layer re-render 5.5 ms at 100K. CPU raster only, no presentation; own synthetic scene ([details](figcraft.md#local-measurement-lead)) |
| Transferable                                  | Changed-subtree invalidation, retained pixels with damage, coarse-then-refined zoom, latest-request scheduling, separate "stale / coarse / complete" reporting. These map onto B and C, not onto a GPU rewrite                                                                                                                           |

## Recommendation

1. **This week:** remove the five `:has(:focus-visible)` variants and add a lint guard. Rerun `bench-verynize.cjs` to get the new baseline; it is the cheapest gain found (15× pan at 1,000 nodes, measured).
2. **Next:** fix `drawFrameLabels` and selection maps (fixes 2–3), and stop calling `render()` during live drag.
3. **Then:** move the canvas to the optimized DOM renderer (B) behind `createRenderer({kind})`, measured against the criteria below.
4. **Only if zoom at 50K+ still misses budget:** build B + C (tiles for zoom and overview) and measure the handoff.
5. **Defer GPU.** Revisit only for in-scene shader effects at scale, or if a GPU prototype wins at matched visual quality, bounded memory and presented-frame latency.

The [revised migration plan](../canvas-renderer-migration-plan.md) follows this order. [ADR-001](adr-001-defer-gpu-renderer.md) records the GPU deferral and measurable revisit triggers; the [budget checker](../../eval/canvas-perf/README.md#budget-report) reports acceptance gaps without gating CI.

### Acceptance criteria to use from now on

At 1K, 13K and 100K nodes, on the M1: pan and zoom handler p95 under 8 ms; edit sync p95 under 16 ms; drag frame p95 under 16.7 ms; all-node selection under 500 ms at 2,000; time to fit-all fully drawn; share of visible area incomplete during zoom; pixel difference to export 0% at 100% zoom.

## Open questions and limits

- rAF intervals and the two-rAF fence are main-thread measures, not presented frames (astra review). Compositor/raster checkerboarding of DOM layers is not measured.
- The baseline fixture puts 5% of nodes at top level, so label cost grows with N²; real files with few artboards will be faster before the fixes and the gain from fix 2 smaller.
- The 100K speedups against A/A2 compare truncated runs (few intervals within the time budget); read them as orders of magnitude.
- B + C was never built together. FigCraft's numbers are for its own synthetic scene and its own renderer, not comparable 1:1 with HTML/CSS scenes.
- Safari/Firefox, Intel, Windows and 120 Hz displays were not tested.

## Reproduce

```sh
npm install && npm run build:ui
node eval/canvas-perf/bench-verynize.cjs --sizes 100,500,1000,2000 --runs 5 --no-profile
node eval/canvas-perf/experiment-has.cjs --sizes 500,1000 --runs 3
cd eval/canvas-perf/prototypes && npm install && cd ../../..
node eval/canvas-perf/bench-prototypes.cjs --sizes 13000,100000 --runs 5 --strategies A,A2,B,C,Dgpu
```

FigCraft: see [figcraft.md](figcraft.md#local-measurement-lead). Run benchmarks one at a time; concurrent runs on the same machine skew results.
