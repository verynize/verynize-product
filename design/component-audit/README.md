# Components, instances and slots (page shell / app shell): audit and phase 1 spec

Research, 2026-11-06:

- [figma/README.md](figma/README.md): live Figma capture. Native **Slot** properties were proven: a slot holds ordinary layers per instance, and that content survives edits to the main ([17](figma/17-different-slot-content.png) → [18](figma/18-header-update-preserves-slots.png)). Detach turns a slot into a plain frame and keeps its content ([30](figma/30-detached.png)).
- [pen/README.md](pen/README.md): Pen, captured live plus Pen's own schema. A main component is a node with `reusable`. An instance is a `ref` whose `descendants` is a flat override map keyed by id path. A slot is `Frame.slot`, and an instance replaces the slot's subtree with its own content.
- [verynize/README.md](verynize/README.md): what Verynize has today. A library kept in localStorage that copies nodes. "Update instances" replaces each whole subtree, so edits made in an instance are lost. There is no main/instance link on the canvas, and no detach, reset or slots.

The code audit recommends **materialized instances**: an instance is made of real nodes on the page. Hit testing, selection, cloud per-key operations, lazy pages, export and agent tools all assume every node is a real node with its own id, so render-time expansion would have to be threaded through every one of them.

## Phase 1 scope

In scope: main components, instances, overrides per property, slots (default and modified), detach, reset overrides, go to main component, a Components panel with an **App shell** preset, MCP/agent tools, layers and inspector and canvas indicators, and tests.

Deferred to phase 2: variants and component sets, component properties (text, boolean, instance swap), slot minimum and maximum counts and preferred instances, cross-file libraries, pushing overrides to the main, and migrating the old `libraryComponent` library. The old library keeps working unchanged.

## Data model (stored on ordinary nodes, schema in `web/document-core.js`)

| Field                                | On                                                       | Meaning                                                                         |
| ------------------------------------ | -------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `component: true`                    | a frame                                                  | This frame is a **main component**. It can be on any page, nested or top-level. |
| `instanceOf: "<main id>"`            | instance root (frame)                                    | The main this instance follows.                                                 |
| `sourceId: "<main node id>"`         | every linked node inside an instance, including its root | The node in the main that this node copies.                                     |
| `overrides: string[]`                | any linked node                                          | Keys this node owns locally; the sync never writes them.                        |
| `slot: true` (+ optional `slotName`) | a frame that is a descendant of a main                   | A content region.                                                               |

### Rules

- **Always local, never synced:** `id`, `parentId` of the instance root, `x`/`y` of the instance root, and the link fields themselves.
- **Synced:** every other key of a linked node is copied from its source unless it is listed in `overrides`. That includes `w`/`h` and `name`; editing them in the instance makes them overrides.
- **Marking overrides.** A shared, pure `syncComponents(prev, next)` runs at one central point before every render and save, and in the headless transact.
  - It diffs `prev` against `next`.
  - A changed key on a linked node becomes an override, but only when its new value differs from the source's value.
  - A changed key on a main or a main descendant is propagated to every linked node that has not overridden it.
- **The sync must be deterministic and idempotent.** Two clients that apply the same operations reach the same document, and running the sync twice changes nothing.
- **Changes to the main's structure.**
  - A child added to the main is added to every instance.
  - A child removed from the main is removed from instances.
  - A child reordered in the main is reordered in instances.
  - Ids of materialized nodes are derived stably from (instance root id, source id), so every client produces the same ids.
- **Inside an instance, outside any slot.**
  - Deleting an inherited node hides it (an override of the existing visibility key) rather than unlinking it.
  - A node added there is local: it has no `sourceId`, and the sync keeps it.
- **Slots.**
  - **Default state:** the slot frame in the instance follows its source, and its children follow the main slot's default children.
  - **Modified state:** as soon as a child of the instance's slot is added, removed, reordered or edited, `"children"` is added to that slot frame's `overrides`. From then on its children are local and are never synced or removed.
  - The slot frame's own properties (size, layout, fill…) keep syncing unless they are overridden.
  - Reset on the slot returns it to Default.
- **Nested instances.**
  - A main may contain instances of other mains. The sync runs in dependency order, inner mains first.
  - A main may not contain an instance of itself, directly or indirectly. Validation and the UI both reject such a cycle.
- **Detach.**
  - Remove `instanceOf`, `sourceId` and `overrides` from the nodes linked to the detached main.
  - A nested instance inside stays an instance of its own main. Its nodes are re-pointed: `sourceId` becomes the `sourceId` of the source node they referred to.
  - Slot frames become plain frames and keep their children.
- **Reset overrides:** clear `overrides` on the selected node, or on every node in the instance, then re-sync.
- **Duplicate, copy and paste.**
  - Duplicating or pasting a **main** creates an **instance** of it, as in Figma.
  - Duplicating an instance creates an instance that keeps its overrides and slot content.
- **Deleted or missing main.**
  - Instances keep their links and keep rendering their last state.
  - The inspector says the main component is missing and offers Detach.
  - The sync skips them. Undo brings the main back.
- **Undo:** the changes the sync makes belong to the same undo step as the edit that caused them.
- **Validation:**
  - Only types are checked: strings, a boolean, an array of strings, and `slot` allowed only on frames.
  - A dangling `instanceOf` is **not** an error, because of lazy cloud pages and partial documents.
  - `documentSafety` must never reject a document because of these links.

## UI

- **Commands, listed in `canvas-interactions.js` and shown in the context menu, command palette and shortcuts drawer:**
  - Create component (`⌥⌘K`): for one frame; for several layers it first wraps them in a frame.
  - Create instance.
  - Go to main component.
  - Reset overrides.
  - Detach instance (`⌥⌘B`).
  - Convert to slot / Remove slot (for frames inside a main).
- **Layers panel icons:** a filled four-diamond for a main, a hollow diamond for an instance, a square-plus for a slot. Mains and instances use the component purple color token, slots the slot pink token. Inherited instance children show a muted purple label, and local slot children a normal label.
- **Canvas:**
  - Selection outline and name label in component purple for mains and instances; a dashed outline for an instance.
  - A pink outline for a selected slot, and a "+" affordance on an empty slot.
- **Inspector, new Component section.**
  - On a main: its name, "Create instance", the instance count, and the list of its slots.
  - On an instance: the main's name (click it to go to the main), Reset overrides (with a count), Detach, and each slot with a **Default** or **Modified** badge.
- **Components panel (left sidebar):**
  - Lists every main in the document, with search; click or drag inserts an instance.
  - An **App shell** preset creates a main component "App Shell": a header (title and nav), a sidebar (items), and a `Content` slot, built with auto layout and design tokens.
- Colors are tokens in `web/src/styles/globals.css`, never raw values. Icon-only buttons have an `aria-label`.

## Agents (MCP)

- `design-tools.mjs` `nodeFields` accepts the new fields.
- New tools: `create_component`, `create_instance`, `detach_instance`, `reset_overrides`, `set_slot`.
- The JSX codec writes `data-component`, `data-instance-of` and `data-slot` attributes so agents can see instances and slots.
- Headless edits run the same shared sync.

## Implementation notes (phase A: core engine)

The engine is `web/component-core.js` (`window.VerynizeComponents`; Node: `integrations/component-core.mjs`). Its tests are `integrations/component-core.test.mjs` and `tests/components.cjs`. Where the code differs from or sharpens the rules above:

- **`syncComponents(prev, next)` mutates `next` in place and returns it.** The canvas and its gestures hold references to node objects, so nodes are updated, not replaced. `prev` is only read.
- **Where overrides are marked.**
  - The canvas marks the in-place edits made between two renders. `render()` syncs first and diffs against the previous sync's result, ignoring the geometry the canvas measures while drawing.
  - Only the instances and mains an edit touched are checked and re-synced. A render costs about one comparison per layer inside mains and instances: 1–4 ms for an app shell with ten instances, about 20 ms at 5,000 instance layers.
  - A replaced document is only reconciled, never marked. That covers `setDocument`/`loadDocument`, undo, remote operations and agent commits.
  - Agent edits are marked headless, before they reach the canvas: in `design-tools.mjs` `write()` and in `design-store.mjs` `applyOperations`.
  - So other `setDocument` callers that edit instance layers (imports, the old library's "Update instances") are reconciled back to the main rather than marked.
- **Measured geometry is neither marked nor copied**, except when a node is first materialized. That is `w`/`h` under hug, fill or percent sizing, and `x`/`y`/`w`/`h` of constraint-anchored layers. The canvas computes them for each instance; `inset` and the sizing modes themselves do sync.
- **`parentId` of an inherited layer is not an override.**
  - With history, moving an inherited layer out of its place snaps it back. Reordering inherited layers outside a slot snaps back too.
  - Without history, the moved copy becomes a plain layer and the instance gets its layer back.
  - Inside a slot, any move makes the slot Modified, as specified.
- **Instance ownership.** The root's `sourceId` is its main's id. A nested instance copied inside another instance has `sourceId` = the node it copies (≠ `instanceOf`), so it belongs to the outer instance; a node belongs to the nearest root whose `sourceId === instanceOf`. Detach, and a slot turning Modified, re-point such nested copies one level down, keeping the overrides of both levels.
- **Derived ids** are `<instance root id, first 80 characters>~<106-bit hash of (root id, source id)>`. A taken id gets a salted next attempt, deterministically.
- **Slots.**
  - On Modified, the layers in the slot lose their link fields and become local; nested instances in it are re-pointed.
  - Reset to Default removes the local content and re-materializes the main's.
  - In a merge where a slot ends up Default but holds local layers, the layers are removed: reset wins.
- **Cycles are not rejected by `validateDocument`.** This deviates from "Validation … reject such a cycle", because `documentSafety` must never reject a stored document.
  - The sync never touches a main that contains itself, and `componentProblems()` reports it.
  - `createInstance` and agent writes in `design-tools.mjs` refuse to create a new cycle.
- **Validation.**
  - Limits: `instanceOf` and `sourceId` are 1–200 characters; `overrides` has at most 500 keys of at most 120 characters; `slotName` has at most 100 characters.
  - Load-time repair (`normalizeDocument` with `repairs`) drops mistyped link fields and `slot` on non-frames, and records each drop.
- **Deleting an inherited layer** restores it hidden, together with its linked descendants. Local layers that were inside it stay deleted.
- **A same-step edit of the main and the instance on one key** makes the instance's value an override (the instance wins).
- **`component` on a node copied into an instance is removed**: a nested main is not a main inside instances. `createComponent` refuses instance roots and inherited layers.
- **Copies (`adoptCopies`).**
  - A copy of a main becomes an instance only when that main is in the document. A cut-then-paste of a main, or a main pasted from another file, stays a main.
  - A copied part of an instance becomes plain layers.
  - The "Name 2" renaming of a duplicate is reverted to the main's name by the next sync, because a new node has no overrides.
- **Agents (phase B2):** see "Component tools" in `docs/agent-workflows.md`.
  - `duplicateElements` calls `adoptCopies`; what the call changes on an instance root (label, classes) becomes an override.
  - The JSX codec writes and reads the link attributes. A new instance element is materialized from its main, and only its `data-slot` descendants are read (as slot content). Overrides outside slots are not carried by JSX: a whole-page JSX round trip keeps mains, instances and slot content, not other instance edits.
  - The lossless HTML export leaves the link fields out, so an exported instance imports as plain layers.

## Implementation notes (phase B1: UI)

- **Commands** (`component.*` in `web/canvas-interactions.js`, section Components): Create component `⌥⌘K` (one frame becomes a main; several layers, or one non-frame layer, are framed first in the same undo step), Create instance (placed 40 px right of the selection), Go to main component (switches page, selects and zooms), Reset overrides (all overrides of an instance, or one layer's), Detach instance `⌥⌘B`, Convert to slot / Remove slot. They are in the command palette and the shortcuts drawer (section COMPONENTS). In context menus, Create component sits in Layout next to Frame selection; mains, instances, their layers and frames inside a main get their own group.
- **Cycle guard** (`wouldCycle` in `web/component-core.js`): layer-panel moves and `moveNodes`, paste into a selected frame, the clipboard extension's pastes and canvas drags refuse to put an instance (or a layer holding one) inside a main it depends on. The canvas raises `bd:notice`, shown as a toast; a canvas drag simply does not enter that frame.
- **Layers**: rows carry `data-role` (`main`, `instance`, `slot`, `inherited`). Icons are `ComponentMainIcon`, `ComponentInstanceIcon` and `SlotIcon` in `web/src/components/icons.tsx`.
- **Canvas**: `web/canvas-render.js` sets `data-component` (`main`, `instance`, `slot`, `instance-slot`) on canvas layers; `web/canvas.css` draws the component purple and slot pink outlines (dashed for an instance), the ❖/◇ name labels and the "+" on an empty slot.
- **Inspector**: `web/src/islands/inspector/component.tsx` (`#component-section`, `#component-create-instance`, `#component-go-to-main`, `#component-reset`, `#component-detach`, `[data-slot-state]`, `#component-convert-slot`, `#component-remove-slot`).
- **Components panel**: `web/src/islands/sidebar/ComponentsSection.tsx` (`#components-panel`, `#components-search`, `[data-component-card]`, `#components-preset-app-shell`, `#components-preset-page-shell`). Thumbnails clone the main's canvas element, so a main on another page shows its icon instead. Presets are built in `web/src/lib/components.ts`.
- **Tokens**: `--component`, `--component-foreground`, `--component-muted`, `--slot`, `--slot-foreground` (`<component-tokens>` in `web/src/styles/globals.css`, both themes), measured from Figma 25.
- **Tests**: `tests/components-ui.cjs`. **Evidence**: `verynize/after/` (`verynize/capture-after.cjs`) and Figma | Verynize pairs in `pairs-after/` (`make-pairs.py`).
- **Not done in B1**: renaming a slot from the inspector (`slotName` can only be set through `setSlot`), Swap instance, thumbnails for mains on unloaded pages.
