# Verynize DOM canvas baseline — 4 November 2026

> **Validation status.** Rerun sequentially on an idle machine by the lead ([results/verynize-2026-11-04-sequential.json](../../eval/canvas-perf/results/verynize-2026-11-04-sequential.json)): every completed cell is within about 1–7% of the contended run (edit sync at 1,000 nodes: 280.2 → 281.6 ms; render 258.3 → 260.7 ms), and 2,000-node all-node selection again hit the 60 s ceiling. Reviewed in [reviews/opus-on-verynize-baseline.md](reviews/opus-on-verynize-baseline.md): numbers confirmed, but attribution corrected. `drawFrameLabels` dominates edits, drags and selection as well as pan/zoom (it runs from `render()` via `afterRender`), the fixture's 5% top-level frames make label cost grow with N², and the 100-node "% > 16.7 ms" values are timestamp jitter. The root cause of the whole-workspace restyle was then isolated experimentally: see [README.md](README.md#root-cause-five-hasfocus-visible-rules).

The current canvas misses a 60 Hz budget at **500 nodes** for median pan/zoom frames and synchronous edits in this fixture; the tested bracket is **100–500 nodes**, not an exact crossover. This is an implementation baseline, not evidence that the DOM itself has this limit. Camera motion is dominated by forced style recalculation; edits rebuild the document DOM; all-node selection adds expensive descendant computations.

Measured commit: `022d40e6b7a07fd0e7f26ee72cd450738ed25d2c` (app 0.18.0), branch `docs/perf-research`. Real Electron, production UI bundle, fresh profile per repeat. Apple M1, 8 logical CPUs, 8 GiB RAM. Five repeats per completed size. Host contention is material: per-repeat load averages and free RAM are in the raw JSON; rerun sequentially before treating these as hardware limits. UTC timestamps fall on 3 November; the report date is Jakarta time.

## Method and limits

Seed 241104; one page with 10% frames (including nested frames), 65% rectangles, 20% text and 5% embedded SVG images. Fixed-size, free-positioned children, fills, radii and borders; most nodes are offscreen at 100%. Documents pass the shared validator and load through `design.loadDocument`. Timed gestures exercise the production wheel/pointer handlers with one selected rectangle, once per rAF for two seconds. State-change checks verify input took effect. They exclude OS input delivery overhead.

“Paint fence” below means a zero-delay task and two rAF callbacks after the API call. It includes an opportunity to paint and process island updates, **not the exact first displayed pixel or a guaranteed React-idle timestamp**. It has a frame-wait floor: use synchronous edit cost to locate the 16.7 ms work-budget crossover. Full render is the production `render()` call. No product code was changed.

Select-all passes **every node**, including ancestors and descendants, to the public agent API. Keyboard Select All selects siblings within the current scope instead; this is a deliberately demanding agent selection workload. Heap and DOM are sampled after gestures and selection without forcing GC. DOM counts include detached nodes; connected elements are reported separately.

## Measurements

Times in ms, **median / p95 across five repeats** (five-sample p95 is the maximum).

| Nodes | Load paint fence | Full render, sync | One-property edit, sync | Edit paint fence | All-node selection paint fence |
| ----: | ---------------: | ----------------: | ----------------------: | ---------------: | -----------------------------: |
|   100 |      34.0 / 48.2 |       12.3 / 12.6 |             15.5 / 15.8 |      47.6 / 48.8 |                  115.7 / 117.1 |
|   500 |    167.2 / 174.0 |       83.9 / 93.1 |             94.7 / 98.2 |    115.7 / 132.1 |                1592.3 / 1628.8 |
| 1,000 |    497.6 / 505.5 |     258.3 / 269.6 |           280.2 / 283.8 |    315.7 / 316.6 |                9600.8 / 9660.9 |

Frame columns show **p50 / p95 ms / % >16.7 ms**, each the median of the five within-run statistics.

| Nodes |                   Pan |                  Zoom |         Drag one node |
| ----: | --------------------: | --------------------: | --------------------: |
|   100 |   16.7 / 17.6 / 44.6% |   16.7 / 17.6 / 32.2% |   16.7 / 33.3 / 36.4% |
|   500 |   50.0 / 51.0 / 97.6% |   50.0 / 66.7 / 97.4% | 100.0 / 116.7 / 95.2% |
| 1,000 | 166.7 / 183.4 / 92.3% | 166.7 / 200.0 / 92.3% | 283.3 / 566.6 / 85.7% |

| Nodes | JS heap, MiB | CDP DOM nodes (incl. detached) | Connected elements |
| ----: | -----------: | -----------------------------: | -----------------: |
|   100 |         34.5 |                         15,547 |              6,096 |
|   500 |         73.5 |                         58,288 |             21,816 |
| 1,000 |        127.1 |                         57,364 |             41,466 |

**Ceiling: 2,000 nodes, first repeat, all-node selection did not complete within 60 seconds.** Earlier operations in that partial repeat completed: load paint fence 1,678.0 ms, full render 940.6 ms synchronous, edit 978.4 ms synchronous / 1,016.6 ms paint fence. These are single observations, not medians. Only three pan/zoom inputs and two drag inputs fit the two-second window; these tiny interval samples are retained in JSON, not reported as stable percentiles. No heap sample was reached. **5,000, 13,000 and 50,000 were not attempted**, following the stop rule.

One-minute host load averages ranged from 4.34 to 8.20. DOM-count non-monotonicity reflects GC and detached objects, not fewer connected layers.

At 100 nodes, literal p95 intervals already exceed 16.7 ms slightly, and drag p95 reaches approximately two frames. At 500 nodes the median camera interval is 50 ms and input handlers themselves exceed budget: this is a clear degradation beyond display timestamp rounding. No unsampled crossover or larger-scene performance is extrapolated.

## Attribution

The CDP passes are separate from the medians. Baseline camera profiles clear selection; supplemental profiles use one selected rectangle, matching timed gestures. Raw gzip files preserve trace events and CPU profiles. CPU self time includes native work; trace scopes overlap across threads, so their durations must not be summed into an exclusive breakdown. `Performance.ScriptDuration` omits much Runtime.evaluate work (charged as DevTools commands); it alone cannot classify these API benchmarks.

Detailed 1,000-node supplemental pass, durations in ms (one instrumented pass, **not medians**). GC sums only top-level MinorGC + MajorGC events. Raster is summed worker-task duration, not wall time; layerize/commit are compositor-related main-thread scopes, not a complete GPU accounting.

| Operation | Style recalc | Layout | Paint | Layerize / commit | Raster tasks |   GC |
| --------- | -----------: | -----: | ----: | ----------------: | -----------: | ---: |
| render    |        158.9 |    4.8 |   4.7 |         0.4 / 0.2 |          0.2 |  4.6 |
| edit      |        160.4 |    4.4 |   0.5 |         0.3 / 0.4 |          0.1 |  1.1 |
| pan       |       2048.2 |   48.1 |   7.6 |         8.1 / 1.6 |          2.4 |  4.5 |
| zoom      |       1915.5 |   46.0 |   6.4 |         5.7 / 1.5 |         15.1 |  0.0 |
| drag      |       1446.2 |   50.9 |   6.1 |         3.3 / 1.2 |          2.5 | 14.4 |
| selectAll |       2929.3 |   56.2 |  16.8 |         7.1 / 4.9 |          2.9 | 82.3 |

For all-node selection, the detailed CPU sample attributes about 3,493 ms to the `descendants` scan callback (`app.js:14`), 1,572 ms to the pairwise selection callback (`selection-chrome.js:126`), and 770 ms to `descendants` itself. These are sampled self times for separate stack nodes, not timing medians. React bundle functions appear in the profiles, but the leading named paths are outside React.

Concrete paths (line and approximate character positions are for this commit):

| Path                                                                                                                  | Evidence and consequence                                                                                                                                                                                                                                                    |
| --------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `canvas-interactions.js:275` `applyCamera` → `:1129` `drawFrameLabels` → `:307` `worldRect` → `getBoundingClientRect` | CPU profile ancestry identifies the dominant camera stack. `drawFrameLabels` clears the labels, reads a frame's bounds, appends its label, then reads the next frame. Interleaved writes and reads repeatedly force style/layout. It visits offscreen top-level frames too. |
| `app.js:20` `layerElement` (near char 22), `:21` `render` (char 16)                                                   | Creates fresh layer elements and replaces the canvas children. Frame children use whole-page filters. The same call builds hidden legacy layer rows, updates chrome and persists the document.                                                                              |
| `app.js:21` `rows` (near char 1270) and `sizingMode` at `:18`                                                         | Recursive rows filter the whole node array for every node, including leaves; sizing resolves parents with linear `find` calls. These are avoidable repeated scans.                                                                                                          |
| `app.js:85` `updateNodes`                                                                                             | Whole-document stringify/parse/clone, validation, undo, full render, storage save and per-subscriber clones for a one-node edit.                                                                                                                                            |
| `selection-chrome.js:124–126` `topSelected` → `app.js:14` `descendants` (char 21; scan callback near char 96)         | Pairwise selected-node checks recompute descendant sets, each scanning the page repeatedly. Profiles show this dominating JS for all-node selection.                                                                                                                        |
| `canvas-interactions.js:789–835` `startMove`                                                                          | Free-node pointer moves call `ed.render()`; dragging one node inherits the full render and subscriber work every event.                                                                                                                                                     |
| `web/src/lib/bridge.ts:89` subscription; `sidebar/LayersSection.tsx:31` `buildRows`                                   | Islands receive whole-document updates. The React tree already groups children with a map; do not confuse it with the quadratic legacy `rows()`. React work appears in profiles, but the sampled dominant stacks above are native geometry reads and legacy algorithms.     |

## What the X claims establish here

| Claim in the captured threads                                | Verdict for this measurement                                                                                                                                                                               |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| “Falls apart past a few hundred layers”                      | The symptom is supported for this fixture: 500-node pan/zoom and edits miss budget. It does not establish a universal DOM ceiling.                                                                         |
| Style recalculation on every pan/zoom is the cost            | Supported, with a concrete application cause: rebuilding/measuring frame labels forces style/layout. The camera already transforms one container. Paint/raster/compositor trace work is much smaller here. |
| Selection slowness can be UI/data access rather than drawing | Supported in Verynize: ancestor/descendant selection calculations dominate JS, alongside forced styles. This does not verify Paper's implementation or its founder's numbers.                              |
| Plain rectangles fail at 2–5K; real files need 13K–100K+     | This mixed fixture is not a plain-rectangle test, and larger uncompleted sizes are not measured. No numerical conclusion about Paper, 13K/50K/100K rendering, or an optimized DOM renderer follows.        |
| Virtualization, caches or a new renderer solve it            | Caches and avoiding work target observed paths. Gains require follow-up experiments. Nothing here benchmarks PixiJS, WebGPU, Canvas 2D, text fidelity, IME, or agent generation quality.                   |

## Cheapest DOM-preserving fixes (expected gain, not measured speedups)

| Rank | Change                                                                                                                            | Expected gain and measured reason                                                                                                                                                                                                                                     |
| ---- | --------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Keep frame labels keyed; batch all geometry reads before DOM writes; position labels from cached world geometry on camera changes | Very high for pan/zoom: attacks the observed style-flush stack. Preserve the existing single-container camera transform; adding it again changes nothing. Cull offscreen labels.                                                                                      |
| 2    | Cache id→node and parent→children maps per revision; compute top-selected nodes by walking ancestors in a selected-ID set         | Very high for large selections, high for rebuilds: removes repeated `descendants`, pairwise membership checks, parent finds and recursive whole-page filters. Validate against all-node selection before considering a renderer migration.                            |
| 3    | Update only the edited/moved keyed canvas elements; split canvas, selection, layers and inspector invalidation                    | High for edits/drag: one-node moves currently call a full render. First cheap step is bypassing the global render during live drag and committing once at gesture end. Full keyed rendering is a larger change.                                                       |
| 4    | Stop constructing taken-over hidden legacy layer rows; virtualize expanded React layer rows                                       | Medium/high for large selections and memory: both legacy rows and active island UI are built. All-node selection expands the tree; verify connected-element counts after removing this work.                                                                          |
| 5    | Coalesce persistence, validation where safe, document clones and inspector notifications to one commit/frame                      | Medium for edits/drag: `updateNodes` and render subscribers copy/serialize the full document. React is present but is not the dominant camera path; inspector throttling alone will not fix it.                                                                       |
| 6    | Cull offscreen canvas subtrees or experiment with `content-visibility` and stable intrinsic sizes                                 | Potentially high at larger N, but unmeasured: most fixture content is offscreen. Culling must preserve hit-testing/measurement semantics. Fix the measured label and algorithm paths first; indiscriminate visibility changes may not suppress forced geometry reads. |

## Reproduce and inspect

See [the harness README](../../eval/canvas-perf/README.md) for commands, statistical definitions and profile caveats. [Raw results](../../eval/canvas-perf/results/verynize-2026-11-04.json) retain individual frame intervals, five-run samples, environment metadata and profile summaries; adjacent `.json.gz` files contain complete CDP traces/CPU profiles. The harness stops larger sizes when an operation exceeds 60 seconds and checkpoints partial results. No fixes, commits or pushes were made.
