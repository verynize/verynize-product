# Conservative loose-node culling

The retained DOM renderer now indexes fixed-size loose rectangles, text, images, shaders and free-layout frames as well as clipping artboards. It keeps the existing half-viewport overscan and `verynize.canvas-cull=off` switch. No elements are removed.

Visual bounds include rotated/flipped boxes, free descendants, text scroll extents and overhang, strokes, outlines and structured shadows. Layout/effects whose overflow cannot be bounded cheaply remain visible: hugging/percentage/constrained sizing, unclipped flow containers, live previews, vectors, active filters and legacy CSS shadow strings. Text reads happen together during indexing on render; camera updates only query cached bounds. Font completion rebuilds the bounds.

Selection, drag markers, text editing and outstanding external edits protect the entire top-level ancestor. Camera mutations coalesce into one rAF update; newly visible content is revealed without the old six-board budget. The existing spatial grid handles ordinary views, while overview queries scan candidates when that is cheaper than traversing empty cells. Very wide/thin bounds cannot allocate an excessive number of grid entries.

Export still builds fresh trees without culling attributes. The regression test compares HTML and PNG screenshot output with culling on/off, and covers loose elements, selected descendants, dragging, text editing, overflowing children/shadows/outlines, camera reveal and hit testing. The original incremental-render test's selection and empty-frame expectations now reflect these semantics.

The repeatable 3,000-node probe is `CULL_BENCH=1 node tests/canvas-loose-culling.cjs` under the shared Electron lock and Xvfb. It pans 120 frames and records rAF intervals plus CDP style/layout counts and durations. Baseline is the renderer at `d78d899`, with the same fixture and build.

DOM virtualization remains a possible follow-up for memory and initial mounting, especially when many nodes are visible at overview zoom. It requires independent geometry/hit-testing and export guarantees; this change deliberately preserves all DOM nodes. Offscreen boxes retain layout but skip their own paint through `visibility:hidden`; shader runtimes are not paused by this change.

## Measurements on instabox `coba`

Three alternating baseline/changed runs under `/data/tmp/locks/electron.lock`, Node 24 and Xvfb, 3,000 fixed-size top-level text nodes, 120 camera steps of 10 px at 100% zoom. Median across runs; this is a shared Linux box, not a macOS/Retina acceptance measurement.

| Metric                                   | Baseline d78d899 |  Changed |
| ---------------------------------------- | ---------------: | -------: |
| Pan frame p50                            |         150.0 ms |  16.7 ms |
| Pan frame p95                            |         150.1 ms |  16.8 ms |
| Main-thread task duration over 120 steps |         17.370 s |  0.441 s |
| Style recalculations                     |              120 |      120 |
| Style duration                           |         30.08 ms | 46.21 ms |
| Layout count                             |                0 |        3 |
| Layout duration                          |             0 ms | 16.06 ms |
| Culled top-level nodes after pan         |                0 |    2,980 |

Per-run frame p50/p95: baseline `133.4/150.1, 150.0/150.1, 150.0/150.1` ms; changed `16.7/16.8, 16.7/16.7, 16.7/16.8` ms. Task durations: baseline `16.926210, 17.567024, 17.369567` s; changed `0.419870, 0.454434, 0.441129` s.

The gain comes from avoiding paint, not fewer style/layout passes. The intermediate content-visibility-only implementation retained the offscreen boxes' own paint and regressed p95 to about 467 ms. Hiding their visibility as well is essential; geometry remains available.

## Validation

On the box, `npm run build:ui` passed. Under the shared Electron flock, `node scripts/run-tests.mjs --all --group canvas --skip-build --report /data/tmp/vfix-cull-canvas-report` completed in 364.5 seconds: **40 passed, 10 failed, 0 skipped**. The new loose-culling test passed, including HTML and PNG screenshot equivalence. Drag-scale, frame labels, tiles, roundtrip, interactions, compositing and component tests also passed.

All ten failures are on the supplied pre-existing box baseline list: `canvas-advanced`, `canvas-shaders`, `inspector-shader-library`, `canvas-precision`, `canvas-incremental-render`, `canvas-selection-marks`, `inspector-parity`, `inspector-paints`, `inspector-selection-colors`, `inspector-typography`. No new failing test names were introduced. The existing incremental-render test stops before its culling section on this box; the independent loose-culling regression supplies executable coverage here.

Mac validation was limited to `npm run lint` (passed with existing warnings) and `npx vp fmt` on changed files. Unrelated formatting in the legacy minified CSS was preserved. No `web/src` changes or typecheck were needed. Native macOS/Retina and hardware-GPU behavior were not tested.

The requested full-worktree push stalled for over 15 minutes and was stopped. Changed runtime/test files were pushed individually; SHA-256 hashes matched the local worktree both before and after the final canvas run. The box's preinstalled dependencies were not modified.
