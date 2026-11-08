# After-fix pairs: review (2026-10-31, merged `feat/canvas-parity`)

Every PNG and `P1-*.txt` in this folder was captured in one run of [`../capture-after.cjs`](../capture-after.cjs) against the merged build (`npm run build:ui` first). The run uses a full window of 1440×870 at 2×. The fixture rebuilds Wonder's "Sunbird" scratch file at the stage each Wonder shot was taken, at 100 % with Wonder's camera placement. Pairs are in [`../../pairs-after/`](../../pairs-after/) (Wonder left, Verynize right).

Each line below says whether the two halves match and what differs. W = Wonder, V = Verynize.

- **Match**: same state, same strings, same geometry within a few px.
- **Close**: the behaviour matches but a visible detail differs.
- **Differs**: the behaviour or strings differ.
- **n/c**: not comparable, because the Wonder file does not show the state its name claims (see `../../wonder/notes*.md`).

Fixture-only differences hold for every shot and are not repeated below:

- shader artwork: Verynize's parametric presets versus Wonder's Pixel Party;
- layer-row glyphs: `#` frame icon versus Wonder's dashed-corner icon;
- no "Pages 3" count in V's Pages header;
- Wonder's extra Thrush/Porto tabs.

## Context menus

- **CM1-empty**: Match. Select all ⌘A | Paste here | Hide left sidebar, Hide right sidebar, at the same point (±2 px).
- **CM2-frame**: Match. The 14 rows, separators and shortcuts are identical; Add context is highlighted; the menu sits at the same place.
- **CM2-copy-as**: Match. Copy as code ⌘⇧C, Copy as PNG, Copy prompt ⌘⇧⌥C, Copy styles ⌘⌥C.
- **CM2-select-layer**: Close. The submenu lists "Frame"; W puts a frame icon before the name, V does not.
- **CM2-arrange**: Close. The items and shortcuts match (4 | Flip horizontal ⇧H, Flip vertical ⇧V). V opens the submenu level with the Arrange row and runs it to the window bottom; W lifts it ≈25 px so it ends above the toolbar.
- **CM2-layout**: Match. Frame selection ⌘G, Add auto layout ⇧A.
- **CM3-text**: Close. 13 rows without Hide label, and the badge "59.39 Hug x 14.5 Hug" match.
  - V draws a purple "Canvas au" name label above the selected text; W draws none.
  - The inspector line height reads `1.15` in V and `Auto` in W.
- **CM4-shader**: Match. The menu for a top-level shader-painted frame includes Hide label.
- **CM5-multi**: Differs. The union box and the `739 x 391.18` badge match.
  - W lists **Use as mask** after Layout for a 4-layer selection; V shows it only for exactly two siblings, so it is absent here.
  - W's Lock row is disabled (one member was locked); V's is enabled.
- **CM6-hidden**: Close. The row menu reads Show ⌘⇧H / Lock ⌘⇧L in both. W draws the hidden layer's bounds as an empty purple outline on the canvas; V draws nothing.
- **CM6-locked**: Match. Hide ⌘⇧H / Unlock ⌘⇧L.
- **CM7-row**: Match. 13 rows without Select layer, Hide label kept. W's row also shows its T / lock / eye hover icons under the open menu.
- **CM8-page**: Close. Rename F2 | Delete with the backspace glyph. With a single page V draws Delete disabled (dim red); W draws it enabled.
- **CM9-label**: Differs. V's label menu includes **Select layer ›** (V's canvas-menu group). W's label menu has no Select layer: Copy link to selection is followed directly by Paste.
- **CM10-copied**: Match. The 14-row menu has Paste enabled after ⌘C.
- **CM10-empty-clipboard**: n/c. V is a true empty clipboard, so Paste, Paste to replace and Paste over selection are disabled. W's internal clipboard was not empty and its target differs (row at 323 %).

## Keyboard and clipboard

- **K1-shortcuts**: Close. The drawer has the same title, Search shortcuts… field, pinned Command palette ⌘K and sections in order.
  - W dims the whole window behind the drawer; V does not.
  - V's TOOLS section adds "Rectangle tool R" and "Ellipse tool O".
- **K2-duplicate**: Match. ⌘D puts the 120×120 copy at X675 Y−133, which is 120 + a 40 px gap to the right. The copy is named "Frame 3" in V, from "Frame 2"; W names it "Frame 2", from "Frame".
- **K2-paste-here**: Close. The empty-canvas menu with Paste here highlighted. V's menu opens ≈75 px higher (click point).
- **K2-over**: n/c. V's ⌘⇧V pastes the copy centred over the selected 100×70 frame (X250 Y275). W's attempt shows no pasted layer.
- **K2-replace**: n/c. V's ⌘⇧R replaces the 100×70 frame with the copied 120×120 frame at X260 Y300. W's attempt shows no replacement.
- **K3-frame-selection**: Close. ⌘G wraps the 4 layers in "Frame" 739 × 391.18 at X56 Y−153.
  - V collapses the new wrapper's row; W shows it expanded with indented children.
  - Selection colors read FFFFFF in V and 000000 in W.
- **K3-unframe**: n/c. W's ⌘⇧G had a child selected and did nothing. V's ⌘⇧G restored the four top-level layers (4 nodes selected).

## Layers and pages

- **L1-hover**: Match. A "Lock layer" tooltip over the row's lock button, with T / lock / eye on the row. W's row is the selected "Auit SAMPLE" row at 323 %.
- **L2-rename**: Close. Page row menu Rename F2 | Delete (red). V's menu opens ≈10 px higher and covers the "Page 3" label.
- **L2-rename-field**: Differs. The purple inline field with "Page 3" selected matches. Choosing Rename makes Page 3 the **active page** in V (tab "Sunbird - Page 3", empty canvas, "No layers on this page"); Page 1 stays active in W.
- **L2-renamed**: Close. Page 1, Page 2, Audit. Audit is active in V (same cause), Page 1 in W.
- **L2-drag**: Close. The dragged "Audit" chip and the purple insertion line above Page 1 match. Same active-page difference.
- **L2-order**: Match on the order Audit, Page 1, Page 2. Same active-page difference.
- **L2-reorder-during**: n/c. W's file is the eyedropper accident (its real drag is L2-drag-confirmed). V shows the drag with the insertion line.

## Palette, paste, thumbnail, mask (pass b)

- **P1-\*.txt**: Close in structure, with different payloads.
  - **Same structure**: "Implement this … design." / "Design to implement (each link ends in the … page id and the element id: …)", one link per node, MCP instructions and an install hint / "Inline snapshot (fallback, captured at <ISO>):" with a `tsx` block per node / "How to implement it:" and the guidance.
  - **Links**: V writes `verynize://node/Sunbird/p1/<short id>`; W writes `wonder://node/<org>/<page uuid>/<element uuid>`. The snapshot header link is the same `verynize://` URI, where W uses an `https://app.wonder.so/...?nodeId=` URL. P1-copy-link.txt is the `verynize://` URI, not an https URL.
  - **Snapshot**: V's uses Tailwind classes plus `data-node-label` / `data-canvas-x` / `data-vn` attributes, a `/* @verynize {...} */` comment and `export default function Frame()`. W's prompt snapshot uses inline `style={{…}}` objects in `export default function ()`. Text has `leading-[1.15]` in V and `lineHeight: "normal"` in W.
  - **Copy code**: W adds a `:root` variables `<style>` and `wrap-anywhere … [line-height:normal]`; V has neither.
  - **Guidance**: reworded (original text, by design).
- **P2-empty**: Close. Same position and size, placeholder "Jump to or find anything...", footer Navigate ↓ ↑ / Open ↵ / Close Esc. V shows only Application (Open keyboard shortcuts, Restart tour, Give feedback). W also has a "Recent" section from its session.
- **P2-select**: Differs. This is a V bug found here: after typing "select" key by key, the active row is Select all but the list stays scrolled 270 px from the intermediate "s"/"se" results. The shot opens on Select parent… with no highlight visible.
  - W shows Edit: Select all (highlighted), Paste over selection | Selection: Select inverse | Workspace: two toolbar-view rows.
  - V also matches Copy link to selection, Select all matching layers, Select children/parent/next/previous sibling, Deselect, Zoom to selection, and Frame/Unframe selection.
- **P2-keyboard-focused**: Close. Down highlights "Paste over selection ⌘⇧V" (neutral grey). V's list is still scrolled, with Edit and Select all above the fold.
- **P2-frame**: Close. Layers come first with right-aligned breadcrumbs, then Tools "Frame tool F". V lists 6 layer rows (fixture) against W's 8, and adds "Insert frame" and Transform "Frame selection ⌘G".
- **P2-enter**: Match. Enter runs Select all and closes ("5 nodes selected" in V, 4 in W, by fixture).
- **P2-escape**: Match. The palette closes and the selection is kept.
- **P3-source**: Match. The nested 100×80 frame is selected (X49 Y40).
- **P3-empty-menu**: Match. Select all | Paste here | Hide left / right sidebar at the click point.
- **P3-empty-result**: Close. The copy's top-left lands at the right-click point, at top level, at the same screen position.
  - The document X/Y differ (V −98, −26; W −78.61, −5.75) because the fixture origin is ≈20 px off.
  - V's copy is white; W's is transparent.
- **P3-inside-menu**: Close. Right-click inside the parent gives the frame menu with Paste and no Paste here.
  - W adds "Paste styles ⌘⌥V", which V has nowhere.
  - V's frame is top level (shows Hide label); W's is nested (X20 Y20).
- **P3-normal-context**: Close. Same frame menu on the selected target with Paste enabled; W adds Paste styles.
- **P3-context-paste-result**: Match. Menu Paste centres the 100×100 copy inside the 300×300 target as an indented child (X100 Y100).
- **P3-menu-over-parent**: Match. The empty-canvas menu overlaps the selected target (badge 300 x 300).
- **P3-paste-over-parent-result**: Match. Paste here anchors at the original right-click point and stays top level (V X357 Y70, W X356.75 Y39.84; the click point differs by 30 px).
- **P4-files-before**: Differs. V's card draws the active page (white frame, shader frames, small frames); W's card is a dark placeholder. V lists one local file; W lists five.
- **P4-thumbnail-menu-before**: Close. "Set as file thumbnail" is last, after a separator. W adds Paste styles; W's frame is nested (no Hide label).
- **P4-thumbnail-menu-after**: Close. The same label, unchanged, and a "Thumbnail updated" toast at the bottom right. W's toast has a green check and a close button; V's has a grey circled check and none.
- **P4-files-after**: Close. The Sunbird card shows the white frame with "Canvas au" filling the thumbnail. The Files headers differ ("Personal workspace · Local", Archived tab against W's account and Upgrade).
- **P5-overlap-siblings**: Match. A 200×200 coloured frame under a centred 100×100 white frame, both top level, "2 nodes selected", badge 200 x 200.
- **P5-mask-menu**: Close. "Use as mask" after Layout, before the final separator. W's Lock is disabled and W adds Paste styles.
- **P5-mask-result**: Match. The source is consumed with no wrapper, the 100×100 frame stays at X147 Y−60, and the Mask row reads `inset(-50% -50% -50% -5…`.
- **P5-mask-inspector**: Close. The same Mask row with shape, copy and remove controls. W is scrolled further (Export visible below Mask).
- **P5-mask-result-menu**: Close. Detach mask as shape and Remove mask replace Use as mask; W adds Paste styles.
- **P5-detach-mask**: Close. A white 200×200 Frame at X97 Y−110, same level, shader not restored. **Clip content is off in V and on in W.**
- **P5-detached-layer-inspector**: Close. Same Clip content difference.
- **P5-remove-menu**: Close. Same as mask-result-menu.
- **P5-remove-result**: Match. The Mask section is empty and the source is not restored.

## Selection

- **S1-hover**: Close. Purple outline, no handles, inspector stays on Page.
  - V also draws dashed outlines on the hovered frame's children.
  - V's name label stays grey where W's turns purple.
  - V gives no hover fill to the layer row.
- **S2-classic / S2-drill / S2-double**: Close. A click (and a double-click) selects the nested 100×80 frame (X49 Y40, badge, ⊕). W also draws thin dashed guides from the child to its parent's top and left edges; V draws none.
- **S2-escape**: Match. Esc deselects and the inspector shows Page.
- **S3-marquee**: Close. The two top-level frames are selected, with one box and `579 x 391.18`.
  - Background Fill reads FFFFFF in V and "Click to replace background fills" in W.
  - V's per-member outline is thicker.
- **S3-shift-add**: n/c. V's Shift-click adds Frame 2 (2 nodes, 579 x 391.18). W's attempt kept one node.
- **S4-frame**: Match. `300 x 270` with no Fixed suffix, purple name, ⊕ chip, X65 Y−153. V's corner handles are ≈4 px dots against W's 8 px white squares (also in the TR1 shots).

## Toolbar and tools

- **T1-move / scale / hand / frame / shader / text / view-a / view-b / plus**: Close. The 6 tools, Details / Design and + match.
  - V tooltips: Move V, Scale K, Hand H, Frame F, Shader S, Text T, Details ⌥1, Design ⌥2, Save or choose a view. W shows readable tooltips only for the + button (its verified retakes have none).
  - In W the Design toggle is drawn active (purple) while the view is "Design · edited". V draws neither toggle active, in every toolbar shot.
- **T2-plus**: Match. "Design · edited", Save current view, Reset to Design | Details (pin) ⌥1, Design (pin) ⌥2, Canvas ⌥0. Same toggle-highlight difference.
- **T3-details**: Close. The left sidebar is hidden and the toolbar shifts left. V leaves a floating "B Page 1 ⇕" chip; W leaves a "Sunbird" chip with lock / sidebar icons.
- **T3-design**: Match. Both sidebars are restored. W is on an empty Page 2 at 25 %.
- **T4-scale**: Differs. The proportional result matches: 100×70 → 150 x 105. W's inspector switches to a **Scale** section (W 150, H 105, 150 %); V keeps the normal inspector with no percentage field.
- **T5-help**: Close. Docs ↗, Keyboard shortcuts, Restart onboarding, Give feedback, Contact us ↗, Discord commu… ↗, Export diagnostic logs | What's new … View all ↗.
  - V's What's new has no entries; W lists "Wonder Capture / August 18" and "Gradients & Presence / August 3".
  - V shows "Export diagnostic logs" in full; W truncates it.
- **T6-zoom**: Match. Zoom to 50%, Zoom to 100% ⇧0, Zoom to 200% | Zoom in ⌘+, Zoom out ⌘−, Zoom to fit ⇧1. W also tints the zoom label purple while the menu is open.

## Transform

- **TR1-corner**: Match. 340 x 350 at X76 Y−153.
- **TR1-shift**: Match. 380 x 391.18 (ratio kept).
- **TR1-alt**: Match. 420 x 391.18 with X76 → 56 (centred horizontal resize).
- **TR2-rotate**: Close. The −47.19° rotation keeps W/H 100/70, and the label, handles and badge rotate.
  - V's rotation field is too narrow and shows "-47.…".
  - The inspector X/Y read 150/300 in V (unrotated box) and 176/314 in W (rotated bounds).
- **TR3-nudge / TR3-shift-nudge**: Match. X65 → 66 → 76.
- **TR4-guide**: Close. A thin blue horizontal centre guide between the rotated frame and the dragged sibling.
  - W's guide runs centre to centre with end ticks; V's starts at the rotated frame's left extent.
  - V keeps the selection box and the 100 x 70 badge during the drag; W hides them.
- **TR5-alt-parent**: Close. Blue chips and dashed extension lines, node to node.
  - V's chips have decimals ("36.4", "84.3", "216.3"); W's are integers ("31", "90", "210"). The values differ by fixture.
  - W also boxes the rotated selection's bounds in blue.
  - V again outlines the hovered frame's children.
- **TR6-alt-duplicate**: Match. ⌥-drag leaves the original; the copy "Frame 3" is selected at X615 Y17.
- **TR7-out-during**: Differs. W keeps the child in its flex slot and shows a tall translucent purple drop column. V moves the child freely with the pointer (≈150 px below the row) and shows no slot indicator.
- **TR7-out-after**: Match. The child stays inside the flex parent in both (W: "not observable" as a reparent).
- **TR7-reorder-during / TR7-reorder-after**: n/c. V reorders live: Frame 3 moves before the other shader and stays there. W's attempt selected 2 nodes and did not reorder.
- **TR8-gap-padding**: Close. "880 Hug x 431.18 Hug" (W 431.17), blue edge marks and orange gap marks, gap 20, padding 20/20.
  - V's second gap field shows 20 where W shows 0.
  - V's Layers row is collapsed.
  - V outlines the hovered child's children.

## Text

- **TX1-click**: Close. Empty text, Hug × Hug, Inter Regular 12, Auto line height, 0 letter spacing, fill 000000, nested at X59 Y160.
  - V shows W "1 Hug" where W shows "0 Hug".
  - V's caret is purple; W's is black.
  - W keeps the Text tool active while editing; V shows no tool active.
- **TX1-drag**: Close. A fixed 150×60 box, fill FFFFFF, at X515 Y47. V draws the selection box, the "Text" label and the 150 x 60 badge with no visible caret; W shows only the caret.

## Camera

- **V1-100**: Match. ⇧0 gives 100 %.
- **V1-in**: n/c. W's ⌘+ stayed at 100 % (key injection); V's ⌘+ steps 100 → 200 %.
- **V1-out**: Match. 50 % after ⌘− from 200 %.
- **V2-hand**: Match. The Hand tool is active and the canvas is panned by the drag.
- **V3-fit**: Close. ⇧1 fits all artwork and keeps the selection: 108 % in V, 113 % in W (different extents).
- **V3-selection**: Close. ⇧2 fills the view with the 120×120 frame, but V zooms to 572 % where W zooms to 538 %, so V leaves a smaller margin.
- **V4-high-zoom**: Close. No rulers or pixel grid in either; ⇧2 on 150×105 gives 532 % in V and 548 % in W.

## Remaining visible differences worth fixing (summary)

1. **P2-select**: the palette list keeps a stale scroll offset while typing, so the active row is off-screen.
2. **CM5-multi**: Use as mask is missing for 3+ layers (W offers it for 4).
3. **CM9-label**: the label menu still lists Select layer.
4. **L2**: Rename from the page menu switches the active page.
5. **T4-scale**: no Scale inspector section (W, H, %).
6. **TR7-out-during**: no in-slot drop column; the child follows the pointer instead.
7. **CM6-hidden**: no outline for a selected hidden layer. **S2**: no dashed child-to-parent guides.
8. **Toolbar**: the Design toggle is not drawn active for a "Design · edited" view.
9. **Small items**:
   - "Paste styles ⌘⌥V" is absent from menus;
   - **CM8**: Delete is disabled on the only page;
   - **P5**: a detached shape has Clip content off;
   - **TR2**: the rotation field truncates;
   - **TR5**: chips show decimals;
   - **V3**: zoom-to-selection margin;
   - **T5**: What's new has no entries;
   - **TX1**: purple caret and chrome around a new drag text;
   - **CM3**: line height 1.15 against Auto and an extra name label on text;
   - **S1**: hover outlines children.

## Follow-up fix pass (2026-10-31, afternoon)

Three more slices fixed most of the summary above. These shots were retaken from the merged build: `capture-after.cjs CM3 CM5 CM6 CM9 L2 P3 P4 P5 S1 S2 S4 T1 T2 T3 T4 T5 TR1 TR2 TR5 TR7 TR8 TX1 V3 V4`.

| Summary item                          | Now                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. P2-select stale scroll             | **Fixed earlier** (the active row stays in view while typing).                                                                                                                                                                                                                                                                                              |
| 2. CM5 Use as mask for 3+             | **Fixed**: offered for 2 or more siblings. Assumption: the bottom-most selected sibling masks each of the others.                                                                                                                                                                                                                                           |
| 3. CM9 Select layer in the label menu | **Fixed**: Copy link is followed directly by Paste, as in Wonder.                                                                                                                                                                                                                                                                                           |
| 4. L2 Rename switches the page        | **Fixed**: Rename from the page menu renames by id and keeps the current page.                                                                                                                                                                                                                                                                              |
| 5. T4 Scale section                   | **Fixed**: the Scale section (✕, W, H, %) replaces the inspector while the Scale tool is on. The % preset menu is an assumption.                                                                                                                                                                                                                            |
| 6. TR7 drop column                    | **Close**: the child stays in its slot under a purple translucent column. The column's sizing rule is an approximation (Wonder's spans downward from the slot).                                                                                                                                                                                             |
| 7. CM6 / S2 marks                     | **Fixed**: a selected hidden layer gets an outline; a selected nested child gets dashed parent guides with no labels. Nested layers and text no longer show a name label.                                                                                                                                                                                   |
| 8. Toolbar toggle                     | **Fixed per pixels**: the active view's toggle is highlighted while the views menu is closed. Wonder's T2-plus shows `+` highlighted only because its menu is open.                                                                                                                                                                                         |
| 9. Small items                        | Fixed: the rotation field shows `-47.19`; Alt chips show whole numbers; zoom to selection gives 538 %; What's new has a placeholder entry; the caret is black on white; there is no chrome while typing; hover outlines only the frame; a detached mask shape has Clip content on. CM3's 1.15 came from the capture fixture (new text already stores Auto). |
| Not changed                           | **CM8**: Delete stays disabled on a single page, because Wonder never exercised it. **Paste styles**: listed after Paste only once styles have been copied, matching Wonder's pass-b menus.                                                                                                                                                                 |

Still open:

- Wonder's caret is 1.5 px wide, but Chromium's caret can't be widened.
- The hover outline is axis-aligned on rotated frames.
- The existing selection purple (#b93cdb) differs from Wonder's #c468f7. Only the new marks use Wonder's colour.
- The Help menu doesn't truncate "Discord commu…" or "Export diagnostic l…".
- Scale works on a single layer only.

## Final pass (2026-10-31, evening): the last open items

New Wonder evidence is R1–R7 in `wonder/notes-2026-10-31-c.md`. **All 103 after-shots were retaken from the final build.**

| Open item                   | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TR7 drop column             | **Resolved: there is no drop column in Wonder.** R1 shows the dragged child following the pointer. The "column" in TR7-out-during is a marquee rectangle: it starts in the gap, the inspector shows Z Auto, and the shot next to it reads "2 nodes selected". Verynize now matches R1: the child follows the pointer, the slot stays empty and siblings stay put. The drag hides the child's chrome; its name label shows only over the page. The target parent gets a 1px outline. The Layers panel previews the new hierarchy live, and the order changes on release (one undo step). A top-level frame can be dropped into a stack (R1-row-return-during). The stack drop line is 3px #c468f7. |
| 1.5 px caret                | **Fixed** with a custom caret (`web/text-caret.js`). It is a constant 1.5 px wide at every zoom; its height follows the line (14.5 → 58 px at 100 → 400 %, R7). It is black or white by background, blinks, and hides for a range or during IME composition.                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Rotated hover outline       | **Fixed**: it turns with the frame and is 1px RGB(196,104,247) (R4).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Selection purple            | **Fixed**: all canvas selection chrome uses #c468f7. The outline is 1px across the edge, handles are 9×9 white with a 1px border, and the badge is #a245d3 (R5). Handles on a Clip content frame were cut to a quarter by the frame's own clip; they are now drawn over it whole (regression test in `canvas-selection-marks.cjs`).                                                                                                                                                                                                                                                                                                                                                               |
| Help truncation             | **Fixed**: the menu is 180px; labels stop at 112/128px ("Discord commu…", "Export diagnostic l…"). What's new uses Wonder's row sizes and the label grey #969696. The placeholder entry is "Verynize 0.16".                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Scale on a multi-selection  | **Fixed**: the union scales about the opposite corner (240×120 → 360×180). The inspector reads the primary layer (150×90, 150 %). The % menu has Wonder's nine presets (0.25×–10×) (R2).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| CM8 Delete on a single page | **Matches**: disabled in Wonder too. The row now uses Wonder's muted red RGB(132,69,68) (R3).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

Still not proven in Wonder, left as is:

- Escape-cancel of a stack drag (added; Wonder not captured).
- Multi-selection resize with the Move tool.
- The Layers row position of an entering layer differs by one slot from R1-row-return-during; Verynize uses the slot release will use.
