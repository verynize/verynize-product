# Verynize side: Properties panel parity audit

Captured with `capture.cjs` in this folder (`npm run build:ui`, then `node design/wonder/properties-audit/verynize/capture.cjs [prefix…]`).
Real Electron app via Playwright `_electron`, temp `--user-data-dir`, `VERYNIZE_SKIP_ONBOARDING=1`, content size 1440×870, `--force-device-scale-factor=2`.
Every PNG is a crop of `aside#properties` (x 1159, y 40, 281×830 CSS → 562×1660 px). When a Radix menu or popover is open, the crop is widened to include it.
No source code was edited. 116 screenshots. `metrics.json` holds the raw DOM data behind each entry: header buttons, row controls, select options, the selected node and the canvas computed style.

**Naming.** Where `wonder/` already had a file for the same state, the Verynize file uses the same name, e.g. `A2-border-individual-sides`, `A2-border-variable-bound`, `A11-eye-visible`, `A11-drop-open`, `B1-cross-gap-typed-37`, `B2-fixed-selected`, `B3-variable-50-attempt`. A few states have no Wonder counterpart and use extra names (`*-solid`, `*-side-colours`, `*-editor`).

**Fixture.** Unless an entry says otherwise, the fixture is a top-level frame "Card": x 100, y 100, 270×340, `#FFFFFF`, radius 0, Clip content on, display Free. These are the same values as Wonder's frame, except Wonder has y −205.

- Tokens: `surface #111827`, `surface/base #172033`, `accent #5EEAD4`, `ink #000000`.
- Variables: `spacing` (dimension 24), `strength` (number 60).

**Measurement method.**

- Coordinates are CSS px relative to the panel's left/top edge.
- Colours are the most frequent pixel in a region, or the brightest pixel for text and icons.
- The canvas outline `1.5px rgb(185,60,219)` that appears in every canvas readout is the selection outline, not a document outline.

## Shared measurements

| What                            | Value                                                                                                                    |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Panel background                | `#1C1C1C`                                                                                                                |
| Section divider                 | 1px `#262626`                                                                                                            |
| Section header height           | 31px (`h-7.75`). The title sits at x 13.                                                                                 |
| Section title text              | 12px, `#A8A8A8`                                                                                                          |
| Header icon buttons             | 24×24 with a 16px glyph, `#A8A8A8`. The last one sits at x 245, the one before it at x 217 (Fill) or x 213 (Appearance). |
| Active toggle button background | `#363636`                                                                                                                |
| Field                           | 24px tall, `#2B2B2B`, 6px radius                                                                                         |
| Value text                      | `#E8E8E8`; disabled value text is `#909090`                                                                              |
| Prefix letter or icon           | `#909090`, 14px slot at x 6–20 inside the field                                                                          |
| Value start inside a field      | x 25                                                                                                                     |
| Rows                            | 8px apart, inside a 256px-wide body (x 13–269)                                                                           |
| Trailing tool column            | 24px wide (x 245)                                                                                                        |

---

## A. Section header states

### A1 Background Fill

**Files:** `A1-background-empty`, `-added`, `-solid`, `-hover`, `-removed`, `-gradient`, `-bound`, `-variable-menu`, `-multiple`, `-hidden`, `A1-fill-picker`.

**Steps.**

1. Load Card with `color: transparent` → empty.
2. Click `+` ("Add paint") → added.
3. Load a white Card → solid.
4. Hover row 0 → hover.
5. Click the row `−` → removed.
6. Gradient (`fills: [linear 180°, #172033 → #456099]`).
7. Token-bound (`token: surface`), then open "Apply variable".
8. Three paints (red 50%, white, linear).
9. A hidden top paint.
10. Click the swatch to open the picker.

**Header icons.** Every state shows the same two buttons: the "Apply variable" glyph (ShaderIcon, x 217) and `+` "Add paint" (x 245), both enabled. Nothing in the header depends on whether a fill exists.

**Empty.** The header is followed by the text "No paints. Add one with +." (10px text, `#707070`, at y+35, 14px tall), then a caption "Animated" with a "None ▾" select (116px wide; options None / Aurora / Sunset / Ocean). Section height 113px. Wonder's empty fill is the header only.

- Source: `web/src/islands/inspector/paints.tsx:327` and `properties.tsx:609-617`. The Animated select is always rendered.

**Added.** Clicking `+` adds a solid `#D9D9D9` paint (Wonder adds `FFFFFF`). The canvas background becomes `rgb(217,217,217)`.

**Solid row** (24px, x 13–205), laid out left to right:

- 18px swatch button (x 17)
- hex input "FFFFFF" (x 39, 114px wide)
- opacity "100" plus "%" (x 157)

The row tools sit outside the field: eye "Hide paint" (x 217) and `−` "Remove paint" (x 245). Section height 123px. The Animated row stays below.

**Hover.** No visible change in the row. Nothing extra appears on hover.

**Removed.** Back to the empty state. Canvas background `rgba(0,0,0,0)`.

**Gradient.** The row is a preview swatch plus the label "Linear", then "100 %", eye, `−`. The canvas uses `linear-gradient(rgb(23,32,51) 0%, rgb(69,96,153) 100%)`.

**Bound** (token `surface`).

- The row shows the swatch plus a variable chip "surface" (16px tall, chip fill `#1C1C1C`, text `#D4D4D4`, chip x 38).
- No hex and no opacity field. Eye and `−` remain.
- "Apply variable" menu (opens to the left): header "Apply variable", then `surface`, `surface/base`, `accent`, `ink`, separator, "Detach variable".

**Multiple.** One row per paint, 4px apart (rows at y 605 / 633 / 661), each with its own eye and `−`. There are no reorder arrows in the row; "Move paint up/down" live in the picker header.

- **Bug seen:** the top paint has `opacity: 50`, but its field reads **100 %**. The canvas correctly renders `rgba(255,0,0,0.5)`. For unbound solids the field shows the colour's alpha, not the paint opacity (`paints.tsx:433`).

**Hidden.** The hidden paint's eye becomes EyeOff ("Show paint"). The row's text is not dimmed. The canvas drops that paint: `backgroundImage` contains only the white layer.

**Picker** (`#color-dialog`, to the left of the panel), top to bottom:

- "Color" with a close button
- paint-type select: Solid / Linear / Radial / Conic / Image
- tabs: "Custom" / "Variables"
- saturation/value plane, hue slider, alpha slider
- format select (HEX / RGB / HSL / OKLCH), eyedropper, copy
- channel fields, "A … %"

### A2 Border

**Files:** `A2-border-empty`, `-added`, `-hover`, `-settings`, `-individual-sides`, `-side-colours`, `-color-picker`, `-child-added`, `-variable-bound`, `-hidden`, `-removed`.

**Steps.**

1. White Card.
2. Click `+` → added (one undo step; the canvas changes at once).
3. Hover the width field.
4. Hover the header tool (Verynize has no settings popover).
5. Click "Independent border widths" → individual sides.
6. Click "Independent border colours" (palette icon) → side colours.
7. Open the colour picker.
8. Add a border on a nested child frame.
9. Load `strokeToken: accent` → variable-bound.
10. Load `strokeHidden: true` → hidden.
11. Click `−` → removed.

**Header icons.**

- Inactive: `+` "Add border" only (x 245). Clicking the header row also adds a border.
- Active, in every state (added, hover, bound, hidden, sides): **one icon only**, the dashed square (lucide `SquareDashed`, "Independent border widths", x 245). It is enabled, and gets a `#363636` background when individual widths are open.
- Missing compared with Wonder's active header: no sliders (settings) button and no `+`. Source: `properties.tsx:770-781` (`tools={<IconButton icon={SquareDashed} …/>}`). `OptionalSection` renders no `+` when present (`controls.tsx:139-155`).
- `A2-border-settings` therefore has no popover. It shows the header tool hovered. The style options live in the row select instead (native `<select>`, cannot be shown open): **Solid / Dashed / Dotted**.

**Row 1** (y+35, 24px), against Wonder's `≡ 1 | All ▾ | eye | −`:

- `W 1 px` width field: letter prefix "W", value at x 38, unit "px"; 108px wide. Hovering shows the diamond "Apply variable to border width" at x 65.
- `Solid ▾` style select: x 121, 84px wide.
- Eye "Hide border": x 213.
- `−` "Remove border": x 245.
- Source: `properties.tsx:783-826`. The "W" prefix is at `properties.tsx:791/802`. The style select is `effects.tsx:338-353`.

**Row 2** (y+67), against Wonder's `■ 000000 100 %` with no trailing icon:

- Swatch plus hex field "000000" (x 40, 117px), then a separate alpha field "100 %" (x 160–212).
- Then a **palette icon** "Independent border colours" (x 245).
- Source: `border-colors.tsx:57-79`.

**Added defaults.** Width 1, solid, `#000000`, 100%. Canvas: `border 1px solid rgb(0,0,0)` on all sides. Section height 103px.

**Individual sides.** A 4-column row "T 1 | R 1 | B 1 | L 1" (25px inputs) is added under the colour row. Section height 135px.

**Side colours.**

- The colour row becomes "Side colours", with the palette button active (`#363636`, "Use one border colour").
- Four rows follow: T / R / B / L, each with swatch, hex and alpha.
- Section height 263px.

**Variable-bound.**

- Row 2 shows the swatch plus chip "accent", then a **Detach (Unlink) button** at x 213, then the palette at x 245.
- No hex or alpha field.
- Canvas border colour `rgb(94,234,212)`.

**Hidden.** The eye becomes EyeOff ("Show border"). The canvas border width is 0px while `strokeWidth` stays 1.

**Child.** Same rows and icons as on the top-level frame.

**Removed.** The header is back to `+` only (32px section). The canvas border is 0.

### A3 Outline

**Files:** `A3-outline-empty`, `-added`, `-hover`, `-removed`.

**Steps.** White Card → `+` → hover the width field → row `−`.

**Header icons.**

- Inactive: `+` "Add outline".
- Active: **no header icons at all**. `OptionalSection` is used without `tools` or `onRemove`.

**Added.**

- Row 1 is captioned: "Width" `W 1`, "Offset" `O 0`, then eye (x 213) and `−` (x 245). 44px tall.
- Row 2: swatch, `000000`, `100 %` (no trailing icon).
- Row 3: full-width "Solid ▾" select (Solid / Dashed / Dotted).
- Section height 155px.
- The canvas readout here is dominated by the selection outline. The document gets `outlineWidth 1, outlineOffset 0, outlineColor #000000`.

**Hover.** No visible change.

**Removed.** `+` only.

### A4 Shadow

**Files:** `A4-shadow-empty`, `-added-editor`, `-added`, `-hover`, `-multiple`, `-bound`, `-bound-editor`, `-removed`.

**Steps.** White Card → `+` (the editor opens automatically) → Escape → hover the row. Then load 3 shadows (box, inner, drop), then load one shadow bound to `accent`, then `−`.

**Header icons.** `+` "Add shadow" is the only header icon in **every** state, including when shadows exist.

**Added.** Adds `box 0 4 12 0 #00000040`. The canvas shows `box-shadow: rgba(0,0,0,0.25) 0 4px 12px`.

- The row is a 24px button (square icon plus "Box shadow", 192px wide), then eye (x 213) and `−` (x 245).
- The editor popover (left of the panel) contains: segmented Box / Drop, X / Y / B / S fields, colour "… %", "Inner shadow" checkbox.

**Multiple.** One row per shadow, 8px apart: "Box shadow", "Inner shadow" (dashed-square icon), "Drop shadow".

- Canvas: `box-shadow` for box and inner, plus `filter: drop-shadow(...)` for the drop shadow.

**Bound.**

- The row itself does not show the variable; it still reads "Box shadow".
- The editor's colour field shows chip "accent".
- Canvas shadow colour `rgb(94,234,212)`.

**Hover.** The row button gets the accent background.

**Removed.** `+` only.

### A5 Filters

**Files:** `A5-filters-empty`, `-added`, `-hover`, `-multiple`, `-removed`.

**Steps.** White Card → `+` → hover the type select → load blur + brightness → `−` twice.

**Header icons.** `+` "Add filter" only, in every state. `+` adds a filter immediately; there is no add menu (Wonder has `A5-filters-add-menu`).

**Row.**

- Native type select (88px): Blur, Brightness, Contrast, Grayscale, Hue rotation, Invert, Saturate, Sepia. The list appears twice in the options, because it holds two groups: layer filters and backdrop filters (values `layer:*` and `backdrop:*`).
- Amount field ("4 px").
- Eye (x 213) and `−` (x 245).

**Defaults.** Blur 4. Canvas `filter: blur(4px)`. Two filters give `blur(4px) brightness(1.2)`.

**Removed.** `+` only; canvas `filter: none`.

### A6 Mask

**Files:** `A6-mask-empty`, `-added-editor`, `-added`, `-hover`, `-removed`.

**Steps.** White Card → `+` (the editor opens automatically) → Escape → hover the row → `−`.

**Header icons.** `+` "Add mask" only, in every state.

**Added.** A "Linear" row (button, eye, `−`). The canvas gets `-webkit-mask-image: linear-gradient(rgb(0,0,0), rgba(0,0,0,0))`.

- A **"Custom mask (CSS)" text field** is always shown under the rows once a mask has been added.
- The editor contains: type, "Alpha A %", "Rotation R °", "Invert", Add / Subtract / Intersect / Exclude, "Advanced", "Detach mask as shape".

**Removed.** The row is gone, but the "Custom mask (CSS)" field **stays visible** (section height 91px rather than 32). Source: `masks.tsx:187-200`, where `showCustom` is sticky local state.

### A7 Export

**Files:** `A7-export-empty`, `-added`, `-hover`, `-removed`.

**Header icons.**

- Inactive: `+` "Add export".
- Active: `−` "Remove export" in the header (x 245).

**Body.**

- Row 1: file name "Card", suffix "@2x".
- Row 2: size select "2x" (0.5x, 1x, 2x, 3x, 4x, 720p, 1080p, 1440p, 2160p, 512w, 512h), format "PNG" (PNG / JPG / WebP / PDF / Code), scope "Selection" (Selection / Page).
- Row 3: button "Export as PNG".
- Section height 135px.

**Canvas.** No change (UI-only panel).

### A8 Layer

**Files:** `A8-layer-empty`, `-added`, `-removed`, `-text-bottom`.

**Header icons.**

- Inactive: `+` "Add layer".
- Active: `−` "Remove layer".

**Body.**

- "Name": a text field.
- "Parent frame": a select (Canvas, plus frames).
- Four buttons: "½×", "2×", Duplicate, Delete.
- Section height 175px.

**Canvas.** No change. The panel is UI-only, and its open state is per layer.

**Text layer, scrolled to the bottom.** The same `+`-only Layer section is the last one in the panel.

### A9 Selection colors

**Files:** `A9-selection-colors-frame`, `-bottom`, `-multiple`, `-svg-mono`, `-svg-multi`.

**Steps.**

1. Card bound to `surface` with a text child (`accent`) and a red rectangle child.
2. Select Card (top of the fill section, then scrolled to the bottom).
3. Multi-select Card, text and rectangle.
4. Then a monochrome SVG image and a two-colour SVG image.

**Result.** **Verynize has no "Selection colors" section.** The section titles with the frame selected are, verbatim: Position, Layout, Appearance, Background Fill, Border, Outline, Shadow, Filters, Mask, Export, Layer. The multi-selection is the same.

**Nearest equivalent.** A "Colors" section (`#svg-colors-section`, `svg-colors.tsx:83`, `:192`) that only appears for SVG image layers.

- Monochrome SVG: one row, swatch plus hex `FF0000`.
- Two colours: one row per paint, `FF0000` and `0000FF`.
- No header icons until something is recoloured; then Reset and Detach appear.

### A10 Typography

**Files:** `A10-typography-text`, `A10-typography-text-fill`.

**Layer.** Text "Hello world", Inter 400, 24px.

**Header icons.** One: sliders "Edit text content" (lucide `SlidersVertical`). It focuses the Text area.

**Rows.**

- Font family "Inter".
- Weight "Regular" plus size `24 px`.
- Captions "Line height" `1.15` and "Letter spacing" `|A| 0 px`.
- "Alignment": left / center / right / justify.
- "Text" textarea (84px).
- "Select text above, then style the range", with Bold / Italic / "Apply fill colour and size to selected range".
- Typography section height 332px.

**Text Fill.** The fill section is titled "Text Fill", with the same header icons as A1 (Apply variable, `+`).

### A11 Appearance

**Files:** `A11-eye-visible`, `A11-eye-hidden`, `A11-drop-open`, `A11-appearance-blend-multiply`.

**Header icons.** Eye "Hide layer" (x 213) and drop "Blend mode: Normal" (x 245).

**Eye.** Toggles the layer's `hidden`. The icon becomes EyeOff "Show layer", and the canvas element becomes `display: none`.

**Drop.** Opens a menu to the left. Verbatim: "Blend mode", Normal ✓ | Darken, Multiply, Plus darker, Color burn | Lighten, Screen, Plus lighter, Color dodge | Overlay, Soft light, Hard light | Difference, Exclusion | Hue, Saturation, Color, Luminosity.

- Picking Multiply makes the drop button active (`#363636`, label "Blend mode: Multiply"). The canvas gets `mix-blend-mode: multiply`.

**Body.** "Opacity" `100 %` and "Corner radius" `0`, plus an "Independent corner radii" button (x 245), then "Clip content" checked (purple checkbox). Section height 128px.

---

## B. Open questions (behavioural evidence)

### B1 Flex gap without wrap

**Files:** `B1-before-gap`, `B1-after-gap-37`, `B1-cross-gap-typed-37`, `B1-gap-row-nowrap`, `B1-gap-column-nowrap`, `B1-gap-row-wrap`.

**Steps.**

1. Card flex row, gap 10.
2. Type 37 into the main gap.
3. Try to type 37 into the cross gap.
4. Repeat for a column flex, and for a row flex with Wrap on.

**Current behaviour.** The cross-axis gap field is **disabled** whenever wrap is off.

- Row direction: the "Row gap" `gapY` field is disabled.
- Column direction: the "Column gap" `gapX` field is disabled.
- In the disabled field the value text is `#909090` instead of `#E8E8E8`. The field background stays `#2B2B2B`.
- A click does not focus it (`focusedAfterClick: false`), and Playwright `fill` times out. **You cannot type into it.**
- It keeps mirroring `gap` (it shows 10), and the canvas is unchanged: `row-gap` and `column-gap` both 10px.

**Main gap.** Typing 37 sets `gap: 37`. The canvas `row-gap` and `column-gap` both become 37px.

**With Wrap on.** The cross field is enabled. Typing 37 writes `gapY: 37`; the canvas `row-gap` becomes 37px while `column-gap` stays 8px.

**Wonder differs.** Wonder's `B1-cross-gap-typed-37` shows 37 typed into the cross field without wrap.

**Cause.** `web/src/islands/inspector/layout.tsx:585` (`disabled={column && !wrap}`) and `:592` (`disabled={!column && !wrap}`).

**Locked by.** `tests/inspector-parity.cjs:190`: `assert.equal(await page.locator('#layout-section [name=gapY]').isDisabled(), true, 'cross gap is inactive without wrap')`.

### B2 W/H sizing label and menu

**Files:** `B2-fixed-selected`, `B2-hug-selected`, `B2-fill-selected`, `B2-wh-menu-open`, `B2-wh-after-hug-contents`, `B2-min-width-added`, `B2-wh-top-level`.

**Fixture.** A child frame "Kid" (120×60, flex) inside the flex Card.

**Labels.** The sizing mode is a bare native `<select>` inside each W/H field, after the number. Labels are **`px` / `Hug` / `Fill`** (`layout.tsx:166`).

- Fixed: `W 120 px ▾`. The select is at x 83, 30px wide.
- Hug: `W 76 Hug ▾`. The select is 39px wide.
- Fill: `W 238 Fill ▾`.
- The number always stays visible. There is no "Calculate" mode or label (Wonder shows "270 Calc").

**Options.** Always px / Hug / Fill. Unavailable ones are disabled (`layout.tsx:214`, `sizingAllowed` in `web/node-style.js:35-40`):

- Hug needs a text layer or a non-free frame.
- Fill needs a flow parent.
- Top-level free Card: `px`, `Hug (disabled)`, `Fill (disabled)`.
- Flow child frame: all three enabled.
- Rectangle in flex: `Hug (disabled)`.

**What each does.**

- Fixed keeps w/h.
- Hug sets `wMode/hMode: hug` and resizes to the content: 120×60 → 76×36 on the canvas.
- Fill sets `wMode: fill` and takes the remaining main-axis space: width 238.

**Trailing tool menu** ("Size options" icon at x 245). Verbatim: **Hug contents** | separator | **Add min width**, **Add max width**, **Add min height**, **Add max height**.

- "Hug contents" sets both axes to hug in one step. It is disabled where hug isn't allowed.
- "Add min width" adds a limit row "⟷ 76 | Min width ▾". Its select lists Min width / Max width / Min height / Max height / Remove. The value is seeded with the current width, so the canvas is unchanged.
- An item is disabled when that limit already exists.
- No Fixed / Fill / Calculate items.

**Locked by.**

- `tests/canvas-interactions.cjs:266-273`: the option list is fixed / hug / fill with their disabled states, and Fill takes the remaining space.
- `tests/inspector-parity.cjs:206-207`: the Size options menu, then `[data-limit=maxW]`.

### B3 Fill bound to a variable at 100% / 50%

**Files:** `B3-variable-100`, `B3-variable-100-picker`, `B3-variable-100-picker-custom`, `B3-variable-alpha-50-editor`, `B3-variable-50-attempt`, `B3-variable-50`.

**At 100%.** The row is swatch plus chip "surface" (chip area x 38, 167px wide), then eye and `−`. **There is no opacity field.** The picker opens on the "Variables" tab.

**The only UI way to make it translucent** is the picker's Custom tab "A %" field (or the alpha slider).

- It shows `100`. Typing 50 commits `#11182780` with `token: ''`, which **detaches the variable**.
- The row turns into hex `111827` / `50 %`. The canvas shows `rgba(17,24,39,0.5)`.
- There is no way to keep the binding and lower its opacity from the UI.

**At 50%.** Only reachable through data: `fills: [{token: surface, opacity: 50}]`. The row then shows the chip (115px wide) **plus a "50 %" field** (x 157). The canvas shows `rgba(17,24,39,0.5)`.

- Typing 100 there should hide the field again. This comes from reading the code; it was not captured.

**Cause.**

- `paints.tsx:503`: `{p.token && (legacy || opacity === 100) ? null : <Field … Fill opacity>}` hides the field for bound paints at 100%.
- `paints.tsx:428`: `commit` sets `token: undefined`, so any picker edit detaches.
- `paints.tsx:433` defines the opacity source: paint opacity when bound, colour alpha when unbound.

**Locked by.**

- `tests/inspector-bound-fields.cjs:139-142`: "bound fill shows no hex or opacity field".
- The header comment at line 2: "no unit or opacity".
- The picker-alpha behaviour for unbound fills is asserted in `tests/inspector-parity.cjs:36-40`.

### B4 Constraint diagram, top-level vs nested

**Files:** `B4-constraints-top-level`, `B4-constraints-child`, `B4-constraints-child-hover`, `B4-constraints-flex-child`, `B4-nested-absolute-constraints`.

**Top-level frame.** Disabled and dimmed:

- The "Left ▾" and "Top ▾" selects are disabled. Text `#727272`, opacity 0.7.
- The diagram well is at 50% opacity: it samples `#292929` and the ticks `#382C40`, instead of `#363636` and purple `#974BCC`.
- The diagram's pin buttons are disabled.

**Child of a free frame** (Inner, 20,20). Enabled:

- Selects in `#E8E8E8`, well `#363636`.
- Left and top ticks purple (aria-pressed).
- Hovering reveals the centre lines.

**Child of a flex frame.** Disabled, like the top-level frame.

**Absolutely positioned flex child.** Enabled.

**Cause.**

- `web/canvas-interactions.js:1438`: `anchorable = n => !!n.parentId && (!isFlow(find(n.parentId)) || n.position === 'absolute')`. `constraintsOf` returns null otherwise (`:1457`).
- `web/src/islands/inspector/constraints.tsx:52` and `:109` (`disabled={!list}`), and `:131` (`!list && "opacity-50"`).

**Locked by.** `tests/canvas-constraints.cjs:108-117`:

- "artboards have no constraints" (`constraintH` disabled)
- "stack children have no constraints"
- "absolute children read their insets as constraints"

### B5 Variable chip x offset vs plain value

**Files:** `B5-numeric-prefix`, `B5-numeric-variable-chip`, `B5-chip-bound-layout`, `B5-numeric-menu`, `B5-width-hover`, `B5-width-variable-search`.

**Measured inside the field** (opacity and corner radius, 108px fields; gap and padding give the same result):

|               | Prefix slot | Content starts at | Gap after prefix | Chip                                                                     |
| ------------- | ----------- | ----------------- | ---------------- | ------------------------------------------------------------------------ |
| Plain value   | x 6–20      | x 25              | 5px              | —                                                                        |
| Variable chip | x 6–20      | x 28              | 8px              | 16px tall, its label inset 4px (`px-1`), so the chip text starts at x 32 |

So the chip sits **3px further right** than a plain value.

- The bound field drops the unit ("%") and the diamond.
- Chip fill `#1C1C1C`, text `#D4D4D4`.

**Cause.** `web/src/islands/inspector/bind.tsx:193` (`<VariableChip … className="ml-0.75" />`, documented at `:167`: "the chip starts 3px after where the value text would (27.5px in with a prefix…)"). The prefix inset comes from `controls.tsx` `fieldPrefixInset` (`pl-1.5`) and the shell's `gap-1.25`.

**Locked by.** `tests/inspector-bound-fields.cjs:124-128`: the chip is 16px tall and `geometry.left >= 27 && geometry.left <= 28.5`, "chip sits after the prefix".

**Menus.**

- Hovering a numeric field reveals the diamond (opacity 0 until hover).
- The radius menu, verbatim: "Apply variable" | spacing 24px, strength 60 | New dimension variable…, New number variable….
- The W menu: "Apply variable" | spacing 24px | New dimension variable….
- There is no search box in Verynize's bind menu (Wonder has `B5-variable-search`).

---

## C. Layout / position

### C1 Position block

**Files:** `C1-position-top-level`, `C1-position-child`, `C1-position-multi-mixed`.

**Row 1.** Three tool groups (24px, `bg-muted`):

- Align left / centre / right: disabled with one layer selected, opacity 0.4.
- Align top / middle / bottom: disabled with one layer selected, opacity 0.4.
- Rotate 90°: always enabled.
- Distribute horizontally / vertically: need three or more layers.

**Row 2.** `X 100`, `Y 100`, `∟ 0 °` (80px each).

**Row 3.** The `Left ▾` and `Top ▾` selects, with the constraint diagram spanning two rows on the right, and `Z Auto` (placeholder, 168px) below them.

**No header icon.** Wonder has an expand icon at the top right of Position.

**States.**

- Top-level: constraints disabled (see B4).
- Child: X/Y relative to the parent (20, 20); constraints enabled.
- Two children with different constraints: `Mixed (disabled)` is the shown option of the horizontal select.

### C2 Display segmented

**Files:** `C2-display-none`, `-flex`, `-block`, `-grid`, `C2-display-rectangle`.

**Segments** (64px each): Free position, Flexbox, Block flow, Grid.

- Active segment: `#363636` fill with an edge and shadow, glyph `#E8E8E8`.
- Inactive: no fill, subtle glyph.

**Header.** The auto-layout glyph "Add auto layout" (free) or "Remove auto layout" (flow) at x 245. It is always quiet, never filled.

**Per display.**

- Free: section height 124px (Display plus W/H). Hug and Fill are disabled.
- Flex: 308px.
- Block: 244px ("Block" caption with a "Vertical spacing" field).
- Grid: 368px.
- Rectangle (not a frame): no Display row; W/H only (72px).

### C3 Flex

**Files:** `C3-flex-controls`, `C3-flex-column-centered`, `C3-flex-between-wrap-reverse`, `C3-flex-matrix-hover`.

**Group** (caption "Flex", 108px tall):

- Direction segmented: Horizontal / Vertical.
- 3×3 alignment matrix (56px): the active cell shows three bars; the others show dots.
- Column-gap field `)( 8` and row-gap field `≍ 8`. The cross field is disabled without wrap (B1).
- Distribution segmented: Space around / between / evenly.
- Trailing column: Reverse order (ArrowRightLeft) and Wrap.

**States.**

- Column, centred: the matrix centre cell is active. The disabled gap moves to Column gap.
- Space-between + wrap + reverse: the whole cross row of the matrix is active (three cells). Reverse and Wrap are active (`#363636`). Both gaps are enabled.
- Matrix hover: the hovered dot turns light.

### C4 Grid

**Files:** `C4-grid`, `C4-grid-tracks-popover`.

**Fixture.** 3 columns, gap 8, gapY 12.

**Layout.**

- Captions "Grid" and "Gap" side by side. The track preview is 56px tall and labelled "3 × Auto", with one column outline per track. Two stacked gap fields: Column 8, Row 12.
- Then "Align": a 3×3 cell matrix.
- Then Padding.
- Section 368px.

**Track popover** (to the left): "Columns" and "Rows" (Rows placeholder "Auto").

### C5 Grid child

**File:** `C5-grid-child`.

- Caption "Grid child": `Column span 2` and `Row span 1` fields (icons only).
- Margin follows below.
- W/H options: `Hug (disabled)`, Fill enabled.

### C6 Padding

**Files:** `C6-padding-collapsed`, `C6-padding-expanded`, `C6-padding-mixed-sides`.

**Collapsed.** Two fields, horizontal `16 px` and vertical `16 px` (placeholder "Mixed"). The tool is "Independent padding" (x 245), inactive.

**Expanded.** The tool is active (`#363636`). A 2×2 grid appears: Left / Top / Right / Bottom, all `16 px`.

**Mixed sides** (4/8/12/16). The panel opens directly in the expanded state.

### C7 Margin

**Files:** `C7-margin-px`, `C7-margin-auto`, `C7-margin-auto-sides`.

**Fixture.** Rectangle A inside the flex Card.

**px.** `⟷ 0 px ▾` and `↕ 0 px ▾`. Unit options are **px / Auto** only.

**Auto** (`margin: [0, auto, 0, auto]`). The horizontal field reads **`Auto  Auto ▾`**: the value "Auto" (27px) followed by the unit select "Auto" (42px). This matches Wonder's "Auto Auto ▾". The canvas `margin-left` resolves to auto.

**Sides.** The "Independent margins" toggle expands to Left `Auto Auto ▾`, Top `0 px`, Right `Auto Auto ▾`, Bottom `0 px`.

### C8 Page section (no selection)

**Files:** `C8-page-no-selection`, `C8-page-custom-background`.

**Layout.** Section "Page" (72px). One row: swatch, hex `2B2B2B` (the theme default), `100 %` (read-only), and an empty 24px tool column.

**Custom background.** With background `#1E1E1E`, the tool column shows a Reset (RotateCcw) button.

---

## Summary of differences against the user's Wonder notes

| Area                        | Verynize                                                                       | Wonder                             |
| --------------------------- | ------------------------------------------------------------------------------ | ---------------------------------- |
| Border header, active       | One dashed-square icon (`SquareDashed`, "Independent border widths")           | Sliders + sides + `+`              |
| Border row                  | `W 1 px` / `Solid ▾` / eye / `−`                                               | `≡ 1` / `All ▾` / eye / `−`        |
| Border colour row           | Swatch, hex, separate `100 %` field, trailing palette icon                     | `■ 000000 100 %`, no trailing icon |
| Empty Background Fill       | Header plus "No paints. Add one with +." plus "Animated: None" (113px section) | Header only                        |
| Margin, Auto                | `Auto  Auto ▾`                                                                 | `Auto  Auto ▾` (same)              |
| Selection colors            | No section; only the SVG-only "Colors" section                                 | "Selection colors" section         |
| Cross-axis gap without wrap | Disabled                                                                       | Typeable                           |
| Sizing modes                | px / Hug / Fill only                                                           | Also "Calculate"                   |

The Verynize equivalent of each is captured above.
