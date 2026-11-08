# Properties panel parity audit: capture checklist

Shared checklist for two capture passes: Wonder (live app, `wonder/`) and Verynize (Electron, `verynize/`).
Name each screenshot `<id>-<state>.png` using the ids below, so the two sides pair up by filename.
Capture at 2x and crop to the right inspector panel (full panel width). In `notes.md`, give each id the
measured values (heights, paddings, colours, icon glyphs, which header buttons appear) and the observed behaviour.

## A. Section header states (active = section has a value, inactive = empty)

For each one: the header with no value, the header right after "+", a filled row, hover on the row, and after "−".
Record which header icons appear in each state (e.g. Border inactive: `+` only; active: sliders, sides, `+`).

- A1 Background Fill (empty / one solid paint / gradient / variable-bound / multiple paints / hidden paint)
- A2 Border (empty / added / individual sides / variable-bound colour / settings popover from the sliders icon)
- A3 Outline
- A4 Shadow (empty / one / multiple / bound)
- A5 Filters
- A6 Mask
- A7 Export
- A8 Layer
- A9 Selection colors (when shown, which layers)
- A10 Typography (text layer)
- A11 Appearance header icons (eye, drop) and what each toggles

## B. Open questions (behavioural evidence)

- B1 Flex row gap / cross-axis gap without wrap: enabled or disabled? Can you type into it? Does it change the canvas?
- B2 W/H sizing label and menu: label text for fixed, hug and fill; the full menu items (Fixed / Hug / Calculate / Add min/max…); what each one does.
- B3 A fill bound to a variable at 100%: is there an opacity field? How do you make it translucent? Same at 50%.
- B4 Constraint diagram (Left/Top + diagram) for a top-level frame vs a nested child: enabled or dimmed?
- B5 A variable chip inside a numeric field: x offset of the chip relative to the prefix icon, vs the x offset of a plain value.

## C. Layout / position

- C1 Position block (X/Y/rotation, constraints, Z) for a top-level frame and for a child
- C2 Display segmented: none / flex / block / grid, active and inactive glyphs
- C3 Flex: direction, align grid, distribution row, wrap/reverse icons, gap fields
- C4 Grid: track preview, gaps, Align grid
- C5 Grid child: span fields
- C6 Padding collapsed / expanded (4 sides), toggle button active and inactive
- C7 Margin: unit menu values (px / Auto / …), "Auto" display
- C8 Page section (no selection)
