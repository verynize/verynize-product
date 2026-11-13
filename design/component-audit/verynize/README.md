# Verynize component audit — 2026-11-06

**Status: live library workflow verified; detailed update semantics established by source inspection, not a completed override-loss experiment.** No application source was changed. Build completed with existing CSS/font and x.png warnings.

## Isolation and method

Built with `npm run build:ui`. Launched using `env -u ELECTRON_RUN_AS_NODE npx electron . --user-data-dir=<repo>/design/component-audit/verynize/profile/audit-20261106 --use-mock-keychain`. The environment correction was required because the first launch treated Electron as Node. Nothing was copied from the user's profile. Continued without an account through onboarding. The isolated instance was restarted once to resolve accessibility process ambiguity and terminated after the audit; its profile was deleted.

Another worktree's Electron tests were running concurrently. Commands scoped only by app name sometimes surfaced that test window; subsequent experiments were scoped to the verified isolated window w-4078 (PID 55305). The user's running real-profile app received no design edits. Physical sequences used the shared lock; library experiments used semantic AX actions.

## Current capabilities

1. **Onboarding/isolation.** A fresh profile starts with sign-in and Continue without an account. [Fresh start](01-isolated-start.png). (A later onboarding capture was removed because it showed an account email.)
2. **Entry point.** Main menu → Templates opens a gallery containing All, Websites, Apps, Presentations, My templates, and Components. Actions include Add selection to library, Publish instance changes, Update instances, and import/export packs. [Gallery](04-template-gallery.png).
3. **Create library entry.** Selected the default Violet card, chose Add selection to library, entered **Audit Card**, and opened Components. Its card reports version 1 and one use in this file, with Insert and Delete controls. [Created library entry](05-library-created.png).
4. **Insert.** Insert closes the gallery and selects a cloned Violet card. The original and clone both appear as ordinary rectangle rows; the inspector offers standard geometry/fill controls with no component identity, Go to main, Detach, or Reset overrides controls visible. [Inserted instance](06-inserted-instance.png).
5. **Publish.** Published the inserted instance. The library reports **Version 2 · 2 in this file · 1 outdated**, with a Published “Audit Card” version 2 confirmation. [Published version](07-published-v2.png). An AX fill-field change to 123456 was attempted, but the thumbnail remained violet: that edit was not verified as committed. This is evidence of version publishing, not color propagation.
6. **Update.** Clicked Update instances. The gallery reports **Updated 1 instance**, and the outdated count disappears. [Updated instances](08-updated-instances.png).

## Source-backed behavior

Primary source: [web/views-templates.js](../../../web/views-templates.js), especially lines 18–49, 51–79. Existing coverage: [tests/agent-workspace-ui.cjs](../../../tests/agent-workspace-ui.cjs), component-library section around lines 310–350 (read, not run in this audit).

- The library is a localStorage list under `verynize-component-library`, shared across files in the same profile. It is not a dedicated main-component node stored in the design document.
- `addComponent` requires one selected root; a frame groups a multi-layer subtree. It stores `{id,name,version,updatedAt,nodes}` and marks the original root `libraryComponent:{id,version:1}`. The original is itself an instance of the library record.
- `insertComponent` clones the saved nodes with new ids, places the root near the camera, and adds `{id,version}` metadata to that root.
- `publishComponent` can publish a selected linked instance. It copies its current subtree into the library, increments the version, and updates only the publishing root's version. Other instances wait for Update instances.
- `updateInstances` walks pages and replaces every outdated linked root's complete subtree. It preserves the root id, parent and x/y position. Descendant ids are regenerated, and local descendant content is not merged. Other root properties come from the newly cloned library definition.
- `cloneTree` deletes `libraryComponent` from **every cloned node**. Nested library links are therefore stripped when cloning a saved definition/subtree; ordinary nesting of frames remains possible.
- Import/export supports a versioned template pack containing templates and components. This was visible but not exercised.

The existing integration test asserts that a published color reaches the older instance after an explicit update. That is an assertion in existing source, not a test result from this run.

## Gaps and evidence

| Gap                                               | Evidence and implication                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Main/instance relationship on canvas              | [Inserted instance](06-inserted-instance.png) shows ordinary rectangle rows and generic inspector. Source links roots only to a local library id/version, with no canonical main node id. Pen exposes distinct main/instance icons and Go to component; see [Pen audit](../pen/README.md).                                                                  |
| Live propagation                                  | [Published v2](07-published-v2.png) deliberately leaves one instance outdated; [update](08-updated-instances.png) is explicit. This is versioned library synchronization.                                                                                                                                                                                   |
| Persistent overrides                              | `updateInstances` removes the full old subtree and inserts a fresh clone. There is no per-property override map or merge in this path. Local changes can exist before updating but are not protected overrides. A live destructive-update demonstration remains unperformed.                                                                                |
| Dynamic App Shell content / slots                 | The library stores a generic node subtree and replaces it wholesale. There is no slot declaration or per-instance slot-content reconciliation in these functions. Independent page content inside a shell would need protection from replacement. Pen slot support remains unproven, so this is a product requirement gap, not a verified Pen parity claim. |
| Nested component links                            | `cloneTree` explicitly deletes libraryComponent on all cloned nodes, losing nested library identity.                                                                                                                                                                                                                                                        |
| Detach / reset / navigation controls              | Not visible in the captured instance inspector; the library API exposes list/add/insert/publish/updateInstances only. No matches for libraryComponent in web/src in this audit. Whole-document absence beyond the inspected paths is not proven.                                                                                                            |
| Variants and exposed properties                   | Stored library records and instance metadata contain no variant sets or exposed-property definitions; the captured gallery has no such controls. Figma-style property/variant requirements need a separate comparison rather than treating absence in Pen as proven.                                                                                        |
| Portable definitions and missing-library recovery | Document roots carry id/version, while definitions live in profile-local storage; packs are separate. Cross-profile missing definitions and recovery were not exercised.                                                                                                                                                                                    |

## Data model recommendations

Keep stable definition and descendant ids; represent instance overrides separately from inherited values. Give main/instance identity to Layers and inspector. Define named content regions whose local children survive updates, including nested component references. Provide Go to main, Detach, Reset property/all overrides, and explicit update conflict behavior. Treat variants/properties as separate model concepts rather than slash-separated names. Preserve the existing pack workflow as migration/import behavior rather than silently treating versioned copies as full components.

## Unproven / remaining work

A clean fill/text update with committed UI edits; override loss on actual update; nested component insertion; an App Shell with two independent child trees; detach/reset behavior outside inspected UI; persistence across reload; import/export and missing-library handling. The audit intentionally distinguishes missing implementation in the inspected library path from features not found in a limited UI inspection.

## Privacy and artifacts

Retained PNGs are linked above. Account/avatar regions were masked, including the generated offline avatar. No known personal email/avatar redactions remain. The profile and raw AX logs were removed. Build output under web/dist is generated/ignored; no source changes were made.
