# Figma components and native slots: live capture

Captured 2026-11-06 using agent-desktop on macOS, in Google Chrome's **Adam (Arc Migration)** profile. This is a **partial, evidence-backed behavioral specification**, not a claim that every checklist test passed. No existing Figma files were edited. No library was published, no invitations were sent, and no account settings were changed.

One Design draft was created through Drafts → New Design file and renamed **Verynize component research (scratch)**:
https://www.figma.com/design/1BsOPLQLQmBUyW52rizA46/Verynize-component-research--scratch-

All canvas experiments are in that file. Later experiments alter the same fixture, so the numbered screenshots are the record of each intermediate state. In particular, the final file includes a component set and a detached specimen; it is not identical to the earlier two-instance demonstration.

## Capture method and privacy

Window screenshots were taken with `agent-desktop screenshot --window-id w-52`. Headed sequences acquired `../.headed.lock` atomically and released it in a Python `finally` block. Each executed sequence was short; waiting to acquire the lock did not hold it. Chrome sometimes became inaccessible while the other app was active; activating Chrome and allowing its Space transition to settle restored access.

Screenshots were cropped with macOS `sips` to remove Chrome's profile photo, browser tabs, and Figma's account avatar. No synthetic image generation or repainting was used. The initial new-tab screenshot was cropped down to a nonpersonal central fragment and is **not behavioral evidence**. No email or other person's name remains in the reviewed core evidence images. Review all artifacts before committing, particularly any additional captures made after this report. No raw accessibility dump containing account information was saved here.

Important tooling limitation: CLI key delivery sometimes chooses a native Chrome menu action. `⌘R` reloaded Chrome instead of renaming a layer; `⌥⌘B` opened Chrome Bookmarks instead of detaching. We closed that newly opened Bookmarks tab and used the Figma menu to detach. These are automation observations, not evidence that Figma lacks the shortcuts. A stray page-level text layer `r` remains from the interrupted rename experiment; it is not part of the component.

## 1. Create a component from a frame

**Confirmed.** Drew a frame, selected it, and sent `⌥⌘K`. The result has a purple component glyph, purple layer name and canvas label, and purple selection outline. The left panel contains the layer hierarchy; the right Design panel puts the component name and component actions above Properties, Position, Layout, Appearance, Fill, Stroke, Effects, and export-related sections.

The right panel exposes **Add variant**, **Component configuration**, **More actions**, and a plus button whose accessibility label is **Create property**. Width and Height remain editable. The original fixture was 504 × 341.

Evidence: [02 main component](02-main-component.png), [04 main with slot dialog](04-create-slot.png).

## 2. Instances and instance controls

**Confirmed copy/paste path.** Selecting the main component in Layers and using `⌘C`, `⌘V` created an instance, subsequently named Frame 2 by Figma. Its layer icon is a hollow purple diamond. The right panel shows the source component name and **From this file**. Copying this instance produced another instance, Frame 3, including its existing local slot content.

Clicking the component name in the instance's right panel opens **Swap instance**, with **Search in this library**, a source selector showing **Created in this file**, and component choices. This picker was inspected, not used to prove override preservation across swaps.

The instance's **More actions** menu showed **Detach instance**, **Reset instance**, **Reset name**, **Create component**, **Toggle ready for dev status**, and **Use as mask**. The observed reset label was **Reset instance**, not the requested wording “Reset all changes.” Reset semantics and a “Go to main component” action were not confirmed.

Evidence: [11 copy result](11-copy-result.png), [12 instance actions](12-instance-actions.png), [27 swap picker](27-swap-menu.png). Assets dragging and Option-drag were not successfully exercised; the CLI drag interface did not expose a modifier parameter.

## 3. Overrides, propagation, and structure

**Confirmed:** adding header/sidebar rectangles to the main updated an already-existing instance while preserving its locally drawn slot rectangle. Increasing the main header height from 26 to 40 updated both instances while retaining their different slot children. This proves propagation of these structural/geometry edits in this fixture, not a complete property-precedence algorithm.

**Confirmed resize:** editing the instance Width field changed 504 to 550 while the source stayed 504. See [28 resized instance](28-resize-instance.png) and the resulting [30 detached frame](30-detached.png).

**Confirmed slot-local insertion:** drawing an ordinary rectangle, and later inserting text, inside a slot on an instance creates instance-local children. Their layer names are ordinary light-colored text beneath the pink Slot row; inherited shell children retain purple layer labels.

Evidence: [14 local rectangle](14-slot-rectangle.png), [15 added shell structure](15-shell-propagates.png), [17 before header change](17-different-slot-content.png), [18 after header change](18-header-update-preserves-slots.png).

Not established: text/fill override precedence against later main edits, deleting inherited children, insertion outside slots, push-overrides-to-main, and reset behavior. A failed drawing attempt is not evidence that insertion is forbidden; explicitly choosing the Rectangle toolbar tool succeeded.

## 4. Variants and component sets

**Confirmed.** **Add variant** wrapped the existing main in an **App Shell** component set and added a second component. Layers showed **Default** and **Variant2** under the set. The canvas set has a dashed purple boundary. Selecting a variant exposes its property value; an existing instance gained a **Property 1** dropdown, initially **Default**, alongside its slot property. Opening the dropdown lists the variant choices.

Evidence: [24 Add variant result](24-add-variant.png), [25 instance variant and Modified slot](25-instance-variant.png), [26 variant dropdown](26-variant-options.png). Switching variants and matching overrides between variants were not verified.

## 5. Component properties

The **Properties + / Create property** menu lists five types, in this order: **Variant**, **Text**, **Boolean**, **Instance swap**, **Slot**. Native Slot is present in this account's current UI; it must not be treated as merely an instance-swap workaround.

- **Boolean:** Create property dialog has **Name**, a **Value** control displayed as **True**, and **Create property**. Creating the default Boolean definition produces a row **Boolean · True** with **Not used within component** until bound. On a child layer, the Appearance visibility area exposes **Apply variable/property**, opening a variable/property picker. Binding was attempted but not completed.
- **Text:** dialog has **Name**, **Value**, **Create property**. A definition with the default name Text was created; its unbound state displayed a warning. Binding to a text node and editing from an instance were not confirmed.
- **Instance swap:** dialog has **Name** (default **Instance**), **Value → Pick instance**, and **Preferred instances** with a plus button. Create property was disabled before choosing a default instance. The dialog was closed without creating this definition. A nested instance separately exposes **Create instance swap property** in its right-panel accessibility tree.
- **Variant:** demonstrated by Add variant and Property 1 above.
- **Slot:** fully detailed below.

Evidence: [03 type menu](03-property-types.png), [19 Boolean dialog](19-boolean-property.png), [20 unbound Boolean](20-current.png), [21 binding picker](21-visibility-binding.png), [22 Text dialog](22-text-property.png), [23 Instance swap dialog](23-instance-swap-property.png).

## 6. Native slots and the App Shell test

### Definition and binding are separate operations

1. Select the main component → Properties + → **Slot**.
2. The **Create property** dialog has **Name** (default Slot), rich-text **Description** with placeholder **How to use this slot**, and **Settings**.
3. Settings include **Minimum layers** and **Maximum layers** (both visually **None** by default); **Only allow preferred instances** (unchecked); **By default, display empty slot** (unchecked); **By default, fill items on slot's counter axis** (disabled in the captured freeform configuration); and **Preferred instances**, **Learn more**, and a plus picker.
4. Click **Create property**. The property now exists, but the main's property list says **Not used within component**. No content region is created automatically by this operation.
5. Draw a child frame inside the main. Its right-panel header offers **Convert to slot**. That menu lists the existing **Slot** definition and **Create property…**.
6. Choose Slot. The child frame is renamed **Slot** and rendered with a pink outlined-square-plus icon in Layers. Selected on canvas, it has a pink outline and pale pink editor overlay. The panel exposes **Edit slot property**. The bound region retained its 340 × 230 geometry.

Evidence: [04 definition dialog](04-create-slot.png), [05 unbound definition](05-slot-created.png), [07 child frame](07-inner-frame.png), [08 binding menu](08-bind-slot.png), [09 bound slot](09-slot-bound.png).

### Instance editing and propagation

The empty instance slot shows a pink plus affordance. The right panel exposes **Add instances** and a slot state badge **Default**. After local content is inserted, the instance panel shows **Modified**. The property is visible at the instance root as well as when the slot is selected.

The tested slot was freeform. It accepted an ordinary rectangle drawn directly with the Rectangle toolbar tool, and an ordinary text layer inserted with the Text toolbar tool and pasted text. **Content did not have to be a component or an instance.** Both children coexist in one slot. This proves rectangle/text support and multiple children, not every possible Figma node type.

The shell main contains a header rectangle, sidebar rectangle, and the slot. Two instances were made. One contains a rectangle; the other contains a rectangle plus **Page B content**. Editing the main header's Height to 40 updates both headers while preserving these distinct contents. Screenshots 17–18 are the key before/after pair. The initially empty main slot does not acquire the local page content from either instance.

Evidence: [11 Default badge](11-copy-result.png), [13 selected empty slot](13-slot-content.png), [14 ordinary rectangle child](14-slot-rectangle.png), [18 both pages after main edit](18-header-update-preserves-slots.png), [25 Modified badge and layer hierarchy](25-instance-variant.png).

### Layout and detach

The main slot panel exposes **Freeform**, **Vertical**, **Horizontal**, **Grid**, **Toggle auto layout**, Width, Height, constraints, and Clip content. The captured experiment used Freeform and Clip content enabled. Auto-layout behavior, hug/fill sizing, and counter-axis fill were not exercised, so do not infer them from the presence of those controls.

Choosing **More actions → Detach instance** converts the outer instance to a regular frame. The slot becomes a regular frame named Slot (hash/frame icon, no pink slot icon), and its rectangle and text children remain. The detached root uses a blue outline and the ordinary Frame inspector. It retained the resized width of 550. [30 detach proof](30-detached.png). The requested shortcut was attempted but intercepted by Chrome; screenshot 29 is that failed shortcut attempt, not detach evidence.

## 7. Nested instances and exposure

**Nested instance creation confirmed, exposure unproven.** After the detach experiment, the ordinary content frame named Slot was converted into a separate component. Copying it and pasting into the Default shell main created a nested instance. The screenshot shows a hollow-diamond Slot below Default, and the nested instance's source link **From this file**. The existing shell instance also acquired this new nested content.

This later experiment deliberately changes the fixture and is separate from the native slot proof. Do not confuse the new component named Slot with the original native Slot property; they have different icons and meanings.

Evidence: [33 new component source](33-nesting-source.png), [34 nested instance](34-nested-instance.png). The nested instance's AX tree exposed **Create instance swap property**. Searching the parent property menu showed only the five property types; [35 inspected menu](35-expose-nested.png) does **not** prove “Expose nested instances” is absent elsewhere. That action was not located or exercised. Component configuration displayed description/link fields and Component set / Selected variant tabs: [32 configuration](32-component-configuration.png).

## 8. Help Center

No Help Center page was consulted. All behavioral claims above come from the scratch-file experiment. The scratch-file URL is a reproduction pointer, not published documentation. Account/plan/rollout differences were not tested.

## Data model implications

These are **implementation recommendations inferred from observed behavior**, not claims about Figma's private storage format.

- **Component:** stable identity, ordered node tree with stable child IDs, reusable default attributes, and a collection of typed property definitions. A component set additionally maps variant property tuples to component identities.
- **Instance:** stable reference to a source component, its own placement/size, selected variant, and local differences. Copying an instance must preserve its local slot children while creating distinct identities for the new instance's editable content.
- **Override:** address a source descendant plus a property, rather than duplicating and severing the whole source tree. Store local slot-content replacement separately from ordinary scalar overrides. Propagating a main geometry/structure change must not discard that local content. Exact merge/reset precedence still needs validation.
- **Property definition:** stable ID, display name, type, default value and optional descriptive metadata. Definitions can exist unbound, so do not conflate property creation with layer creation. Store binding references separately and expose unused-definition diagnostics.
- **Slot definition:** name/description, optional minimum and maximum counts, preferred component references, preferred-only flag, default-empty flag, and counter-axis fill preference. Treat “None” bounds distinctly from a literal zero until enforcement semantics are confirmed.
- **Slot binding:** reference from a component-owned frame/container to a slot definition ID. Keep geometry/layout/clipping on the region. An instance needs to distinguish inherited/default slot content from a locally modified ordered child list, including an intentionally empty list.
- **Slot children:** real editable nodes, including non-component rectangles and text, with their own IDs and parent relationship. They must survive main edits and be materialized into ordinary child frames on detach.
- **Nested instance:** another source-component reference inside a component's tree. Property exposure, if supported, needs a separate mapping to a nested-instance path; this mapping was not established experimentally.
- **Detach:** materialize the current resolved instance tree, preserving local content and geometry, and remove component/slot bindings for the detached specimen. Nested detach depth was not tested.
- **Editor presentation:** distinguish main, instance, native slot, and ordinary frame icons; display slot Default/Modified state; provide both component-level definition creation and child-frame binding.

## Unproven / follow-up tests

- Assets drag and Option-drag creation paths; direct “Go to main component” action.
- Full text/fill override precedence; push overrides to main; reset scope and whether reset clears slot modifications.
- Adding/deleting/reordering inherited children outside slots. No prohibition should be inferred from this report.
- Boolean/Text binding completion and instance editing; Instance swap definition creation and preferred-value enforcement.
- Variant switching and override/slot-content retention across variants.
- Arbitrary node types beyond rectangle/text; nested slots; multiple bindings to one slot definition.
- Minimum/maximum layer enforcement, including whether counts are warnings or hard limits.
- Preferred-only restrictions, default-empty behavior, auto layout, hug/fill sizing, and counter-axis fill behavior.
- Slot child deletion/reordering and intentionally empty overrides.
- Expose nested instances location and behavior; nested property forwarding; nested detach depth.
- Library publishing/update semantics and remote components (intentionally outside authorization).

## Artifact index

All PNGs are cropped window captures. Some filenames describe the attempted action; the report above identifies the successful evidence. Specifically, 06 is an interrupted frame-building attempt, 13 is still an empty slot, 29 shows Chrome intercepting a shortcut, and 35 shows an inspected menu without an exposure action. 00–01 are setup captures. They must not be cited as proof of successful feature tests.

`capture-helper.py` is the local CLI orchestration helper; `workflows-reference.json` is the CLI's workflow documentation loaded for the experiment. Neither is product code. `FILES.txt` lists every artifact in this directory.
