# TypeScript migration

The renderer canvas and `web/document-core.js` remain imperative/classic scripts. There is still one runtime document validator.

## Checking JavaScript

`npm run typecheck:ratchet` runs four independent allowJs/checkJs projects: desktop, legacy-web, integrations and cloud. Each checks its complete import graph; totals overlap and must not be summed as unique errors. Existing UI projects remain strict and clean under `npm run typecheck:ui`.

The checked-in baseline limits both each area's total and each file/diagnostic-code count. `npm run typecheck:baseline` can only lower the limits: it rejects increases, including when updating. CI cannot rewrite the baseline. Compiler crashes, unreadable configs and unparseable diagnostic output fail the check. Detailed logs go to ignored `.typecheck/*.log`. Integration test files are not included in the production integration baseline; tests are a later phase.

## IPC and renderer boundaries

`desktop/ipc-contract.ts` maps all 165 invoke channels to the existing renderer API signatures, including nested API groups. Preload's invoke wrapper and main's registration helper use this map via erased JSDoc imports. Raw IPC arguments still cross an untyped Electron boundary; sender-origin checks and runtime payload validation remain essential.

The synchronous `agentBridge.onCall` unsubscribe and `reply` return values are corrected. `listAllowRules` accepts the optional `projectKey` actually forwarded by preload. `createProject` and `openProject` now describe their actual argument/result shapes.

Remaining desktop diagnostics include inferred options/queue types (`repositories` workspacesRoot callback, ChatGPT welcome callback return, Project.repositoryRoot augmentation, usage/memory registration options). These are not demonstrated runtime failures. Other legacy-only methods still use the existing `Untyped` signature: the channel map prevents name drift but does not claim payload completeness for them. Feature registration functions should adopt the shared Handle type as each desktop module is migrated.

`web/types/legacy-globals.d.ts` reuses existing island declarations for design, accounts, preferences and platform, and adds cloud-room/share, history, cache and export helpers. It is an initial boundary inventory, not complete coverage of every canvas extension. Missing canvas/service shapes and DOM narrowing remain visible in the legacy-web baseline; no catch-all Window index signature is used.

## First strictly typed integration cluster

`integrations/src/preferences.mts` and `verification.mts` own durable agent preferences and revision-bound verification/repair state. Both are checked with `strict: true`, `noUnusedLocals`, `erasableSyntaxOnly` and `noEmitOnError`. There is no diagnostic allowance for these sources. The ratchet builds this project first, so consumers see current declarations rather than stale output.

`npm run build:integrations` emits ESM `.mjs` and `.d.mts` into ignored `integrations/generated/`. Stable `integrations/preferences.mjs` and `verification.mjs` re-export the generated runtime. This deliberately uses a build rather than Node runtime stripping: Electron still loads raw JavaScript, the desktop has no TypeScript bundler, and the same paths are imported by CLI/MCP and server code. The modules have no relative runtime assets to relocate. No tsdown dependency or desktop bundle is necessary for these two leaves.

The build runs during dependency installation, UI/app builds, CLI/MCP commands, test-runner preparation, direct server starts and macOS packaging. After editing the sources, run `npm run build:integrations` before invoking individual test scripts directly. The affected-test graph follows generated imports back to `.mts` source even before output exists. Packaging copies the generated ESM alongside the existing wrappers.

Preference JSON is read as unknown and narrowed at the boundary. Malformed persisted timestamps become null (or fall back to a valid creation timestamp); valid stored preferences retain their format and order. Tests cover malformed records, serialization across stores, rejection recovery, receipt invalidation and the finish gate. A real compiler test checks valid calls and rejects numeric revisions/IDs without suppression directives.

The document store/edit/tools/schema-wrapper cluster and the remaining codecs, assets, fonts and transports remain JavaScript under checkJs. Converting those requires shared document, backend, node and codec contracts; the trial full rename's diagnostics are not baselined or suppressed. The document schema stays in `web/document-core.js`.

## Later phases

Continue the integration migration by dependency cluster, then cloud, desktop, legacy web and tests. Model the shared document/backend and codec types before converting the larger graph. Keep fidelity tests and runtime entry paths intact; do not replace the shared schema with a second implementation.
