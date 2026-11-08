# Wonder canvas facts — 2026-10-31

Empty-canvas, object, layer-row and page-row menus differ. Top-level frames expose **Hide label**; multiple selection exposes **Use as mask**. Toolbar + manages views. Text starts empty with Inter Regular12px. Corner rotation,1/10px nudges, Shift aspect resize, horizontal Alt-centered resize, Option duplicate and Option distance readouts are confirmed. Several subtests remain unverified; this is an evidence inventory, **not a claim of complete parity or exhaustive behavior coverage**.

Documentation-only audit on branch `docs/canvas-audit`; no branch change, commit or source edit. All document mutations were in **Sunbird**, primarily Page1 after recovering the stale Page2 tab. Page addition was also in Sunbird. Thrush/Porto were not edited. No Share, publish, Add context, AI prompt, settings/account/billing or page Delete was invoked. Menu labels containing these actions were only observed.

Capture method: Wonder activated before every action group and every capture; `cliclick` and `screencapture -x -R0,30,1440,870`; native2×, **2880×1740**. All retained PNGs are full-window, no crop. Helper scripts and inspection contact sheets stayed in `/tmp`; no PNG overwritten. Menu/focus changes and asynchronous navigation sometimes caused failed trials; filenames are not proof. The authoritative evidence is specified per section. Native cursor is not included by `-x`; no cursor-shape claims. Initial hover work overlapped a view-toggle sequence; those states are expressly limited below.

Measurements use CSS pixels relative to screenshot top-left; add30 to y for global screen coordinates. Approximate radii are optical estimates, not app CSS inspection. `measurements.json` holds point coordinates/RGB for **every PNG**, plus commonly sampled canvas colors (nearest-neighbor8px sampling; counts are sampled pixels). This includes unsuccessful trials, which remain excluded from behavioral conclusions. Common menu geometry:176wide,25px rowpitch,4px outer inset,≈12px radius,10px text inset. Common dark panel/menuRGB(28,28,28), canvas/fields(43,43,43), badge(162,69,211), white(255,255,255). Borders have antialiased purple variants near(196,104,247). Screenshots are authoritative if a sampled point hits content rather than the named surface.

## CM1 — Empty canvas

Steps: Deselect on Page 1, right-click (900,350), capture, Escape.

Authoritative CM1-empty-verified.png. Exact order: **Select all ⌘A**; separator; **Paste here**; separator; **Hide left sidebar**, **Hide right sidebar**. No Add context, Arrange or Layout. Initial CM1-empty.png is a stale-page attempt without a menu.

Measurements / RGB: Menu approximately x903–1079, screenshot y320–447; width176, row25, padding4, radius≈12; interior RGB(28,28,28).

Verdict: Empty canvas has a distinct four-item menu.

## CM2 — Frame context and submenus

Steps: Create F drag (450,280)→(750,550) at100%; right-click (600,400). Hover Copy as, Select layer, Arrange and Layout, then Escape.

Use CM2-frame-ready.png and CM2-copy-as/select-layer/arrange/layout.png. **Frame menu M**, exact grouped order: Add context ⌘L | Copy ⌘C; Copy as ›; Copy link to selection | Select layer ›; Paste ⌘V; Paste to replace ⌘⇧R; Paste over selection ⌘⇧V; Duplicate ⌘D | Hide ⌘⇧H; Lock ⌘⇧L; Hide label | Arrange › | Layout › | Set as file thumbnail. Here | denotes a separator. Copy as: Copy as code ⌘⇧C; Copy as PNG; Copy prompt ⌘⇧⌥C; Copy styles ⌘⌥C. Select layer: Frame (one hit). Arrange: Bring to front ⌥⌘]; Bring forward ⌘]; Send backward ⌘[; Send to back ⌥⌘[ | Flip horizontal ⇧H; Flip vertical ⇧V. Layout: Frame selection ⌘G; Add auto layout ⇧A. No destructive/outward menu command was invoked.

Measurements / RGB: Main menu176wide, row25, padding4, radius≈12. Each submenu176wide; Select layer32high, Layout57high. Menu(28,28,28); highlighted Add context sampled(76,48,91).

Verdict: Confirms submenu structure inferred in §2.8; top-level frames also expose Hide label.

## CM3 — Text context

Steps: Create nested text; exit edit with Move button, select text row, right-click text.

CM3-text-menu.png: M except **Hide label** is absent. Text is “Canvas au” (typing lost trailing characters); inspector Inter / Regular /12px. CM3-text.png was still editing and has no menu.

Measurements / RGB: Menu176wide, row25, common menu palette; text badge contains59.39 Hug and14.5 Hug.

Verdict: Text uses the selection menu but omits Hide label.

## CM4 — Shader-painted frame

Steps: S drag(900,300)→(1020,420); Move; right-click.

CM4-shader.png: M including Hide label. Inspector Background Fill **Pixel Party 6**, Shadows F26605, Midtones E94560, Highlights F9ED69. Layer name/type UI says Frame. This is a top-level shader-painted frame, not proof of a non-frame child menu. Nested ordinary frame exists in S2 captures.

Measurements / RGB: 120×120 document px at100%; menu176wide; animated shader RGB is time-dependent, not a stable UI token.

Verdict: Shader-painted frame menu captured; a true non-frame child variant is not observable in this fixture.

## CM5 — Multiple selection

Steps: Marquee surrounding all four top-level objects; right-click a selected shader.

CM5-multi-verified.png shows **4 nodes selected** and one outer bounding box. Menu M additionally includes **Use as mask** below Layout, before final separator/Set as file thumbnail. Original CM5-multi.png only selected one object and is excluded.

Measurements / RGB: Combined badge739×391.18; menu176wide, row25; common purple chrome.

Verdict: Multi-selection adds Use as mask; original single-selection attempt is not evidence.

## CM6 — Hidden and locked

Steps: Select shader; ⌘⇧H; right-click its row. Restore visibility, ⌘⇧L, right-click row; restore lock afterward.

CM6-hidden.png says **Show ⌘⇧H**, **Lock ⌘⇧L**; empty outlined shader bounds. CM6-locked.png says **Hide ⌘⇧H**, **Unlock ⌘⇧L**. Row menus omit Select layer.

Measurements / RGB: Menu176wide, row25; selected row dark purple; sample values in measurements.json.

Verdict: Show/Unlock replace Hide/Lock according to state.

## CM7 — Layer row menu

Steps: Right-click selected Frame row(85,237).

CM7-row.png: M without **Select layer** and its preceding separator; clipboard actions immediately follow Copy link to selection. Top-level Hide label remains.

Measurements / RGB: 176wide,25pitch,padding4,radius≈12, interior(28,28,28).

Verdict: Layer-row menu differs from canvas menu by omitting Select layer.

## CM8 — Page row menu

Steps: Right-click Page1(85,160); capture; Escape.

CM8-page.png: **Rename F2** | **Delete** with backspace icon in red. Neither page deletion nor its confirmation was invoked.

Measurements / RGB: 176wide, approximately67high; interior(28,28,28); exact samples in JSON.

Verdict: Page menu has Rename and Delete only.

## CM9 — Artboard label menu

Steps: Right-click Frame name above artboard(465,267).

CM9-label.png: same M as frame body, including Hide label.

Measurements / RGB: Frame name about14px above top border; menu176wide,25pitch.

Verdict: Artboard-name context opens the frame menu.

## CM10 — Clipboard-dependent appearance

Steps: Copy shader with⌘C, open menu; later clear system clipboard to empty string, right-click layer row.

CM10-copied.png and CM10-empty-clipboard.png retain visible Paste / Paste to replace / Paste over selection. They are not a controlled same-menu pair: one is canvas and one row, and Wonder may retain an internal clipboard. No claim that OS clipboard clearing empties internal nodes.

Measurements / RGB: Same176wide menu and25px pitch; per-image samples, not inferred disabled colors.

Verdict: Paste remains listed after OS clipboard clearing; true empty-internal-clipboard disabled state not observable.

## T1 — Toolbar hover and active states

Steps: Hover all nine button positions; repeat with pointer moved away and back; capture native window.

Move V, Scale K, Hand H tooltips are readable in original T1-move/scale/hand.png. **Save or choose a view** is readable in T1-plus-tooltip.png. Other tooltip retries do not expose readable tooltips, despite hover styling; their labels/shortcuts are corroborated by K1, not claimed from hover. Active Move/Frame/Text/Scale are visible across S4-ready, TX1-click and T4-scale-retry. View icons are Details and Design by T2.

Measurements / RGB: Toolbar about338×44; button32square, enclosing radius≈14. Dark neutral active tool; purple active view. Common RGB samples per capture.

Verdict: Nine buttons captured; four tooltip texts observed, other hover texts not observable in these attempts.

## T2 — Toolbar plus

Steps: Click+ at(868,865).

T2-plus.png: **Design · edited**; Save current view; Reset to Design | Details (pin,⌥1); Design(pin,⌥2); Canvas(⌥0). No creation primitives listed.

Measurements / RGB: Popup≈256wide, item25,4padding,radius≈12; menu(28,28,28).

Verdict: Plus opens saved-view management.

## T3 — View toggles

Steps: Click Design, then Details, then restore Design.

T3-details and CM2-frame.png show left sidebar removed and right inspector retained; toolbar shifts left. Restored Design shows Pages/Layers left and Properties right. Some initial T3 names were captured during overlapping hover work; final layouts are corroborated by later S4 and CM2-ready shots.

Measurements / RGB: Each sidebar280px; canvas width880with both,1160with only right.

Verdict: Details hides left sidebar; Design restores both sidebars.

## T4 — Scale, Shader, Text

Steps: S drag; T click and drag; Scale select100×70 frame and drag corner.

T4-shader:120×120 painted frame. T4-scale-retry: **Scale**, W150 H105,150%; canvas badge150×105. Original T4-scale.png missed rotated handle. TX1 supplies click/drag text evidence. Native cursor is omitted by screencapture -x, so cursor shape cannot be proved. Child/font scaling not exercised.

Measurements / RGB: Scale100×70→150×105; native cursor not captured.

Verdict: Shader drag creates painted frame; Scale proportionally enlarges bounds; text click/drag differ.

## T5 — Help menu

Steps: Click bottom-left?.

T5-help/ T5-help-fixture: Docs↗; Keyboard shortcuts; Restart onboarding; Give feedback; Contact us↗; **Discord commu…**↗; **Export diagnostic l…**; separator; What’s new; Wonder Capture / August18↗; Gradients & Presence / August3↗; View all↗. Only Keyboard shortcuts opened.

Measurements / RGB: ≈180wide; ordinary row29px; menu(28,28,28); radius≈12.

Verdict: Help includes shortcut panel and external/support entries.

## T6 — Zoom menu

Steps: Click bottom-right zoom label.

T6-zoom: Zoom to50%; Zoom to100% ⇧0; Zoom to200% | Zoom in⌘+; Zoom out⌘−; Zoom to fit⇧1. No zoom-to-selection item in this captured menu.

Measurements / RGB: 176wide,25px items,≈167high, common menu palette.

Verdict: Zoom label opens a six-command menu.

## S1 — Hover

Steps: Deselect and move over nested frame.

S1-hover.png records initial trial. **S1-hover-final.png** isolates hover on an unselected rotated frame: purple outline and name, no handles/badge, inspector remains Page; corresponding Layers row gets neutral hover fill. Nested hover was not isolated.

Measurements / RGB: Hover border≈1px, purple; white interior255/255/255; exact per-PNG samples in JSON. Selected chrome documented in S4.

Verdict: Unselected frame hover shows purple outline/name without handles; nested hover comparison remains unverified.

## S2 — Click, drill, Escape

Steps: Click empty, click nested child, double-click child; repeat click+Escape in same focused action.

S2-classic.png despite its name selects the inner100×80 frame. S2-double retains it. S2-escape-focused.png fully deselects and inspector says Page. Thus current behavior looks deep; preference was not opened or changed. Earlier S2-escape alone retained selection and is not authoritative.

Measurements / RGB: Inner100×80; purple dashed guides to parent; page(43,43,43).

Verdict: Current click selects inner frame; focused Escape deselects, not a proven one-level-up action; classic/deep comparison untested.

## S3 — Add/remove and marquee

Steps: Shift-click objects; drag empty(410,240)→(1050,700).

S3-marquee.png says **2 nodes selected**, selecting the two top-level frames, not separately counting text/child. S3-shift-add retained only shader; not evidence for add/remove semantics. CM5-multi-verified later selects4 top-level nodes.

Measurements / RGB: 2-node badge579×391.18; common1px border and8px handles.

Verdict: Marquee selects top-level frames in this fixture; Shift add/remove remains unverified.

## S4 — Selection chrome

Steps: Inspect selected frame, text, flex parent, multi-selection.

S4-frame-ready.png: **300 x 270** (no Fixed suffix), four white square corners, purple border/name, circled+ above top-right, bottom badge. CM3-text-menu: **59.39 Hug x 14.5 Hug**. TR7-flex-fit: **780 Hug x 391.17 Hug**. S3/CM5 show single enclosing multi-box. Fill badge variant not established.

Measurements / RGB: Handle8×8; border≈1; badge22high,≈4radius,10px below frame. BadgeRGB(162,69,211), line samples near(196,104,247), white(255,255,255).

Verdict: Four corners, size badge, name and+ observed; Hug labeled explicitly, fixed values have no Fixed suffix.

## TR1 — Resize modifiers

Steps: Bottom edge drag, corner drag, Shift corner drag, then Alt right-edge drag.

TR1-resize-retry:300×270→300×310. TR1-corner-confirmed:340×350. TR1-shift:380×391.18, preserving340:350 ratio. TR1-alt:420×391.18 and X76→56, confirming horizontal center retention. Alt trial hit right edge, not a two-axis corner.

Measurements / RGB: Document dimensions above at100%; badge22high; common purple chrome. Alt vertical-center behavior not tested.

Verdict: Edge/corner resize and Shift aspect confirmed; Alt centered horizontal resize confirmed.

## TR2 — Rotation

Steps: Draw100×70 at(450,730); drag outside lower-right(558,808)→(580,750).

TR2-test-frame and TR2-rotate-verified show rotation0→−47.19°, W100/H70 retained; label, handles and badge rotate. Earlier TR2-rotate had no fixture and is excluded. Center pivot consistent with pixels, not an exact pivot measurement.

Measurements / RGB: W100 H70; cursor unavailable in-x captures; selection palette as S4.

Verdict: Outside-corner drag rotates the frame; inspector confirms−47.19°.

## TR3 — Nudge

Steps: Click frame and Right; click and Shift+Right.

TR3-nudge-retry X66, TR3-shift-retry X76; baselineX65,Y−153. Initial standalone key trials did not move and are excluded.

Measurements / RGB: X65→66→76; Y−153 unchanged; inspector fields24high.

Verdict: Right moves1px; Shift+Right moves10px in current preferences.

## TR4 — Snap guides

Steps: Draw sibling100×70; drag center(700,760)→(600,760), capture before release.

TR4-guide.png shows a thin blue horizontal guide connecting centers of two objects. No successful equal-spacing three-object fixture was established; numeric snap threshold unknown.

Measurements / RGB: Guide≈1px; blue tones present in numeric samples; no red guide inferred.

Verdict: A center alignment guide is observed; equal-spacing guide and snap tolerance unverified.

## TR5 — Option distances

Steps: Select rotated frame, hold Option and hover neighboring white frame.

TR5-alt-parent.png shows blue labels **31**, **90**, **210**, dashed bounds/lines. Despite filename this is node-to-node, not child-to-parent. S2 selected nested frame shows purple dashed parent guides without numeric distance labels.

Measurements / RGB: Blue sample palette includes(96,148,227),(108,154,248); numeric labels in document px at100%.

Verdict: Confirms §2.5 inferred Option-hover node distances; child-parent numeric readout remains unverified.

## TR6 — Option-drag copy

Steps: Option-drag shader(950,350)→(1050,500).

TR6-alt-duplicate.png shows **Frame3** with original and Frame2 retained. X515,Y−133→copyX615,Y17, matching100/150 gesture. In-drag distance overlay not captured.

Measurements / RGB: 120×120 copy;100/150px displacement at100%.

Verdict: Option-drag duplicates and moves copy by gesture delta.

## TR7 — Parenting and flex reorder

Steps: Wrap four objects; Shift+A; set gap/padding20; try child drag across row and outside.

TR7-flex-fit establishes flex parent with4children. TR7-reorder-during/after selects2nodes and TR7-out-after retains child in hierarchy. No decisive insertion/reparent transition. L1-reorder-after does show a moved row indented beneath another frame, but is a Layers-panel drag.

Measurements / RGB: Flex parent780×391.17 Hug before padding;880×431.17 after gap/padding. No drop-indicator dimension inferred.

Verdict: not observable — canvas drag trials did not establish reparenting or flex reorder; panel reparent is separate evidence.

## TR8 — Layout handles

Steps: Select flex wrapper, set gap20 and both padding axes20; hover canvas.

TR8-gap-padding.png shows small blue/cyan marks at container edges and orange marks between children. Inspector gap20,padding20/20. Dragging these handles was not verified.

Measurements / RGB: Container880 Hug×431.17 Hug; gap/padding20document px at107%; marks only a few CSS pixels, no precise hitbox inferred.

Verdict: On-canvas layout marks are visible; their edit behavior remains unverified.

## V1 — Zoom controls

Steps: Use⇧0,⌘+/− attempts and menu; use⇧1/2.

V1-100 confirms100%; V3-fit113%; V3-selection538%; V4-high-zoom548%. Keyboard-plus trials did not establish the claimed discrete stop sequence; Unicode key injection can differ from physical+ key. Wheel/pinch anchoring not tested.

Measurements / RGB: Zoom label about32px from right canvas edge,14px font; no exponential factor inferred.

Verdict: 100%, fit and selection commands work; full stop table and wheel/pinch remain unverified.

## V2 — Pan

Steps: Click Hand then drag(1000,650)→(1100,700). A Space-hold attempt was rejected by cliclick before gesture.

V2-hand.png shows shifted canvas with Hand selected; later V1-reset retains shifted framing. A later CoreGraphics physical Space-down/up helper with cliclick drag produced V2-space-before/after with unchanged camera; no successful Space-pan evidence. Helpers remained in /tmp.

Measurements / RGB: Gesture100×50screen px; sidebar280px remains fixed; no cursor captured.

Verdict: Hand pan observed; Space-drag not observable with the attempted input method.

## V3 — Fit vs selection

Steps: Select120×120 shader,⇧2; then⇧1.

V3-selection fills central viewport with shader at538%; V3-fit shows all scratch frames at113%, keeping selection.

Measurements / RGB: 538% versus113%; same880px canvas width.

Verdict: Selection fits selected bounds; Fit includes all scratch artwork.

## V4 — Rulers/grid

Steps: Zoom to selected frame; inspect548% canvas and surrounding edges.

V4-high-zoom.png has no rulers or pixel grid. V4-return.png is a transient black/blank render and is excluded. No12800%+ test established.

Measurements / RGB: 548% visible label; canvas(43,43,43), framewhite. No grid-spacing measurement possible.

Verdict: No rulers/pixel grid observed at548%; universal absence at all zoom levels not proven.

## K1 — Shortcut reference

Steps: Help→Keyboard shortcuts; capture top; scroll600px repeatedly to bottom.

Authoritative K1-open-verified and K1-scroll-01…09.png. Continuous right drawer, not tabs;01–07cover content,08/09repeat bottom. Headings: APPLICATION, TOOLS, EDIT, SELECTION, VIEW, TRANSFORM, SHAPE, ALIGNMENT, MOVEMENT, PAGES, TEXT EDITING. Search shortcuts… field and pinned Command palette⌘K. Initial K1-page-01…09 are failed unopened-panel trials. See transcript below.

Measurements / RGB: Drawer320wide, text inset12, rows32pitch; input32high; background(28,28,28), purple focus. No action invoked from listing.

Shortcut transcription (reading order; key symbols normalized to macOS notation; these are advertised bindings, not all behaviorally verified):

- APPLICATION: Command palette⌘K; Go to settings⌘,.
- TOOLS: Move toolV; Scale toolK; Hand toolH; Temporary hand toolSpace; Frame toolF; Text toolT; Shader toolS; Eye dropperI; Eye dropper(alt)⌃C.
- EDIT: Copy⌘C; Copy as code⌘⇧C; Copy styles⌘⌥C; Copy prompt⌘⇧⌥C; Paste⌘V; Paste styles⌘⌥V; Paste to replace⌘⇧R; Paste over selection⌘⇧V; Cut⌘X; Undo⌘Z; Redo⌘⇧Z; Redo(alt)⌘Y; Duplicate⌘D; Delete⌫; Select all⌘A; RenameF2; Rename layer⌘R.
- SELECTION: Select inverse⌘⇧A; Cycle next layerTab; Cycle previous layer⇧Tab; Find layer⌘F; Select child↵; Select parent⇧↵; Move selection up to parent\; DeselectEsc.
- VIEW: Zoom in⌘+; Zoom out⌘−; Zoom to100%⇧0; Zoom to fit⇧1; Zoom to selection⇧2; Zoom to next frameN; Zoom to previous frame⇧N; Zoom(scroll)⌘Scroll; Toggle sidebars⌘.; Hide or show both sidebars⌘⇧\; Hide or show all panels⌘\; Toggle repository sidebar⌘B; Move repository or worktree up⌥↑; Move repository or worktree down⌥↓; Toggle chat⌘⇧B; Toggle canvas⌘⇧.; Toggle changes & terminal⌘J; Start or stop preview⌘⇧P; Open preview in a tab⌘⌥P; Switch to next view⌥]; Switch to previous view⌥[; Switch to the first toolbar view⌥1; Switch to the second toolbar view⌥2; Switch to the Canvas view⌥0; Focus chat⌘L; Add selection to chat⌘L; Send message↵; Send the other way while the agent works⌘↵; Stop the agentEsc; Paste as text, not a file⌘⇧V; Toggle visibility⌘⇧H; Toggle lock⌘⇧L; Peek behind backgrounds(hold)⇧; Collapse all layers⌥L; Set opacity0–9.
- TRANSFORM: Flip horizontal⇧H; Flip vertical⇧V; Reset image size⇧R; Add auto layout⇧A; Remove auto layout⌥⇧A; Resize to fill⌘⇧⌥F; Frame selection⌘G; Frame selection(alt)⌘⌥G; Unframe selection⌘⇧G; Unframe selection(alt)⌘⌫; Send backward⌘[; Bring forward⌘]; Send to back⌘⌥[; Bring to front⌘⌥].
- SHAPE: Remove fill⌥/; Remove border⇧/; Swap fill and border⇧X.
- ALIGNMENT: Align left⌥A; Align horizontal center⌥H; Align horizontal center(alt)⌥C; Align right⌥D; Align top⌥W; Align vertical middle⌥V; Align bottom⌥S; Distribute horizontal spacing⌃⌥H; Distribute vertical spacing⌃⌥V; Tidy up⌃⌥T.
- MOVEMENT: Move left←; Move right→; Move up↑; Move down↓; Move left10px⇧←; Move right10px⇧→; Move up10px⇧↑; Move down10px⇧↓.
- PAGES: Next pagePgDn; Previous pagePgUp.
- TEXT EDITING: Bold⌘B; Italic⌘I; Underline⌘U; Strikethrough⌘⇧X; Align text left⌘⌥L; Align text center⌘⌥T; Align text right⌘⌥R; Align text justify⌘⌥J.

Verdict: Shortcut drawer captured from top through final text-align command.

## K2 — Clipboard placement

Steps: Copy node,⌘D,Option-drag; copy/paste; empty-canvas Paste here; attempt replace/over shortcuts.

K2-duplicate:120×120 shaderX515→675,Y−133 unchanged (40pxgap). K2-paste-here shows copy at clicked region, **150×105** visual badge while base inspector W100 H70 reflects scale. K2-paste did not establish a new distinct object beyond existing3shader frames. K2-replace/over do not prove successful replacement. Copy as options enumerated CM2; clipboard payload formats not inspected.

Measurements / RGB: Duplicate160px horizontal offset for120px width; no universal fixed offset inferred.

Verdict: Duplicate and Paste here placement observed; normal/replace/over semantics and each Copy as payload unverified.

## K3 — Frame, unframe, hide, lock, delete

Steps: Marquee4objects,⌘G; attempt⌘⇧G on canvas; hide/lock asCM6.

K3-frame-selection shows new **Frame** wrapper739×391.18 and indented children. K3-unframe still has wrapper because child was selected; not successful unframe proof. Hide/lock successfully change state/menu. Delete node and alternate grouping shortcuts not exercised.

Measurements / RGB: Wrapper739×391.18; Layers indentation16px per level, row32px.

Verdict: ⌘G wraps selection in a frame; hide/lock confirmed; unframe and delete remain unverified.

## TX1 — Text creation/editing

Steps: T click insidewhite frame; type; attempt select-all; Move exit. T drag150×60 on dark canvas.

TX1-click has empty caret, layer **Text**, W0Hug,H14.5Hug, Inter,Regular,12px,Line heightAuto,Letter spacing0, black000000100%. TX1-selection actually reads **Canvas au** with caret, not selected range. TX1-drag creates W150px/H60px and empty caret; whiteFFFFFF100% outside white parent. Esc in isolated action did not reliably exit; Move button did.

Measurements / RGB: Text click H14.5; drag150×60; black/white fill context differs. Selection color not sampled because no range selection.

Verdict: Click creates empty Hug text; drag fixed text box; Inter Regular12px; selection highlight and Esc edit exit unverified.

## L1 — Layer hover, rename, reorder

Steps: Hover row; double-click attempted rename; type; drag row into another row.

L1-hover/reorder-after shows actual name **Auit SAMPLE** (not intended Audit sample), lock/eye at row right; **Lock layer** tooltip appears in L1-hover.png. L1-rename is still context menu, so double-click entry itself not proven. Reorder-after indents renamed frame beneath another frame; hierarchy expanded. Existing chevrons visible but collapse toggle not isolated.

Measurements / RGB: Rows32high,indent16; selected inset6px; dark-purple selected fill.

Verdict: Eye/lock and renamed row visible; panel drag reparents; rename entry and collapse behavior only partially observed.

## L2 — Page add/rename/reorder

Steps: Click Pages+; wait loading; inspect Page3. Open Page3 context→Rename; edit field; drag row; never Delete.

L2-load-result shows Pages3 and Page1/Page2/Page3. L2-rename-field shows purple-outlined inline field selecting Page3. L2-renamed-confirmed reads **Audit**; L2-drag-confirmed has a purple insertion line above Page1; L2-order-confirmed order is **Audit, Page1, Page2**; early L2-renamed actually invoked eyedropper because field was not active and is excluded. Delete confirmation deliberately not opened.

Measurements / RGB: Page rows32high; rename field≈218×20, purpleborder; normal page fill(43,43,43).

Verdict: Page addition, rename to Audit, and reorder above Page1 confirmed; deletion confirmation excluded for safety.

## X1 — Stale tab/page render

Steps: Initial app had Porto context menu; Escape and switch Sunbird; click Page1. Later add page and wait.

X1-initial.png is Porto read-only baseline, not edited. Sunbird tab initially Page2 but only Page1 in panel, canvas near(24,24,24), creation no-op. ClickingPage1 restores graycanvas and edits. Later addition reveals Page2/Page3; this is stale display, not proof Page2 was absent. Some post-navigation captures transiently black.

Measurements / RGB: All screenshots fullrect(0,30,1440,870), native2880×1740; loading canvas differs from normalRGB43.

Verdict: Tab/panel state can be stale; verify loaded page and actual pixels before edits.

## X2 — Adaptive layer menu

Steps: Compare CM2-frame-ready, CM3-text-menu, CM5-multi-verified and CM6 row menus.

Hide label only in tested top-level frame/shader cases; Use as mask in multi; Select layer only canvas context. No separate X2 image needed: existing paired evidence referenced.

Measurements / RGB: All measured menus176wide and25px itempitch; palette shared.

Verdict: Menu composition depends on target, hierarchy/surface and selection cardinality.

## X3 — Eye dropper magnifier

Steps: A failed page-rename typing attempt activated Eye dropper with I; later deliberately press I on empty canvas and capture, then Escape. No color was applied to artwork.

X3-eyedropper.png shows circular loupe with pixel grid, central outlined sample and **42, 42, 42**. Earlier L2-reorder-after.png shows toast **Hex color #1C1C1C copied to clipboard**, resulting from the unintended eyedropper click during that failed rename trial. This is clipboard-only, not evidence of a fill edit.

Measurements / RGB: Loupe≈120px diameter including dark surround; inner grid≈92px; central sample≈10px; displayedRGB42/42/42. Per-PNG numeric samples in measurements.json.

Verdict: Eye dropper supplies a pixel-grid magnifier and can copy sampled hex to clipboard.

## Capture exclusions and remaining subtests

Do not use attempted-state names as proof. Excluded or limited: CM1-empty (no menu); CM2-frame and S4-frame/S4-frame-verified (stale page/no object); original T1 sequence partly overlapped view toggles; later tooltip images without text prove only hover styling; initial TR3 nudge and TR2 rotation attempts lacked successful transitions; CM3-text still edits; CM5-multi only selects one; S2-escape is focus-ambiguous; T4-scale misses handle; K1-page-01…09 never opened drawer; TX1-selection has no selected range; V4-return is blank/transient; L1-rename still shows context menu; L2-renamed is eyedropper, not rename; X1-final-canvas accidentally creates tiny text in scratch Audit page rather than restoring Page1. **X1-restored-page1.png** is the verified return to Page1.

Outstanding: true non-frame child menu(CM4); true empty internal clipboard(CM10); five tooltip texts(T1); scale child/font effect and native cursor(T4/TR2); nested hover(S1); controlled Classic/Deep preference comparison(S2); Shift add/remove(S3); Fill badge(S4); Alt two-axis corner(TR1); equal-spacing/snap thresholds(TR4); child-parent numeric distances(TR5); flex canvas reparent/reorder(TR7); layout-handle editing(TR8); full zoom-stop table and wheel/pinch(V1), Space pan(V2), extreme zoom(V4); normal/replace/over paste payload semantics and every Copy as payload(K2); successful unframe/delete(K3); text range highlight and Esc edit-exit(TX1); isolated layer-collapse toggle(L1). Page delete confirmation(L2) was intentionally not opened per the safety constraint. These are limitations, not claims the features are absent.

All new PNG filenames, exact dimensions and SHA-256 hashes are enumerated in manifest.json. No tests were run because no source was edited. No commit made.
