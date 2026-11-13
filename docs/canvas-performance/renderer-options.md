# Canvas renderer options: measured on identical scenes (2026-11-04)

> **Validation status.** Reproduced by the lead on an idle machine (`results/prototypes-2026-11-04-sequential*.json`, within ~5–10% of every headline cell) and reviewed adversarially in [reviews/astra-on-renderer-options.md](reviews/astra-on-renderer-options.md). Read the review's corrections before using these numbers as a selection gate: rAF intervals are not presented frames; 100K speedups against A/A2 come from truncated runs (A zoom 10–12 intervals, A2 drag 3–4); D's overview cost reflects this prototype's thumbnail policy, not a GPU ceiling; and B+C was never built together.

Question: how much faster than a naive DOM canvas is each renderer strategy, and what HTML/CSS fidelity does each give up? Context: the X debate in [x-threads-2026-11-04.md](x-threads-2026-11-04.md) and the unimplemented PixiJS plan in [../canvas-renderer-migration-plan.md](../canvas-renderer-migration-plan.md).

Every number below is **measured** by `eval/canvas-perf/bench-prototypes.cjs` unless it is marked _estimated_. Raw runs: `eval/canvas-perf/results/prototypes-2026-11-04.json`. Fidelity PNGs and diffs: `eval/canvas-perf/results/fidelity/`.

## Setup

| Item          | Value                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Machine       | Apple M1, 8 cores, 8 GB RAM, Darwin 27.2, built-in display at DPR 2                                                                                                                                                                                                                                                                                                                                                                                  |
| Runtime       | Electron 42.11.18 / Chromium 148 (the app's version) via Playwright `_electron`; window 1440×900 CSS px                                                                                                                                                                                                                                                                                                                                              |
| Load          | Shared machine, other agents benchmarking at the same time: 1-min load average 2.2–16.4 at run start (median 3.8), free RAM down to 282 MB. Per-run values are in the JSON; treat ±20% differences as noise                                                                                                                                                                                                                                          |
| Runs          | Fresh Electron process per run, median of 5 runs per strategy and size                                                                                                                                                                                                                                                                                                                                                                               |
| Frame time    | Delta between consecutive `requestAnimationFrame` timestamps, **vsync and frame-rate cap disabled**, so a delta is the real cost of a frame instead of saturating at 16.7 ms. "% > 16.7 ms" = share of frames that would miss 60 Hz                                                                                                                                                                                                                  |
| Scenes        | `prototypes/scene.js`: deterministic, version-2-shaped nodes (flat `nodes[]` + `parentId`). Each artboard is exactly 100 nodes: nav, gradient hero with mixed-run title, image with shadow, translucent glass card (backdrop blur on every 4th artboard), 8 cards (radius, border, shadow, clipped image, text, tag, gradient avatar; layer blur on one card per 10 artboards) and a footer. 40% of nodes are text. N = 1K…100K → 10…1,000 artboards |
| Camera script | Start centred on the middle artboard at 50%. **Pan**: 60 frames, 24/12 px per frame. **Zoom**: 60 frames 50% → fit-all → 50% around the artboard. **Fit-all**: jump to whole-document zoom, time until fully drawn, then 40 pan frames. **Edit**: 10× change text + colour of one subtitle, time until the second rAF after the call. **Drag**: move one card (7 nodes) 40 frames                                                                    |
| Memory        | JS heap after `gc()`; renderer ("Tab") and GPU process working sets from `app.getAppMetrics()`; each strategy's own texture/tile estimate (_estimated_)                                                                                                                                                                                                                                                                                              |

### Strategies (all in `eval/canvas-perf/prototypes/`, no product code)

| Id       | Strategy                       | What it does                                                                                                                                                                                                                                                                                                                                                                                      |
| -------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A        | Naive DOM                      | Nested divs in screen space; every camera change rewrites every node's style (position, size, font size, radius, shadow). The pattern criticised on X                                                                                                                                                                                                                                             |
| A2       | **Current Verynize pattern**   | Emulates `web/canvas-interactions.js` + `web/app.js`: world-space divs, one container `transform`, `--iz` custom property written on every camera change, `will-change` only while panning, and **every edit and every drag move rebuilds the canvas DOM** (`render()` → `layerElement()` → `createElement` per node). The layers panel rebuild is not emulated, so the product is slower than A2 |
| B        | Optimized DOM                  | Container transform; artboards mounted only when near the viewport (grid index) and built within a 6 ms/frame budget; `contain: strict` per artboard; keyed per-node patches for edit/drag; `will-change` during any gesture (compositor scales the cached raster) and released 160 ms after; below 8% zoom each artboard is a Canvas 2D thumbnail                                                |
| C        | Tile-based Canvas 2D           | Whimsical-style: 512×512 device-px tiles per power-of-two zoom level, LRU cache (220 tiles), 8 ms/frame paint budget, missing tiles covered by a scaled tile from another level; CSS-like text layout with `measureText` (baseline/half-leading per CSS 2.1 §10.8); dragged node lifted out of the tiles and painted live; DOM overlay would handle text editing (not exercised)                  |
| D / Dgpu | PixiJS 8.22 WebGL / WebGPU     | Artboards built lazily (8 ms/frame) and culled with the grid; Graphics for shapes, cached pre-blurred shadow textures, stencil clip only where children touch a rounded edge, BitmapText (white atlas per weight, tinted), generated thumbnail textures below 8% zoom                                                                                                                             |
| E        | Hybrid (migration-plan design) | D's painter, but boxes and word positions come from a hidden DOM layout host (real CSS, built and measured per artboard on demand) and each text node is rasterised from DOM word boxes into a cached canvas texture                                                                                                                                                                              |

## Headline (measured, median of 5)

How to read this: frame deltas below 1 ms mean the main thread was idle. The frame was a compositor transform or a blit of cached tiles. rAF cannot see raster lag or checkerboarding in the DOM strategies, and **neither the 60 Hz pass nor the "incomplete content" column measures it**: A, A2 and B expose no completeness hook, so their incomplete share is _not measured_ (an earlier draft printed 0%; corrected after review). Speedups are p95 against **A (naive)** for camera work and against **A2 (current pattern)** for edits and drags, because A edits keyed elements and A2 does not.

### 13,000 nodes (130 artboards; Amichai's "early-stage canvas")

| Strategy           | First frame ms |      Pan p95 ms | Zoom p95 ms (% > 16.7) | Content incomplete while zooming |         Edit p50 ms |         Drag p95 ms | JS heap / renderer proc MB |
| ------------------ | -------------: | --------------: | ---------------------: | -------------------------------: | ------------------: | ------------------: | -------------------------: |
| A naive DOM        |            154 |            85.1 |           145.5 (100%) |                     not measured |                 7.0 |                 3.0 |                    7 / 406 |
| A2 current pattern |            155 |   4.8 (**18×**) |  30.6 (33%) (**4.8×**) |                     not measured |               122.4 |               146.6 |                    7 / 350 |
| B optimized DOM    |             36 |   2.4 (**35×**) |  25.5 (18%) (**5.7×**) |                     not measured | 5.6 (**22×** vs A2) | 2.3 (**64×** vs A2) |                   12 / 354 |
| C tile Canvas 2D   |             46 |  0.6 (**140×**) |    10.1 (0%) (**14×**) |                               9% |       3.8 (**32×**) |                 0.3 |                   12 / 242 |
| D Pixi WebGL       |            267 |   5.7 (**15×**) |  52.6 (28%) (**2.8×**) |                               8% |       5.8 (**21×**) |                 6.0 |                  237 / 504 |
| Dgpu Pixi WebGPU   |            232 |   3.8 (**22×**) |  48.5 (30%) (**3.0×**) |                               9% |       6.5 (**19×**) |                 2.0 |                  240 / 562 |
| E hybrid           |            202 | 15.0 (**5.7×**) |  79.0 (67%) (**1.8×**) |                              29% |       5.8 (**21×**) |                 6.3 |                  134 / 656 |

### 100,000 nodes (1,000 artboards)

| Strategy           | First frame ms |     Pan p95 ms |  Zoom p95 ms (% > 16.7) | Content incomplete while zooming |  Fit-all fully drawn ms |          Edit p50 ms |           Drag p95 ms | JS heap / renderer proc MB |
| ------------------ | -------------: | -------------: | ----------------------: | -------------------------------: | ----------------------: | -------------------: | --------------------: | -------------------------: |
| A naive DOM        |            928 |          608.4 |          1,184.8 (100%) |                     not measured |                   1,505 |                 35.3 |                  17.9 |                   30 / 894 |
| A2 current pattern |            959 | 22.6 (**27×**) | 341.5 (100%) (**3.5×**) |                     not measured |                     704 |                1,561 |                 2,274 |                   29 / 814 |
| B optimized DOM    |             57 | 5.5 (**111×**) |    62.0 (73%) (**19×**) |                     not measured |                   1,940 | 8.2 (**190×** vs A2) | 2.3 (**~990×** vs A2) |                 63 / 1,358 |
| C tile Canvas 2D   |             50 | 3.3 (**184×**) |     13.7 (2%) (**86×**) |                              39% |                     948 |       4.8 (**325×**) |                   0.7 |                   61 / 586 |
| D Pixi WebGL       |            329 | 22.4 (**27×**) |    65.0 (70%) (**18×**) |                              40% |                  12,439 |       7.8 (**200×**) |                   7.3 |              1,109 / 1,661 |
| Dgpu Pixi WebGPU   |            278 | 28.3 (**21×**) |    71.2 (78%) (**17×**) |                              40% |                  13,853 |       7.9 (**198×**) |                   3.5 |              1,118 / 1,803 |
| E hybrid           |            469 | 46.2 (**13×**) |    70.8 (85%) (**17×**) |                              51% | > 20,000 (not finished) |       24.2 (**65×**) |                  10.0 |                446 / 2,052 |

Main observations:

1. **The naive pattern does fall apart as claimed on X.** A misses 60 Hz on every pan frame from 5K nodes (p50 26 ms) and takes 547 ms per pan frame at 100K. Rewriting per-node styles on every camera change is what fails, as Jesse said.
2. **One container transform already removes most pan cost (A2).** Verynize's renderer pattern pans at p95 4.8 ms at 13K and 22.6 ms at 100K. What A2 cannot do is edit: edits and drags rebuild the DOM and grow linearly (122 ms at 13K, 1.6 s at 100K). Zoom re-rasters everything (p95 341 ms at 100K). The real app is much slower than A2 because of application work outside the renderer. [verynize-baseline.md](verynize-baseline.md) measures pan p50 167 ms and edit 280 ms at **1,000** nodes, dominated by `drawFrameLabels` forcing layout and by `render()`/`rows()` scans. A2 is the ceiling that fixing those paths can reach without changing the renderer (_estimated_: same DOM, minus the measured app overhead).
3. **Optimized DOM (B) is flat in N for open, edit and drag**: first frame 36 → 57 ms, edit 5.6 → 8.2 ms, drag p95 2.3 ms at 13K and 100K. The cost is the renderer process at 100K (1.36 GB, all built artboards kept) and zoom at ≥50K (p95 62 ms, 73% of frames over budget). Zooming out mounts and builds more artboards (6 ms/frame budget) and paints thumbnails; which part dominates was not profiled.
4. **Tile Canvas 2D (C) has the best camera numbers from 13K up and holds them to 100K** (zoom p95 ≤ 13.7 ms and pan p95 ≤ 3.7 ms at every size; at 1K–5K B is as fast or faster). It is also the cheapest in memory: the tile cache is capped at about 238 MB _estimated_, and the renderer process is 586 MB at 100K. It pays by showing scaled or blank tiles while zooming: 9% of tiles at 13K, 39% at 100K.
5. **PixiJS (D/Dgpu) was not faster than B or C for this content.** It redraws everything each frame: pan p50 2.8–7.2 ms even with nothing new to draw. First frame takes 230–330 ms (Pixi initialisation, including shader setup; not timed separately). The JS heap is large (240 MB at 13K, 1.1 GB at 100K) because every node becomes one or more display objects; the prototype also builds every board to make overview thumbnails (12–14 s at 100K). WebGPU beat WebGL on drag (p95 2.0 vs 6.0 ms at 13K) and pan p50, but not on zoom.
6. **The hybrid (E) has the best GPU fidelity but the worst scaling.** Measuring the hidden DOM layout host per artboard dominates. Edit p95 rises to 155–194 ms at 50K–100K, probably because forced layout touches a growing host document (not profiled). Fit-all takes 1.7 s at 13K and does not finish in 20 s at 100K. The renderer process reaches 2 GB.

### At 60 Hz (vsync on, measured, median of 3)

With vsync on, deltas sit at 16.7 ms when a frame is on time. A **dropped frame** is a delta above 25 ms (1.5 refresh intervals).

| Strategy           | Zoom p95 ms (dropped) 13K | Zoom p95 ms (dropped) 100K | Pan dropped 13K / 100K | Drag p95 ms 13K / 100K | Edit p50 ms 13K / 100K |
| ------------------ | ------------------------: | -------------------------: | ---------------------: | ---------------------: | ---------------------: |
| A2 current pattern |                35.2 (22%) |               316.7 (100%) |                0% / 0% |        150.1 / 2,266.6 |        126.3 / 1,561.1 |
| B optimized DOM    |                 32.1 (7%) |                 66.7 (60%) |                0% / 0% |            18.5 / 18.5 |            19.6 / 19.1 |
| C tile Canvas 2D   |                 18.7 (5%) |                 50.1 (25%) |                0% / 0% |            18.5 / 18.6 |            17.8 / 17.6 |
| Dgpu Pixi WebGPU   |                50.0 (22%) |                 66.7 (67%) |                0% / 5% |            17.3 / 18.6 |            17.2 / 17.6 |

At 60 Hz every strategy except A2 pans and drags without drops up to 100K (Dgpu drops 5% of pan frames at 100K). Edits land in the next frame (about 17–20 ms, the one-frame floor). Zoom separates the strategies: at 100K, C drops 25% of frames, B 60%, Dgpu 67% and A2 all of them.

### Plain Chrome check (measured, median of 3, 13K)

Chrome 156.0.8078.80 (Playwright `channel: chrome`, vsync off) gives the same ranking as Electron. Zoom p95: A2 50.2, B 29.1, C 11.8, Dgpu 70.0, E 71.0 ms. Edit p50: A2 114.5, B 4.5, C 4.2, Dgpu 5.9, E 6.8 ms. Drag p95: A2 139.2, B 1.4, C 0.6, Dgpu 1.7 ms. First frame: B 19, C 25, Dgpu 256 ms. Process memory is not available outside Electron. Safari and Firefox were not tested.

## Fidelity audit

One realistic screen: `PerfScene.fidelity()`, a 1200×780 dashboard with flex rows/columns, a mixed-run title (bold italic, colour, larger size), ligatures and emoji, a 3-stop gradient, layered shadows, a translucent border, backdrop blur over an image, and auto-height text. It is rendered at 100% zoom and compared with the DOM reference (A2, real CSS layout) over a 1300×880 CSS px clip at DPR 2. Strategies without a CSS layout engine (A, C, D) get boxes measured by the browser; E measures through its own layout host. PNGs and red-marked diffs (> 32/255) are in `eval/canvas-perf/results/fidelity/electron-<id>[-diff].png`.

| Strategy                | Pixels differing > 32/255 | > 8/255 | What differs (inspected)                                                                                                                         | What it loses in general                                                                                                                                                                                                                              |
| ----------------------- | ------------------------: | ------: | ------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A naive DOM             |                        0% |      0% | Nothing at 100%                                                                                                                                  | Nothing visual; positions must be precomputed (no flex in the scaled copy)                                                                                                                                                                            |
| B optimized DOM         |                        0% |      0% | Nothing                                                                                                                                          | Below 8% zoom artboards are Canvas 2D thumbnails (C's painter)                                                                                                                                                                                        |
| C tile Canvas 2D        |                     0.79% |   1.12% | One line wraps a word earlier (emoji fallback font width); emoji spacing. Runs, italics, gradients, shadows and backdrop blur match              | Every CSS feature has to be reimplemented: masks, blend modes, filters other than blur, letter-spacing, decorations, SVG and grid/flex (needs a layout engine or DOM measurement). Backdrop blur samples only its own tile (tile-edge seams possible) |
| D Pixi (WebGL = WebGPU) |                     3.36% |   5.32% | Mixed runs lost (one style per BitmapText); different line breaks; emoji drawn as a tinted monochrome glyph; no backdrop blur; text 1–2 px lower | Same re-implementation burden as C plus a GPU-specific one: no core backdrop-filter, `FillGradient` reverses ramps whose line has dx < 0 or dy < 0, and texture fills are forced to `repeat`. Both were worked around with canvas-drawn textures      |
| E hybrid                |                     0.63% |   2.18% | Backdrop blur missing; sub-pixel glyph AA. Line breaks and runs match the DOM                                                                    | Same CSS-feature burden as D for boxes; text matches the DOM because word positions come from it                                                                                                                                                      |

Not measured in pixels, but true for every non-DOM strategy (C, D, E):

| Capability                                  | DOM (A/A2/B)                          | Canvas/GPU (C/D/E)                                                                                  |
| ------------------------------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Live app previews (`<iframe>`)              | In the scene, clipped and transformed | Only as a DOM overlay over the canvas (Wonder's approach), with snapshot textures when inactive     |
| Text editing, IME, spellcheck, context menu | Native                                | Needs a DOM editor overlay with matching metrics (C/E keep them; D does not)                        |
| Accessibility tree                          | Native                                | Needs a parallel hidden DOM or ARIA tree                                                            |
| Export / MCP codec (HTML/Tailwind)          | WYSIWYG: the canvas is the export     | Output stays HTML; the 0.6–3.4% differences above are the gap between what users see and what ships |
| Shader nodes                                | Separate WebGL canvas per node        | C: drawn into tiles; D/E: in-scene filters (an advantage for GPU)                                   |

## Recommendation for Verynize

Keep the DOM as both renderer and source of truth. Fix the application paths first, then make the DOM renderer incremental. Add a tile-based Canvas 2D layer only for zooming and overview. Defer a GPU renderer: in these measurements it does not pay for its fidelity and memory costs.

| Phase                                       | Work                                                                                                                                                                                                                                                                                                      | Expected gain (basis)                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0. App paths (no renderer change)           | The fixes ranked in [verynize-baseline.md](verynize-baseline.md): keyed frame labels with batched geometry reads, id/children maps instead of `descendants`/`rows()` scans, live drag without `render()`                                                                                                  | The product reaches the A2 pattern: pan p95 1–5 ms at 1K–13K vs 183 ms measured today at 1K (_estimated_ from A2 measured)                                                                                                                                                                                                      |
| 1. Optimized DOM (B)                        | Keyed per-node patches instead of `render()` rebuilds; artboard culling with a grid index and budgeted mounting; `contain: strict` per artboard; selection chrome in a screen-space overlay instead of the inherited `--iz` variable; `will-change` during every camera gesture; thumbnails below 8% zoom | At 13K vs A2: edit 122 → 5.6 ms (22×), drag p95 147 → 2.3 ms (64×), first frame 155 → 36 ms (4.3×). At 100K: edit 190×, drag ~990×, first frame 17×, zoom p95 5.5×. **0% pixel difference** (measured)                                                                                                                          |
| 2. Tile layer for zoom and overview (B + C) | While a zoom gesture runs, and below about 25% zoom, show C's tiles and hide the DOM; return to DOM when settled at detail zoom. Text editing and iframes stay DOM                                                                                                                                        | Zoom p95 near C's 10–14 ms instead of B's 25–62 ms at 13K–100K; at 60 Hz, 5% / 25% dropped zoom frames instead of 7% / 60% at 13K / 100K (_estimated_: C and B were measured separately, the combination was not built). Costs C's incomplete tiles during zoom (9–39% measured) and C's 0.8% difference at overview scale only |
| 3. GPU (deferred)                           | Revisit only for in-scene shader effects at scale, more than about 100K _visible_ layers, or if Phase 2 cannot hold zoom budgets                                                                                                                                                                          | None shown here: Pixi was slower than B/C at camera work and used 4–20× more JS heap                                                                                                                                                                                                                                            |

### What `docs/canvas-renderer-migration-plan.md` should change

1. **Put performance first, not in Phase 5.** Culling, keyed updates and LOD (its Phase 5) deliver the measured gains on the current DOM. Add Phases 0–1 above before any model or renderer migration.
2. **Revise "PixiJS dipilih".** The stated reason was scale. On M1/Electron 42, B and C match or beat PixiJS 8.22 at 13K–100K (tables above) without its 3.4% fidelity loss. Keep `createRenderer({kind})`, but make DOM the default and Canvas 2D tiles the second renderer.
3. **The exit criterion "10k node ≥ 55 fps pan" is already met by B (13K pan p95 2.4 ms) and by A2's pattern.** Replace it with criteria that failed here: zoom p95, edit p95, drag p95, fit-all time to fully drawn, and incomplete-tile share, each at 13K and 100K.
4. **LayoutHost needs a budget, not live per-view measurement.** E shows that measuring per artboard on demand costs 1.7 s (13K) to > 20 s (100K) at fit-all, and up to 194 ms p95 per edit. Persist a layout snapshot (boxes and line boxes) per revision, re-measure only the dirty subtree, and never measure for overview (draw cached thumbnails).
5. **Text: BitmapText cannot represent `textRuns`.** Use DOM word boxes (E, 0.63% difference) or C's CSS-like layout (0.79%). Plan zoom-bucket re-rasterisation.
6. **Record the PixiJS 8.22 pitfalls found here:** `FillGradient` direction flip, texture fills forced to `repeat`, no backdrop-filter in core (pixi-filters or a custom filter needed), and `DOMContainer` still experimental.

## Limits

- One machine (M1, 8 GB, DPR 2), shared with other benchmarks; Electron only for the main matrix (Chrome check below). Not tested on Intel/Windows, external high-refresh displays, or Safari/Firefox (Whimsical's caveat for Canvas 2D).
- Synthetic, artboard-structured scenes: culling works per artboard. A single huge frame with 100K children would cull worse for B, C and D.
- The prototypes are about 1,000 lines (1,400 with driver and runner) and not product-grade. D's memory and overview time reflect my eviction and thumbnail policy (all boards built to make thumbnails). A smarter Pixi implementation would do better, by an unknown amount (not measured). C has no worker or OffscreenCanvas threading, which would help it further.
- rAF deltas measure main-thread frame production. Raster/GPU time on other threads shows up only when it back-pressures the pipeline. Checkerboarding of DOM layers is not measured.
- Hit-testing, selection chrome, snapping and the layers panel are excluded from all strategies. In the app they are the dominant costs today ([verynize-baseline.md](verynize-baseline.md)).

## Reproduce

```sh
cd eval/canvas-perf/prototypes && npm install && cd ../../..   # pixi.js 8.22.0, harness only
node eval/canvas-perf/bench-prototypes.cjs --fidelity --sizes 1000,5000,13000,50000,100000 --runs 5
node eval/canvas-perf/bench-prototypes.cjs --vsync --sizes 13000,100000 --runs 3 --strategies A2,B,C,Dgpu
node eval/canvas-perf/bench-prototypes.cjs --browser chrome --sizes 13000 --runs 3 --strategies A2,B,C,Dgpu,E
node eval/canvas-perf/bench-prototypes.cjs --report        # markdown tables below
```

Flags: `--sizes`, `--runs`, `--strategies A,A2,B,C,D,Dgpu,E`, `--browser electron|chrome`, `--budget <ms per phase>`, `--vsync`, `--fidelity`, `--no-perf`, `--out`. Results merge by `browser/strategy/size`, so a subset can be rerun alone. The full Electron matrix took about 35 minutes of run time, launches included (plan for about an hour).

## Appendix: all sizes, Electron, vsync off (measured, median of 5)

`*` = phase hit the 15 s budget before 60 frames (fewer frames measured). `†` = not fully drawn within 20 s.

#### time to first frame, ms

| Strategy | 1,000 | 5,000 | 13,000 | 50,000 | 100,000 |
| -------- | ----: | ----: | -----: | -----: | ------: |
| A        |    32 |    82 |    154 |    483 |     928 |
| A2       |    19 |    82 |    155 |    505 |     959 |
| B        |    32 |    38 |     36 |     42 |      57 |
| C        |    48 |    54 |     46 |     47 |      50 |
| D        |   256 |   298 |    267 |    260 |     329 |
| Dgpu     |   214 |   269 |    232 |    238 |     278 |
| E        |   167 |   253 |    202 |    227 |     469 |

#### pan frame ms p50 / p95 (% > 16.7 ms)

| Strategy |           1,000 |              5,000 |             13,000 |                50,000 |               100,000 |
| -------- | --------------: | -----------------: | -----------------: | --------------------: | --------------------: |
| A        |  6.9 / 8.4 (0%) | 26.1 / 29.8 (100%) | 68.5 / 85.1 (100%) | 263.0 / 288.2 (100%)* | 546.8 / 608.4 (100%)* |
| A2       |  0.3 / 1.0 (0%) |     1.2 / 5.6 (0%) |     1.4 / 4.8 (0%) |       2.0 / 10.7 (0%) |       4.0 / 22.6 (8%) |
| B        |  0.2 / 0.9 (0%) |     0.9 / 4.2 (2%) |     0.5 / 2.4 (0%) |        0.3 / 1.7 (0%) |        1.4 / 5.5 (0%) |
| C        |  0.2 / 2.6 (0%) |     0.2 / 3.7 (0%) |     0.2 / 0.6 (0%) |        0.2 / 0.5 (0%) |        0.2 / 3.3 (0%) |
| D        |  4.9 / 7.6 (2%) |     5.4 / 7.2 (3%) |     3.8 / 5.7 (2%) |        4.0 / 5.5 (0%) |       7.2 / 22.4 (7%) |
| Dgpu     |  2.8 / 3.6 (2%) |     4.0 / 8.1 (3%) |     2.9 / 3.8 (0%) |        2.8 / 4.0 (0%) |       5.4 / 28.3 (8%) |
| E        | 4.1 / 16.9 (7%) |   5.9 / 33.4 (20%) |    4.4 / 15.0 (5%) |       4.1 / 10.8 (3%) |      8.2 / 46.2 (35%) |

#### zoom frame ms p50 / p95 (% > 16.7 ms)

| Strategy |            1,000 |              5,000 |               13,000 |                50,000 |                100,000 |
| -------- | ---------------: | -----------------: | -------------------: | --------------------: | ---------------------: |
| A        | 12.8 / 15.8 (3%) | 47.7 / 59.5 (100%) | 123.1 / 145.5 (100%) | 456.1 / 556.1 (100%)* | 997.6 / 1184.8 (100%)* |
| A2       |  5.3 / 15.0 (0%) |   7.2 / 20.6 (23%) |    13.7 / 30.6 (33%) |    33.3 / 143.3 (98%) |    75.6 / 341.5 (100%) |
| B        |   0.5 / 1.7 (0%) |     3.3 / 6.4 (2%) |     6.7 / 25.5 (18%) |     15.4 / 35.6 (47%) |      30.5 / 62.0 (73%) |
| C        |   0.3 / 7.8 (0%) |    0.3 / 10.1 (0%) |      0.9 / 10.1 (0%) |       8.5 / 12.4 (0%) |        8.8 / 13.7 (2%) |
| D        |  5.1 / 15.8 (5%) |    8.1 / 31.6 (8%) |    10.2 / 52.6 (28%) |     10.3 / 46.0 (27%) |      36.2 / 65.0 (70%) |
| Dgpu     |   2.7 / 4.2 (0%) |    8.4 / 27.4 (7%) |     7.1 / 48.5 (30%) |     11.9 / 49.7 (27%) |      39.5 / 71.2 (78%) |
| E        |  2.0 / 16.2 (5%) |   7.8 / 46.6 (25%) |    26.4 / 79.0 (67%) |     27.9 / 53.0 (78%) |      38.8 / 70.8 (85%) |

#### fit-all: time to fully drawn ms; pan p50 / p95

| Strategy |          1,000 |           5,000 |             13,000 |              50,000 |                100,000 |
| -------- | -------------: | --------------: | -----------------: | ------------------: | ---------------------: |
| A        | 35; 9.6 / 10.2 | 54; 39.4 / 57.7 | 141; 114.2 / 130.4 | 633; 486.4 / 571.8* | 1505; 1366.3 / 2187.0* |
| A2       |  28; 0.4 / 1.0 |   37; 1.5 / 4.4 |     56; 3.2 / 11.3 |    213; 45.6 / 52.9 |      704; 91.9 / 114.7 |
| B        |  30; 0.4 / 1.1 |   38; 1.2 / 4.8 |     109; 1.2 / 1.6 |     575; 8.8 / 13.5 |      1940; 33.3 / 37.8 |
| C        |  24; 0.2 / 0.4 |   34; 0.2 / 0.4 |      77; 0.2 / 0.3 |      329; 0.1 / 0.2 |         948; 0.2 / 0.5 |
| D        | 24; 8.7 / 11.1 | 41; 11.8 / 13.6 |     303; 0.2 / 0.3 |    2351; 1.7 / 16.9 |      12439; 4.0 / 39.7 |
| Dgpu     |  22; 2.8 / 3.4 | 37; 12.5 / 13.3 |     260; 0.3 / 0.4 |    1848; 1.7 / 14.1 |      13853; 3.7 / 21.2 |
| E        | 22; 8.9 / 10.9 | 32; 12.5 / 14.3 |    1720; 0.3 / 1.0 |    18807; 3.6 / 9.4 |  20031†; 107.3 / 288.8 |

#### incomplete-content share while panning / zooming (tiles or boards not yet drawn)

| Strategy |        1,000 |        5,000 |       13,000 |       50,000 |      100,000 |
| -------- | -----------: | -----------: | -----------: | -----------: | -----------: |
| A        | not measured | not measured | not measured | not measured | not measured |
| A2       | not measured | not measured | not measured | not measured | not measured |
| B        | not measured | not measured | not measured | not measured | not measured |
| C        |      0% / 4% |      0% / 8% |      0% / 9% |     0% / 20% |     0% / 39% |
| D        |      0% / 0% |      0% / 0% |      0% / 8% |     0% / 25% |     1% / 40% |
| Dgpu     |      0% / 0% |      0% / 0% |      0% / 9% |     0% / 25% |     0% / 40% |
| E        |      0% / 0% |      1% / 2% |     0% / 29% |     0% / 46% |     4% / 51% |

#### single-node edit latency ms p50 / p95

| Strategy |       1,000 |       5,000 |        13,000 |        50,000 |         100,000 |
| -------- | ----------: | ----------: | ------------: | ------------: | --------------: |
| A        |  7.2 / 18.8 |  6.4 / 12.1 |    7.0 / 10.7 |   29.4 / 33.3 |     35.3 / 72.7 |
| A2       | 11.4 / 29.6 | 48.3 / 53.3 | 122.4 / 150.1 | 573.8 / 658.0 | 1561.4 / 2215.1 |
| B        |  6.2 / 19.4 |  6.6 / 20.1 |     5.6 / 8.5 |    6.6 / 11.5 |      8.2 / 13.6 |
| C        |  4.4 / 19.9 |  4.7 / 20.0 |    3.8 / 19.1 |    4.9 / 18.6 |      4.8 / 21.3 |
| D        |  8.3 / 23.5 | 12.6 / 25.7 |    5.8 / 21.3 |     7.1 / 8.7 |      7.8 / 23.0 |
| Dgpu     |  8.7 / 22.4 | 12.7 / 25.3 |    6.5 / 33.5 |    8.6 / 20.6 |      7.9 / 18.7 |
| E        |  6.4 / 22.8 |  8.3 / 23.6 |    5.8 / 20.7 |  23.1 / 155.5 |    24.2 / 194.3 |

#### drag one card: frame ms p50 / p95

| Strategy |      1,000 |       5,000 |        13,000 |         50,000 |          100,000 |
| -------- | ---------: | ----------: | ------------: | -------------: | ---------------: |
| A        |  1.0 / 1.6 |   1.9 / 3.1 |     1.9 / 3.0 |    12.0 / 12.7 |      16.2 / 17.9 |
| A2       | 9.9 / 12.5 | 45.8 / 53.6 | 128.9 / 146.6 | 617.5 / 682.1* | 1802.9 / 2274.0* |
| B        |  0.9 / 1.7 |   1.2 / 1.8 |     1.5 / 2.3 |      1.7 / 2.8 |        1.4 / 2.3 |
| C        |  0.3 / 0.4 |   0.3 / 0.4 |     0.2 / 0.3 |      0.2 / 0.3 |        0.5 / 0.7 |
| D        |  4.8 / 6.5 |   5.2 / 6.2 |     4.0 / 6.0 |      4.5 / 6.0 |        6.0 / 7.3 |
| Dgpu     |  1.0 / 1.6 |   2.7 / 4.1 |     1.5 / 2.0 |      2.1 / 2.6 |        2.8 / 3.5 |
| E        |  0.7 / 5.8 |   5.2 / 7.4 |     4.1 / 6.3 |      4.3 / 7.7 |       7.1 / 10.0 |

#### memory: JS heap MB / renderer process MB / GPU process MB / own GPU estimate MB

| Strategy |               1,000 |                5,000 |                13,000 |                 50,000 |                 100,000 |
| -------- | ------------------: | -------------------: | --------------------: | ---------------------: | ----------------------: |
| A        |   4 / 230 / 121 / – |    5 / 295 / 129 / – |     7 / 406 / 132 / – |     17 / 764 / 233 / – |      30 / 894 / 215 / – |
| A2       |   4 / 173 / 119 / – |    5 / 231 / 136 / – |     7 / 350 / 131 / – |      17 / 602 / 83 / – |       29 / 814 / 80 / – |
| B        |   5 / 153 / 128 / 0 |    6 / 174 / 130 / 0 |   12 / 354 / 120 / 22 |    33 / 746 / 125 / 84 |   63 / 1358 / 132 / 169 |
| C        | 5 / 162 / 141 / 198 |  7 / 227 / 178 / 238 |  12 / 242 / 218 / 238 |   33 / 383 / 236 / 238 |    61 / 586 / 243 / 238 |
| D        | 23 / 263 / 112 / 63 |  85 / 369 / 145 / 71 |  237 / 504 / 184 / 94 | 669 / 1049 / 163 / 156 | 1109 / 1661 / 133 / 240 |
| Dgpu     | 23 / 266 / 123 / 63 |  86 / 402 / 142 / 71 |  240 / 562 / 182 / 94 | 626 / 1052 / 166 / 156 | 1118 / 1803 / 197 / 240 |
| E        | 15 / 192 / 138 / 79 | 53 / 389 / 189 / 145 | 134 / 656 / 203 / 282 | 396 / 1779 / 150 / 878 |  446 / 2052 / 209 / 974 |
