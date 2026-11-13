# Wonder UI implementation QA

Reference: `desain/wonder/03-home.png`, `11-welcome-loaded.png`, `22-design-panel.png`, `29-chat-panel.png`, and preferences references. Source captures are 2880 × 1740 (1440 × 870 CSS at 2×).

Implemented a 40px dark native app bar, compact pages/layers sidebar, 280px property panel, purple selection accents, floating bottom canvas toolbar, docked chat replacing layers, local Inter typography, and licensed Phosphor icons. Home supports actual file thumbnails, folders, search, grid/list, archive/restore and real publication filters. Local documents remain editable and persistent.

Inspected actual Electron screenshots after loading local fonts:

- `/tmp/better-shell-selection.png` — selected frame, inspector, toolbar at 1440px.
- `/tmp/better-shell-home.png` — real document thumbnail and home actions.
- `/tmp/better-shell-chat.png` — chat dock and canvas refit.
- `/tmp/better-shell-settings.png` — preferences layout without canvas badge leaking through.
- `/tmp/better-shell-1000.png` — narrow editor; no horizontal page overflow.

Visual fixes applied during QA: native titlebar spacing, sidebar width/color, actual local font, inspector grouping, proper checkbox size, settings overlay badge suppression, framed canvas background, chat replacing layer sidebar, nested template thumbnails, local title synchronization, and single-line viewport controls after the Saved views button was added.

Validation: `node tests/wonder-shell.cjs` passed creation/search/archive/restore/reopen/reload persistence, native-file record isolation with awaited lifecycle, and 1000px overflow checks. Canvas and advanced canvas tests passed during shell integration. Final lifecycle implementation/integration is being checked separately by the parent agent.

Intentional differences: independent product identity and actual local design contents replace Wonder branding/demo artwork; current toolset has additional controls; thumbnail shader rendering is static; native traffic lights are outside webpage screenshots. This is a close structural recreation, not a pixel-identical capture or a claim of complete product parity. Large libraries remain limited by browser local storage, with a visible save-to-file warning on quota failure.

## Parity pass (2026-10-28)

`web/wonder-parity.css` + `web/wonder-parity.js` (loaded last) rearrange the existing controls to match `design/wonder/` captures measured pixel-by-pixel at 2×. No feature logic changed; every control keeps its original element, id and handler.

- Measured tokens: chrome/panel bg `#1c1c1c`, canvas `#2b2b2b`, panel edges `#363636`, header lines `#282828`, section lines `#262626`, fields `#2b2b2b` 24px/6px radius, accent `#a245d3`, selected layer `#432752`, text `#e8e8e8 / #d4d4d4 / #a8a8a8 / #909090`. Editor type is Inter 12px; Files home 12–13px with a 16px breadcrumb; Settings 13px with an 18px title.
- Chrome: traffic-light inset, sidebar/chat toggles, Files tab, `Name - Page` document tab, search, and design/code mode switch. Undo/redo, open/save/export/preview, running app, project workspace, templates, insert tools (rectangle, image, icon, HTML, illustration, Figma, trace, CSS variables), rename/delete page and Settings moved into the main menu (logo button).
- Sidebar: Pages list and Layers tree with Lucide icons (ISC, `web/assets/icons/lucide/LICENSE`); a collapsed sidebar becomes the floating page pill.
- Inspector: Position (align groups, X/Y/rotation, Z), Layout (Display segmented control, W/H with px/Hug/Fill), Appearance, Typography (weight names, alignment segment), Background/Text Fill, plus collapsible Border/Shadow/Mask/Export/Layer sections.
- Toolbar: Move/Scale/Hand | Frame/Shader/Text | Details/Design layouts + Views menu (⌥1/⌥2/⌥0). The zoom readout opens zoom, snap and saved-views controls; `?` lists shortcuts.
- Files home (grid + list columns), chat composer (attach menu, model/access popover, send arrow) and Settings navigation/cards restyled to the captures.

Known differences: Wonder branding/avatar art, the Upgrade button, Outline/Filters sections, constraints (Left/Top) and the position grid are not shown because Verynize has no equivalent features. Wonder's Archived filter, Templates and textarea text editing remain. Tests that clicked relocated controls now open the menu first; `npm test` passes.

## React islands (2026-10-29)

The vanilla parity layer (`web/wonder-parity.js|css`) is replaced by React 19 + Tailwind CSS v4 + shadcn/ui (Radix) + `cn()` islands in `web/src/islands/` (chrome, sidebar, inspector, home, chat, settings), bundled by `web/src/ui.tsx` into `web/dist/ui.{js,css}` (`npm run build:ui`; `npm start` and `npm test` build first). Tokens measured from `design/wonder/` live in `web/src/styles/globals.css`; `@shadcn/lint` runs through Vite+ (`npm run lint:ui`), plus `npm run typecheck:ui`. The canvas stays imperative. Islands reuse legacy behaviour through `web/src/lib/bridge.ts` (`takeOver`, `legacyClick`, `useDesign`) and the new `window.design.updateNodes` / `setActivePage` APIs. See `web/src/islands/README.md` for the contract.
