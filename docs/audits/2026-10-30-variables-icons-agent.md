# Variables and Icons audit — 30 October 2026

Agent: `audit_variables_icons`. Scope: source audit and non-UI regression checks. The root agent owns the live Wonder session and its new screenshots. This report does **not** represent a fresh Wonder interaction or full parity certification.

## Evidence and coverage

Read the product `AGENTS.md`, island ownership contract, `docs/wonder-canvas-spec.md`, and `docs/implementation-status.md`. Visually inspected the existing reference screenshots [41 — Variables](../../design/wonder/41-variables.png) and [42 — Create variable menu](../../design/wonder/42-new-variable-menu.png).

Screenshot 42 establishes the five creation categories: Colors, Dimensions, Numbers, Font family, and Font weight. Screenshot 41 establishes nested `brand` grouping with `on-primary` and `primary` children. These are historical screenshots; the live run should establish the current application's exact controls.

The table below records the state **before** this session's fixes; later sections mark which gaps were closed.

| Workflow                    | Verynize implementation                                                                             | Evidence boundary / gap                                                                                            |
| --------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Five variable categories    | Color tokens plus four typed variable types                                                         | Present in `variables.tsx` / `vars.ts`; existing creation tests cover four typed types                             |
| Find variables              | Name and value search, grouped by type                                                              | Slash names remain flat; reference shows a collapsible name hierarchy                                              |
| Edit variables              | Color picker; typed inline value; font-weight selector                                              | Color and typed creation use different validation paths                                                            |
| Rename variables            | Double-click typed names                                                                            | Color names are non-interactive text; no color rename control                                                      |
| Delete variables            | Removes bindings while preserving resolved value                                                    | Existing typed tests cover this; color deletion uses hidden legacy DOM                                             |
| Bind properties             | Radius, gap, padding, stroke width, font size, letter spacing, line height, opacity, family, weight | Width/height, individual sides, shadow, stroke color, page background and SVG colors are outside the binding model |
| Mix colors and typed values | Fill/text/shader `token` plus independent `bindings`                                                | Functional foundation present; global color-token creation can invalidate typed variables                          |
| CSS export                  | Colors and typed values in one `:root`                                                              | Distinct valid names can produce the same CSS identifier                                                           |
| Icon library                | Upload/paste SVG, add selection, grid/list, search, rename/delete, insert                           | Inserted icon is an image with embedded SVG, not editable SVG colors                                               |
| Icon reuse                  | Each insertion copies source                                                                        | No library instance reference or propagation from library to inserted nodes                                        |
| Icon validation             | SVG prefix and length checks in document validators                                                 | Malformed base64 accepted; insertion can throw before error handling                                               |

## Findings

### V1 — Color creation can overwrite a bound variable and create invalid mixed-variable documents (high)

`web/src/islands/inspector/variables.tsx:330` calls `createColorToken()` from `legacy.ts:76`, which clicks the legacy handler in `web/app.js:32`. That handler writes `design.tokens[name.trim()] = '#a58bdd'` directly after checking only three untrimmed reserved strings.

Consequences:

- Creating an existing color name resets its value and changes every bound layer without a duplicate-name error.
- Creating a color with the name of an existing dimension/number/font variable creates a document rejected by `validateVariables` (`integrations/design-store.mjs:31`).
- Leading/trailing whitespace bypasses the reserved-name check before the later trim.
- Typed creation already uses `nameError` (`vars.ts:119`), validates both namespaces and uses a validated document transaction, so the UI behaves inconsistently across its five creation categories.

Suggested implementation: route color creation through the same name validation and transaction flow as typed creation, use a collision-free suggested name, validate against the current document after the naming dialog resolves, and open Variables after successful creation. Preserve legacy menu/test contracts by delegating to that canonical implementation or fixing the canonical legacy handler.

Regression: bind an existing color, attempt duplicate creation and assert no value/binding change; attempt a name used by a typed variable; reject padded reserved names and invalid names; assert no extra undo checkpoint on failure. Test successful creation from a collapsed panel.

### V2 — CSS export silently aliases different variables (medium)

`vars.ts:237` and `integrations/design-edit.mjs:708` both slug variable names into CSS names. `space/md`, `space-md`, `space md`, and `space.md` all become `--space-md`. The validator allows these distinct names, including across color and typed namespaces.

Executed a Node reproduction with valid `tokens: {'space-md':'#123456'}` and `variables: {'space/md':{type:'dimension',value:16}}`. `validateDocument` succeeds, and `variablesCss` returns:

```css
:root {
  --space-md: #123456;
  --space-md: 16px;
}
```

The typed value overwrites the color in CSS. Simply fixing the exporter is insufficient: the same naming convention is used by JSX serialization and class parsing (`integrations/tailwind-map.mjs:7,45–46`).

Suggested implementation: use one collision-aware mapping across descriptions, export, serialization and parsing, or reject ambiguous export with a clear error and list of names. Avoid silently changing the established mapping in one path alone.

Regression: collision within colors and across color/typed variables; distinct deterministic exported identifiers or explicit rejection; round-trip JSX binding retains its original variable.

### I1 — An accepted icon can throw before the insertion error handler (medium)

`integrations/design-store.mjs:35–44` checks only a base64 SVG prefix and length. The renderer validator in `web/app.js` has the same limitation. `icons.tsx:142` decodes with `fromBase64(...)` before entering its `try` block.

Executed a Node reproduction: a document containing `src: 'data:image/svg+xml;base64,***'` passes `validateDocument`, but `atob('***')` throws `InvalidCharacterError`. An imported/saved malformed asset therefore creates a visible library item that fails on insertion rather than a handled error.

Suggested implementation: move decoding/parsing into the guarded insertion block and reject invalid SVG with a useful toast. Strengthen both document validators consistently if the document contract is changed. Do not insert a broken source after merely falling back to 24×24.

Regression: malformed base64, valid base64 containing non-SVG text, invalid XML, and valid SVG. Failed insertion must not add a node or undo checkpoint; valid insertion retains intrinsic dimensions.

### I2 — Icon color variables do not drive SVG content (functional gap)

`icons.tsx:146` inserts an `image` node with `color: 'transparent'` and copied `src`. Fill/token controls in `properties.tsx:372` change the node background, while SVG path fill/stroke remains inside the embedded source. The existing Wonder spec records an SVG `Colors` inspector (`docs/wonder-canvas-spec.md:318,406`). The current model has no SVG node or icon color bindings.

Suggested implementation sequence: confirm current Wonder behavior in the live session; specify a sanitized editable SVG/color model; support color references, export and codec round trips; then expose compatible variable controls. This is larger than a cosmetic icon-panel change. Do not claim icon–variable mix-and-match parity from changing the image background.

### V3 — Variable name hierarchy and color rename are missing (functional gap)

Reference screenshot 41 shows an expandable `brand` group. `variables.tsx:380` renders a flat list of full names inside type groups. Typed rows can rename, but `TokenRow` displays color names as a plain span (`variables.tsx:106`). These gaps complicate a real token library, even though color creation and binding are available.

Suggested implementation: share name editing across color/typed rows and preserve all references on rename; add slash-based folder grouping after confirming group behavior in the live Wonder run. Keep search able to match full paths.

## Validation performed

Executed from `verynize-product/`:

```sh
node --test integrations/variables.test.mjs
```

Result: **7 tests passed, 0 failed**. Ran the independent Node reproductions for CSS collision and malformed icon acceptance described above. Did not launch Electron or control the desktop; the root agent was using Wonder.

Existing UI coverage to extend: `tests/inspector-parity.cjs:62–130` (typed creation, binding, update, detach/delete, fonts, CSS) and `tests/canvas-page.cjs:59–81` (paste SVG, simple sanitization, insertion, selection import, list and undo). These tests were inspected, not executed in this audit.

## Implementation handoff

Prioritize V1 and I1 as bounded reliability fixes. Coordinate V2 across UI and headless codec ownership. Keep I2 and V3 as explicitly tracked parity gaps until implemented and evidenced. Preserve all pre-existing dirty files, especially `package.json`, desktop modules and canvas interaction/styles. This audit added only this document and changed no application code.

## Implemented follow-up (same audit session)

The root agent authorized bounded fixes after reviewing this audit:

- **V1 fixed:** the legacy color creation handler now trims and validates names, checks both color and typed namespaces after the dialog resolves, proposes an unused name, validates a cloned document before checkpointing, and avoids applying the result after a document replacement. Successful creation preserves selection and opens Variables through the island wrapper.
- **V2 mitigated at CSS export:** both UI and headless CSS exporters reject colliding CSS identifiers with a message naming the two variables. Copy/save export displays the error instead of reporting success. The existing naming convention remains unchanged; JSX serialization of ambiguous names is still a separate limitation, so this is not a global token-naming redesign.
- **I1 fixed at insertion:** decode and SVG parse now run inside error handling. Invalid assets produce a notification and do not insert a layer. Valid assets are sanitized again before insertion. The persisted icon validator remains permissive for compatibility; malformed stored assets are handled, not silently repaired.

Added `tests/inspector-variable-library.cjs` for duplicate/cross-type/reserved-name creation, successful reveal/selection/undo, clipboard preservation on export collision, and malformed base64/non-SVG/XML insertion. The root agent must wire this new file into the test script because `package.json` contains pre-existing user changes. No Electron run was started by this agent while the Wonder session was active.

Validation after edits: `node --test integrations/variables.test.mjs` **8/8 passed** (including new color/color, color/dimension, and dimension/number CSS-collision regressions); `npm run lint:ui` passed; `npm run typecheck:ui` passed; `node --check web/app.js` and `node --check tests/inspector-variable-library.cjs` passed. Existing dirty files were preserved, and no commit was made. The other agent independently edits `bindVariable` in `vars.ts`; this agent edits only its `variablesCss` function.

## Fresh Wonder evidence and bounded SVG Colors implementation

The root agent's new [13 — Icon color variable](../../design/wonder/2026-10-30/13-icon-color-variable.png) shows a pasted SVG with its actual **Colors** property bound to `accent` and its Opacity bound to `strength`. The capture does not show the background, so independence from it is not established by this image. This upgrades I2's reference from the historical spec to fresh runtime evidence. Screenshot 12 establishes the number convention: `60` represents 60% opacity.

Implemented an original, deliberately bounded equivalent for **simple monochrome imported SVG images**:

- New `svg-colors.tsx` exposes a Colors row, color picker and color-variable picker, detach, and restore-original actions. Multicolor SVGs, CSS styles/classes, references, gradients, effects and catalog-generated icons are excluded from this control. Unsupported images keep their original rendering.
- The original embedded `src` remains unchanged. Optional image fields `svgColor` (six/eight digit hex) and `svgColorToken` describe the paint. Both document validators check these fields. Existing `iconColor` is reserved for catalog icon regeneration, so this implementation does not overload it.
- The shared `node-style.js` renders the actual SVG alpha silhouette with the chosen paint. The layer background is independent. Canvas and headless HTML export use the same mapping; token changes resolve at render time. Token rename/delete helpers preserve references/resolved paint.
- JSX uses explicit `data-svg-color` and `data-svg-color-token` attributes so source, paint and binding survive a read/write round trip. The public node type remains `image`; a new SVG node type was not introduced.
- `integrations/svg-colors.test.mjs` verifies shared shape/background styles, variable changes, rename/delete, JSON reload, HTML export, unchanged source, JSX round trip and schema rejection. The combined variables, SVG colors, node-style and design-edit runs pass **38/38**.
- The existing new UI test now also checks actual screenshot pixels (green shape center, gray outside), UI variable propagation, detach, reload, export and restoring the original image. The final Electron pass is recorded below. Clipboard checks no longer overwrite the system clipboard; launch/cleanup handles failed Electron startup.

This supports one paint for a simple monochrome SVG. It does not implement per-color replacement on multicolor artwork or claim full Wonder Icons parity.

## Electron evidence — first completed pass

`VERYNIZE_EVIDENCE_DIR=design/verynize/2026-10-30 node tests/inspector-variable-library.cjs` passed after rebuilding the combined UI. It verifies creation rejection/reveal/undo, export-collision errors, malformed assets, SVG variable updates, real rendered shape pixels, independent background, multi-selection detach with different colors and missing-variable fallback, reload/export/restore, and no uncaught renderer errors. Screenshot pixels are decoded through an sRGB canvas with a two-level quantization tolerance because macOS `nativeImage.toBitmap()` converts into display color space; the unpainted sample avoids resize handles.

- [SVG variable binding in Verynize](../../design/verynize/2026-10-30/svg-color-variable.png)
- [Editable workflow recreation in Verynize](../../design/verynize/2026-10-30/workflow-canvas.png)

The workflow screenshot was captured from the root agent's `workflow.verynize.json` in an isolated temporary profile. Eight layers rendered, the SVG tint was present, and visual inspection found the title, icon and grid inside the artboard. The first native 2× PNG export exposed a separate scaling issue: a 1600×1140 bitmap contained 800×570 artwork at its upper-left. That initial export is retained as before-fix evidence; the corrected final export is verified below.

SVG mask sizing now follows `contain`, `cover`, `fill` and `none`; `scale-down` currently falls back to contain. Per-color SVG replacement, complex SVG effects, and exact scale-down sizing remain outside this bounded implementation. Multi-selection detach now preserves each selected image's own resolved paint.

## Final verification and artifacts

The desktop was released by the root agent and every Electron command below ran **sequentially**, using temporary profiles that were closed and removed afterward. Both new suites are registered in `package.json` → `test:canvas`; the lockfile resync produced no lockfile diff.

| Command                                     | Final result                                                                                                                                                                                                                  |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run build:ui`                          | Passed with existing unresolved asset warnings for `x.png` and `…`                                                                                                                                                            |
| `node tests/inspector-variable-library.cjs` | Passed on the latest combined build; safe variable creation, export collision, malformed icon handling, actual SVG pixels, variable propagation, independent background, multi-selection detach, source/reload/export/restore |
| `node tests/inspector-variable-binding.cjs` | Passed; fill detach with alpha/mixed selection/missing token/undo/redo/reload, scalar override replacement, individual corners/borders and independent gaps                                                                   |
| `node tests/canvas-page.cjs`                | Passed; page, panel accordion and icon-library regression                                                                                                                                                                     |
| `node tests/inspector-parity.cjs`           | Passed; color picker, typed variables, fonts, 0.5×/4× PNG and PDF save, layout controls                                                                                                                                       |
| `node tests/render-export.cjs`              | Passed; real pixel coverage at 0.5×/1×/2×/4× and unchanged CSS layout measurements                                                                                                                                            |
| `npm run lint:ui` / `npm run typecheck:ui`  | Passed                                                                                                                                                                                                                        |
| `git diff --check`                          | Passed                                                                                                                                                                                                                        |

The properties agent fixed the native scaling bug by setting the Electron zoom factor **after** navigation. The regenerated [workflow export](../../design/verynize/2026-10-30/workflow-export.png) is **1600×1140** and fills the intended artboard extent. PNG header dimensions and opaque pixels in the right/lower, bottom-center and right-center regions were checked; [export-verification.json](../../design/verynize/2026-10-30/export-verification.json) records the result. Visual inspection confirms the title, icon and grid fit, with no extra transparent half-canvas. The [before-fix export](../../design/verynize/2026-10-30/workflow-export-before-scale-fix.png) is retained only as bug evidence.

Additional actual-product proof: [individual corners](../../design/verynize/2026-10-30/01-individual-corners.png), [individual border widths](../../design/verynize/2026-10-30/02-individual-border-widths.png), [SVG variable binding](../../design/verynize/2026-10-30/svg-color-variable.png), and [canvas recreation](../../design/verynize/2026-10-30/workflow-canvas.png). These are Verynize screenshots, separate from the Wonder reference directory. No application commits were created by this agent.
