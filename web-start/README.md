# Web app (TanStack Start)

The browser deployment of Verynize: a TanStack Start app that serves the existing editor
client-only and composes with the existing cloud Worker. Desktop does not use it: Electron still
loads `web/index.html` over `app://verynize` with `web/dist/ui.js` built by
`vite.renderer.config.ts`.

```sh
npm run dev               # build:ui, then Start + workerd (cloud/worker.js, Durable Objects, D1, R2)
npm run build             # build:ui, then the Cloudflare build in .cloudflare/output
npm run deploy:check      # build + `cf deploy --prebuilt --dry-run`
npm run build:web:node    # build:ui, then the Node build in dist/web-node
VERYNIZE_BACKEND_URL=http://127.0.0.1:8787 npm run start:web:node   # PORT=3000 HOST=127.0.0.1
npm run test:web          # tests/web-cloudflare.mjs (dev + preview) and tests/web-node.mjs
```

`npm run dev` keeps local state in `.cloudflare/state`. Apply the D1 migrations to it once with
`vpr db:migrate --local --persist-to .cloudflare/state`. `VERYNIZE_CF_STATE=<dir>` points the dev
server and `vp preview` at another directory (the tests use a temp directory).

## Layout

| Path                                                  | Role                                                                                                                                                                                                                     |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `vite.config.ts` (repo root)                          | Cloudflare target: `cloudflare({ viteEnvironment: { name: "ssr" } })` + `tanstackStart({ srcDirectory: "web-start/src", server: { entry: "server.cloudflare.ts" } })`. Also holds the repo's lint/fmt config, as before. |
| `vite.node.config.ts`                                 | Node target: the same app with Start's default server entry, dependencies bundled (`ssr.noExternal`), output in `dist/web-node/{client,server}`.                                                                         |
| `cloudflare.config.ts`                                | Worker `verynize`, entry `web-start/src/server.cloudflare.ts`. Bindings unchanged.                                                                                                                                       |
| `web-start/src/routes/`                               | `__root.tsx` (document shell), `_editor.tsx` (pathless, `ssr: false`), `_editor/{index,editor,code,settings,settings.index,settings.$section}.tsx`, `index[.]html.ts` (302 to `/`). See "Areas" below.                   |
| `web-start/src/legacy/boot.ts`                        | Client-only boot of the desktop renderer page.                                                                                                                                                                           |
| `web-start/src/legacy/ui.ts`                          | Runs the renderer UI from source (`virtual:verynize/legacy-ui` = `web/src/web-app.tsx`) where `web/index.html` loads `ui.js`; `useLegacyUi()` for route components.                                                      |
| `web-start/src/legacy/shell-host.ts`                  | Registers Start's router as the shell router's host; `useShellArea` for the editor routes ("One router" below).                                                                                                          |
| `web-start/src/server.cloudflare.ts`                  | Worker entry: backend paths to `cloud/worker.js`, everything else to Start; re-exports the Durable Objects.                                                                                                              |
| `web-start/worker-paths.mjs`                          | Backend-owned paths, shared by the Worker entry and the Node server.                                                                                                                                                     |
| `web-start/build/legacy-web.mjs`                      | Vite plugins: `virtual:verynize/legacy-shell` from `web/index.html`, `virtual:verynize/legacy-ui` (the islands from source, `@` alias), and the `web/` static-file allowlist.                                            |
| `web-start/node/server.mjs`                           | Node HTTP server for `dist/web-node`.                                                                                                                                                                                    |
| `vite.nitro.config.ts`, `web-start/nitro/backend.mjs` | Opt-in Nitro spike (preset `node-server` or `vercel`); see "Nitro spike" below.                                                                                                                                          |
| `web-start/src/routeTree.gen.ts`                      | Generated by Start on dev/build. Committed so type checking works without a build; do not edit.                                                                                                                          |

Why a separate `web-start/` source directory but the root `vite.config.ts`: the Cloudflare Worker
must stay one Worker named `verynize`, because it hosts the Durable Objects whose data lives in
production. `cloudflare.config.ts`, `cf deploy --prebuilt` and `scripts/db-migrate.mjs` read the
config from the Vite root, and `tests/cloud-harness.mjs` builds the root config and runs
`.cloudflare/output/.../bundle`. Keeping the Vite root at the repository root keeps one deploy
config and makes the cloud tests run the bundle that is actually deployed. The directory is not
called `apps/`: in dev Vite serves source modules by path, and `/apps/*` belongs to the Worker
(published apps).

## The editor stays client-only

The editor routes share the pathless layout `_editor` with `ssr: false` (inherited by its
children). The server sends only the document shell: `<html>`, head metadata, and Start's
hydration scripts. No editor markup is server-rendered and no legacy script runs on the server.
After hydration, `EditorHost` calls `bootLegacyEditor()` once per page:

1. inserts the stylesheets of `web/index.html` and waits for them;
2. inserts the `<body>` markup of `web/index.html` as direct children of `<body>`, before Start's
   nodes (legacy CSS and selectors such as `body > header` depend on it);
3. inserts the scripts in document order with `async = false`, which keeps execution in order
   while downloading in parallel. `web/dist/ui.js` is the exception: at its place in the order the
   same UI runs from source, bundled into Start's client build ("One React" below);
4. dispatches `DOMContentLoaded` once the last script has run. A parsed page fires it after its
   scripts, and `web/cloud-panel.js` reconnects the open file's room from a listener added at
   startup;
5. sets `<html data-legacy-editor="ready">`. `data-ui-ready` (web/src/lib/bridge.ts) then follows as
   on desktop.

The shell is generated from `web/index.html` at build time (`virtual:verynize/legacy-shell`), not
copied. Extra or reordered script tags, such as a `web/platform.js` added early in the page, are
picked up automatically, including scripts in `<head>` (they run first, after the body markup
exists). Inline scripts and `<style>` blocks are supported.

Production builds keep those original names in the shell and add `shell.assetUrls`, an original-name
to content-hashed URL lookup. Boot code selects scripts by original name, then resolves the URL
when inserting each script or stylesheet. Copies live under `/assets/legacy/`; classic scripts
remain byte-for-byte unchanged, and CSS `url()` dependencies (including fonts) are rewritten to
hashed copies before hashing the CSS. Original files remain available for frames, workers and
other callers. Cloudflare `_headers` and the Node server cache hashed copies immutably for a year;
route documents and the diagnostic `/legacy-assets.json` manifest keep normal revalidation.
Development and Electron continue using original URLs.

Alternatives considered:

- SSR the static markup with parser-inserted scripts: this gives exact parse-time semantics, but
  React then hydrates `document` after the legacy scripts have already rewritten `<body>`. A
  hydration mismatch makes React re-render the whole document client-side, which would wipe the
  editor.
- Start SPA mode (`spa.enabled`): the editor would still be hydrated by the same root, so the
  problem is the same, and every route, including future SSR pages, would lose SSR.
- `<ClientOnly>`: equivalent to `ssr: false` for a component that only runs an effect, but
  `ssr: false` also skips server loaders and states the intent at the route.

Navigating between `/`, `/editor`, `/code` and `/settings/*` never remounts the layout.

### Sign-in first

The web app needs an account (cloud/README.md "Web sign-in"). Before step 1 above, `EditorHost` asks
`webAccess()` (`legacy/web-auth.ts`, imported dynamically so the server never loads it): it loads the
stylesheets alone (`loadLegacyStyles()`, step 1) and checks the stored session for this origin with
`GET /api/me`. Signed out, the layout renders the sign-in screen
(`web/src/islands/onboarding/web-sign-in.tsx`) instead of its children and boots nothing; once signed
in it registers the shell host and boots the editor at the same address, fragment included. A
`#public=…` snapshot link boots without an account. After boot, losing the session (sign out) reloads
the page into the sign-in screen. `<html data-web-auth>` reports `checking`, `signed-out`, `signed-in`
or `public`.

### One router

Start's router is the only router and the only history on the page. The legacy shell router
(`web/src/lib/router/shell-router.ts`, inside `web/dist/ui.js`) is the same source that runs
standalone on desktop. On the web it runs hosted:

1. `EditorHost` calls `installShellHost(router)` (`legacy/shell-host.ts`) before
   `bootLegacyEditor()`. This sets `window.verynizeShellHost = { router, initialState }`, where
   `initialState` is `history.state` as loaded, read before Start's history keys the entry (the
   module is imported by `router.tsx`).
2. When `ui.js` runs and finds the host, the shell router creates no history and no route tree.
   `window.shellRouter` is Start's router, and `navigate()`, `window.shellNavigation` and the
   legacy requests (`window.shellRequest`) write through Start's history. The cloud-fragment wrapper
   wraps that history, so Start's own navigation keeps `#room=…`/`#public=…` as well.
3. Start's route components name the area they stand for: `_editor/index.tsx` `/`, `editor.tsx`
   `/editor`, `code.tsx` `/code`, `settings.tsx` (layout of `settings.index.tsx` and
   `settings.$section.tsx`) `/settings`. `useShellArea(area)` hands each rendered location (keyed
   by its history entry) to `window.shellNavigation.applyLocation(area, location)`. Hosted, the shell
   router applies no view there (its legacy appliers are not called, see "Areas"); it keeps the
   history rules: the view under settings (history state, recorded for state-less entries), settings
   closing through `history.back()`, the pre-router request queue and section canonicalization
   (`/settings` and unknown sections are replaced with `/settings/<section>`).
4. Locations rendered before the UI ran find no `shellNavigation`; the router island applies the
   current entry once when it mounts.

There used to be two `@tanstack/history` browser histories here, each wrapping
`history.pushState`/`replaceState`, with Start's router following the shell router through the
chained wrappers. That is gone: there is one wrapper and one location. `tests/web-cloudflare.mjs`
and `tests/web-node.mjs` check it with `tests/helpers/web-router.mjs` (UI clicks, app navigation
and Back/Forward between every area, one entry per step, Start's location equal to the address bar,
no editor remount, deep links, room fragment).

Start's scroll restoration and hash scrolling are off. The `#room=…`/`#public=…` fragments stay
client-side as before (`docs/spikes/tanstack-router.md`).

### One React

The web page does not load `web/dist/ui.js` (the desktop IIFE, which carries its own React).
`web/src/web-app.tsx` imports the same islands as `web/src/ui.tsx` and exports the areas the routes
render; the `legacy-ui` plugin bundles it into Start's client build as `virtual:verynize/legacy-ui`
(an empty module on the server, so the Worker bundle gets none of it). Start's tree and every island
root therefore share one React, one ReactDOM, one TanStack Router and one `QueryClient`
(`web/src/lib/query/client.ts`; `IslandProviders` in `web/src/lib/mount.tsx` gives route-rendered
areas the same providers as island roots). The islands stay separate React roots, as on desktop, and
the route areas portal into the legacy hosts, so ids, `[name=…]` selectors and CSS are unchanged.

Styles still come from `web/dist/ui.css` (Tailwind runs in `scripts/build-ui.cjs`), loaded by the
legacy shell like on desktop; CSS imported under `web/src` is an empty module in Start's build.
`npm run build:ui` therefore stays a prerequisite. `web/dist/ui.js` is still published (the static
allowlist is unchanged) but nothing on the web page loads it.

`legacy/ui.ts` records `<html data-shared-react="true">` when the islands' React is Start's;
`tests/helpers/web-router.mjs` checks it, checks that no `dist/ui.js` script exists and fails on
"Invalid hook call" / duplicate-React console messages.

### Areas

| Area           | Web (Start)                                                                                                                                       | Desktop (`ui.js`, standalone shell router)                                   |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Settings       | `settings.tsx` renders `SettingsArea` (`web/src/islands/settings/route-area.tsx`): rendered = open, section = the URL param (unknown → default)   | settings island renders `SettingsScreen`; `appSettings.applyOpen/applyClose` |
| Files home     | `index.tsx` renders `HomeArea` (`web/src/islands/home/route-area.tsx`): rendered = `body.files-view`, `#file-home` shown                          | home island; `fileLibrary.applyHome/applyEditor`                             |
| Code workspace | `code.tsx` renders `CodeArea` (`web/src/islands/code/route-area.tsx`): rendered = `body.code-mode`, `#code-workspace`, chat section moved into it | code island renders `CodeWorkspace`; `agentWorkspace.applyCodeMode`          |
| Editor         | `editor.tsx` renders nothing: the canvas is imperative and shows when no other view is rendered                                                   | same                                                                         |

- Each area portals into the same host as on desktop (`#settings-screen`, `#bd-home-root` inside
  `#file-home`, a body-level root for `#code-workspace`) and marks it with
  `data-route-owner="start"`. The area owns the DOM state of being shown (the `hidden` attribute,
  the `settings-open`/`files-view`/`code-mode` body class) in layout effects, and reports it to the
  legacy module for that module's own bookkeeping: `appSettings.syncSection(section)` (so
  `getState()` stays true), `fileLibrary.syncHome(open)` (toggle, Escape, renders),
  `agentWorkspace.syncCodeMode(on)` (chat section host, launch restore, listeners).
- Settings over a view: `settings.tsx` also renders `HomeArea` or `CodeArea` when the entry's
  `settingsUnder` state names `/` or `/code`. Switching sections keeps the same screen mounted
  (one layout route).
- The areas mount and unmount with their route. What must outlive that stays in the islands: the
  settings island's dialogs, toasts and preference runtime; the home island's host setup (takeovers,
  all deferred on the web because the screen only renders on `/`) and `fileLibrary.attachView()`;
  the code island's controller, `window.codeWorkspace` and the design-mode chat sidebar. The home
  screen keeps its filter, layout and search across remounts; the code workspace keeps its open file
  (module store) and panel state (localStorage). The terminal panel is desktop-only, so no PTY view
  is torn down on the web.
- Route areas render after every island's first commit (`islandsCommitted()` in
  `web/src/lib/bridge.ts`), as the router island applies the first location after the other islands
  on desktop; otherwise a view class set too early keeps shell controls from claiming their
  takeover ids and `data-ui-ready` never arrives.
- Requests made before the UI ran (`web/shell-request.js`) still apply through the legacy appliers
  and are folded into the URL; the route then renders the same view.

Still legacy: the canvas editor (by design: never rendered by React), the legacy DOM inside the
areas (`#file-home`, `#settings-screen` and the chat `.project-agent` section are created by
`web/wonder-shell.js`, `web/settings.js` and `web/desktop-panel.js`), every other island (chrome,
sidebar, inspector, chat, onboarding, dialogs), and the history rules in `shell-router.ts` listed
under "One router". Desktop keeps the standalone router and the island-rendered areas.

Unknown paths now return a server-rendered 404, where the old SPA fallback served the editor for
any path. `/index.html` redirects to `/` with its query; browsers carry the fragment across the
redirect.

## Server composition

Cloudflare (`server.cloudflare.ts`) depends on just two parts of `cloud/worker.js`, both stable:
the default export `{ fetch }` and the named classes `DesignRoom`, `AccountDirectory` and
`PublishedApp`.

- Requests for `/api/*`, `/u/*`, `/apps/*`, `/passkey`, `/passkey.js` and `/account/*`, and any
  request with an `Upgrade` header, go to `worker.fetch(request, env, ctx)`. Room sockets
  (`/api/rooms/<id>/socket?token=…`) therefore reach the `DesignRoom` Durable Object exactly as
  before.
- All other requests go to Start's handler (`createServerEntry` from
  `@tanstack/react-start/server-entry`).
- The Durable Object classes are re-exported from the entry, because the bindings in
  `cloudflare.config.ts` name this Worker's exports.

The static assets are Start's client build plus the allowlisted `web/` files. `assets.notFoundHandling`
is `"none"` (Start renders the pages; there is no SPA fallback). `runWorkerFirst` keeps the backend
paths off the asset lookup.

Node (`node/server.mjs`) serves requests in this order:

1. Backend paths (same list) are forwarded to `VERYNIZE_BACKEND_URL` with `Host` rewritten and
   `X-Forwarded-For` appended. Requests and responses stream, and multiple `Set-Cookie` headers
   are kept.
2. WebSocket upgrades on backend paths are forwarded by splicing the raw sockets, so the backend
   does the handshake. Without `VERYNIZE_BACKEND_URL`, backend paths answer 502 and upgrades are
   refused.
3. Files from `dist/web-node/client` are served. Content-hashed `assets/*` files are cached as
   immutable, everything else gets `no-cache`.
4. Everything else goes to Start's `fetch` handler (`dist/web-node/server/server.js`).

This uses Start's own build output and a small `node:http` server instead of Nitro. It stays the
default. The opt-in Nitro build below reaches parity without a WebSocket client per connection,
because Nitro's crossws layer can hand over the raw socket. Nitro 3 is still a release candidate,
though.

## Nitro spike (Node/Vercel)

Status: a bounded spike (step 2 of `docs/audits/2026-10-31-tanstack-start-ai.md`). It is opt-in.
Cloudflare (`vite.config.ts`, `cloudflare.config.ts`), the Node build (`vite.node.config.ts`,
`node/server.mjs`) and the Vercel entries (`vercel.json`, `api/server.mjs`,
`scripts/vercel-build.mjs`) are untouched and remain the production path.

```sh
npm run build:web:nitro            # NITRO_PRESET=node-server → dist/web-nitro/{public,server}
VERYNIZE_BACKEND_URL=http://127.0.0.1:8787 PORT=3000 HOST=127.0.0.1 npm run start:web:nitro
VERYNIZE_BACKEND_URL=https://backend.example.com npm run build:web:nitro:vercel   # → .vercel/output
npm run test:web:nitro             # tests/web-nitro.mjs (separate from npm test, see below)
```

- **Version.** `nitro` is pinned to exactly `3.0.261029-rc` (devDependency, the `latest` dist-tag
  on 2026-11-01). It is Nitro 3 (`nitro`, `nitro/vite`, `nitro/h3`), not `nitropack` (Nitro 2).
  Upgrading it means re-running `npm run test:web:nitro`.
- **Config.** `vite.nitro.config.ts` uses the same Start app, routes and `legacy-web` plugin as
  the other two builds, and adds `nitro()` with `NITRO_PRESET` = `node-server` (default) or
  `vercel`. Any other value fails the build.
- **Backend paths, node-server.** The paths in `worker-paths.mjs` have one owner, and it is
  `nitro/backend.mjs`, a global Nitro middleware that runs after Nitro's static files and before
  Start. `VERYNIZE_BACKEND_URL` is read at runtime.
  - HTTP goes through h3's `proxyRequest` (fetch). Bodies stream both ways, the client's abort
    cancels the upstream request, every `Set-Cookie` is kept, `X-Forwarded-For` is appended and
    `Host` is the backend's.
  - WebSockets need `features.websocket: true`. The handler's crossws `upgrade` hook takes the raw
    Node socket from `request.runtime.node.upgrade`, splices it to the backend as `node/server.mjs`
    does, and returns `{ handled: true }`. The backend does the handshake and crossws creates no
    peer. Upgrades on other paths are refused with 404. crossws would otherwise accept them with
    empty hooks.
  - With no backend set, backend paths answer 502 and upgrades get 404.
  - Nitro `routeRules.proxy` is not used on Node. It is fixed at build time and does not proxy
    WebSockets.
- **Backend paths, vercel.** Each backend pattern becomes a `routeRules.proxy` to the build-time
  `VERYNIZE_BACKEND_URL`. Nitro turns these into CDN rewrites in `.vercel/output/config.json`,
  placed before `{"handle":"filesystem"}` and before the catch-all `/(.*)` → `/__server` (Start's
  function). The backend therefore has to be its own origin, for example the existing Vercel
  project that runs `api/server.mjs`. See `docs/deployment-vercel.md`.
- **Static files.** `dist/web-nitro/public` holds exactly the `legacy-web` allowlist plus Start's
  hashed chunks; the test compares the two. Nitro marks all of `/assets/**` as immutable, so a
  route rule sends `/assets/fonts/**` (stable names) with `no-cache`, as `node/server.mjs` does.

Measured on an Apple Silicon Mac, `tests/web-nitro.mjs`, 6 runs:

| Measure                                | Nitro node-server | Current Node build               |
| -------------------------------------- | ----------------- | -------------------------------- |
| `vp build` (warm)                      | 1.0–3.3 s         | 1.3 s                            |
| Server output                          | 1.2 MB            | 1.0 MB (`dist/web-node/server`)  |
| Process start → listening              | 63–131 ms         | (in-process in `tests/web-node`) |
| Room socket open through the proxy     | 6–15 ms           | not measured                     |
| Client abort → backend sees close      | 6–11 ms           | not measured                     |
| Vercel preset build (`.vercel/output`) | 0.9–3.1 s         | n/a                              |

Differences from `node/server.mjs`, all checked in the test or by reading h3 2.0.8:

- `Location` headers that point at the backend origin are rewritten to the public origin
  (`proxyRequest`'s default `locationRewrite`). The old server passes them through.
- `Accept-Encoding` is not forwarded. Backend responses travel uncompressed between the proxy and
  the backend.
- `/api` with no trailing path goes to Start (404), as before. In the Vercel `config.json` the
  generated regex also sends bare `/api` to the backend.
- Spliced sockets are not tracked for shutdown. They end when the process exits.

`test:web:nitro` stays out of `npm test` and `test:web`. It runs in about 8 s and passed 6 runs
in a row, but it tests an opt-in path that depends on a release candidate. Add it to `test:web`
if Nitro becomes the default.

Recommendation: adopt for Node only, as the opt-in build, and keep `node/server.mjs` as the
default. Switch the default once Nitro 3 is stable, or once Nitro server routes are needed (for
example an `/api/ai/*` owner in the web app). Do not adopt the `vercel` preset yet
(`docs/deployment-vercel.md`). Rollback: delete `vite.nitro.config.ts`, `nitro/`,
`tests/web-nitro.mjs`, the four `*:nitro*` scripts and the `nitro` devDependency. Nothing else
depends on them.

## Static files

`publicDir: "web"` used to publish everything under `web/`, including `web/src`. The
`legacy-web` plugin now serves (dev) and emits (build) `web/` files except:

- `web/src/**`;
- `web/index.html`: Start renders the document; `/` would otherwise resolve to it as a static
  asset;
- `web/storage-migration.html`: desktop-only;
- `web/dist/*` other than `ui.js`/`ui.css`;
- dotfiles and `*.md`.

`web/dist/ui.js` must be built first. `npm run build`, `dev` and `build:web:node` run
`scripts/build-ui.cjs`; a bare `vp build` warns when it is missing.
