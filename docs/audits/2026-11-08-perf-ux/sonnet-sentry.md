# Sentry inventory (Sonnet, 2026-11-08)

Reconstructed summary. The original report was lost when the scratchpad was wiped.

Org `adamabdrrahman`, projects `verynize-desktop`, `verynize-server`, `verynize-web`. Data starts 2026-11-06, so the 90-day window covers everything. 20 unresolved issues (desktop 2, server 17, web 1) and 3 resolved server issues. User counts are 0 everywhere because user data is not collected.

## Real production failures

- **VERYNIZE-SERVER-5** (20 events): Durable Object isolate exceeded its memory limit, on `/api/rooms/:id/socket` and `/ops`.
- **VERYNIZE-SERVER-4** (11 events): Durable Object overloaded, same routes.
- Bursts on 2026-11-07 06:39–07:53 and 16:07–17:16, and 2026-11-08 02:06. The 06:39 burst started five seconds after the two slowest requests in the data, a pair of 7 s `POST /assets`.
- Likely cause (unconfirmed, platform resets carry no stack): a ~21 MiB batch or snapshot copied several times inside one DO. The 300 s CPU limit stopped CPU resets; memory resets continue.
- **VERYNIZE-SERVER-6** ("Upload changed in transit") has no matching test, so it may be a real upload race.

## Noise

- 14 server issues come from local test runs reporting to production Sentry. Proven for VERYNIZE-SERVER-M (deliberate "test chunk failure" from `tests/cloud-account-state.mjs`, from 127.0.0.1); the other 13 match test files and timing.
- Expected 4xx thrown by `rpcFail` (`cloud/http.js:123`) are reported as unhandled errors, so real users with expired links or bad emails create issues too.

## Blind spots

Desktop and web have only synthetic verification events: no render/screenshot, size-limit, IPC or agent errors, no web vitals, spans or replays. Desktop reporting is opt-in (`desktop/main.cjs:76`) and untrusted renderers are filtered (`desktop/telemetry.cjs:130`, `:141`), so the screenshot failures never reached Sentry.

## Recommendations

1. Stop test runs from using the production DSN.
2. Do not report expected 4xx from `rpcFail`.
3. Reduce DO memory per batch (see `sol-errors-limits.md`).
4. Make desktop telemetry opt-out or ask at first launch, and add web vitals.
