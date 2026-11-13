# ADR-001: defer the GPU renderer

Date: 2026-11-05. Status: accepted for the performance plan; implementation and acceptance remain outstanding. Supersedes the PixiJS-first decision in the [renderer migration plan](../canvas-renderer-migration-plan.md). Decision scope: documentation and opt-in measurement guardrails, with no product runtime changes.

## Context

The previous plan chose PixiJS for scale before measuring the app's bottlenecks. The [research synthesis](README.md) and [baseline review](reviews/opus-on-verynize-baseline.md) locate the immediate problem in CSS invalidation, interleaved frame-label writes/geometry reads, repeated selection scans, and full DOM rebuilds. Changing painters would leave much of that application work intact and introduce a second implementation of CSS paint and text.

Evidence is from one Apple M1, 8 GiB, DPR 2, Electron 42 / Chromium 148. The lead reran the principal experiments sequentially on an idle machine. Synthetic prototypes exclude the app's selection, panels, persistence and labels. The [renderer review](reviews/astra-on-renderer-options.md) qualifies timing, completeness, fidelity and memory claims; the [FigCraft review](reviews/sol-on-figcraft.md) predates the lead's successful local build. Its earlier “unreproduced” verdict is superseded only by the local measurement section, not by assuming upstream numbers are product frame timings.

## Decision

Keep DOM as the product renderer and source of truth for CSS layout/paint, with JSON as the canonical document model. Follow phases 0–3 in the revised migration plan: remove the five pathological focus `:has()` variants; fix labels/selection and live drag; implement keyed incremental DOM and culling (B); evaluate optional Canvas 2D tiles for zoom/overview (B+C) only if needed. Preserve DOM text editing, IME, accessibility, HTML export and iframe live previews.

Defer PixiJS/WebGPU renderer adoption and cutover. Keep the product `package.json` free of PixiJS/WebGPU renderer dependencies; `pixi.js@8.22.0` remains isolated in [the prototype manifest](../../eval/canvas-perf/prototypes/package.json). Existing per-node WebGL shader effects are a separate implemented feature, not a scene renderer migration.

## Evidence

| Experiment                                  | Observation                                                                                                                                      | Raw artifact and interpretation                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Product sequential baseline                 | At 1K, pan handler p95 184.8 ms; zoom 189.9 ms; edit sync p95 299 ms; drag interval p95 585.3 ms. All-node selection at 2K hits the 60 s ceiling | [Baseline JSON](../../eval/canvas-perf/results/verynize-2026-11-04-sequential.json), `summary[n=1000]`, `ceiling`; this fixture has many top-level frames and is not a universal DOM limit                                                                                                                                                                                                                                                                                                    |
| Five focus `:has()` rules removed via CSSOM | At 1K, pan handler median 164.4 → 10.9 ms; pan interval 166.7 → 16.7 ms                                                                          | [Experiment JSON](../../eval/canvas-perf/results/experiment-has-2026-11-04.json); runtime experiment only, no product fix shipped here                                                                                                                                                                                                                                                                                                                                                        |
| B vs C vs Dgpu at 100K, sequential          | Pan p95 5.6 / 3.0 / 24.5 ms; zoom p95 62.4 / 13.8 / 71.6 ms; overview settle 1,874.9 / 849.9 / 13,510.4 ms; JS heap 62.9 / 61.4 / 1,118.9 MB     | [Sequential prototype JSON](../../eval/canvas-perf/results/prototypes-2026-11-04-sequential.json), `results["electron/{B,C,Dgpu}/100000"].summary`; rAF/strategy-settle, not presentation timestamps. Post-traversal heap snapshots, not peak GPU allocation                                                                                                                                                                                                                                  |
| Fidelity at settled 100%                    | B 0%; C 0.79%; D/Dgpu 3.36%; E 0.63% pixels with max RGB channel difference >32/255                                                              | [Original prototype JSON](../../eval/canvas-perf/results/prototypes-2026-11-04.json), `fidelity`; one screen against DOM reference, not a full export/overview audit. B's 0% does not prove all sizes/features                                                                                                                                                                                                                                                                                |
| E: hidden DOM layout + GPU painter          | Fit-all 1.72 s at 13K, incomplete after 20 s at 100K; edit p95 194.3 ms at 100K                                                                  | [Original prototype JSON](../../eval/canvas-perf/results/prototypes-2026-11-04.json), `results["electron/E/{13000,100000}"].summary`; keep revision-scoped layout snapshots, dirty-subtree measurement, and no overview measurement. Include layout in the <16 ms edit budget                                                                                                                                                                                                                 |
| Vsync-on sanity check                       | C/100K zoom rAF p95 about 50 ms despite uncapped 13.8 ms; cheap callbacks alone do not establish smooth complete pixels                          | [Vsync/Chrome JSON](../../eval/canvas-perf/results/prototypes-2026-11-04-sequential-vsync-chrome.json); see review for distinction between rAF intervals and presented frames                                                                                                                                                                                                                                                                                                                 |
| FigCraft local CPU raster                   | Fit-all 50K: 9.4 ms with LOD vs 80.1 ms exact; 100K: 16.0 vs 148.2 ms                                                                            | [Five raw Markdown runs and build log](../../eval/canvas-perf/figcraft/lead-run-2026-11-04/), [run 1](../../eval/canvas-perf/figcraft/lead-run-2026-11-04/run1.md), [measurement description](figcraft.md#local-measurement-lead). No local rendering-result JSON was produced; the earlier [observations JSON](../../eval/canvas-perf/figcraft/observations-2026-11-04/results.json) contains environment probes only. CPU raster excludes upload/presentation/UI and uses a different scene |

PixiJS 8.22 pitfalls recorded in [renderer-options](renderer-options.md#fidelity-audit): reversed `FillGradient` ramps for negative direction, texture fills forced to repeat, missing core backdrop-filter, experimental `DOMContainer`, and lost mixed runs/emoji fidelity in the single-style BitmapText implementation tested. E's DOM word boxes improve text fidelity but do not remove layout or CSS paint costs. These are prototype/version findings, not a claim about every possible GPU implementation.

D's full-detail display-tree thumbnail policy inflates overview cost; equal LOD/cache policies could change its ranking. C's incomplete statistic (~38% at 100K sequential zoom) counts tiles, not screen area. B exposes no completeness hook, so its missing value must never become 0%. Two-rAF fences are paint opportunities, not completed/presented pixels. A/A2 large runs are truncated, so large speedup ratios are descriptive partial-workload comparisons. B+C has never been integrated; there is no measured combined win.

## Consequences

We can address measured bottlenecks while preserving browser CSS behavior and export semantics. A renderer interface remains a useful seam; a GPU dependency, model migration or replacement collaboration protocol is not required. Keyed updates, culling, containment and stale-thumbnail invalidation still need product work and behavioral tests. Tile painting adds a CSS fidelity burden, cache memory and handoff complexity, so phase 3 is conditional.

FigCraft contributes retained pixels, damage, effect-aware culling, bounded overscan, coarse/refined reporting and latest-request scheduling. It does not establish a GPU scene-renderer advantage or HTML/CSS fidelity. Iframe previews stay DOM overlays regardless of painter. Wonder's static bundle findings and advertised roadmap remain evidence of implementation/declarations, not proof of runtime parity.

## Revisit triggers

These are proposed thresholds for reopening an architecture evaluation, **not measured GPU crossover points**. A trigger authorizes another isolated prototype/ADR, not product adoption. The canvas maintainer and performance-change author own the rerun and evidence review.

1. **Matched-quality win at 100K:** a GPU prototype achieves ≤0.5% differing pixels (max RGB channel difference >32/255, equal dimensions/DPR, alpha checked separately) across mixed-text, multilingual, images, blur, clipping and layout fixtures at 100% and agreed fractional zooms. This is an evaluation threshold; the product acceptance target remains 0% against export at settled 100%. With equal LOD/overscan/cache policy and identical full timed trajectories, its input-to-presented-frame p95 must beat the integrated B+C by ≥20% for pan and zoom in five sequential isolated runs, with no worse fit-all completion or blank/stale/coarse visible-area duration. First build/instrument B+C; until then this comparison is unknown.
2. **Bounded memory:** for the same 100K test, peak renderer RSS ≤1.5 GiB, JS heap ≤256 MiB, live texture estimates ≤256 MiB, and post-eviction residency growth ≤5% across ten repeated pan/zoom/edit cycles. Track renderer/GPU processes separately and resource lifetimes; do not sum overlapping counters. These proposed caps must be published before the run, not chosen after observing a GPU result. A timing win without these bounds does not satisfy trigger 1.
3. **In-scene shaders at scale:** a reproducible product document with ≥100 simultaneously visible animated shader layers misses input-to-presented p95 16.7 ms on M1 after phases 0–2, and profiling attributes ≥50% of frame work to per-node shader canvases/compositing. Reopen an in-scene GPU experiment with equivalent effects, then require matched quality/memory evidence before adoption.
4. **More than 100K visible layers:** a real or agreed representative fixture contains >100K viewport-intersecting layers at detail zoom (not merely >100K total offscreen nodes), and optimized B or integrated B+C misses the handler/edit/drag budgets in at least three of five runs. Capture dense text/effect cases and a single huge frame. Reopen backend evaluation; this node count alone proves no crossover.
5. **Persistent DOM/tile failure:** after an integrated B+C attempt, a reproducible fixture still breaches numeric budgets in three of five isolated runs, or cannot reach 0% export diff at settled 100%. Publish traces showing residual rendering/handoff cost, then compare a retained GPU candidate under triggers 1–2 rather than assuming migration fixes it.

## Acceptance budgets and rerun ownership

Any contributor implementing phases 0–3 can rerun; the canvas maintainer reviews results and updates this ADR when evidence changes. On an idle graphical macOS session, install/build the UI, run each harness separately, preserve commit/machine/runtime/DPR/load and raw artifacts under a new output name, and report ranges as well as medians. Do not overwrite the November baseline. Recipe and metric semantics: [harness README](../../eval/canvas-perf/README.md); [research reproduction](README.md#reproduce); [FigCraft build/provenance](figcraft.md#local-measurement-lead).

```sh
npm install
npm run build:ui
node eval/canvas-perf/bench-verynize.cjs --sizes 1000,2000,13000,100000 --runs 5 --no-profile --output /tmp/verynize-rerun.json
node eval/canvas-perf/check-budgets.mjs /tmp/verynize-rerun.json
node eval/canvas-perf/experiment-has.cjs --sizes 500,1000 --runs 3
cd eval/canvas-perf/prototypes
npm install
cd ../../..
node eval/canvas-perf/bench-prototypes.cjs --sizes 13000,100000 --runs 5 --strategies B,C,Dgpu --fidelity --out /tmp/prototypes-rerun.json
```

A baseline ceiling stops larger sizes: report missing data and fix the preceding bottleneck before increasing sizes. Use the profiler separately for attribution. Current harnesses do not capture the presentation, visible-area or export checks required for full acceptance; instrument those before claiming a trigger/criterion met.

[budgets.json](../../eval/canvas-perf/budgets.json) transcribes the [synthesis acceptance criteria](README.md#acceptance-criteria-to-use-from-now-on). Fit-all completion and visible-area incompleteness are mandatory reports with **no numeric limit specified by the research**; no arbitrary pass thresholds are invented. All-node selection uses sync p95 at 2K. Missing measurements fail to demonstrate acceptance. This advisory checker is not wired into CI and returns success for budget failures; malformed input/usage still errors.

### Saved-baseline checker output

Command: `node eval/canvas-perf/check-budgets.mjs eval/canvas-perf/results/verynize-2026-11-04-sequential.json`

```text
FAIL 1000 pan.handlerMs.p95: 184.800 ms (< 8 ms)
FAIL 13000 pan.handlerMs.p95: missing measurement (< 8 ms)
FAIL 100000 pan.handlerMs.p95: missing measurement (< 8 ms)
FAIL 1000 zoom.handlerMs.p95: 189.900 ms (< 8 ms)
FAIL 13000 zoom.handlerMs.p95: missing measurement (< 8 ms)
FAIL 100000 zoom.handlerMs.p95: missing measurement (< 8 ms)
FAIL 1000 edit.syncMs.p95: 299.000 ms (< 16 ms)
FAIL 13000 edit.syncMs.p95: missing measurement (< 16 ms)
FAIL 100000 edit.syncMs.p95: missing measurement (< 16 ms)
FAIL 1000 drag.frameP95Ms: 585.300 ms (< 16.7 ms)
FAIL 13000 drag.frameP95Ms: missing measurement (< 16.7 ms)
FAIL 100000 drag.frameP95Ms: missing measurement (< 16.7 ms)
FAIL 2000 selectAll.syncMs.p95: missing measurement; Error: Ceiling 60000ms: selectAll (< 500 ms)
FAIL 1000 fitAll.fullyDrawnMs: missing measurement (report required; no numeric limit)
FAIL 13000 fitAll.fullyDrawnMs: missing measurement (report required; no numeric limit)
FAIL 100000 fitAll.fullyDrawnMs: missing measurement (report required; no numeric limit)
FAIL 1000 zoom.incompleteVisibleAreaPct: missing measurement (report required; no numeric limit)
FAIL 13000 zoom.incompleteVisibleAreaPct: missing measurement (report required; no numeric limit)
FAIL 100000 zoom.incompleteVisibleAreaPct: missing measurement (report required; no numeric limit)
FAIL 1000 fidelity.export100Pct: missing measurement (= 0 percent)
FAIL 13000 fidelity.export100Pct: missing measurement (= 0 percent)
FAIL 100000 fidelity.export100Pct: missing measurement (= 0 percent)
Advisory: 0 PASS, 22 FAIL, 0 REPORT; no CI gate.
```

The four numeric 1K measurements exceed budget. The 2K selection ceiling is an observed failure, not a zero-duration sample. Larger sizes and quality/completion fields are absent, so this run cannot demonstrate those criteria. No product optimization is claimed by this documentation PR.
