# Fix 1: remove focus-dependent relational selectors

Replaces the five utility sites identified in [Root cause: five `:has(:focus-visible)` rules](README.md#root-cause-five-hasfocus-visible-rules). No canvas JavaScript changes.

Layer-row actions use `group-focus-within:flex`. Directory and attachment chips hide their original icon and show the remove control while focused. Paint-row outlines use `focus-within:ring-*`. Existing direct `focus-visible` styles on controls remain. Unlike descendant-only `:has(:focus-visible)`, `:focus-within` includes the element itself and mouse/programmatic focus too: actions stay visible after a click, and paint fields can show the outline on mouse focus. Keyboard focus remains visible; focusing a layer row itself now exposes its actions.

The source audit also found `has-disabled` in inspector fields. Those use their existing `disabled` prop/condition to select the same background, avoiding relational matching with identical disabled semantics. Shared UI components only use element/attribute arguments. The built CSS retains element/attribute queries and the settings dialog's structural `:not([hidden])` query. The handwritten `web/*.css` rules use element/attribute arguments; the existing research experiment found no meaningful improvement from removing the two workspace rules, so they remain. The remaining all-`:has()` experiment improvement is small relative to this fix and does not isolate any one additional selector.

Tailwind automatically scanned the research README and regenerated the old focus utilities even after their removal from product source. `globals.css` now excludes `docs/` from class scanning. This is necessary to ship the fix on the research branch.

`scripts/check-css-has.cjs`, wired into `lint` and `check`, rejects named pseudo-class arguments and arbitrary pseudo-class arguments for `has`, `group-has`, and `peer-has` throughout `web/src` (including shared UI). Attribute/element arguments remain allowed. It also rejects `:has(:focus...)` in the built `web/dist/ui.css`. The real Electron regression test loads 500 mixed nodes, recursively walks all loaded CSSOM rules (including grouping/import rules), rejects focus relational selectors, and verifies keyboard focus exposes layer actions. A timing threshold is deliberately avoided because concurrent machine load makes it unreliable.

## Provisional measurements

Command:

```sh
node eval/canvas-perf/bench-verynize.cjs --sizes 100,500,1000,2000 --runs 3 --no-profile --output eval/canvas-perf/results/verynize-after-has-fix.json
```

Comparison: `eval/canvas-perf/results/verynize-2026-11-04-sequential.json` (five baseline runs) versus `verynize-after-has-fix.json` (three requested runs). The machine is shared with other benchmark agents and this checkout's validation run; results are provisional. The lead must rerun sequentially before treating these as final performance claims. Raw samples record load averages at each launch.

| Nodes |      Runs before / after      | Pan handler ms before → after | Pan frame ms before → after | Zoom handler ms before → after | Edit sync ms before → after |
| ----: | :---------------------------: | ----------------------------: | --------------------------: | -----------------------------: | --------------------------: |
|   100 |             5 / 3             |                     5.6 → 2.0 |                 16.7 → 16.7 |                      5.6 → 2.1 |                 15.7 → 18.4 |
|   500 |             5 / 3             |                    46.7 → 6.7 |                 50.0 → 16.7 |                     47.9 → 7.6 |                 93.4 → 94.4 |
| 1,000 |             5 / 3             |                  166.9 → 22.5 |                166.7 → 32.3 |                   166.0 → 29.3 |               281.6 → 284.1 |
| 2,000 | 0 (1 partial) / 0 (1 partial) |                  671.0 → 64.4 |                666.6 → 67.0 |                   675.7 → 82.5 |               968.0 → 891.4 |

After-run one-minute load average ranged from **14.1 to 36.0** across launches (8 logical CPUs). Initial 1/5/15-minute averages: 14.1, 5.9, 5.9.

Both baseline and after commands hit the existing 60-second `selectAll` ceiling at 2,000 nodes on the first run. The harness stops remaining runs at that ceiling. The 2,000-node cells above are **one partial run**, with pan/zoom/edit captured before selection timed out; they are not three-run medians. All smaller after sizes completed three runs. No timing assertions or harness ceilings were changed.

The raw after-report `commit` records the research parent because the benchmark ran before committing the fix; the working tree already contained the selector replacements and source-scan exclusion. This report measures this fix only, with the original canvas implementation.

## Validation

- `npm install` and lockfile-only resynchronization completed; lockfile unchanged.
- `npm run build:ui`, `npm run lint:ui`, `npm run typecheck:ui`, and `npm run check`: pass.
- `npm run lint`: pass, with existing warnings in research/capture code.
- `node tests/canvas-css-invalidation.cjs`: pass independently and in the changed-test run (500 real canvas nodes, production CSSOM, focused layer actions).
- `npm run test:changed`: **207 passed, 3 failed, 0 skipped**, 1,202 seconds. Changing the lint command in `package.json` selected the full suite. This run shared the Mac with benchmarks and other agents.

The three failures were investigated without weakening tests:

| Test                         | Initial failure                                                              | Follow-up                                                                                                                                                                                                                                    |
| ---------------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/share-collab.mjs`     | Electron installation incomplete while the local binary download was pending | Reused the already installed identical Electron 42.11.18 binary; standalone head rerun passed.                                                                                                                                               |
| `tests/inspector-parity.cjs` | Timeout waiting for a Sonner toast to detach                                 | Standalone reruns passed on both head and unchanged `origin/docs/perf-research`.                                                                                                                                                             |
| `tests/web-cloudflare.mjs`   | Preview navigation destroyed the execution context                           | Unchanged research base also failed on navigation (`page.waitForNavigation` timeout). A standalone head rerun instead hit the dev-server startup deadline under load. WebKit link checks were skipped because that browser is not installed. |

The benchmark command completed with its recorded 2,000-node selection ceiling; it did not complete three runs at that size. No product changes were made to `web/app.js`, `web/canvas-interactions.js`, or `web/selection-chrome.js`.
