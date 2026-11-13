# Fix 4: experimental Canvas 2D overview tiles

> Historical measurement. The node-cap follow-up and current decision are in [node-cap-2026-11-06.md](node-cap-2026-11-06.md).

**Recommendation: keep OFF.** This branch is stacked on research PR #12 (`docs/perf-research`), without parallel fixes 1–3. It does not establish that optimized DOM zoom needs tiles. The product's 10,000-node document limit also prevents the requested 13K/50K real-app decision gate on this base. Do not bypass document validation to claim a large-document measurement.

## Activation and integration

In the renderer console, set `localStorage.setItem('verynize.canvasTiles', '1')` and reload. Remove that key (or set `0`) and reload to disable. OFF installs no subscriptions, event listeners, cache, style or DOM; the only camera integration is one optional `window.canvasTiles?.camera(cam)` call in `applyCamera`. The independent classic-script module loads immediately after `app.js`.

At <=25% zoom, a zoom change activates a pointer-transparent Canvas 2D overlay. Top-level DOM layers become transparent but retain hit testing and accessibility. Selection/frame chrome is untouched. A nonempty selection uses DOM for the whole page, preserving the existing per-layer CSS selection outlines as well as overlay handles. The DOM returns immediately at detail zoom and after a 220ms settling delay at overview (allowing refinement, with a two-second gesture-age safety bound). Editing contenteditable text stops the overlay; pages with live iframes stay DOM. Unsupported transforms, shader/gradient/complex paints, mixed text runs, masks, filters and legacy CSS shadows conservatively stay DOM. This is a navigation approximation, not export rendering.

The implementation is original product code, not copied from FigCraft or the prototype. It uses:

- 512×512 device-pixel tile interiors at power-of-two raster scales, two-pixel gutters cropped during presentation, and a 96-entry LRU (about 98 MiB maximum backing pixels, excluding the viewport surface).
- A four-millisecond paint budget, resumable within a tile between nodes. One expensive primitive, allocation, scene snapshot, browser layout, or camera work outside this module can exceed that budget. Pending tiles are not reported as exact.
- Complete coarser ancestor tiles as scaled fallbacks; a partially covered fallback never counts as coverage. Visible coverage is measured by clipped world-area intersection, not tile counts. `blank + scaled + exact = 1`; `exact` means current-level LOD paint, **not CSS pixel equivalence**.
- Public document subscriptions, old/new node bounds damage at every cached scale, inherited clip/opacity changes, reorder/page/token invalidation, and browser auto-layout bounds read once per document notification. Fixed free-layout geometry comes from the document. There are no `render`, `updateNodes`, drag, label, selection or Tailwind changes.
- Rounded fills/borders, simplified structured shadows, cached images downscaled to at most 512px (64 entries), measured word wrapping, and bars for text smaller than four raster pixels. Fonts/image completion invalidate cached pixels. Readiness includes image loading. Complex unsupported pages fall back to DOM; supported text still approximates CSS whitespace and shaping and clips overview ink to its node box.

`window.canvasTiles.stats()` exposes active state, revision, invalidated tile count, backing pixel bytes, coverage fractions and refinement latency from the latest changed camera to the first completely painted viewport. Coverage after DOM handoff describes the last tile frame; it is not a measurement of Chromium's DOM raster completeness. A viewport requiring more than the cache capacity falls back to DOM instead of endlessly evicting visible tiles.

## Measurement method

Run `node eval/canvas-perf/bench-tiles.cjs --output eval/canvas-perf/results/fix-4-tiles.json`. Optional `--sizes 1000` reruns a subset. Each cell gets a new Electron profile and toggles the flag before reload. It uses the baseline synthetic fixture and production public document/camera APIs. The same 24-camera trajectory crosses 24% → 8% → detailward overview, one checkpoint per rAF. This measures camera handler time, not OS wheel delivery. Each load/trajectory has a 60-second ceiling. Incomplete trajectories are reported as errors, never as comparable percentiles.

Samples contain load time, handler p50/p95, rAF intervals >16.7ms, per-callback coverage and final refinement latency, CPU, free memory and load averages. rAF is main-thread scheduling, not compositor presentation. DOM coverage is unmeasured. No fixes 1–3 are simulated through CSSOM or monkey-patching. Concurrent agents and the full test suite were active: these results need an idle, sequential rerun by the lead.

## Results

The initial sweep is in `eval/canvas-perf/results/fix-4-tiles.json`. Its first OFF cell failed during Electron installation; the 1K pair was rerun in fresh profiles. The already-installed exact pinned Electron 42.11.18 runtime was copied into this worktree after the network installer stalled. No dependency or lockfile was changed.

|  Nodes | OFF                                                   | ON                                         |
| -----: | ----------------------------------------------------- | ------------------------------------------ |
|  1,000 | Fresh paired run recorded separately below            | Fresh paired run recorded separately below |
|  5,000 | Loaded in 13,752.9ms; 24-checkpoint zoom exceeded 60s | Loaded in 12,964.4ms; zoom exceeded 60s    |
| 13,000 | Rejected: Maximum 10000 nodes                         | Rejected: Maximum 10000 nodes              |
| 50,000 | Rejected: Maximum 10000 nodes                         | Rejected: Maximum 10000 nodes              |

The incomplete 5K trajectories cannot supply trustworthy full-path p50/p95 or refinement values. The 13K/50K cells have no rendering measurements. Load averages during the sweep rose above 30; this is substantial contention on the eight-core M1.

Final instrumented 1K pair: `eval/canvas-perf/results/fix-4-tiles-1k-final.json` (one fresh run per flag, 24 handler samples each):

| Flag | Load ms | Handler p50 / p95 ms | rAF >16.7ms | Mean blank / scaled / exact | Last-view fully refined ms |
| ---- | ------: | -------------------: | ----------: | --------------------------- | -------------------------: |
| OFF  |   538.6 |        340.5 / 433.3 |        100% | unmeasured                  |                 unmeasured |
| ON   |   644.8 |        343.4 / 403.9 |        100% | 24.25% / 0% / 75.75%        |                      376.6 |

ON eventually reached 100% exact coverage with 36 tiles / 38.3 MB of backing pixels. The 17.9ms post-loop settling time is **not** its refinement latency: much of refinement latency is spent inside the synchronous camera handler before the final rAF. The final `refinedMs` measures from the last camera change. Mean coverage samples the prior rendered viewport before requesting the next camera; initial cold coverage is included. No scaled fallback was observed in this trajectory, so this run does not measure its benefit. The 1-minute load averages were 27.3 OFF and 25.0 ON. The apparent p95 difference is not an established speedup under this load; p50 is effectively unchanged and every interval misses budget.

An earlier paired run (`fix-4-tiles-1k.json`) also found no meaningful gain (p95 423.5ms OFF / 426.0ms ON). Its `refinedMs` used gesture-start semantics; use the final instrumented file for last-view refinement. The original sweep and this earlier file are retained for auditability, not pooled into the final statistics.

## Enablement gate after integration

First rerun fixes 1–3 with this flag OFF, sequentially on an idle machine, after the large-document limit is addressed by its owner. If 50K+ zoom meets handler p95 <8ms and acceptable rAF scheduling, leave tiles off. Otherwise compare identical completed trajectories ON/OFF at 1K, 5K, 13K and 50K+, with repeated fresh profiles, memory, coverage and handoff measurements. An ON win must improve zoom latency while meeting an explicit product completeness target (proposed: zero blank coverage after warm-up, >=95% exact during zoom, fully refined within 100ms after the last camera change), and pass expanded mixed-scene pixel/accessibility tests. The present results meet none of the evidence needed to enable by default.

## Validation

`tests/canvas-tiles.cjs`, registered in the test manifest, uses real Electron. It covers flag OFF, tile activation, overview and detail DOM handoff, local damage preserving unrelated tiles, and an overview screenshot comparison with rectangles, a frame, auto-layout, opacity, text and an embedded image. The gate is <2% of viewport pixels differing by >24/255 in any RGB channel; the latest run was 0.161%. This small fixture does not establish arbitrary CSS fidelity. Artifacts: [tiles](../../eval/canvas-perf/results/fix-4/tiles.png), [DOM](../../eval/canvas-perf/results/fix-4/dom.png).

- PASS: `npm run build:ui`, `npm run lint` (existing warnings), `npm run lint:ui`, `npm run typecheck:ui`, `npm run check`, `node tests/canvas.cjs` and `node tests/canvas-tiles.cjs`.
- `npm run test:changed` selected the full suite because the manifest changed: **205 passed, 5 failed, 0 skipped**, 1155.7 seconds. The new tile test passed in that run. Known flaky onboarding/capture/MCP/preview tests passed in this run.
- Isolated retries passed: `tests/dev-server.cjs` (temporary `hang.pid` missing initially), `tests/chatgpt-auth.cjs` (temporary directory cleanup race), `tests/share-collab.mjs` (initial Electron install failure), and `tests/inspector-variable-library.cjs` (clipboard contents overwritten during concurrent tests).
- Remaining failure: `tests/web-cloudflare.mjs`. Initial run timed out; retry passed its Cloudflare dev assertions but failed in preview room-link navigation with `page.goto: net::ERR_ABORTED` at `checkLinks` line 504. WebKit was unavailable and its link checks were skipped by that test. No assertions or unrelated application code were changed to suppress these failures.

The full suite is not claimed green. Feature-specific validation passes; the unrelated web navigation failure and high-contention benchmark results remain explicit integration limitations.
