# Deployment

Verynize's browser app and collaboration backend can run on three targets. The desktop app is packaged separately (`npm run package:mac`) and defaults to the configured hosted origin; the user can choose another backend in **Share & collaborate**.

| Target                                | Web app                                                                         | Backend                                    | Rooms (single writer per room)           | Guide                                        |
| ------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------ | ---------------------------------------- | -------------------------------------------- |
| Cloudflare (configured hosted target) | TanStack Start on Workers                                                       | `cloud/worker.js`                          | SQLite Durable Objects                   | this page                                    |
| VPS / Docker                          | Start Node build (`npm run start:web:node`) or the backend's own static serving | `npm run start:server` (`server/node.mjs`) | in-process actor per room, `node:sqlite` | [self-hosting.md](self-hosting.md)           |
| Vercel                                | static `web/` (Start/Nitro output can replace it later)                         | `api/server.mjs` Node function             | Redis lease + fencing, libSQL storage    | [deployment-vercel.md](deployment-vercel.md) |

All three run the same backend code through the runtime-neutral interfaces in `cloud/platform/` (see `cloud/platform/README.md`), and the same cloud test scenarios: `npm run test:cloud` (workerd), `npm run test:cloud:node`, `npm run test:cloud:vercel` (needs a local `redis-server`).

## Cloudflare

The application uses a Worker with SQLite Durable Objects, a room-creation rate limiter, and static web assets. `cloudflare.config.ts` declares the entrypoint and bindings. No Wrangler configuration is used. To run the same backend on your own server or in Docker instead, see [self-hosting.md](self-hosting.md); on Vercel, see [deployment-vercel.md](deployment-vercel.md).

The browser app is a TanStack Start app in `web-start/` (see `web-start/README.md`). `vite.config.ts` builds it with the Cloudflare Vite plugin. The Worker entry `web-start/src/server.cloudflare.ts` sends the backend paths (`/api/*`, `/u/*`, `/apps/*`, `/passkey`, `/passkey.js`, `/account/*`) and WebSocket upgrades to `cloud/worker.js`. It re-exports the Durable Object classes, so the Worker name, bindings and Durable Object data are unchanged. Start serves the editor routes as a client-only shell that boots `web/index.html`'s markup and scripts. Static assets are Start's client build plus the files of `web/`, except `web/src`, `web/index.html` and the desktop-only migration page. `npm run build` builds `web/dist/ui.js` first.

### Start web app on Node

`npm run build:web:node` builds the same app into `dist/web-node` (self-contained, no `node_modules` needed at runtime). `npm run start:web:node` serves it (`PORT`, default 3000; `HOST`, default 127.0.0.1). It forwards the backend paths and their WebSocket upgrades to `VERYNIZE_BACKEND_URL`, for example `http://127.0.0.1:8787` for the Node backend. Without it, those paths answer 502. TLS, compression and process supervision are left to the hosting environment.

## Commands

Use Node.js 22.18 or newer and the lockfile's project-local `cf`:

```sh
npm install
npm test
npm run deploy:check
npm run deploy
```

`deploy:check` builds and validates without uploading. `deploy` requires a configured Cloudflare account and creates the declared bindings. The dry run validates the asset bundle and every declared binding: the `ROOMS`, `ACCOUNTS`, `APPS` and `AI_RUNS` SQLite Durable Objects, the `DB` D1 database, the `ASSETS_BUCKET` R2 bucket, the `EMAIL` send-email binding, and the `ROOM_CREATION`, `AUTH_LIMIT`, `MCP_LIMIT` and `AI_LIMIT` rate limiters.

## Accounts database (D1) and auth secret

Better Auth (`cloud/auth.js`) keeps users, sessions and organizations in the `DB` D1 database, whose schema is in `cloud/migrations`. The Worker needs Workers Paid, because `cloudflare.config.ts` sets `limits.cpuMs` to 300 000 (the Paid maximum) for scrypt password hashing and large room imports. `npm run deploy` sends that value on every deploy, so a CPU limit changed in the Cloudflare dashboard is reset by the next deploy: change it in `cloudflare.config.ts`. First deployment:

The checked-in configuration targets `https://verynize.gayaloo.app`, with D1 database `verynize`
(`76210bc4-d4fe-4075-a321-776c2525a828`) pinned in `cloudflare.config.ts`.
This identifies the target; it is not a live deployment check. The Git branch `staging`
is not a separate hosted environment. ALPHA desktop distribution does not require
provisioning a second backend; use a local backend for automated tests.

```sh
npm run db:migrate
# Existing Worker with its required secrets already configured:
npm run deploy
```

For a fresh Worker, `cf` requires declared secrets at the initial upload. Create a
private temporary JSON file containing `BETTER_AUTH_SECRET` and `ASSET_SIGNING_SECRET`, then run:

```sh
npm run build
node scripts/env.mjs ./node_modules/.bin/cf deploy --prebuilt --secrets-file /absolute/path/to/private-secrets.json
# Optional after successful deployment, when Sentry release reporting is configured:
node scripts/env.mjs node scripts/sentry-release.mjs
```

Use the explicit `cf` command when passing deploy options: `npm run deploy` is a
shell chain, so appended arguments reach its final Sentry command rather than
`cf deploy`. The path above uses the installed project-local CLI without requiring
a global `cf`. Remove the private file after successful deployment. Subsequent
deployments retain existing secrets; do not rotate them on every deploy.
`npx cf d1 list` lists database IDs.

Apply new migrations before deploying code that needs them; `0002_rooms.sql`
(rooms owned by organizations) must be applied before the organization release.
`0003_directory.sql` (profiles, room index, publications and apps in D1) must be
applied before deploying the directory release. On the first request after that
deploy, the Worker copies the existing `AccountDirectory` data into these tables once
(see cloud/README.md, "Account directory in D1"); no manual step is needed.
For a local database,
add `--local` (and optionally `--persist-to <dir>`).

### Room assets (R2 bucket and signing secret)

Shared-room images live in the R2 bucket `verynize-assets` (binding `ASSETS_BUCKET`), with metadata in D1 (`cloud/migrations/0004_room_assets.sql`). Upload and read URLs are signed with the `ASSET_SIGNING_SECRET` Worker secret (see cloud/README.md, "Room assets"). Before deploying this release:

1. Apply the migration: `npm run db:migrate` (it applies `0004_room_assets.sql`).
2. Create the bucket, unless `npm run deploy` provisions it from the declared binding: `npx cf r2 buckets create --name verynize-assets` (add `--location-hint` or `--cf-r2-jurisdiction` if needed, and `--dry-run` to check the request first).
3. Provide the secret, generated with `openssl rand -base64 32`. For the next deploy, add `ASSET_SIGNING_SECRET` to the private secrets file and use the explicit build/deploy commands above, or set it on the existing Worker with `npx cf workers secrets update ASSET_SIGNING_SECRET --worker verynize --text '<value>'` (keep the value out of shell history). Delete the file afterwards.

Do not rotate `ASSET_SIGNING_SECRET`: every image URL stored in room documents depends on it. Without the bucket or the secret, the asset endpoints answer 503 and the desktop keeps images embedded as before. These steps were checked only with `npm run deploy:check`; no bucket or secret was created against a real account.

### Crash reports (Sentry)

Optional. Put `SENTRY_DSN_WEB` (and `SENTRY_AUTH_TOKEN` for source maps) in the repo-root `.env`, which `npm run build`, `deploy` and `deploy:check` load, or export them. Set `SENTRY_DSN_SERVER` as a Worker secret (`npx cf workers secrets update SENTRY_DSN_SERVER --worker verynize --text '<dsn>'`) or in `.env` to build it in. Without them nothing is reported. See docs/telemetry.md.

### Transactional email

The checked-in configuration selects Cloudflare Email Sending through the native `EMAIL` binding.
`EMAIL_FROM` is `mada@gayaloo.app`, and the binding restricts senders to that address.
The `gayaloo.app` sending domain must be onboarded with valid sending DNS records;
Workers Paid is required to send to arbitrary recipients. No webhook URL or token
is needed. The optional webhook transport remains available for other deployments.
Never enable the development `outbox` provider on a public deployment.

`node tests/cloud-email.mjs` checks native sending and failures in local workerd.
Local simulation does not prove delivery to a real inbox.

## Sharing

After deployment, enter the deployed origin in **Share & collaborate**. Private invites keep the room id and capability token in the URL fragment (`#room=…&token=…`), which browsers never send to the server; the web router preserves it on every navigation and it must never move into the query string. REST calls authenticate with bearer tokens; the WebSocket upgrade carries the token as a query parameter because browsers can't set headers there. Treat invites as credentials for their role (viewer, commenter, editor, owner). Public URLs address frozen snapshots and do not confer edit access; unpublishing revokes the public snapshot, and publishing again rotates the public link.

Edits are merged on the server as per-property operations (hybrid-logical-clock last-writer-wins, range-merged text, cycle-safe moves; see cloud/README.md, "Merging"), so concurrent edits combine without asking the user. Legacy revision-checked snapshot writes still work. Rooms accept up to 32 WebSocket connections. `web/room-limits.js` is the source of truth: 20 MiB per document, 20 MiB per page within that document total, 2 MiB metadata, and 21 MiB request/WebSocket envelopes. Large binary assets go through room asset storage rather than expanding document JSON.

Accounts (Better Auth: email + password, plus passkeys), organizations with member roles, and creator profiles live in D1. Owners can issue and revoke role-limited invite links and rotate all links at once (`POST /api/rooms/:id/tokens/rotate`); sockets on a revoked link are closed. Rate limits: 10 room creations and 10 auth attempts per client per minute, 240 hosted-MCP calls per minute. Cloud hosting does not grant browser access to desktop project files or CLI agents; those stay desktop-only.

## Evidence

Context7 resolved Cloudflare's official Workers SDK and cf documentation; configuration was verified against the installed cf types and dry-run output. Local Miniflare/workerd tests verify authorization, room isolation, operation merging (concurrent edits, duplicate batches, restart-persistent stamps), restart persistence, publication/unpublish, accounts and organizations, room assets, hosted MCP, email and rate limiting; the same scenarios run on the Node and Vercel runtimes. Two Electron clients verify REST/WebSocket CORS, joining, cursors, synchronization and reconnect. `npm run test:web` checks the Start app in Cloudflare dev, preview and the Node build.

- [Cloud service implementation and API](../cloud/README.md)
- [Cloudflare project configuration](https://developers.cloudflare.com/cf/projects/cloudflare-config/)
- [Durable Object WebSockets](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)

### Migration shortcut

Run `npm run db:migrate` from the product repository. The wrapper reads `worker.env.DB.id` from `cloudflare.config.ts`; no database ID argument is needed. Forks must configure their own D1 binding before deploying or migrating.

The default target is the cloud database. Use `npm run db:migrate -- --dry-run` to validate arguments without executing migrations, or `npm run db:migrate -- --local --persist-to .cloudflare/state` for the local state used by the Vite development server. A dry run does not verify credentials or SQL against the database. `--profile NAME` selects the cf authentication profile; configuration modes and arbitrary database overrides are intentionally not accepted.
