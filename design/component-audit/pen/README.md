# Pen component audit — 2026-11-06

**Status: partial live audit, not a complete behavioral specification.** Captured with agent-desktop on macOS. Read CLAUDE.md and [prior Pen notes](../../../docs/pen-reference.md). All canvas edits were in scratch.pen. The design-system document was observed only; spaces.pen was not edited. No AI chat was submitted. The pre-existing Blue Teapot in scratch was retained. The shell experiment is the component named **Frame 1**; “Audit App Shell” is its text label, not its node name (the rename attempt instead pasted text).

## Observed behavior

1. **Components panel.** The left sidebar has a diamond-cluster Components switch, a searchable thumbnail grid, component names, and a prominent **Create Component** button. The existing design system contains slash-separated names such as Badge/Pending and Button/Accent; that naming alone does not establish variants. [Existing panel](01-initial.png), [scratch panel](10-components-panel.png).
2. **Creating a main component.** A normal frame offers Create Component in the inspector. In scratch, I drew a 430 × 220 frame with three rectangles representing header, sidebar, and content, selected the root, and clicked Create Component. The resulting main has a purple four-diamond icon in Layers and above the canvas, purple descendant labels, a solid purple selection boundary, and **Detach Component** in its inspector. [Ordinary frame](06-frame.png), [three shell regions](07-shell-regions.png), [created main](09-component.png).
3. **Insertion.** Dragging the shell thumbnail from Components onto the canvas creates an instance containing the shell regions and label. Its inspector name has a hollow diamond, and its canvas boundary is dashed purple. The AX labels of the two icon buttons are **Go to component** and **Detach Instance**. An additional Create Component action is available. Those buttons were identified, but navigation and detach results were not tested. [Inserted instance](11-instance.png).
4. **Editable descendants.** In the first instance, the text was changed to **Page A** while the main continued to display **Audit App Shell**. Layers shows a hollow-diamond instance root with editable descendants, including Page A. This confirms an instance-specific text difference; it does not by itself establish override serialization or reset semantics. [Text difference and Layers](12-text-override.png).
5. **Two instances of the shell.** A second thumbnail drag created another shell instance retaining Audit App Shell, while the first retained Page A. The second was dropped over the pre-existing Blue Teapot region: overlap/parenting makes this unsuitable as a clean layout fixture. [Two instances and main](13-main-change.png). Despite the filename, this screenshot does **not** prove a successful main-text change.
6. **Attempted main edit produced ambiguous evidence.** Subsequent double-click/paste sequences produced overlapping text on the main and instances. The final image is consistent with adding a child to the main and that addition propagating, but the action was not verified against document structure. Do not treat it as a clean “main text changed, override survived” test. [Ambiguous propagation attempt](16-main-propagation.png).
7. **Descendant context menu.** Right-clicking the content rectangle inside an instance exposes Copy, Copy as, Paste here, Paste to replace, grouping/frame/layout actions, Create Component, and Delete. No reset action appears in this captured descendant menu. This does not establish that reset is absent elsewhere. [Menu](17-instance-menu.png).

## App Shell / dynamic-content result

The shell main and two instances were created. Different text in the existing content region is confirmed. The content region is a **rectangle**, not a designated slot/container. Therefore this experiment does not establish arbitrary child insertion, replacement of a content subtree, constraints on slots, or behavior of two independent nested page trees. The pasted text attempts cannot substitute for that test. No claim of functional page-shell slots should be based on this capture.

## Data model implications

These are design implications from visible behavior, not a recovered .pen schema:

- Main and instance are distinct identities with different icons and inspector actions.
- Instance descendants need addressable identities so at least text can differ locally.
- A component browser needs previews and drag-to-insert, and Layers needs meaningful main/instance indicators.
- An App Shell feature needs a separately specified content-region contract: ownership of children, allowed insertion/replacement, sizing, and how main changes merge with local page content.
- Do not infer that slash-separated component names are a variant/property system.
- A robust Verynize model should preserve explicit per-property overrides and local slot children independently of the shared definition; this is a recommendation, not a proven Pen implementation.

## Documentation and prior evidence

[Prior repository notes](../../../docs/pen-reference.md) identify the installed app as Pen 1.2.20 / dev.pencil.desktop at the time of that earlier inspection. They explicitly do not establish the private .pen schema. This run did not inspect a saved .pen file or verify `ref`, `reusable`, `children`, `descendants`, or `slot` fields. The documentation entry URL is [docs.pen.dev](https://docs.pen.dev/), but **no component-model documentation was verified in the requested Chrome profile**. Do not cite that landing URL as support for a schema claim.

## Unproven

- Reset overrides: existence, scope, and behavior.
- Go to component and detach execution, including nested detach semantics.
- Clean main-to-instance text/fill propagation and preservation of overrides.
- Arbitrary content insertion into two shell instances, slot declarations and allowed children.
- Nested reusable components and nested override paths.
- Variants, exposed component properties, boolean visibility and instance-swap properties.
- Saved JSON model, cross-file references, persistence, and library updates.

Accessibility initially included inactive-tab controls and intermittently failed during macOS space changes. Physical operations used the shared mkdir/rmdir lock. Several failed/ambiguous attempts are explicitly excluded above. A separate Electron test process also changed foreground state during this run. These observations must not be promoted into claims that untested features are absent.

## Screenshots / privacy

All retained PNGs are linked above. The initial screenshot is cropped to the Components panel; account badges are masked in the other captures. Discarded captures included pre-existing chat history and an unrelated real-profile window. No known email/avatar redactions remain. Existing component names and the pre-existing teapot remain visible; review those if sharing outside this project. No source code was changed.

## Addendum — Pen's own schema (read 2026-11-06 via the Pen MCP `read_skill`: `pen-schema.md`, `guide/components.md`)

Source: the pen-dev skill bundled with the Pen MCP server (schema version "2.22"), read-only. This settles several items listed under "Unproven" above at the **format** level (not live UI behaviour):

- **Main component** = any node with `reusable: true`. It has a generated id that can't be set by hand.
- **Instance** = `{type:"ref", ref:"<component id>"}`. It has **no `children` of its own**; its subtree is resolved from the component at render time. Overrides on the instance root are plain properties on the `ref` node.
- **Descendant overrides** = `descendants: { "<id path>": {…props} }`. It is one flat map keyed by id path, never nested. Nested instances use `instanceId/childId` paths at any depth.
- **Replacement** = a `descendants` entry that contains `type` replaces that descendant's whole subtree with a new tree. This is how per-instance content (slots) is done.
- **Slots** = `Frame.slot?: false | string[]`: "Marks frame as a slot for component instances. Array entries are IDs of recommended reusable child components (e.g. menu items inside a menu bar)." The documented pattern is: insert the instance, then `Replace(instanceId + "/contentSlotId", {type:"frame", …})`, then insert children into it.
- **Hide a nested node** = override `enabled: false`.
- There are no cross-file references (`imports` exist, but components "must be copied over").
- The schema has no variants or component properties. Properties are only overridden directly, via `descendants`.
