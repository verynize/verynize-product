# Renderer router spike

This spike adds `@tanstack/react-router` 1.170.46, using code-based routes and a
null-rendering React island. The URL is the single source of truth for the
top-level shell (see "Shell state model" below): `/` is the Files home,
`/editor` the editor, `/code` the Code workspace and `/settings/<section>` the
settings overlay over one of them. The canvas, document, other islands and the
settings and code-mode UI remain legacy-owned; only the choice of view moved.

In the web app (TanStack Start, `web-start/`) the same module runs hosted: it
uses Start's router and history instead of creating its own, and Start's route
components apply the area (`web-start/README.md`, "One router"). Everything
below holds in both modes; "the router" is Start's router there.

Opening another file while already in the editor does not create another route
entry. History is view history, not file history: Back returns to the previous
view, not the previous document. `window.shellRouter` exposes the imperative
router for integrations and tests.

HTTP(S) and the proposed `app://verynize` origin use browser history.
`/index.html` is replaced with `/` before router construction, preserving search
and fragment. Only top-level route paths are supported; relative assets still
resolve beside index.html. Extensionless deep links require the supplied SPA
fallback contract. Neither Electron nor the Cloudflare serving configuration is
changed here.

`file://` uses memory history initialized from the legacy startup view (currently
editor). This preserves existing desktop/test startup behavior, avoids invalid
file path pushState operations and leaves the fragment exclusively available to
`#room=...&token=...` / `#public=...`. Navigation in this mode does not change the
address bar, survive reload, or use native browser Back/Forward; the router's
history back/forward methods work. Every navigation on browser history keeps the
current cloud fragment by construction (see "Cloud fragments" below); legacy
navigation also carries search forward. Router scroll restoration and fragment
scrolling are disabled.

The router never loads a document or connects a room. Existing cloud code still
reads invite/public fragments and owns their network/dialog behavior. Unknown
paths render no router content and leave the shell as-is; a full 404 experience,
trailing-slash deep links and per-document URLs are outside this spike.

## Cloud fragments: `#room=` / `#public=` stay in the hash

Rule: room invites keep the existing format, `<origin>/#room=<id>&token=<capability>`
(token omitted for account invites) and `<origin>/#public=<id>`. They never move
into the path or query string. The router preserves them by construction.

Why the hash, checked against the code:

- No server ever needs the fragment. `cloud/rooms.js` `access()` reads the
  capability from `Authorization: Bearer` (and from `?token=` only on
  `/api/rooms/<id>/socket`, because browsers cannot set WebSocket headers; that
  request URL is never a page URL). On the web the editor page is the client-only
  shell of the Start app (`web-start/README.md`; before that, a static asset served
  by the Worker's `single-page-application` fallback); it takes no room parameters. `web/cloud-panel.js` reads `location.hash` once at
  startup and joins through `request()` with the token in a header.
- A token in the page query would leak. The editor page has no
  `Referrer-Policy` (only Worker-rendered pages, apps and room assets send
  `no-referrer`), so the browser default `strict-origin-when-cross-origin` would
  send the full URL, query included, as `Referer` on every same-origin script,
  style, asset and `/api/*` request. The query is also in the request line itself,
  which reaches Worker logs (`observability` is enabled). Browsers never send the
  fragment. The plain-browser check below served 176 requests for a
  `/editor#room=…&token=…` session; none carried the token in its path, query or
  `Referer`.
- Links already sent stay valid. Links are built in `web/cloud-panel.js`
  (`updateInvite`, the role-link generator and publish use `url.hash`),
  `cloud/worker.js` (invite email: `${origin}/#room=<id>`) and `cloud/mcp.js`
  (`editorUrl`: `${origin}/#room=<id>`). All point at `/`, now the Files home
  route, and the startup invite dialog opens regardless of route.

Preservation by construction (`web/src/lib/router/shell-router.ts`): the browser
history object's `push`/`replace` are wrapped. A target without its own fragment
inherits the current `#room=`/`#public=` fragment. This covers
`shellRouter.navigate`, `navigate()`, links, `history.push` and legacy view
changes alike; nobody has to remember `hash: true`. If the fragment makes a push
equal to the current URL, the push becomes a replace, so there are no duplicate
entries. Every entry pushed in the session carries the fragment, so Back/Forward
and reload keep it. A target with an explicit fragment replaces it. App code
navigates with the exported `navigate()`; lint (`no-restricted-imports` in
`vite.config.ts`) rejects importing `shellRouter` anywhere except the router
island. Search params are not preserved by construction.

Leaving: `cloud-panel.js` never cleared the hash before. With preservation, a
left room's invite would be offered again on every reload. Now
`disconnect(…, leave=true)` calls `window.shellNavigation.clearRoomHash(roomId)`.
This replaces the current entry without the fragment (only if it names that room)
and remembers the room for the page session, so Back/Forward onto an older
entry of the same room drops the fragment again. `#public=` is never cleared. A
fresh page load of the invite link is a new invitation.

Desktop: `verynize://join?invite=<https invite>` (`desktop/app-preferences.cjs` →
`desktop:open-link` → `openDesignLink` in
`web/src/islands/settings/preference-runtime.ts`) closes settings, fills the
share dialog and joins. It never writes `location.hash`, so the `app://verynize`
URL stays on its route with no fragment, and the capability never enters the
renderer URL or session history. Desktop rooms persist through the file
library's cloud record. Under `file://` (memory history) the real address bar is
untouched, so the fragment is preserved trivially; `clearRoomHash` uses
`replaceState` there.

## Shell state model

```text
                 app code: navigate()             legacy entry points
                 Back/Forward, reload,            showHome/showEditor, appSettings.open/close/select,
                 typed URL                        agentWorkspace.setCodeMode, ⌘, ⌘K Escape, deep links
                        |                                   |
                        |                          window.shellRequest(target, apply)   (web/shell-request.js)
                        |                                   |
                        |                    router loaded? |-- no --> apply() now, queue target
                        |                                   |           (folded onto the startup URL
                        v                                   v            when the router loads)
               browser/memory history  <-- commit --  request(target)   (shell-router.ts)
                        |                                   |
                        v                                   | applies synchronously
               route component (/, /editor, /code,          |
               /settings/$section) applies its location     |
                        \                                  /
                         `--------> applyShell(view, settings) <---'
                                          |
          agentWorkspace.applyCodeMode · fileLibrary.applyHome/applyEditor · appSettings.applyOpen/applyClose
                                          |
                      body.code-mode · body.files-view · body.settings-open (+ #settings-screen)
```

| Route                 | `files-view`        | `code-mode`         | `settings-open` |
| --------------------- | ------------------- | ------------------- | --------------- |
| `/`                   | on                  | off                 | off             |
| `/editor`             | off                 | off                 | off             |
| `/code`               | off                 | on                  | off             |
| `/settings/<section>` | per `settingsUnder` | per `settingsUnder` | on              |

Code mode is its own route (`/code`), not `/editor?mode=code`: it is a full-window
view exclusive with the editor and the Files home (`code.css` hides `main` and
`#file-home`), and app navigation keeps the search string by default, so a
`mode` query would follow every later navigation. Choosing Files (or ⌘K) in code
mode therefore leaves code mode for the home; before, the home opened hidden
behind the code workspace. `setCodeMode(false)` outside code mode is still a
no-op. Code mode is no longer restored at launch: a plain desktop launch opens
the Files home (`/`), a cold-start design link opens `/editor`, and the URL
always wins (reload, Back/Forward, typed or shared URLs, the web).

Not routed (layout state inside a view): `code-sidebar-collapsed`,
`left-collapsed`/`right-collapsed`, `agent-chat-open`, `chat-sidebar-open`, the
preview tab view (`data-pt`) and onboarding.

Requests are synchronous: `request()` writes history (directly, not through
`router.navigate`, whose `latestLocation` lags a push made in the same tick, so
`showHome(); showEditor()` would drop the second change) and applies the shell
before returning, so callers reading body classes or `getState()` right after
still see the new view. The router renders the entry afterwards and its route
component re-applies it, which is a no-op. Route components skip a location that
is no longer the current history entry (a request already committed a newer one).
Repeated requests for the current shell never touch history.

Removed mirror machinery: the `bd:view-change` event (legacy no longer emits it,
the router no longer listens), `syncFromShell`, the `applyingRoute` feedback
guard, `adoptShellOnLanding` and the body-class startup adoption. Kept, and why:

- The pre-router queue (`window.shellRequest.pending`). `dist/ui.js` loads after
  every legacy script, so a request can happen before the router exists. It is
  applied at once (the UI responds) and queued only if it changed the shell; the
  router folds the queue onto the startup URL and replaces that entry. Unlike
  the old adoption it keeps the URL's view: settings opened while ui.js loads on
  `/` opens over the Files home.
- The stale-route check (entry key comparison) described above.
- `closing`: settings closes with `history.back()` (so Forward can reopen it),
  which lands asynchronously. Requests made before it lands are applied at once
  and committed after landing; routes skip the settings entry meanwhile. The
  settings entry's key is kept in `sessionStorage`, so a reload before it lands
  comes back closed on the view underneath (previously it reopened settings). A
  traversal that never lands is replaced after one second.
- `fromPath`/`lastAction`, so a settings entry pushed by `navigate()` (no state)
  records the view it was opened from.

Legacy compatibility: `fileLibrary.showHome/showEditor`,
`appSettings.open/close/select` and `agentWorkspace.setCodeMode` keep their
names and synchronous effect; they are now requests. The appliers are new on the
same objects (`fileLibrary.applyHome/applyEditor`, `appSettings.applyOpen/
applyClose`, `agentWorkspace.applyCodeMode`) and are for the router only: calling
them directly bypasses the URL. `appSettings.select` while settings is closed
only selects the section, as before.

## Settings route

`/settings/<section>` (`account`, `preferences`, `agents`, `accounts`, `tools`,
`projects`, `usage`, `models`, `connections`, `memory`, `members`,
`permissions`) owns the legacy overlay (`window.appSettings`, body class
`settings-open`, `#settings-screen`). `/settings` and unknown sections are
replaced in place by `/settings/preferences`.

The URL names only the section. The view underneath is not in the URL. It is
stored in that entry's history state (`settingsUnder`: `/`, `/editor` or `/code`,
`settingsPushed`). Settings is app-level, not view-specific, so the URL stays
canonical and shareable. Per-entry history state survives reload and
Back/Forward, so a reload of `/settings/account` opened over Files home comes
back over Files home. A typed or shared `/settings/...` URL has no state. It opens
over the current view, which on a fresh load is the editor (the legacy startup
view).

History:

- Opening (menu `#shell-settings`, ⌘,, `appSettings.open`, avatar/profile
  buttons, or a router navigation from a view) pushes one entry.
  Switching sections replaces it, so Back always closes settings in one step.
- Back closes settings and shows the view underneath. Forward reopens it.
- Closing (`#settings-back`, Escape, `appSettings.close`, deep links)
  steps back to the entry it was pushed from (`history.back()`), so no entry is
  added. Forward can reopen settings. If there is no such entry (a typed URL),
  the settings entry is replaced with the view underneath.
- Requesting a view while settings is open (Files, ⌘K, code mode, opening a
  file) closes settings and pushes that view; Back reopens settings.
- Repeated `open`/`select` calls for the current section do not touch history.

Fixed edges: the URL used to catch up one tick after closing (a reload in that
tick reopened settings); see `closing` above. Escape over the Files home with
settings open used to close settings and also leave home: settings now marks the
Escape handled (`preventDefault`) and the Files home ignores a handled Escape.
`leftRooms` lives only for the page session.

### Room-hash and settings validation (spike/room-hash-settings)

- `npm run build:ui`, `lint:ui`, `typecheck:ui` and `check` exit 0.
  `oxfmt --check` passes on the changed files. `web/settings.js` is minified
  legacy and already fails the baseline check.
- `node tests/shell-router.cjs` and `node tests/settings-route.cjs`: 3/3 PASS each.
- `test:ux` run file by file (wonder-shell, settings, views-templates, views-store,
  document-lifecycle, cloud-async, shell-router, settings-route): all PASS.
  `npm run test:cloud`: PASS.
- Plain Chrome against a static `web/` server with SPA fallback: `/settings` →
  `/settings/preferences` (section clicks replace, Back to app → `/editor`, ⌘,
  pushes, Back/Forward/reload work). `/editor#room=…&token=…` opens the invite
  dialog. `shellRouter.navigate({to: "/"})`, settings over home, two Backs and
  reload all keep the exact fragment. There were no page errors. Of 176 server
  requests, none contained the token.

## Validation

Validation results and the measured generated bundle delta are recorded below.
The generated `web/dist` files are built, ignored by Git, and never hand-edited.

Dependency selection: `npm view @tanstack/react-router version` returned
`1.170.46`; `npm install @tanstack/react-router@latest` installed that version
and synchronized the lockfile. Context7 `/tanstack/router` was consulted for
code-based routes, RouterProvider and custom memory history.

Generated `web/dist/ui.js`: 1,681,220 bytes before, 1,757,543 bytes after;
76,323 bytes added (4.54%, uncompressed). Both builds used the same local
Node 26.13.0/toolchain and production build command.

Plain browser checks used the T3 browser and a temporary Node static server on
127.0.0.1:4317, serving `web/` with extensionless-path fallback to index.html:

- Direct `/editor`: route `/editor`, `files-view=false`, three existing canvas layers.
- Files button: URL `/`, `files-view=true`.
- Native `history.back()`: `/editor`, `files-view=false`; `history.forward()`:
  `/`, `files-view=true`.
- Fresh `/`: Files home with the existing file; clicking Open Untitled:
  `/editor`, `files-view=false`.
- `/index.html?spike=1#room=router-test&token=a%2Fb%3D`: replaced with
  `/?spike=1#room=router-test&token=a%2Fb%3D`; invite dialog remained open.
  Switching to editor preserved the exact encoded hash and search.
- `#public=router-test` was preserved through home/editor switching.

The browser exposed no `window.desktop`, as expected. Native project access,
agent execution and IPC were not tested there. The static server has no cloud
API: successful room joining and public-document fetching were not end-to-end
browser checks. Existing cloud async/document lifecycle tests and the fragment
checks cover the integration boundary of this spike.

Still to verify after merging the parallel protocol work: privileged app origin,
`app://verynize/editor` direct load/reload and asset resolution, Back/Forward,
and origin-based IPC authorization after a path change. The new regression test
intentionally asserts `file:` for this branch; adapt its startup assertions when
the desktop protocol lands, while retaining coverage of the memory fallback.

Checks completed:

- `npm run build:ui`: exit 0, `Built UI islands: ui`. Existing unresolved asset
  warnings for `x.png` and `…` also occur in the baseline build.
- `npm run lint:ui`: exit 0, no diagnostics.
- `npm run typecheck:ui`: exit 0, no diagnostics.
- `npm run check`: exit 0, `All JavaScript syntax and entry asset checks passed`.
- `npm run build` (Cloudflare): exit 0, final output `✓ built in 94ms`.
- `npm run format:check`: exit 1, `Format issues found in above 509 files. Run
  without --check to fix.` The exact same 509 file paths fail on a clean archive
  of staging `0a5e9f88a0ff76c9dd30ebf21b905a2d19aca3ca`; no new failing paths.
  New TypeScript and regression test files pass a targeted format check.
- `node tests/shell-router.cjs`: exit 0:

```text
PASS shell router: file memory history, route/view sync, Back/Forward, Escape, deduplication, document and cloud hash preservation
```

The pre-router bundle baseline passed `test:canvas` and the original `test:ux`.
The named onboarding/capture/MCP flakes are not part of these two suites and
were not run. No unrelated assertions or formatting were changed.

`npm run test:ux` completed with exit 0, including the new router test. The
initial changed-branch `npm run test:canvas` stopped at
`tests/inspector-parity.cjs:168:45` with exit 1:

```text
page.waitForSelector: Timeout 20000ms exceeded.
  - waiting for locator('[data-sonner-toast]') to be detached
```

The original baseline suite passed that test. An isolated rerun from the clean
staging archive also passed (exit 0), ending with:

```text
PASS layout section: flex matrix, distribution, reverse, wrap, gaps, padding axes/sides, limits, Grid settings tracks (fr weights, auto rows) + Automatic positioning + cell alignment, grid child spans, margin auto, block spacing
```

Browser checks were active during the initial changed-branch suite. The timeout
may be related to focus/visibility pausing toast expiry, but that cause is not
proven. No implementation or assertion was changed in response; the full canvas
suite was rerun with browser checks finished.

The unchanged full `npm run test:canvas` rerun completed with exit 0. Its final
output was:

```text
PASS typography: Wonder layout, line height Auto, vertical alignment, Type settings fields render + clear, in-canvas editing with range styling, light theme
```

Thus the final canvas and UX suite runs pass. The initial toast timeout and the
repository-wide formatting failure remain explicitly recorded above.

Editor files use `/editor/<fileId>` with stable library IDs. Tab switches push history; bare
`/editor` and known cloud-room ID aliases replace to the local file URL. Unknown or unavailable
files return to Files with a non-blocking notice. Settings history retains the full file path;
cloud capabilities remain exclusively in the existing fragments.
