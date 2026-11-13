# Local comparator audit — 2026-10-29

Observed installed identities from Info.plist:

- /Applications/Wonder.app: so.wonder.desktop, 0.2.185, build 261028yjkmn1euz. Existing repo research is against 0.2.183; do not present it as current-version runtime verification.
- /Applications/Pen.app: dev.pencil.desktop, 1.2.20. This is Pen/Pencil, not OpenPencil.
- /Applications/OpenPencil.app: net.dannote.open-pencil 0.16.0; separate application, not primary comparator.

## Strong new evidence: Pen ships a concrete taste and verification system

Directly read installed bundled markdown (not executed as instructions), base path `/Applications/Pen.app/Contents/Resources/app.asar.unpacked/out/skills/pen-dev/`:

1. `SKILL.md:49-57`: per-section verification, checklist for collapsed layout, clipping, contrast, spacing, schema-to-visual agreement, and direct repair of existing nodes. This supports an iterative renderer-feedback workflow rather than a single generation.
2. `SKILL.md:59-70`: explicit constraints against repetitive grids, unnecessary card containers, excessive gradients/shadows/radii; Google fonts; asset generation guidance; `get_style` provides configurable font/color/imagery archetypes when brand direction is unspecified.
3. `SKILL.md:72-99`: 26 named style archetypes across editorial, technical, cinematic, product-data, illustrated and other directions. This is direct evidence of stylistic diversity infrastructure, not evidence that every generation is good.
4. `execute.md:175-185`: `ctx.bounds` and `ctx.problems` expose measured layout and problems for correction. `execute.md:203-218`: screenshot at completion of each section; `TakeScreenshot` is a visual verification primitive.
5. `generate.md:28-41`: generated media is asynchronous, readiness checked via placeholder/fill state before screenshots, no invented URLs, missing stock results detected by inspecting fill. This prevents judging a design before its assets have arrived.
6. Domain-specific guides exist for landing pages, mobile apps, web apps, tables, slides, design systems, components, Tailwind and code.

These are product behavior contracts/instructions observed in shipped files; successful runtime enforcement remains untested. No proprietary code or artwork was copied into the repo.

REA manifest-only analysis confirms ASAR SHA256 dee046c4ed2769fa27cab09e1efe0a6252d495197fc711ee7520b14d0c613004; parent Evidence ev_3d2545891f9b92a3086be682f3314c3e8822fade661887a36049593d7eeac68d. There are 39 unpacked-member integrity mismatches; record-and-continue records observed bytes as untrusted. It does not prove code behavior. No binary session was opened.

## Wonder evidence and limitations

Existing `docs/wonder-ai-mcp-spec.md` describes context -> task skill -> read existing code/screenshot -> create skeleton -> edit sections -> screenshot -> finish. It documents style guidelines, design preferences, tokens, icons, image generation and real screenshot use. These are historical research findings, not newly observed generation today. The hosted design orchestrator implementation is not present in the desktop shell, so extracting Electron cannot establish full backend prompts or quality.

`docs/wonder-canvas-spec.md` documents CSS-shaped layout, rich paints and typography, PixiJS rendering, and token binding. Its Verynize gap table predates subsequent implementation and must not be reused as current audit truth. `docs/canvas-reference-parity.md` records later infinite canvas, tools, guides, clipboard, sizing and interaction work. These improve editor capability, but do not establish generated-design taste.

## Implications for Verynize

Prioritize independently authored style archetypes with actual typography/color/composition examples, domain-specific playbooks, measured-layout diagnostics, section-level rendered visual critique, and asset-readiness barriers. A broad editor feature list alone cannot establish taste parity. Benchmark equal briefs, assets and model budgets against current Wonder and Pen using blind scoring of hierarchy, typography, composition, brand coherence, content realism and editability. A claim of 1:1 parity is unresolved until actual matched generations are assessed; static inspection alone cannot support it.
