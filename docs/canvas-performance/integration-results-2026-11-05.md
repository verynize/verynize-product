# Integrated results: fixes 1–5 together (2026-11-05)

> Historical measurement. The node-cap follow-up and current decision are in [node-cap-2026-11-06.md](node-cap-2026-11-06.md).

All five fixes merged on `perf/canvas-integration` (PRs #13–#17 on top of #12) and measured **sequentially on an idle machine** (Apple M1, 8 GiB; 1-min load 3.1–5.0 during the run). Same harness and fixture as the baseline: `node eval/canvas-perf/bench-verynize.cjs --sizes 100,500,1000,2000,5000 --runs 5 --no-profile`. Raw: [results/verynize-integration-2026-11-05.json](../../eval/canvas-perf/results/verynize-integration-2026-11-05.json); before: [results/verynize-2026-11-04-sequential.json](../../eval/canvas-perf/results/verynize-2026-11-04-sequential.json). Medians of five fresh app launches. Handler = main-thread time per input; frame = rAF interval (vsync-capped, 16.7 ms is on time at 60 Hz).

## Before → after

| Nodes | Metric                        |           Before |               After |      Gain |
| ----: | ----------------------------- | ---------------: | ------------------: | --------: |
|   500 | Pan handler p50               |          46.7 ms |              1.1 ms |       42× |
|   500 | Pan frame p50 / p95           |   50.0 / 64.8 ms |      16.7 / 17.9 ms |     60 Hz |
|   500 | Drag frame p95                |         117.9 ms |             17.4 ms |     60 Hz |
|   500 | One-property edit, sync       |          93.4 ms |             25.8 ms |      3.6× |
|   500 | Load to paint                 |         178.7 ms |             74.3 ms |      2.4× |
|   500 | All-node selection to paint   |       1,584.7 ms |            410.8 ms |      3.9× |
| 1,000 | Pan handler p50               |         166.9 ms |              1.2 ms |      139× |
| 1,000 | Zoom handler p50              |         166.0 ms |              2.0 ms |       83× |
| 1,000 | Pan frame p50 / p95           | 166.7 / 184.5 ms |      16.7 / 17.9 ms |     60 Hz |
| 1,000 | Drag handler p50              |         270.8 ms |              2.2 ms |      123× |
| 1,000 | Drag frame p95                |         585.3 ms |             17.8 ms |     60 Hz |
| 1,000 | Full render, sync             |         260.7 ms |             33.8 ms |      7.7× |
| 1,000 | One-property edit, sync       |         281.6 ms |             45.2 ms |      6.2× |
| 1,000 | Load to paint                 |         505.1 ms |            126.1 ms |      4.0× |
| 1,000 | All-node selection to paint   |       9,694.8 ms |            988.9 ms |      9.8× |
| 2,000 | All-node selection            | > 60 s (ceiling) |          1,895.1 ms | completes |
| 2,000 | Pan / zoom / drag handler p50 |      not reached |  1.6 / 3.3 / 2.2 ms |     60 Hz |
| 5,000 | Whole run                     |    not attempted | completes, 5/5 runs |         — |
| 5,000 | Pan / zoom / drag handler p50 |                — |  2.5 / 6.6 / 3.3 ms |     60 Hz |
| 5,000 | Edit sync / load to paint     |                — |    206.7 / 530.5 ms |         — |
| 5,000 | All-node selection to paint   |                — |          6,426.3 ms |         — |

At 100 nodes everything was already inside budget; it improves further (pan handler 5.6 → 1.2 ms, edit 15.7 → 6.7 ms) and load is unchanged (34.9 → 36.6 ms).

## Budgets (`eval/canvas-perf/check-budgets.mjs`)

| Budget                                        | Result                                                                                                                                                                                                               |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pan handler p95 < 8 ms at 1,000               | **PASS** 1.6 ms                                                                                                                                                                                                      |
| Zoom handler p95 < 8 ms at 1,000              | **PASS** 2.1 ms                                                                                                                                                                                                      |
| Edit sync p95 < 16 ms at 1,000                | FAIL 45.5 ms (was 299 ms)                                                                                                                                                                                            |
| Drag frame p95 < 16.7 ms at 1,000             | FAIL 17.8 ms: the frame is on time; a vsync-capped p95 sits just above 16.7 ms from timestamp jitter. The budget should be stated as handler p95 or "intervals > 25 ms" (review finding); drag handler p95 is 2.7 ms |
| All-node selection sync p95 < 500 ms at 2,000 | FAIL 643 ms (was > 60 s)                                                                                                                                                                                             |
| 13K / 100K budgets                            | Not measurable in the app: document validation rejects more than 10,000 nodes                                                                                                                                        |
| Fit-all, incomplete area, export fidelity     | Not measured by this harness yet                                                                                                                                                                                     |

## Tile layer decision (fix 4)

`eval/canvas-perf/bench-tiles.cjs --sizes 1000,5000` on the integrated build ([raw](../../eval/canvas-perf/results/fix-4-tiles-integration-2026-11-05.json)), one run per cell: zoom-out handler p50/p95 with tiles OFF 0.3/0.4 ms (1K) and 0.9/1.3 ms (5K); with tiles ON 0.4/0.5 ms and 0.8/1.0 ms. With fixes 1–3 in place the DOM already zooms well inside budget at every size the app accepts, so **the tile layer stays off by default**. Revisit if the 10,000-node cap is raised and zoom at 13K+ misses budget.

## What is left

1. **Edit at 1,000 nodes is 45 ms, not < 16 ms.** The remaining cost is in the commit path and the hidden legacy layer rows (`rows()` rebuild, about 41 ms per edit at 1K per fix 3's profile); removing the taken-over legacy rows is the next step.
2. **All-node selection at 2,000 is 643 ms sync.** Index lookups are done; remaining cost is selection chrome and inspector/layers expansion for 2,000 selected items.
3. **The 10,000-node document cap** blocks testing the 13K/100K budgets in the real app.
4. Correct the drag budget metric (handler p95 or intervals > 25 ms instead of capped frame p95).
5. Full test suite on this branch: 213/214 passed; `tests/desktop-workspaces.mjs` failed under parallel load and passes alone on both this branch and the base.
