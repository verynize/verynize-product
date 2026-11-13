# Verynize canvas baseline

Run from this worktree with a graphical macOS session:

```sh
npm install
npm run build:ui
node eval/canvas-perf/bench-verynize.cjs --sizes 100,500,1000,2000,5000,13000,50000 --runs 5 --output eval/canvas-perf/results/verynize-2026-11-04.json
```

Optional `--ceiling-ms 60000` sets the per-operation wall-time limit; `--no-profile` skips the separate instrumented passes. A failure or ceiling stops larger sizes. JSON checkpoints after every repeat preserve partial results. Run sequentially when possible; CPU/RAM/load average are captured per repeat to expose host contention. The script closes its own app and deletes its temporary profiles; it never changes product code. No test manifest entry is needed: this is an opt-in experiment, not a regression test.

Added for fix 3 ([fix-3-incremental-renderer.md](../../docs/canvas-performance/fix-3-incremental-renderer.md)): `--skip selectAll` (comma list of render, edit, pan, zoom, drag, selectAll) leaves operations out, e.g. the all-node selection that stops runs at 2,000; `--strip-has` removes the five `:has(:focus-visible)` rules through CSSOM before loading (fix 1 simulated, as `experiment-has.cjs`); `--storage k=v[,k=v]` sets localStorage before loading (`verynize.canvas-render=full` = full rebuild on every render, `verynize.canvas-cull=off`); `--clip-boards` makes the top-level frames clip their content so they can be culled. `profile-edit.cjs <n> [--strip-has] [--full]`, `profile-drag.cjs <n> [moves]` and `commit-cost.cjs <sizes>` print CPU-profile breakdowns of edits and drags and the cost of each piece of a one-node commit. `profile-drag-scale.cjs --n <nodes> [--nodes-per-page k] [--node id] [--moves 60]` (above the schema caps, which it lifts for the run like `bench-node-cap.cjs`) traces a fixed number of drag moves and breaks steady moves, the slowest moves, pointerdown/up and the work between moves into trace events and sampled functions ([drag-scale-2026-11-06.md](../../docs/canvas-performance/drag-scale-2026-11-06.md)).

`bench-verynize.cjs` uses the same Playwright Electron launch and UI-ready helper as `tests/canvas.cjs`. Each repeat launches a new real application with a unique `--user-data-dir`, skips onboarding, enters the editor through `fileLibrary.showEditor`, and loads a document through `design.loadDocument`. The actual shared `web/document-core.js` validator is imported through its Node adapter before launch. The seeded scene has 10% frames (including nested frames), 65% rectangles, 20% text, and 5% embedded SVG images, fixed sizes, rounded corners, strokes, and free-positioned children. All nodes occupy one page; most are offscreen at 100% zoom. This is one fixture, not a proxy for all design documents.

Measurements:

- `load`, `render`, `edit`, `selectAll`: synchronous API time and time until a zero-delay task plus two rAF callbacks. The latter provides a paint opportunity and React update window, **not an exact first displayed pixel timestamp**. Load starts inside the renderer, excluding app startup and Playwright document serialization. `render()` is the production global function, called without changing the document. Edits change one rectangle's `color` through `updateNodes`, including validation, undo, save, subscriptions, and downstream UI.
- Pan and zoom dispatch cancellable bubbling WheelEvents to the production workspace handler, once per rAF for two seconds. Zoom sets `ctrlKey`. Drag dispatches pointer events through production node/gesture handlers. Input does not bypass canvas code; it excludes OS delivery/coalescing/hit-test overhead. Frame intervals include the first frame after starting. A long frame can overshoot two seconds. State before/after proves the gestures took effect. Motion starts at 100% with one selected rectangle; drag uses the fixture's original position and retains snapping/drop behavior.
- Select-all explicitly passes **every page node** to the public agent API. The keyboard command selects siblings within the current scope, so the two are different workloads. All-node selection includes ancestors and descendants and stresses selection chrome, inspector and layer expansion.
- Frame p50/p95 and percentage over 16.7ms are computed within each repeat, then their medians reported. Handler percentiles pool input-handler durations across repeats. Operation p50/p95 are across repeats (with five repeats, p95 is the maximum). Literal 16.7ms comparisons are sensitive to 60Hz timestamp rounding; inspect p95 and handler time before calling a 16.8ms interval a failure.
- Heap is CDP `Runtime.getHeapUsage().usedSize`; DOM nodes are `Memory.getDOMCounters().nodes`, including detached/retained objects. Connected element count is measured separately. No forced GC; undo and live drag history are part of the workload.
- Separate CDP Performance/Profiler/Tracing passes follow the last timed repeat at each size. They clear selection before profiling edit/pan/zoom, then select all. These profiles are **not** timing samples. `.json.gz` artifacts contain raw Chrome trace events and CPU profiles; JSON contains metric deltas, sampled self-time leaders, and trace event duration totals. Event totals overlap (nested scopes, multiple threads), so never sum them into a percentage pie. `Performance.ScriptDuration` excludes much code invoked by Runtime.evaluate, charged under `DevToolsCommandDuration`; use CPU samples and trace stacks too. Sample self time is sampled wall time, not an exact CPU accounting.

The baseline report lives at `docs/canvas-performance/verynize-baseline.md`. To add a detailed pass (including full render and drag) at the largest completed size, run after the baseline finishes:

```sh
node eval/canvas-perf/profile-verynize.cjs --output eval/canvas-perf/results/verynize-2026-11-04.json
```

This appends `supplementalProfiles` and writes separate `profile-detail-*` artifacts. It uses the same selection state as the timed gestures and enables additional compositor/GPU trace categories.

## Budget report

The advisory acceptance table is [budgets.json](budgets.json), sourced from the [research synthesis](../../docs/canvas-performance/README.md#acceptance-criteria-to-use-from-now-on). The [GPU deferral ADR](../../docs/canvas-performance/adr-001-defer-gpu-renderer.md) records the saved-baseline output and revisit thresholds.

```sh
node eval/canvas-perf/check-budgets.mjs eval/canvas-perf/results/verynize-2026-11-04-sequential.json
```

Pass a `bench-verynize.cjs` schemaVersion 1 JSON, not a prototype-results JSON. Budgets use strict `<` for latency and exact `= 0` for export diff. Each entry names the node count, metric path under `summary[n]`, unit, comparison and source. The checker reads existing summary percentiles without recomputing/rounding them for comparison. Missing, null, negative or non-finite values print FAIL, including sizes stopped by the harness ceiling. It never substitutes zero or prototype results for missing product measurements.

Fit-all and incomplete visible area have no numeric limits in the source; measured values print REPORT, missing values FAIL. They cannot be counted as numeric passes. The current baseline does not collect these or export fidelity. Future instrumented summaries may add `fitAll.fullyDrawnMs` (validated complete pixels after fit-all), `zoom.incompleteVisibleAreaPct` (0–100 area-weighted mean across the timed zoom trajectory, with separate blank/stale/coarse durations retained in raw data), and `fidelity.export100Pct` (percent differing pixels against matched export at 100%). These are extension paths, not claims that the current harness measures them. Do not map `paintFenceMs`, tile-count `incompleteFrac`, or painter-reference diffs onto those fields.

This is an opt-in report, **not a failing CI gate**: budget/missing-data failures exit 0; invalid JSON/schema or incorrect usage exits nonzero. See the ADR for presentation/completeness instrumentation still required. Run on the same idle M1 environment, sequentially; retain fresh raw artifacts and compare provenance before interpreting changes.
