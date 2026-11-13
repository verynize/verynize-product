# React islands — working contract

The renderer is migrating from vanilla DOM (`web/*.js`, `web/*.css`) to React 19 + Tailwind CSS v4 + shadcn/ui (Radix) + `cn()`.
Each UI area is an **island**: `web/src/islands/<area>.tsx` (entry) + `web/src/islands/<area>/**` (code), bundled together by `web/src/ui.tsx`
into `web/dist/ui.{js,css}` (classic IIFE, one React copy) and loaded by `web/index.html` after all legacy scripts.
The web app (`web-start/`) does not load `ui.js`: `web/src/web-app.tsx` imports the same islands and is bundled into
Start's client build, so Start's routes and the islands share one React and one QueryClient; styles still come from
`web/dist/ui.css` (see "Web vs desktop ownership" below).

Visual target: the Wonder app, captured in `design/wonder/*.png` (2880×1740 = 1440×870 CSS px at 2×; crop and
measure with Python/PIL — divide pixel coordinates by 2). `design-qa.md` lists measured values from an earlier pass.

## Areas and ownership (edit only your own files)

| Area       | Entry            | Owns (visual + behaviour)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Main references                              |
| ---------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| chrome     | `chrome.tsx`     | window chrome/tab bar (`header.app-chrome`), main grid + panel collapse state (`left-collapsed`, `right-collapsed` body classes), canvas overlays in `#workspace` (bottom toolbar, page pill when sidebar hidden, `?` help, zoom readout + zoom menu, view/layout menu), main app menu (undo/redo/file/insert/page/settings commands)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | 03, 11, 19, 20, 22, extra/15                 |
| sidebar    | `sidebar.tsx`    | contents of `aside#layer-panel`: file header (logo/app-menu trigger is rendered by sidebar but must call the chrome menu — see "Cross-island"), Pages list, Layers tree (rows, lock/hide toggles, expand carets, rename, search)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | 11, 12, 84–88, extra/86                      |
| inspector  | `inspector.tsx`  | contents of `aside#properties`: header (panel toggle, presence avatar, Share), Variables (list, search, create menu), Properties/inspector sections (Position, Layout, Appearance, Typography, Fill, Border, Shadow, Mask, Export, layer actions), color picker, font family/weight pickers, shader settings                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | 22, 23, 25–27, 41–43, 45–46, 55–56           |
| home       | `home.tsx`       | `#file-home`: workspace switcher (07), filters, grid/list, file cards + actions (rename 18, duplicate, move, archive/restore), new file/folder                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | 03–07, 17, 18, extra/87                      |
| chat       | `chat.tsx`       | `#agent-chat-dock` and the Code workspace center column (`#code-chat-host`): transcript, composer, model picker (30), access (31), attach menu (32), repository switcher (33), quick chats (34–35), running state (36–37, 51)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | 29–37, 51, 80–83                             |
| settings   | `settings.tsx`   | `#settings-screen` (all pages) and the remaining dialogs: share/cloud (13), export flow (45–50 save/success), generate illustration, and these shadcn Dialogs (content ids exist only while open): text prompt (`#text-prompt`, `window.askText`, `settings/text-prompt.tsx`), preview / Import HTML (`#modal`, `settings/preview-import.tsx`, event `bd:open-modal` `{detail: {mode}}`), Import from Figma (`#figma-dialog`, `settings/figma-dialog.tsx`, `bd:open-figma`), Templates (`#templates-dialog`, `settings/templates-dialog.tsx`, `bd:open-templates`; data and packs stay in `window.designTemplates`) and Saved views (`#views-dialog`, `settings/views-dialog.tsx`, `bd:open-views`; `window.savedViews`)                                                                                                                                                            | 13, 45–50, 61–79                             |
| code       | `code.tsx`       | `#code-workspace` (body class `code-mode`): repositories/chats sidebar, breadcrumb in the title bar slot `#bd-code-titlebar`, toolbar (Start preview, panel toggle), file tree + editor, terminal panel (`code/terminal-panel.tsx`, terminal workstream), hosting the chat island's `.project-agent` section in the center column                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | code mode, 80, 81, 33–35, extra/38           |
| onboarding | `onboarding.tsx` | `#onboarding`: desktop first-run setup (not a tutorial): Verynize account (sign in / create / forgot password / skip), then "Bring your own agent" (Claude/Codex connection status and sign-in, Cursor coming soon). Shown once per profile (`localStorage` `verynize.onboarding`), reopened by `bd:open-onboarding`, skipped when `window.desktop.onboardingState()` reports `skip` (`VERYNIZE_SKIP_ONBOARDING=1`, set by every Electron test). Web: "Set up your AI" (`ai-step.tsx`: OpenRouter connect/paste with status, Claude Code/Codex desktop-only, Skip for now, then a summary) after the first web sign-in, once per account (`/api/me` `aiSetupAt`), reopened by Settings › Agents › AI setup. Also owns the web app's sign-in screen (`web-sign-in.tsx`, `#web-sign-in`), which Start's editor layout renders before the editor boots (cloud/README.md "Web sign-in") | onboarding reference (agents step)           |
| storage    | `storage.tsx`    | document size against the shared-file limits (`web/storage-limits.js`, `window.storageLimits`) and room asset uploads (`window.cloudAssets`, event `cloud-assets-changed`): the size meter portaled into the Share panel after `#cloud-status` (`#storage-meter[data-level]`, `[data-storage-total]`, `[data-storage-problem]`, `[data-storage-uploading]`, `#storage-limit-error`), threshold toasts, and the blocking `#storage-limit-dialog` for the `storage-limit-error` event                                                                                                                                                                                                                                                                                                                                                                                                 | size limits in cloud/README.md "Room assets" |
| collab     | `collab.tsx`     | collaboration in shared rooms (design/wonder/share-audit/CONTRACT.md §3 "C"): presence avatars + the Multiplayer tools popover portaled into the inspector header's `#presence-slot` (`#presence-tools`, `#presence-popover`, `#presence-search`, `[data-person]`, `[data-self]`, `#presence-hide-cursors`, `#presence-busy`, `#presence-invisible`), remote cursors/selections drawn imperatively by `collab/presence-engine.ts` (`window.cloudPresence`, `#cloud-cursors .collaborator-cursor/.collaborator-selection`), the viewer "View only" pill (`#view-only-pill`) and inert inspector body for `body.cloud-read-only`, the `cloud-access-revoked` notice, and file links (`window.cloudLinks`, `#room-no-access`, `#room-invitation`)                                                                                                                                      | share-audit/wonder SC1, wonder-web/collab    |
| history    | `history.tsx`    | per-artboard version history panel (`history/version-panel.tsx`, `#version-history`) over `window.versionHistory` (`web/version-history.js`): list, Preview, Restore, Restore as copy, Save version; opened by `bd:open-version-history` `{detail: {artboardId}}` (the context menu's Version history item)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | docs/version-history.md                      |
| share      | `share.tsx`      | the Share popover (`share/share-popover.tsx`, rendered with the inspector's `#cloud-toggle` Share button): email chips, role menu, workspace note, File visibility with its confirmation dialog (`#share-visibility-dialog`, also opened by the File menu's `#file-make-public` / `#file-make-private`), Copy link, the sign-in step for local files; the sidebar file-header visibility button (`#file-visibility[data-visibility]`). Service: `web/cloud-share.js` (`window.cloudWorkspace.ensureRoom/access/setVisibility/invite/shareLink/state`, event `verynize:cloud-state`)                                                                                                                                                                                                                                                                                                 | design/wonder/share-audit (CONTRACT.md)      |

Shared files are owned by the integrator — **do not edit**: `web/src/lib/*`, `web/src/components/ui/*` (existing files),
`web/src/styles/globals.css` (except your own `<area>-tokens` block at the bottom), `web/index.html`, `vite*.config.ts`,
`package.json`, legacy `web/*.js|css` except where your brief explicitly allows, other islands' folders.
You may add **new** shadcn components with `npx shadcn@latest add <name> --yes` (never `--overwrite`); after adding, fix
the import to `@/lib/utils`, pass `container={portalContainer()}` to every Portal, and apply the density used in
`button.tsx`/`dropdown-menu.tsx` (12px text, 24–28px controls). Need a different look for an existing shadcn component?
Build a local component in your island folder (wrapping Radix primitives from `radix-ui`) instead of editing the shared one.

## How islands talk to the legacy app (`web/src/lib/bridge.ts`)

- `useDesign()`, `useSelection()`, `activePage(doc)` — React views of `window.design` (re-render after every legacy `render()`).
- `window.design.updateNodes(ids, patch)` — validated, undoable node edits (one undo step). `setActivePage(id)`,
  `setSelection(ids)`, `canUndo()/canRedo()`, camera/tool/command APIs are on `window.design` too.
- Legacy controls keep their handlers. To replace one with an island control **that tests can click by id**:
  `takeOver("rectangle")` renames the legacy element to `legacy-rectangle` and parks it in a hidden dock; render your
  own element with `id="rectangle"` and call `legacyClick("rectangle")` (or `legacySet(el, value)` for inputs).
- `hideLegacy(el)` hides legacy/parity DOM you replace without deleting it (other code may still reference it).
- `useBodyClass("left-collapsed")`, `useWindowEvent(...)`, `portalContainer()`.
- Other globals: `window.agentWorkspace`, `window.fileLibrary`, `window.appSettings`, `window.appPreferences`, `window.askText`.

The earlier vanilla parity layer (`wonder-parity.js|css`) has been removed; islands are the only shell UI.

## Desktop vs web runtime (`web/src/lib/platform.ts`)

One place answers "what can this runtime do": `web/platform.js`, a classic script that `web/index.html` loads before
every other script, registers a frozen `window.verynizePlatform`; `platform.ts` types it and re-exports it.

- `platform.kind` is `"desktop"` when the Electron preload exposed `window.desktop`, else `"web"`.
- `platform.desktop` is the bridge typed as `DesktopApi` (`web/src/lib/desktop-api.ts`), or `null` on the web. Never
  read `window.desktop` or cast `window` to reach it; import `platform` (or `can`) from `@/lib/platform`.
- `can(capability)` / `platform.capabilities` (`projects`, `git`, `designFiles`, `agents`, `agentAccounts`, `terminal`,
  `devServer`, `livePreview`, `rasterExport`, `codeExport`, `imageGeneration`, `figma`, `htmlImport`, `templatePacks`,
  `webCapture`, `publishApps`, `passkeyWindow`, `localFonts`, `notifications`, `externalLinks`, `agentBridge`,
  `onboarding`, `cloudDefaults`): true when every preload method the feature needs is present. Gate desktop-only UI on a capability,
  then call `platform.desktop.x()`.
- Legacy scripts use the same object: `window.verynizePlatform.can('figma')`; they may keep calling
  `window.desktop.x()` behind that check.
- New preload method: add it to `DesktopApi` and `DESKTOP_API_SHAPE` (tsc checks the two agree) — `tests/platform-contract.cjs`
  fails until the typed contract matches `desktop/preload.cjs`. New capability: add it to `CAPABILITY_METHODS` in
  `web/platform.js` and `CAPABILITIES` in `platform.ts` (the same test compares them).
- `tests/web-platform.cjs` loads the app in plain Chromium (no preload) and checks the web behaviour.
- Chat turns are not a desktop capability: they go through the `AgentService` on `platform.agents` (`service()`,
  `ready()`, `subscribe`, `changed()`, `provide`), registered by `installAgentTransport()` (`web/src/lib/agent-transport.ts`):
  Claude/Codex over IPC on the desktop, the cloud backend's model API (`/api/ai/*`, agent `openrouter`) on the web.
  Never call `runAgent`/`cancelAgent`/`respondAgentPermission`/`onAgentEvent`/`listAgentModels`/`discoverAgents` on
  `platform.desktop` from chat code; `useAgentTransport()` tells the UI whether a turn can start and why not.
  Details: `docs/ai-runtime.md` "Clients".

## Cross-island contracts

- **Files home and the canvas**: while `body.files-view` is set, `web/app.js` keeps the document, layers list,
  inspector and `window.design` subscribers current but does not draw `#canvas`; it draws it when the class goes.
  `web/cloud-panel.js` connects the open file's room only once the Files home is left (or at launch on any other
  view). The file library never turns the shown document into a file on its own: only an edit
  (`window.design.editCount()`), an explicit create/open, or a signed-out profile's one-time starter file does.
- **Layout state** lives in `body` classes: `left-collapsed`, `right-collapsed` (any island may toggle them; the chrome
  island owns the grid CSS that reacts to them), plus legacy `agent-chat-open`, `files-view`, `settings-open`.
- **Panel widths** are drag-resizable (chrome `chrome/panel-resize.tsx`): read the live `--panel-left-width`,
  `--panel-right-width` (track width incl. the 1px edge) and `--chat-dock-width` (utility `pl-chat-dock` / spacing
  `chat-dock`) instead of hard-coding 280/281/499px. Edge strips are `[data-panel-resize=left|right|chat]`
  (`role=separator`); saved widths are in `localStorage` `verynize.panelWidths`; `html[data-panel-reflow]` is set while
  a width changes so the canvas pans with its moving left edge.
- **Main menu**: the chrome island owns the app menu. Anyone opens it with
  `window.dispatchEvent(new CustomEvent("bd:open-app-menu", { detail: { anchor: buttonElement } }))`. Every visible
  trigger button must have class `app-menu-trigger` (tests click `.app-menu-trigger:visible` then a command id such as
  `#rectangle`, `#undo`, `#save-project`, `#shell-settings`, `#rename-page`, `#import-tokens`, `#icon-kind`).
  Commands must stay reachable by those ids inside the opened menu.
- **Shell routes** (`web/src/lib/router/shell-router.ts`, docs/spikes/tanstack-router.md): the URL owns the top-level
  view — `/` (`files-view`), `/editor/<fileId>` (`/editor` redirects to the active file), `/code` (`code-mode`), `/settings/<section>` (`settings-open`). Never toggle
  those three body classes yourself (on the web only the route areas above set them): navigate with `navigate()` or call the legacy request APIs
  (`fileLibrary.showHome/showEditor`, `appSettings.open/close/select`, `agentWorkspace.setCodeMode`), which update the
  URL and apply the view synchronously. The `apply*` functions on those objects are for the router only. One router
  owns navigation per page: standalone (desktop, `file://`) the shell router creates its own history and routes; in
  the web app it runs hosted on TanStack Start's router (`window.verynizeShellHost`, `web-start/README.md` "One
  router"), `window.shellRouter` is Start's router and Start's routes apply the area via
  `window.shellNavigation.applyLocation(area, location)`. Never create another router or browser history in an island.
- **Web vs desktop ownership** (`web-start/README.md` "Areas"): on desktop every area is rendered by its island. On the
  web, Start's routes render three areas from their island folders, each through a `route-area.tsx` that portals into
  the same host with the same ids, marks it `data-route-owner="start"`, and owns the shown state while mounted:
  settings (`settings/route-area.tsx`, `/settings/$section`; the section is the route param), Files home
  (`home/route-area.tsx`, `/`) and the Code workspace (`code/route-area.tsx`, `/code`). The settings route also renders
  the home or code area when settings is open over it. On the web the matching island parts are not rendered
  (`hosted` from `@/lib/router/host`): the settings island skips `SettingsScreen`, the code island skips
  `CodeWorkspace`, the home island only prepares `#bd-home-root` (its takeovers are all deferred there). Anything that
  must outlive a route (dialogs, toasts, controllers, `window.*` APIs, the design chat sidebar) stays in the island.
  Area components take a prop that says they are route-rendered (`section`, `routed`) instead of reading the body
  class, and must survive remounts (keep view state in a module store or localStorage, not only `useState`).
  Legacy modules learn the route's state through `appSettings.syncSection`, `fileLibrary.syncHome` and
  `agentWorkspace.syncCodeMode`; their `apply*` functions are desktop-only.
- **Code mode**: `body.code-mode` (toggle with `window.agentWorkspace.setCodeMode(on)`, which navigates to `/code` or `/editor`; `openProject()` enters it, `#project-toggle`
  toggles it). Tests use `#code-add-repository` then `#project-open` / `#project-new` / `#project-clone`, `#code-new-chat`,
  `#code-new-quick-chat`, `[data-repository=<name>]`, `[data-chat-id=<id>]`, `#code-file-tree[data-root=<path>]
  [data-path=<file>]`, `#code-file-filter`, `#code-editor`, `#code-editor-save`, `#code-start-preview`, `#code-panel-toggle`,
  and `window.agentWorkspace.getState()` (`chatRoot`, `activeRoot`, `branch`). `#project-name` and `#project-status` stay
  as hidden text hooks. `window.codeWorkspace` exposes repository/chat actions to other islands.
- **Cloud account and workspaces** (`web/src/lib/cloud-account.ts`): `window.cloudAccount` (from `web/cloud-panel.js`) is the one
  email + password session. Islands use `useCloudAccount()`, `useOrganizations()` (one shared list; `await organizationsChanged()`
  before switching to a workspace that was just created or joined), `useActiveOrganization()`, `authRequest()` (Better Auth under
  `/api/auth`) and `openSignIn()`. Events: `cloud-account-changed`, `cloud-organization-changed`, `bd:open-onboarding`. Test ids:
  `#workspace-profile`, `#workspace-create`, `#workspace-members`, `#workspace-sign-in`, `#members-page[data-organization]`,
  `[data-org-member=<email>]`, `[data-org-member-role=<email>]`, `#members-invite*`, `#members-room-role`, `#members-leave`,
  `[data-accept-invitation]`, `#onboarding[data-step]`, `#onboarding-*`, `[data-agent=<id>] [data-status]`. The legacy Share
  dialog already uses `data-member` / `data-remove-member`, so organization rows must not.
  `window.cloudAccount.fetch(path, init)` is the authenticated raw-Response variant of `request` (streamed bodies).
  `cloud-room-changed` fires when the editor joins or leaves a cloud room (`window.cloudWorkspace.room()`).
- **Share**: Share opens the Share popover (share island), not the legacy "Shared design" dialog (`#cloud-dialog`), which
  stays reachable from Settings › Share a design (`#settings-sharing`, `window.cloudWorkspace.openDialog()`; tests use
  `tests/helpers/shared-design.cjs`). Open the popover from anywhere with `window.dispatchEvent(new Event("bd:open-share"))`
  (`openSharePopover()` in `share/api.ts`); request a visibility change (confirmed first) with `bd:share-visibility`
  `{detail: {visibility}}`. Room state for any island: `useCloudState()` (`share/api.ts`) over `verynize:cloud-state`
  (`{connected, roomId, role, visibility, peers}`). Collaborator avatars render into `#presence-slot`, left of Share.
- **Web chat gate**: on the web the chat island replaces the composer with `#chat-web-gate[data-state=signed-out|
  not-configured|needs-credentials|no-room|loading|error]` (`#chat-web-sign-in`, `#chat-web-share`,
  `#chat-web-connect-openrouter`, `#chat-web-paste-key` → `#chat-web-openrouter-key` + `#chat-web-save-key`) until the
  model API can run a turn. The user's own OpenRouter credential is `web/src/lib/ai-credentials.ts` (connect, paste,
  disconnect; the key never comes back to the browser); Settings › Agents shows it on the web (`#settings-openrouter-card[data-status]`).
- **UI ready** (`web/src/lib/bridge.ts` + `mount.tsx`): `<html data-ui-ready="true">` is set and `bd:ui-ready` fires on
  `window`, once per page load, when every island started with `mountIsland()` has committed its first render AND no
  `takeOver()` id is still pending (until claimed, an id such as `#files-home` or `#add-page` resolves to the hidden
  legacy element parked in `#bd-legacy-dock`). It means "the shell's taken-over controls are claimed", not "every lazy
  panel exists": content an island renders on demand (menus, dialogs, settings pages, onboarding steps) is not covered.
  An id that the island only renders on demand must be taken over with `takeOver(id, { deferred: true })` (e.g. home's
  `#folder-breadcrumb`); never take over an id the island never renders — it would hold the signal back forever.
  The signal has no timeout fallback: after 5 s without it, a `[bd] UI not ready` console warning names what is stuck,
  and `window.__bdPendingTakeovers()` returns `{ islands, ids, deferred }` (uncommitted islands, blocking pending ids,
  deferred pending ids). It also works for an island built alone (`node scripts/build-ui.cjs <area>`): then only that
  island is counted. Electron tests call `waitForUiReady(page)` from `tests/helpers/ui-ready.cjs` after launch and after
  every reload, before clicking shell controls (`tests/ui-ready.cjs` is the regression test).
- **Chat composer toolbar** matches Wonder exactly: `+` (attach menu), model picker, access level, then the right-side
  indicators (works with, autonomy, tools, usage ring) and Send. Don't add chips to it. The design style picker
  (`chat/style-picker.tsx`, menu `#chat-style-menu`, `window.chatDesignStyle`) has no chip; only the `/style` slash
  command opens it (event `bd:open-style-picker`), anchored above the composer.
- **Zoom menu**: tests click `#zoom-menu-button` then `#zoom-in`, `#zoom-out`, `#zoom-fit`, `#zoom-reset`, `#snap`,
  `#saved-views-open` (chrome island). `#zoom-reset` text must keep the zoom percentage (tests parse it).
- **Inspector**: tests use `[name=w]`, `[name=rotation]`, `[name=opacity]`, `[name=mask-0-css]`, `[name=layout]`,
  `[name=wMode]`, `[name=shaderPreset]`, `[name=shaderSpeed]`, `[name=shaderIntensity]`, `[data-shader-mode]` (Fill header Shader mode toggle), `#shader-fill-preset`, `[name=animated]` (only while an older layer has one),
  `[name=color]`, `.insp-display [data-layout=flex]`, `#mask-section .insp-add`, `#shader-settings summary`,
  `#choose-shader`, `#type-settings-toggle` / `#type-settings`, `#precision-right`, `#color-value`, `#color-dialog` … — grep `tests/` for the full list.
  Field names must be unique in the document (Playwright strict mode), so the legacy `#inspector` form may not keep
  same-named inputs in the DOM at the same time.
- **Plain CSS**: if you must restyle legacy DOM you cannot render yourself (e.g. the `main` grid, `#canvas-wrap`
  overlays, legacy `<dialog>`s), put plain CSS that uses `var(--token)` in `web/src/islands/<area>/<area>.css` and
  import it from your entry. Never restyle another area's DOM.

## Icons

- Use `lucide-react` or the shared glyphs in `web/src/components/icons.tsx` (logo, `PanelLeftIcon`/`PanelRightIcon`,
  layout icons, `ShaderIcon`, stack icons). Never define icon SVGs inside an island; add missing glyphs to that file.
- Stroke: every outline icon renders a 1px non-scaling stroke (enforced in `globals.css`); don't pass `strokeWidth`,
  `absoluteStrokeWidth` or `size={…}` props. Use `data-icon-weight="bold"` only for tiny check/close marks in 16px controls.
- Size by role, with Tailwind size classes: `size-3` disclosure chevrons · `size-3.5` icons in menus, chips, field
  prefixes and inline status · `size-4` icon buttons (title bar, panel headers, section tools, row icons, hover
  actions) · `size-5` floating canvas toolbar. Same concept → same glyph everywhere (e.g. shader = `ShaderIcon` in the
  toolbar, layer rows and menus; panel toggles = `PanelLeftIcon`/`PanelRightIcon`).

## Rules

- Tailwind utilities only, on tokens from `globals.css` (`bg-background`, `bg-input`, `text-muted-foreground`,
  `border-edge`, `text-xs` = 12px, `text-sm` = 13px, `h-6` = 24px fields…). `npm run lint:ui` (= `vp lint web/src`, with
  `@shadcn/lint`) must report **0 errors** for your files; fix warnings where reasonable. `npm run typecheck:ui` must pass.
- Use shadcn/Radix primitives for menus, popovers, dialogs, selects, tooltips, toggle groups → keyboard navigation,
  Escape, focus return and ARIA come for free. Icons: `lucide-react` (`strokeWidth={1.5}`, 14–20px as measured).
- Keep the canvas imperative: never render canvas layers in React, never subscribe React to pointer-move.
- Keep test contracts: existing tests in `tests/*.cjs|mjs` click ids/selectors and `[name=…]` fields. Grep the tests
  for every selector in your area. Preserve them on visible island elements (via `takeOver`) or update the test to the
  new interaction **only** when the old element genuinely no longer exists, keeping the assertion's intent.
- Accessibility: every icon-only button needs `aria-label`; menus/popovers via Radix; visible focus rings.
- Light theme: tokens already switch on `html[data-ui-theme=light]`; don't hard-code dark values.

## Build & check

```sh
npm run build:ui                      # combined bundle → web/dist/ui.{js,css} (what the app loads)
node scripts/build-ui.cjs <area>      # one island alone → web/dist/<area>.{js,css}, for isolated development
npm run lint:ui && npm run typecheck:ui
node tests/<relevant>.cjs              # Playwright + Electron; each run uses its own temp profile
node /tmp/bd-shots/shoot.cjs <names>   # 2× screenshots → /tmp/bd-shots/<name>.png (see that script for names)
```

Several workstreams build and test concurrently. Only build your own island. If a test fails in an area you don't
own, note it and move on — don't fix other areas. Keep your code compiling at every step.
