# Self-hosting on Node (VPS or Docker)

The collaboration backend also runs as a single Node process: `server/node.mjs` serves the API, the room WebSockets and the web app on one port, with the same code as the Cloudflare Worker (`cloud/worker.js`). The runtime layer is described in [cloud/platform/README.md](../cloud/platform/README.md). Cloudflare deployment is unchanged ([deployment.md](deployment.md)).

## Run

Node 24.11 or newer (the server uses the built-in `node:sqlite`).

```sh
npm install
npm run build:ui                      # web/dist, served with the rest of web/
BETTER_AUTH_SECRET=$(openssl rand -base64 32) \
ASSET_SIGNING_SECRET=$(openssl rand -base64 32) \
PUBLIC_URL=https://verynize.example.com \
DATA_DIR=/var/lib/verynize \
npm run start:server
```

Keep the two secrets stable (store them in your secret manager): rotating `BETTER_AUTH_SECRET` signs everyone out, and every image URL stored in room documents depends on `ASSET_SIGNING_SECRET`.

## Docker

```sh
docker build -t verynize-server .
docker run -p 8787:8787 -v verynize-data:/data \
  -e BETTER_AUTH_SECRET=… -e ASSET_SIGNING_SECRET=… -e PUBLIC_URL=https://verynize.example.com \
  verynize-server
```

The image keeps all state in `/data` (a volume). Run exactly one container per data volume.

## Configuration

| Variable                                                                              | Meaning                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PORT`, `HOST`                                                                        | Listen address (default `8787`, `0.0.0.0`).                                                                                                                                                                                                                                                                                   |
| `DATA_DIR`                                                                            | State directory (default `./data`): `d1/verynize.sqlite` (accounts, organizations, profiles, asset metadata), `objects/<Class>/<name>.sqlite` (one file per room, published app and the credential directory), `blobs/` (room images). Back it up as a whole, ideally with the server stopped or with SQLite's online backup. |
| `PUBLIC_URL`                                                                          | The public origin. Request URLs, emailed links and signed image URLs use it. Without it the origin comes from the `Host` header (or the proxy headers below).                                                                                                                                                                 |
| `TRUST_PROXY`                                                                         | `1` behind a reverse proxy: take the origin from `X-Forwarded-Proto`/`X-Forwarded-Host` when `PUBLIC_URL` is unset.                                                                                                                                                                                                           |
| `CLIENT_IP_HEADER`                                                                    | Header your proxy sets to the client address (`x-forwarded-for`, `cf-connecting-ip`, `x-real-ip`). Rate limits key on it. Without it the socket address is used and client-sent `CF-Connecting-IP` is ignored. Set it only when a proxy always overwrites that header.                                                        |
| `BETTER_AUTH_SECRET`                                                                  | Required. Signs Better Auth tokens (32+ random bytes).                                                                                                                                                                                                                                                                        |
| `ASSET_SIGNING_SECRET`                                                                | Signs room image URLs. Without it image uploads answer 503 and the desktop keeps images embedded.                                                                                                                                                                                                                             |
| `AUTH_URL`, `PASSKEY_RP_ID`                                                           | Optional overrides, as on Cloudflare (`cloud/README.md`).                                                                                                                                                                                                                                                                     |
| `EMAIL_PROVIDER`                                                                      | `smtp` (below), `webhook` (`EMAIL_WEBHOOK_URL`, `EMAIL_WEBHOOK_TOKEN`), or `outbox` for local development only (sign-in links are readable at `/api/dev/outbox`; never on a public server). Anything else disables email sign-in.                                                                                             |
| `ROOM_ACCOUNT_REQUIRED`                                                               | `web` (default): the web app needs a signed-in account for room requests; `all`: room creation needs an account from every client (desktop included); `off`: anonymous web rooms (`cloud/README.md` "Web sign-in").                                                                                                           |
| `EMAIL_FROM`                                                                          | Sender address for `smtp`.                                                                                                                                                                                                                                                                                                    |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_REQUIRE_TLS`, `SMTP_USER`, `SMTP_PASS` | SMTP relay. `SMTP_SECURE=1` for implicit TLS (port 465); otherwise STARTTLS is used when offered, and `SMTP_REQUIRE_TLS=1` refuses to send without it.                                                                                                                                                                        |
| `BLOB_STORE`                                                                          | `file` (default, under `DATA_DIR/blobs`) or `s3`.                                                                                                                                                                                                                                                                             |
| `S3_ENDPOINT`, `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`   | S3-compatible storage for room images (path-style URLs: AWS S3, MinIO, R2, B2).                                                                                                                                                                                                                                               |
| `WEB_ROOT`                                                                            | Directory served as the web app (default `web/`; `web/src` is never served).                                                                                                                                                                                                                                                  |

Rate limits match `cloudflare.config.ts` (10 room creations and 10 sign-in attempts per minute per IP, 240 hosted MCP requests per minute per IP and per account, 20 model API runs per minute per account), counted in memory. The model API runtime ([ai-runtime.md](ai-runtime.md)) needs no secret: each user connects their own OpenRouter account (OAuth or a pasted key, stored encrypted under a key derived from `BETTER_AUTH_SECRET`; serve over https or `http://localhost` for the OAuth callback). `VERYNIZE_AI=off`, `OPENROUTER_BASE_URL`, `VERYNIZE_AI_MODELS`, `VERYNIZE_AI_MAX_TURNS` and `VERYNIZE_AI_MAX_TOOL_CALLS` are optional; `OPENROUTER_API_KEY` is a shared fallback only with `VERYNIZE_AI_SERVER_KEY=1`.

## Operations

- **One process per `DATA_DIR`.** Rooms are single-writer actors held in memory; two processes on the same files would both accept writes. Scale vertically, or use the multi-instance runtime ([deployment-vercel.md](deployment-vercel.md): libSQL, Redis and S3 instead of local files).
- **TLS** terminates at your reverse proxy (Caddy, nginx). Forward WebSocket upgrades on `/api/rooms/*/socket` and keep idle timeouts above a minute.
- **Logs** carry the path of failed requests and error messages only; tokens, sessions and query strings are not logged. Do not enable access logs with full URLs in the proxy: socket tokens travel as query parameters.
- **Shutdown** (`SIGTERM`/`SIGINT`) commits every actor, closes room sockets with 1001 (clients reconnect) and closes the databases.
- **Migrations** in `cloud/migrations` are applied automatically at start-up.

## Tests

`npm run test:cloud:node` runs every `npm run test:cloud` scenario against this runtime (real child-process server, real WebSockets, real SQLite files). Any cloud test can run on Node with `CLOUD_RUNTIME=node node tests/<file>.mjs`, including the Electron ones such as `tests/cloud-desktop.mjs`.
