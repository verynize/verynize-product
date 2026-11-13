# Import fidelity implementation proof

Branch: `fix/import-fidelity`, based on staging `18fe4f72bf7fcddaee6aaa5c1f73c7872763abea`.

The original audit scripts were copied, with only their repository paths redirected to this worktree. Originals were not edited. Final copies and raw output are in `/tmp/verynize-import-proof/{repro.mjs,extra.mjs,results.json,extra-results.json}`. Baseline evidence is the supplied audit's `results.json` and `extra-results.json`.

| Gap                             | Before                                                | After                                                                                                                                      | Regression evidence                                                                               |
| ------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| HTML inline SVG                 | Image without src                                     | One embedded SVG image; original viewBox, dimensions and path survive                                                                      | Decoded-path unit assertions; fixture 31; audit svg                                               |
| JSX inline SVG                  | Empty frame per SVG/path                              | One sanitized embedded image                                                                                                               | Same unit assertions; audit svg-jsx                                                               |
| Arbitrary border/radius/outline | Ignored shorthands, missing outline                   | Shared CSS expansion; side borders, 1–4 corner radii, outline                                                                              | HTML style/class/JSX parity test; fixture 32; audit css-border/tw-border/html-tw-border           |
| Elliptical radius               | Unsupported/silent                                    | Horizontal-radius approximation with warning in Tailwind path                                                                              | Regression warning assertion                                                                      |
| URL background                  | Tailwind URL dropped                                  | HTML embeds URL backgrounds regardless of CSS origin; JSX embeds data URLs and schedules HTTP(S) backgrounds                               | Parity test; fixture 34; audit bg-data/bg-http/bg-tw                                              |
| Hidden JSX size cap             | 2,000,000 chars below tool's 5,000,000                | Parser aligned to 5,000,000 with stage-specific error                                                                                      | >2M image test for HTML and JSX; audit inline-cap                                                 |
| Loopback HTTP image             | Deferred public-host rejection, silent success        | Explicit HTML allowRemote embeds through the scoped loader                                                                                 | Real HTTP server test; audit tool-localhost-after: image src embedded, 4 server hits across cases |
| Missing/relative assets         | Empty images or silent missing state                  | Import warnings include reasons; unresolved images carry durable assetStatus/assetError; deferred jobs retry conflicts and expose failures | Relative/404 tests; fixture 33; audit relative-image                                              |
| Naming                          | Repeated Imported page                                | Explicit name, title, file basename fallback, unique Imported page N; root data-name supported                                             | Concurrent/name tests; audit prepared-placement and jsx-data-name                                 |
| Placement                       | Explicit root coordinates overlap                     | MCP imports and prepared HTML imports default auto; preserve remains explicit                                                              | Concurrent placement test; audit extra explicit-overlap now x=0 and x=180                         |
| Node overflow                   | Misleading shared validation failure                  | Expanded node preflight reports existing/incoming/page+document limits, without mutating original                                          | Atomic regression; audit 2500-buttons reports incoming=5001/page limit=5000                       |
| HTML element overflow           | Truncated import                                      | Atomic error names HTML parse stage and 4000-element limit                                                                                 | Audit element-cap                                                                                 |
| Text/control loss               | display:contents loose text and control values absent | Loose text, input value/placeholder, textarea and selected option retained                                                                 | Visible-text regression; fixture 33; audit contents/input                                         |
| Concurrent file imports         | One writer rejected                                   | Bounded retry reads latest document inside each acquired lock; both roots stored                                                           | Parallel import_html regression; audit parallel-file                                              |

The shared node caps and cloud-sync files were not edited. Preflight reads `MAX_NODES_PER_PAGE` and `MAX_NODES_PER_DOCUMENT` from the shared module, falling back to 5000/10000. Its test also reads those constants, so the sibling cap increase can merge without a hard-coded limit assertion.

## Validation

Implementation commits: `cd3950edd4afc18f62aeda4f17c7f75022845551` and `9774ee0` (shorthand precedence and desktop title fallback).

- `node eval/run-fidelity.mjs`: **34/34 fixtures, 170/170 checks passed**; final log `/tmp/import-fidelity-last.log`.
- `node --test integrations/*.test.mjs`: initial parallel run exposed mapper regressions plus timing failures; those mapper regressions were corrected. Final `node --test --test-concurrency=1 integrations/*.test.mjs`: **398 passed, 0 failed, 0 skipped**, 59.308 seconds; log `/tmp/import-complete-tests.log`.
- New importer regression file: **8 passed, 0 failed**; all are included in the 398-test final run.
- `npm run build:ui`: passed. `npm run lint`: passed with warnings. `npm run check`: **All JavaScript syntax and entry asset checks passed**. Logs `/tmp/import-build.log`, `/tmp/import-lint-last.log`, `/tmp/import-check-last.log`.
- `git diff --check`: passed.
- Audit `repro.mjs` and `extra.mjs`: completed against this branch, with results in `/tmp/verynize-import-proof/`.
- `npm run test:changed`: **70 passed, 4 failed, 0 skipped**, 734.6 seconds, 74 selected tests. Log `/tmp/import-changed.log`. This run started before the final fixes. All four failures were subsequently checked:
  - `integrations/codec-import-tools.test.mjs`: fixed preservation of meaningful CSS-derived root names; final isolated rerun **2/2 passed** (`/tmp/import-wiring-final.log`), also passed in the 398-test run.
  - `tests/html-import-dialog.cjs`: fixed desktop basename being treated as an explicit override of `<title>`; isolated rerun **PASS** (`/tmp/import-dialog-rerun.log`).
  - `integrations/generate-image.test.mjs`: parallel run lacked a temporary `interrupted` marker; passed in the final serial integration run.
  - `tests/chat-composer-menu.cjs`: parallel run missed expected terminal-output text; isolated rerun **PASS** (`/tmp/import-chat-menu-rerun.log`).
  - The full 74-test selection was not repeated after these targeted reruns; it is not reported as an all-pass run.

## Files and scope

- `desktop/html-import.cjs`: file basename is a fallback, preserving page-title precedence.
- `integrations/codec-html.mjs`: SVG capture, CSS-origin background extraction, visible text, scoped images, naming, atomic parse overflow.
- `integrations/tailwind-map.mjs`: shared shorthand expansion and URL background mapping.
- `integrations/design-edit.mjs`: SVG subtree serialization, label alias, placement, names, expanded-node preflight, missing assets.
- `integrations/jsx-codec.mjs`: parser character budget and stage-specific error.
- `integrations/codec-source.mjs`: import options, fresh-document apply and generic-name uniqueness.
- `integrations/design-tools.mjs`: tool schemas/descriptions, warning merging, asset completion diagnostics/retry, file-backend contention retry.
- `integrations/design-knowledge/skills.mjs`: importer usage guidance.
- `integrations/import-fidelity.test.mjs`, `integrations/codec-html.test.mjs`: regression coverage and updated eager-embedding expectation.
- `eval/fidelity/fixtures/31–34`, `eval/lib/adapter.mjs`: foreign-markup fixtures and property accessors, including decoded SVG markup.

Only touched files were formatted with `npx vp fmt <files>`. Several existing compact modules expand substantially under the formatter; no generated bundles are committed.

## Limits and remaining scope

- Elliptical radii and background repeat/position are approximations, with warnings; they are not new canvas primitives.
- Low-level document conversion APIs retain source coordinates for lossless conversion. Prepared imports and MCP import tools use auto placement by default; callers can request preserve.
- HTML remote opt-in is scoped to that import's loader. The generic deferred fetcher's public-HTTPS restriction remains intact, including for JSX remote backgrounds. No hosted-cloud network policy was relaxed.
- Parser/resource limits still exist (4000 HTML elements, 5000 parsed JSX elements, sanitizer/image budgets). HTML overflow now fails rather than silently truncating. Low-level `allowPartial` can explicitly permit HTML parser truncation; node-schema limits remain mandatory.
- File-backend concurrency is covered with real concurrent imports. No claim is made about a historical live-editor overwrite, the separate desktop-dialog stale-snapshot hazard, or exact Pencil-board visual parity; the original boards were unavailable.
