# Merged Pen-parity audit fixes

Implemented on feat/layer-search-image-providers in the verynize-pen-parity worktree.

| Finding             | Result                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Integration failure | Generation test explicitly chooses Custom endpoint before its adapter fields. Both generation and settings flows pass without relaxed assertions.                                                                                                                                                                                                                                              |
| H1                  | Unknown provider IDs and invalid custom settings recover to defaults. Corrupt JSON is copied to image-provider.json.bak. Writes still validate new settings strictly. Tests cover recovery, get/set and subsequent generation.                                                                                                                                                                 |
| H2                  | Gemini skips thought parts and chooses the last inline image. Regression includes multiple images and a trailing thought image.                                                                                                                                                                                                                                                                |
| M1                  | Reject unsupported targets and invalid parents before generation; image targets replace src; new images use content bounds + 40px or explicit x/y/parent. Provider schema enumerates the catalog. Integration tests cover these paths.                                                                                                                                                         |
| M2                  | Tool description explicitly states the cost. Main-process service limits MCP to five attempts per rolling hour, shared across clients, for the current application process. Preference approval is implemented in agent-runtime-specific paths, not a reusable bridge approval API; the audit's rate-limit fallback therefore also protects external MCP clients. The sixth attempt is tested. |
| M3                  | Custom default is gpt-image-2; legacy api.openai.com gpt-image-1/dall-e records select openai_gpt_image_2. Custom-host keys are never migrated to the OpenAI key slot merely because custom settings were invalid.                                                                                                                                                                             |
| M4                  | Finder consumes useDesign's shared snapshot; no second document clone or JSON stringify. Active result ID survives edits and reopening.                                                                                                                                                                                                                                                        |
| M5                  | Both settings and generation dialog trim pasted keys. Settings displays the IPC error message. Tests cover surrounding whitespace and invalid embedded whitespace.                                                                                                                                                                                                                             |
| M6                  | Built-in Gemini uses /v1beta, confirmed against Context7's vendor documentation.                                                                                                                                                                                                                                                                                                               |
| M7                  | Decoded images and binary downloads are capped at 8,000,000 bytes. JSON envelope allows base64 overhead. Oversize regression passes.                                                                                                                                                                                                                                                           |
| L1                  | Removed 512/256 from available and accepted sizes.                                                                                                                                                                                                                                                                                                                                             |
| L3                  | Label is Nano Banana 2 Lite.                                                                                                                                                                                                                                                                                                                                                                   |
| L4                  | Shared IMAGE_FILL_TYPES in the document core contains frame and rectangle only.                                                                                                                                                                                                                                                                                                                |
| L5                  | Only photographic generation opts into selected-layer fills; vector generation inserts a layer.                                                                                                                                                                                                                                                                                                |
| L6                  | Abort controllers are keyed by caller; window close cancels only that window. Concurrent caller regression passes.                                                                                                                                                                                                                                                                             |
| L7                  | Test endpoint overrides are ignored when app.isPackaged is true. Packaged-mode regression passes without making a vendor request.                                                                                                                                                                                                                                                              |
| L8                  | Escape and X restore the pre-Finder selection; Enter commits the result. Both dismissal regressions pass.                                                                                                                                                                                                                                                                                      |
| L9                  | Command/Control-F also accepts code KeyF. Non-Latin key regression passes.                                                                                                                                                                                                                                                                                                                     |
| L10                 | A zero-argument render subscription reapplies the active canvas outline. Regression edits the document and checks the outline.                                                                                                                                                                                                                                                                 |
| L11                 | MCP SERVER_VERSION is 0.8.0.                                                                                                                                                                                                                                                                                                                                                                   |
| L12                 | Restored staging formatting in all six named files, reapplying only functional edits. Diff against staging: 93 insertions and 6 deletions across those files.                                                                                                                                                                                                                                  |
| Pure search tests   | integrations/find-layers.test.mjs covers tree order, cycles, snippets and exact short IDs. Automatically discovered by the integration manifest; no new tests/*.cjs files.                                                                                                                                                                                                                     |

Also repaired missing generateImage callback storage in setBridgeOptions, so the desktop bridge actually reaches the generation service.

## Validation

All commands below exited 0. Electron scripts ran one at a time.

- npm run build:ui — passed; existing unresolved x.png warning.
- npm run lint:ui — passed.
- npm run typecheck:ui — passed.
- npm run lint — passed with 143 warnings.
- npm run check — all JavaScript syntax and entry asset checks passed.
- node --test integrations/image-provider.test.mjs integrations/generate-image.test.mjs integrations/mcp.test.mjs — 21 passed, 0 failed.
- node --test integrations/find-layers.test.mjs — 1 passed, 0 failed.
- node tests/canvas-find-layers.cjs — all assertions passed.
- node tests/canvas-help-shortcuts.cjs — palette and help/shortcuts assertions passed.
- node tests/settings-image-generation.cjs — catalog, keys, relaunch, fill, centered insertion and undo passed.
- node tests/generation-image.cjs — providers, recovery, secure storage, trimming, cancellation isolation, rate limit and packaged override passed.
- node tests/generation.cjs — SVG sanitation/tracing and generation controls passed.
- node tests/platform-contract.cjs — 5 passed, 0 failed.
- node tests/settings.cjs — settings and persistence assertions passed.
- node tests/mcp-shell.cjs — shell tools, approval/access and cleanup passed.
- git diff --check — passed.

Formatted only changed files, preserving staging formatting in the six L12 files to avoid recreating the churn. Provider tests use fixtures, not paid vendor calls.

## Proof screenshots

Captured with temporary user-data directories at 1440×870 CSS pixels. Finder captures are at 2× device scale. Synthetic content only.

Directory: ../pen-research/verynize/ (relative to the worktree root)

- find-empty.png
- find-results.png — 3 results, middle active, canvas outline visible
- find-no-results.png
- find-id.png
- find-light.png
- settings-provider-open.png
- generate-dialog.png

### Codex plan image provider (2026-11-06)

Live verification on this Mac with system Codex CLI 0.166.0: `account/read`
identified `chatgpt`; an ephemeral read-only thread with approval policy `never`
and `features.image_generation=true` generated one blue teapot image. No shell
or file-write tool was invoked. `item/completed` carried:
`{type:"imageGeneration",id:"exec-…",status:"completed",revisedPrompt:"…",
result:<1818872 base64 characters>,transparentBackground:false,failure:null,
savedPath:"<CODEX_HOME>/generated_images/<threadId>/exec-….png",
generationId:"…",startedAtMs:<number>,completedAtMs:<number>}`.
The turn completed successfully. The generated schema has no attachment download
RPC for `fileId`; the implementation tries the thread's generated-images folder
then gives an explicit unsupported-attachment error. The exec fallback is only
used when app-server is explicitly unsupported, never after a submitted turn.
Existing v2 records lack a choice marker; conservatively preserve their provider
rather than overriding a potentially explicit selection. New automatic records
persist `providerChosen:false`, allowing Codex to become the default on sign-in.
