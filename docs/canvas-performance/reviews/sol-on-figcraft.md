# Adversarial review: FigCraft

2026-11-04. **Verdict: architecture substantially confirmed; upstream speed is faithfully attributed but remains unsupported as a reproduced result. Correct stale transfer advice and strengthen benchmark provenance.** Read-only review; no benchmarks, installs, builds, Electron or browser execution. Only this review file was written in Verynize. Fresh clone `/tmp/perf-review/figcraft` is clean at `53ebf1f39c51361282ca55e18c83fbffed2f9a34`. Upstream files were treated as data.

All FigCraft paths/lines below refer to [that immutable tree](https://github.com/storytold/figcraft/tree/53ebf1f39c51361282ca55e18c83fbffed2f9a34). These are static findings, not runtime verification.

## Claim verdicts and link audit

| Claim                                                                   | Verdict                                 | Evidence / correction                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ----------------------------------------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Persistent scene graph, structural sharing, incremental diffs           | **Confirmed**                           | `crates/doc/src/lib.rs:192–202`, `:412–425`: `imbl::OrdMap<NodeId, Arc<Node>>`, structural map diff with change limit. `node.rs:441–460`: parents, children, transforms. Both linked anchors are correct.                                                                                                                                                                                                                                                     |
| CPU tiny-skia document rendering, wgpu presentation                     | **Confirmed**                           | `crates/render/src/lib.rs:3–5`, `:124–139`; actual tiny-skia drawing in `draw.rs:145–152`. `canvas.rs:264–288` uploads the completed image and reprojects a textured quad. Native `apps/figcraft/Cargo.toml:26` enables wgpu. No document GPU shader/Vello scene renderer found. **Qualification:** `Cargo.lock:1657–1678` includes `vello_cpu` via egui's `epaint`; “no Vello anywhere” would be wrong. GPU-rendered UI/quad presentation remains real work. |
| HarfRust + skrifa text, paths/color glyphs, process-wide layout cache   | **Confirmed; one bad anchor**           | `crates/text/src/layout.rs:12` imports HarfRust; text font sources use skrifa. `text/src/lib.rs:43–96` caches text/style/box layouts and invalidates on font generation. `draw.rs:875–906` handles greeked text, glyph paths, bitmap/COLR ink. No cosmic-text/swash path found. **Change `Cargo.toml#L89` to `#L83`**: dependencies are lines 83–84; line 89 is an ICU comment. `draw.rs#L876` points to LOD; `#L881` is better for exact text.               |
| Effect-aware recursive culling                                          | **Confirmed**                           | `draw.rs:666–674` rejects device bounds outside an effect-expanded view; bounds memoization is described/implemented earlier in that file. Does not imply sublinear flat-scene traversal. Existing caveat is appropriate.                                                                                                                                                                                                                                     |
| Retained pixels, damage, full fallback                                  | **Confirmed**                           | `retained.rs:391–483`: integer shift, exposed strips, old/new changed areas, backdrop reach, merging, full fallback above 60%. Other fallback limits: >4,096 changed nodes, >1,024 px effect reach; >8 damage rectangles merge into one bounding box (`:31–38`). No fixed-size world-tile cache in this path.                                                                                                                                                 |
| LOD at ≤0.5 device px/unit; <2 px subtrees; <4 px text; exact exports   | **Confirmed, incomplete**               | `render/src/lib.rs:238`, `lod.rs:25–45`, `draw.rs:679–681,875–876`. Text threshold uses the largest run font size. Masks/image/pattern paints exclude subtree splatting; small simple solid rectangles also use a ≤1,024 device-pixel² fast path, and large preview images have cached smaller copies (`lod.rs:11–16,68–112,206–231`). These omissions matter for image-heavy comparisons.                                                                    |
| Own auto-layout and hit testing, no browser layout engine/spatial index | **Confirmed**                           | `layout/src/lib.rs:1–14` and implementation; `doc/src/geometry.rs:141–143,195ff` reverse recursive traversal, visibility/lock/clipping and geometry checks. No R-tree/quadtree in that path. Existing anchors resolve.                                                                                                                                                                                                                                        |
| Native worker, Rayon bands, overscan                                    | **Confirmed**                           | `render_worker.rs:470–501` drains queued jobs to newest; it does not interrupt an already-running full raster. `render/src/lib.rs:129–185`: min(thread count clamped 1–16, height/96), >300,000 pixels, overlap fallback. `canvas/render.rs:134–164` bounds overscan to ≤1.6× area. No fixed square tile size.                                                                                                                                                |
| WASM inline rendering; coarse preview; 120 ms settling; 24 ms budget    | **Confirmed with precision correction** | `render_worker.rs:31–49,597–617`: factor 4 per dimension (1/16 pixels), previews when previous full work reaches 12 ms, settle wait **min(last full duration,120 ms)**, at least one band even over budget, max 8 bands/min 64 rows. Slow bands can still block for seconds; the report correctly avoids a frame guarantee. Browser wgpu features are `apps/figcraft-web/Cargo.toml:28–29`, not its linked line 26.                                           |
| Rust ≥1.95, version 0.15.0, MIT OR Apache-2.0                           | **Confirmed declarations**              | Workspace `Cargo.toml:9–12`; no local compilation or license analysis was performed.                                                                                                                                                                                                                                                                                                                                                                          |

Other anchors: CLI perf `:100`, UI perf `:40`, synthetic scene `:1`, retained `:391`, overscan `:134`, layout/text/renderer `:1`, hardware parity `:26`, and CLI docs `:1` all resolve to relevant sections. **README `#L79` should be `#L76`** for the sub-millisecond creation statement. The coarse-preview source link at line 1 is relevant but constants at lines 31–49 are more useful. No missing linked FigCraft source file was found.

## Origin and meaning of “~8 ms at 50K”

**Confirmed quotation; unsupported independent performance.** [hardware-parity.md, performance table](https://github.com/storytold/figcraft/blob/53ebf1f39c51361282ca55e18c83fbffed2f9a34/docs/hardware-parity.md#L25) reports a zoomed-out full render with levels of detail. Git history introduces the table in [97159514b4a345e1a7c7d57fb848cd0c1ce36f23](https://github.com/storytold/figcraft/commit/97159514b4a345e1a7c7d57fb848cd0c1ce36f23), October 10, PR #100; subsequent parity revisions say numbers unchanged. Thus it is an older upstream report carried into the November pin, not a freshly recorded measurement of this commit.

Known conditions: synthetic files, owner's Mac, release `cargo xtask bench`; **Mac model/chip/RAM, exact original zoom, raw samples and matching historical command output are unspecified**. The 8 ms row has no no-LOD counterpart. Do not silently identify its precise historical zoom from today's benchmark: today's CLI times both fit and 2× fit.

Current reproduction semantics (`apps/figcraft-cli/src/perf.rs:17–31,100–163,303–345`): 1440×900 **device pixels**, full CPU rendering averaged over five calls; fit-exact uses three calls. Generation, normalization, save/load are separate. Font scan precedes timings; layout/glyph/pool caches can warm during the sequence, with no explicit warm-up before the first render row. Retained pans alternate 40 screen pixels out/back for ten calls after a seed render. Moved-layer snapshots are prepared outside the timed ten retained renders: **the ~0.2 ms category is raster updating, not command-to-screen edit latency**. Upload, GPU drawing, display, UI and DPR-2 pixel workload are excluded. Render `Option`/boolean failures are sometimes discarded.

Scene (`engine/src/content/synthetic.rs:1–145`): grid of 360×240 screens, 80-unit gaps, about 50 layers/screen, header auto-layout, text, ellipses/rectangles, card groups and three shared-button instances. About 1,000 screens at 50K; this is neither 50K simultaneously detailed layers nor a mixed-image/effects scene. It contains **no image workload or blur/mask stress**. Record actual node counts; headers label requested counts. UI benchmark (`ui-egui/src/perf_tests.rs:40–60,239–249`) times headless egui calls, clears texture uploads and does not wait for the native raster worker. Its means are not rendering/presentation completion times.

## Harness and observations

**Confirmed:** observations contain five adjacent environment probes only (~45 ms total), null Rust/Cargo discovery, Apple M1/8 GiB, identical load readings 6.613/4.944/4.505, no render rows. They cannot establish speed, RAM use of FigCraft, or five independent rendering trials. Historical command-not-found and alternate binary-location checks are prose claims; this JSON records PATH discovery only.

**Unsupported provenance / correction needed:** `run.py` checks Git HEAD but accepts any existing `target/release/figcraft-cli`; a stale/different binary or dirty source can be mislabeled with the pin. Require a clean checkout, record toolchain/build/features/fonts and hash the rebuilt executable. The parser correctly handles a **single-size two-column table**, and preserves µs labels; it cannot parse the multi-size xtask table (which it does not invoke).

**Wrong if interpreted as complete failure capture:** `subprocess.run(...timeout=1800)` is uncaught. Timeout aborts the harness before writing that trial's captured output/status; earlier checkpointed trials survive. Handle `TimeoutExpired`, persist partial stdout/stderr and failed-trial metadata before promising complete retention. Five successful means and their median still are not frame p50/p95. README correctly says full mode is unvalidated; no execution was attempted here.

## Transfer and outside references

**Wrong/stale recommendation:** replace “keep the existing Pixi hybrid plan” with the current [renderer-options.md](../renderer-options.md) recommendation: incremental DOM first, B+C overview/zoom tiles, GPU deferred. FigCraft supports changed-subtree invalidation, geometry caches, effect-aware damage, bounded overscan, latest-request scheduling, old-image reprojection and coarse/refined completion reporting. The baseline's label layout flushes and repeated descendant scans deserve priority over changing painters. Structural sharing is optional; indexed identity and scoped invalidation transfer without replacing the model.

**Overstated portability:** “these techniques apply to DOM” needs qualification. DOM can preserve keyed elements and let Chromium retain/composite pixels; manually shifting pixmaps and repainting damage belongs to C's raster layer. Strategy C already caches tiles: FigCraft supplies scheduling/invalidation lessons, not evidence for replacing that cache with one viewport. Preserve browser-measured CSS geometry, live DOM text/IME/iframes and export semantics. Reimplementing tiny-skia text/layout/effects or copying thresholds will not preserve HTML fidelity. Under-sold transferable details: image-resolution caches, backpressure, and separate stale/coarse/refined latency plus incomplete-content reporting. Effect sampling must cross tile boundaries, a known limitation of C.

**Penpot — confirmed description, improve sourcing:** [render-wasm README](https://github.com/penpot/penpot/blob/develop/render-wasm/README.md) confirms Rust/Emscripten/rust-skia. [tile design](https://github.com/penpot/penpot/blob/develop/render-wasm/docs/tile_rendering.md) supports 512×512 logical screen units, DPR independence, bidirectional indexing, cached Skia images, extra visible-area margins and no current parallel tile scheduling. [Official article](https://penpot.app/blog/penpots-new-rendering-system/) identifies the renderer as WebGL beta and describes bounded tile-cache eviction. Pin the moving `develop` links for reproducibility; neither source establishes Verynize's HTML/CSS parity or comparable percentiles.

**Silk — unsupported implementation/performance, appropriately labeled:** local [thread capture](../x-threads-2026-11-04.md) supports the author's Effect/Silk WebGPU, 100K-element XKCD description; it supplies no backend code, machine, timings or heterogeneous image/text test. This review's GitHub repository search `Silk WebGPU` found no result; that is not proof no repository exists. Keep the attribution and uncertainty.

**tldraw — confirmed production distinction; experiment unsupported:** capture supports Ruiz's statement about a separate experiment but lacks its actual URL. Public [DefaultCanvas.tsx](https://github.com/tldraw/tldraw/blob/main/packages/editor/src/lib/components/default-components/DefaultCanvas.tsx) uses a transformed HTML layer and keyed shapes/culling. That supports production DOM architecture, not the experiment's backend or benchmark. Link this file and the local capture, rather than implying a repository-root link verifies the missing experiment.

## Exact future benchmark recipe (not executed)

After Rust ≥1.95 is provisioned and this Mac is idle, inspect build scripts/dependencies, then run separately:

```sh
cd /tmp/perf-review/figcraft
git rev-parse HEAD
git status --porcelain
rustc --version
cargo --version
cargo build --release --locked -p figcraft-cli
shasum -a 256 target/release/figcraft-cli
./target/release/figcraft-cli perf --layers 1000,10000,50000,100000 --instances 0
```

Expected: pinned SHA, empty status, release CLI; Markdown table headed `figcraft perf (macos release build; ms unless noted; mean of several runs)` with four size columns and render/fit/exact/pan/edit/save/load rows. No target millisecond values are justified. For five separate process trials per size using the existing harness (with the caveats above):

```sh
cd <repo>
python3 eval/canvas-perf/figcraft/run.py --source /tmp/perf-review/figcraft --out /tmp/perf-review/figcraft-run-1
```

Expected: new output directory, 20 stdout/stderr pairs, `results.json` with 20 trials, peak process RSS, environment and medians of successful upstream means; no displayed-frame percentiles.

Upstream suite alternative and additional timing tests (no `benches/`, Criterion targets or Criterion dependency found):

```sh
cd /tmp/perf-review/figcraft
cargo xtask bench 1000,10000,50000,100000
FIGCRAFT_BENCH_LAYERS=1000,10000,50000,100000 cargo test --release --locked -p figcraft-ui-egui --lib perf_ui_frames -- --ignored --nocapture
cargo test --release --locked -p figcraft-render --lib glass_render_timings -- --ignored --nocapture
cargo test --release --locked -p figcraft-engine --lib export_timings -- --ignored --nocapture
```

`xtask/src/main.rs:158–172` runs CLI perf **with its default 2,000-instance component bench**, then the UI test above (so do not run both unless intentionally repeating). UI output: per-size mean UI rows at 1920×1080 plus the fixed component/assets report, not GPU/presentation timing. Glass: 2400×1600, eight-call means, full/native bands versus single-thread and retained card/pane edits. Export: bundled example top-level frames at 2×, PNG/JPG/WebP; one warm-up then seven runs, min/median/raw run times; optional `FIGCRAFT_EXPORT_BENCH_OUT=/tmp/perf-review/exports` writes last-run images for inspection. These additional tests broaden workload coverage, not proof of 100K HTML fidelity or smooth interaction.
