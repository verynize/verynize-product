# Sentry audit, round 2 (Sonnet, 2026-11-08)

Re-run and deepened. This replaces the reconstructed summary of the first round.

- **Scope check.** `whoami` returned org `adamabdrrahman` (US region); projects `verynize-desktop`, `verynize-server`, `verynize-web`.
- **Data window.** Everything is from 2026-11-06 onward; all times below are **UTC**.
- **Read-only.** No commit, push, deploy or Sentry state change. No issue was resolved, ignored, assigned or commented. This file is the only repo change (uncommitted).
- **Labels.** **[V]** verified directly (Sentry data, code read, or an experiment I ran). **[S]** suspected: consistent with evidence but not proven.
- **Privacy.** No emails, IPs, tokens or DSN values are in this report. Env variables are named only. Where a loopback host appears in Sentry I say "loopback host".

## 0. What changed versus the first summary

| First-round claim                                         | Verdict                       | Detail                                                                                                                                                                                                                                                                                                                  |
| --------------------------------------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 14 of 17 unresolved server issues are test noise          | **Corrected: 15 of 17**       | SERVER-6 ("Upload changed in transit") is also a test: `tests/cloud-apps.mjs:222-231` sends a tampered upload on purpose and asserts the 409 [V]. Only SERVER-4 and SERVER-5 are real.                                                                                                                                  |
| SERVER-6 "may be a real upload race"                      | **Refuted** [V]               | Same code site as the test (`cloud/apps.js:207-210`), release = the local HEAD, no request context, first/last seen inside two test-run bursts (§4).                                                                                                                                                                    |
| 4xx from `rpcFail` are reported by `reportError`          | **Corrected**                 | `cloud/telemetry.js:9` already drops `errorStatus < 500`, and `cloud/worker.js:964` only reports `>= 500`. The 4xx come from **Sentry's Durable Object wrapper** (`instrumentDurableObjectWithSentry`, `web-start/src/server.cloudflare.ts:30-33`), mechanism `auto.faas.cloudflare.durable_object`, `handled: no` [V]. |
| Test runs reach production Sentry (mechanism unknown)     | **Mechanism found** [V]       | A plain `vp build` (what `run-tests.mjs` and the cloud harness run) loads the git-ignored `.env` and bakes the production server DSN into the Worker bundle. Reproduced; see §4.                                                                                                                                        |
| "Reduce DO memory (a ~21 MiB batch copied several times)" | **Quantified** [V]            | Measured with the real `web/cloud-ops.js`: a 4,900-node batch needs ~96 MB heap at 2 KB/node and ~128 MB (+21 MB external) at 4 KB/node. Copy points are listed in §3.4.                                                                                                                                                |
| Desktop and web have no vitals/spans                      | **Corrected**                 | The pipeline already emits LCP/pageload spans (`ui.webvital.lcp` exists in the one synthetic desktop trace). The gap is consent and volume, plus no custom spans, no LoAF, no process-gone events (§5).                                                                                                                 |
| 14 server issues = test noise by timing                   | **Now proven by request URL** | VERYNIZE-SERVER-M has a loopback-host request URL with an ephemeral port, release = HEAD (§4).                                                                                                                                                                                                                          |

**New since the first round:** no new issue. Last event at 12:19:32Z; SERVER-4/-5 counts are unchanged (11/20). One new **release record** appeared during the audit, `2630c30…` (created 15:31:13Z, no events). It is the current HEAD and matches the mtime of the pre-existing local `.cloudflare/output` build, so it was created by a local build, not by a deploy (§4.3).

## 1. Inventory (all issues, 23 total)

Event totals: 78 accepted, 0 dropped client- or server-side (`find_dropped_events`, errors, 14 d). Per day: 11-06 = 6, 11-07 = 48, 11-08 = 24. Of the 78: 49 production, 23 test runs (11-08), 6 synthetic verification (11-06).

### 1.1 Real production (verynize-server)

| Short ID              | Title                                                             | Status                  | Events | First → last seen               | Release(s)                | Top in-app frame                                                                                                                                       | Root cause                                                                                          |
| --------------------- | ----------------------------------------------------------------- | ----------------------- | ------ | ------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| **VERYNIZE-SERVER-5** | Durable Object's isolate exceeded its memory limit and was reset. | unresolved (escalating) | 20     | 11-07 06:40:10 → 11-08 02:06:29 | d78d899 (19), c958b52 (1) | none: platform reset, no stack. Reported by `cloud/worker.js:964-966` (`reportError(error, "worker")`), tags `area=worker`, `mechanism=verynize.cloud` | DO isolate memory > limit during a batch apply (§3). Routes: `/socket` 14, `/ops` 4, `/:id` 2.      |
| **VERYNIZE-SERVER-4** | Durable Object is overloaded. Requests queued for too long.       | unresolved (escalating) | 11     | 11-07 06:39:40 → 11-07 17:16:24 | d78d899 (5), c958b52 (6)  | none (same path as -5)                                                                                                                                 | DO blocked by long synchronous turns; requests queue (§3). Routes: `/ops` 9, `/socket` 1, `/:id` 1. |

### 1.2 Real production, resolved

| Short ID          | Title                                                     | Events | First → last        | Release | Top frame / cause                                                                                                                                  | Fix                                                                                                                                                                      |
| ----------------- | --------------------------------------------------------- | ------ | ------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| VERYNIZE-SERVER-3 | Durable Object exceeded its CPU time limit and was reset. | 6      | 11-07 01:41 → 01:51 | 63f28d4 | Platform reset on `/api/rooms/:id` at the old 30 s CPU limit                                                                                       | `limits.cpuMs: 300000` in `cloudflare.config.ts` (PR #38, deployed 11-07 06:35). CPU resets stopped; memory resets began 5 min later (§3).                               |
| VERYNIZE-SERVER-2 | APIError: Session is not fresh                            | 12     | 11-07 01:26 → 01:58 | 63f28d4 | Better Auth `SESSION_NOT_FRESH` on `/api/me`, reported as an error (inferred from the fix commit's title and the handler at `cloud/worker.js:258`) | `b48498c` "Fix aged-session account reads and classify server errors" (11-07 09:25 +07 = 02:25Z, after the last event); `cloud/worker.js:258` and `cloud/telemetry.js:9` |

### 1.3 Synthetic verification and local dev (resolved or still open, no user impact)

| Short ID           | Title                                                          | Status     | Events | First → last              | Release                 | Note                                                                                                   |
| ------------------ | -------------------------------------------------------------- | ---------- | ------ | ------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------ |
| VERYNIZE-SERVER-1  | Failed query … `migration_state`                               | resolved   | 2      | 11-06 15:26:04 → 15:28:03 | 87776b2                 | `no such table: migration_state` in local/verification runs. Fixed by `scripts/local-d1.mjs` (PR #36). |
| VERYNIZE-WEB-1     | Verification web vrf-web-…                                     | unresolved | 2      | 11-06 15:26:03 → 15:28:03 | 87776b2                 | Deliberate verification event. **This is the only event verynize-web has ever received.**              |
| VERYNIZE-DESKTOP-1 | Verification main vrf-desktop-1                                | unresolved | 1      | 11-06 15:24:25            | verynize-desktop@0.18.0 | Deliberate.                                                                                            |
| VERYNIZE-DESKTOP-2 | Verification renderer vrf-desktop-1 (email, path placeholders) | unresolved | 1      | 11-06 15:24:25            | verynize-desktop@0.18.0 | Deliberate. Its title shows the scrubber working: `<email>`, `/Users/<user>/x`.                        |

### 1.4 Test-run noise (verynize-server, all unresolved, all release a63a0e9)

Burst 1 is 10:38:24–10:39:36 (one suite run, 72 s). Burst 2 is 12:17:43–12:19:32 (a second, partial run). All reported through the DO wrapper (`handled: no`, frames `wrapMethodWithSentry.js`, `durableobject.js`) unless noted. Test mapping is by message source; "(asserts status)" means the test checks the status code, not the text.

| Short ID | Title                                                    | Events (last seen) | Thrown at                                                                                               | Exercised by                                                                                                                                                       |
| -------- | -------------------------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| SERVER-6 | [409] Upload changed in transit: index.html              | 2 (12:17:43)       | `cloud/apps.js:210` (`PublishedApp.finalize`)                                                           | `tests/cloud-apps.mjs:222-231` [V]                                                                                                                                 |
| SERVER-M | D1_ERROR: test chunk failure … SQLITE_CONSTRAINT_TRIGGER | 1 (10:39:36)       | `cloud/account-state.js:115` (`db.batch`), caught by `cloud/worker.js:944` → `reportError` (status 500) | `tests/cloud-account-state.mjs:84` installs trigger `reject_test_chunk` [V]; request URL is a loopback host with an ephemeral port, `PUT /api/me/state/chat:large` |
| SERVER-J | [404] No passkey is registered for that email            | 2 (12:19:32)       | `cloud/accounts.js:311`                                                                                 | `tests/cloud-passkeys-desktop.mjs` [V by message]                                                                                                                  |
| SERVER-8 | [400] Enter a valid email address                        | 3 (12:17:56)       | `cloud/accounts.js:19`                                                                                  | `tests/cloud-share.mjs` etc. [V by message]                                                                                                                        |
| SERVER-7 | [401] Sign-in link expired or already used               | 3 (12:17:56)       | `cloud/accounts.js:121`                                                                                 | cloud-accounts/passkey negative paths (asserts status)                                                                                                             |
| SERVER-9 | [401] Passkey request expired; try again                 | 2 (10:39:30)       | `cloud/accounts.js:238`                                                                                 | passkey tests (asserts status)                                                                                                                                     |
| SERVER-K | [401] This passkey setup link expired; start again…      | 1                  | `cloud/accounts.js:207`                                                                                 | passkey tests (asserts status)                                                                                                                                     |
| SERVER-H | [404] Sign-in request expired; start again               | 2                  | `cloud/accounts.js:182`                                                                                 | passkey tests (asserts status)                                                                                                                                     |
| SERVER-F | [404] Sign-in request expired; start again from Verynize | 1                  | `cloud/accounts.js:297,352`                                                                             | passkey tests (asserts status)                                                                                                                                     |
| SERVER-C | [401] Passkey user does not match                        | 1                  | `cloud/accounts.js:331`                                                                                 | passkey tests (asserts status)                                                                                                                                     |
| SERVER-G | [400] Passkey belongs to another site                    | 1                  | `cloud/webauthn.js`                                                                                     | `tests/cloud-passkeys.mjs`                                                                                                                                         |
| SERVER-E | [401] Passkey signature is invalid                       | 1                  | `cloud/webauthn.js`                                                                                     | `tests/cloud-passkeys.mjs`                                                                                                                                         |
| SERVER-D | [400] Unexpected ceremony type                           | 1                  | `cloud/webauthn.js`                                                                                     | `tests/cloud-passkeys.mjs` [V by message]                                                                                                                          |
| SERVER-B | [401] Passkey counter did not advance; … cloned          | 1                  | `cloud/webauthn.js`                                                                                     | `tests/cloud-passkeys.mjs` [V by message]                                                                                                                          |
| SERVER-A | [400] Origin mismatch                                    | 1                  | `cloud/webauthn.js`                                                                                     | `tests/cloud-passkeys.mjs` [V by message]                                                                                                                          |

Counts check: 23 events across these 15 issues, matching the 11-08 daily total minus the one SERVER-5 event.

## 2. How to read the evidence

- Platform resets (-4/-5) carry **no stack and no breadcrumbs** (`get_issue_breadcrumbs` returned `[]`), and **Sentry Logs is not enabled** (`search_logs`: no results, 14 d). All correlation below is from event timestamps, release records and sampled spans.
- Traces are sampled at **5 %** (`client_sample_rate: 0.05`). Slow spans I found are therefore a lower bound on how many occurred.
- Sentry's `search_traces` ignored the time windows I asked for (it returned the same top-by-duration list). I used the slowest-first list and the issue event lists, which together cover every burst.
- No payload sizes exist in Sentry: events have no bodies, and the scrubber drops them by design. Sizes in §3 are therefore **measured offline** with the real code, not read from production.

## 3. Deep dive: VERYNIZE-SERVER-4 / -5 / -6

### 3.1 Timeline [V]

All events of both issues, in order (11-07 unless noted). "Sock" = `GET …/socket`, "Ops" = `POST …/ops`, "Id" = `…/rooms/:id`.

| Window                  | Release live                                                    | Events                                                                                                                                         | What happened                                                                                                                     |
| ----------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| **B1** 06:39:35 → 07:53 | d78d899 (released 06:34:34, deploy finished 06:35:26)           | -4: 06:39:40 Sock; 07:49:38 Id; 07:53:00 Ops ×2. -5: 06:40:10 Ops; **14× Sock** 06:41:43 … 06:58:06; 07:48:22 Id; 07:50:01 Id; 07:51:30 Ops ×2 | First event 5 min after the deploy. 17-minute loop of resets on `/socket`, a quiet stretch, then a second cluster at 07:48-07:53. |
| **B2** 16:07 → 16:08    | d78d899 → c958b52 (released 16:07:14, deploy finished 16:08:15) | -4: 16:07:13 Ops (old release, 1 s before the release record); 16:08:42 Ops ×2, 16:08:43 Ops (new release)                                     | Overload brackets the deploy.                                                                                                     |
| **B3** 17:16            | c958b52 → 983f330 (released 17:16:10)                           | -4: 17:16:11, :19, :24 Ops (labelled c958b52, the outgoing version)                                                                            | Starts **1 s after** the next release record.                                                                                     |
| **B4** 11-08 02:06:29   | c958b52                                                         | -5: one Ops                                                                                                                                    | Isolated. Next deploy f4fa689 (11-08 08:20) saw no events.                                                                        |

Quiet gaps: 07:53 → 16:07 (8 h) and 17:16 → 02:06 next day. After 02:06:29 on 11-08 there are no more -4/-5 events, across two later deploys (f4fa689 at 08:20, a63a0e9 at 10:25).

**Event spacing in the 14-socket loop** (seconds): 93, 79, 132, 81, 56, 103, 56, 55, 89, 56, 111, 55, 52, 58. Client reconnect backoff is capped at 15 s (`web/cloud-panel.js:926`, `Math.min(15000, 500 * 2 ** …)`), so the cadence is **not** plain client retry. Unexplained; see §7.

### 3.2 What the sampled spans show [V]

Slowest spans in 14 d (sampled), all server-project `http.server`:

| Start          | Route                     | Duration                                     | Ends at (start + dur) | Matching event        |
| -------------- | ------------------------- | -------------------------------------------- | --------------------- | --------------------- |
| 11-07 07:51:07 | `POST /api/rooms/:id/ops` | **22.3 s**                                   | 07:51:29              | -5 at 07:51:30 (×2)   |
| 11-07 06:53:16 | `GET …/socket`            | **14.2 s**                                   | 06:53:30              | -5 at 06:53:30        |
| 11-07 06:39:35 | `POST …/assets` ×5        | 6.7 / 6.8 / 7.0 / 7.0 / 7.1 s (simultaneous) | ≈06:39:42             | -4 at 06:39:40 (Sock) |
| 11-07 06:55:17 | `GET …/socket`            | 4.3 s                                        | 06:55:21              | -5 at 06:55:21        |
| 11-08 10:35:48 | `POST …/assets` ×2        | 4.0 / 4.1 s                                  | n/a                   | none (test run, §4)   |

Findings:

1. **Every slow request ends in a reset** (three of three matched by timestamp arithmetic). The request waits seconds, then the platform resets the isolate and the Worker's catch-all reports the resulting error.
2. **The time is not in the database.** In the 22.3 s and 14.2 s traces the D1 spans total ≈10 ms each (`select user/session/profile`, `room member organization`). Nothing is instrumented around the Durable Object call, so ~99.9 % of the wall time sits in the DO.
3. **`POST …/assets` is registration only.** `createAsset` (`cloud/assets.js:296-318`) reads a JSON body of at most 16 KiB and does D1 work (≈54 ms avg in the trace); the bytes go to a separate `PUT` (`assets.js:322-347`). A 7 s wall time can therefore **not** be upload bandwidth. The call also awaits the room's `access()` through the DO (`stub.fetch` to `/access`). Five requests finishing inside the same ~0.35 s window means all five were **queued behind one long DO turn** that began before 06:39:35 [S, strongly supported]. The 06:39:40 overload event falls inside that window.
4. The first memory reset (06:40:10) comes 35 s after the five blocked requests. This matches a large import: the desktop registers assets, then streams ops batches.
5. **Deploys line up with B2 and B3** (events within 1-90 s of a release record). A redeploy drops every socket; all clients reconnect and send `sync` at once (`cloud/rooms.js:1147-1176`). Whether that is cause or coincidence is [S]; B1 started 5 min after a deploy and B4 had no deploy nearby.

### 3.3 Verdict on SERVER-6 [V]

Test. See §0 and §1.4. No production event exists for it.

### 3.4 Where `DesignRoom` allocates memory

Request path for one batch (`cloud/rooms.js`): socket message at `:1128-1145` or HTTP `POST /ops` at `:892` → `applyBatch` `:303` → `ctx.storage.sync()` `:338` → `transactionSync(finish)` `:383` → `applyBatchNow` `:391` → `store.load` `:442` → `Ops.apply` `:443` → `store.commit` `:461` → `store.flush()` `:482` → `recordHistory` `:484` → `broadcast` `:221`.

The whole `applyBatchNow` is **one synchronous turn**: while it runs, nothing else on that DO runs, so `/socket` accepts and `/access` calls queue (that is what "Requests queued for too long", SERVER-4, means).

Copies of the data per batch, in order [V by code read]:

| #   | Where                                                          | What is allocated                                                                                                                                                                                                                                                |
| --- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `rooms.js:1130-1132`                                           | `byteSize(message)` = `TextEncoder.encode` of the whole message (`web/room-limits.js` `bytes()`), a full byte copy that is dropped; then `JSON.parse(message)`. The HTTP path (`cloud/http.js:83-87`) holds bytes + decoded string + parsed value.               |
| 2   | `room-store.js:74-79,166-168`                                  | `text()` does `toArray()` then `join("")` (every `parts` row, then one string), `JSON.parse`, and **keeps both texts** in `texts` for the unchanged-record compare in `commit`.                                                                                  |
| 3   | `web/cloud-ops.js:288`                                         | `let doc = clone(document)`; `clone = JSON.parse(JSON.stringify(value))` (`cloud-ops.js:30`). A full stringify+parse of every loaded page, on every batch.                                                                                                       |
| 4   | `web/cloud-ops.js:435,443`                                     | **Two more clones per added node** (`clone(op.value)` for the doc, another for the `applied` list).                                                                                                                                                              |
| 5   | `rooms.js:432-440`                                             | `screened.ops.map(op => ({...op, s}))`: a shallow copy of every op.                                                                                                                                                                                              |
| 6   | `rooms.js:231-266` + `cloud-ops.js` `record(path + "/" + key)` | The stamp cache: one entry per property of each added node. A SELECT miss on each (`stamps.get`) and an `INSERT OR REPLACE` on each at `flush()`. For 4,900 nodes the measured count is **73,500 entries**, i.e. ~147,000 SQL statements inside the single turn. |
| 7   | `room-store.js:231-233`                                        | `JSON.stringify(page.nodes)` (another full string) and `byteSize(nodes)` (another full byte copy). `writeText` then chunks into `parts` rows (`:81-85`).                                                                                                         |
| 8   | `rooms.js:484` → `room-history.js:158-182`                     | `recordHistory` snapshots before/after state per touched artboard. [S: not measured]                                                                                                                                                                             |
| 9   | `rooms.js:221-229`                                             | `broadcast`: one `JSON.stringify` but `socket.send` of up to ~20 MB to each of up to 32 sockets (`MAX_SOCKETS`, `:28`). Outgoing buffers are external memory. [S: not measured]                                                                                  |

Other whole-document paths: non-lazy `/socket` sends `this.snapshot()` = `store.read()` = every page (`rooms.js:92-94,867`); `GET /room` (`:878-879`); 409 conflict (`:274`); legacy `update` (`:277-287`) loads everything and snapshots again. Clients use `?lazy=1` (`web/cloud-panel.js:937`), so the whole-document path is mostly MCP/agents and legacy clients [S].

**Poison marker.** `applyBatch` writes `pending_batches` and `sync()`s before work (`:335-338`). If the isolate dies mid-batch, a retry of the same `client/batch` is rejected as "This batch interrupted room processing… retry a smaller import" with `retained: true` (`:353-368`). That stops an infinite crash loop on one batch, but the client keeps the edits locally while the server does not apply them: the divergence the README reports (server 4,903 nodes, desktop 3, both at revision 37).

### 3.5 Measured memory need [V, offline]

Script: `scratchpad/measure-batch.mjs` (not committed). It loads the **real** `web/document-core.js` and `web/cloud-ops.js` in Node 24, builds a synthetic page, and mirrors steps 1-4 and 7 above in memory (no SQLite). "Min heap" is the smallest `--max-old-space-size` that completes (steps of 16 MB, so ±16 MB). A Durable Object isolate is limited to ~128 MB total (heap + external).

| Scenario (existing nodes → batch nodes @ bytes/node) | Incoming message | Committed page | Stamp entries | Sampled peak heap      | Min heap that survives              |
| ---------------------------------------------------- | ---------------- | -------------- | ------------- | ---------------------- | ----------------------------------- |
| 0 → 4,900 @ 500 B                                    | 2.7 MB           | 2.3 MB         | 73,500        | 42 MB (+4.5 ext)       | n/a (fits)                          |
| 0 → 4,900 @ 2 KB                                     | 9.7 MB           | 9.3 MB         | 73,500        | 83 MB (+11.5 ext)      | **96 MB**                           |
| 0 → 4,900 @ 4 KB                                     | 19.1 MB          | 18.7 MB        | 73,500        | **148 MB** (+21 ext)   | **128 MB** (+21 ext ≈ 149 MB total) |
| 4,900 → 4,900 @ 2 KB                                 | 9.7 MB           | 18.7 MB        | 73,500        | **138 MB** (+20.5 ext) | not searched; exceeds 128           |
| 4,900 → 1,000 @ 2 KB                                 | 2.0 MB           | 11.2 MB        | 15,000        | 76 MB (+13 ext)        | **80 MB**                           |

Reading: one 19 MiB batch (within the 21 MiB `MESSAGE_BYTES` and 5,000-op caps) needs more memory than the isolate has. Even 1,000 nodes into an already-large page uses 80 MB before SQLite buffers, the stamp cache growth, history and workerd's own overhead. Strings here are one-byte; text with non-Latin-1 characters (CJK, emoji) is two-byte, so real documents cost up to twice as much. Caveat: Node's V8 differs from workerd's accounting, and the synthetic nodes are plain, so treat the numbers as a ratio (**peak ≈ 5-7× message size**, scaling with the stored page size too), not an exact limit.

### 3.6 What to change (file level), ranked

1. **Cap work per batch by bytes and statements, not only op count.** `web/room-limits.js:19-37` (`batchOps`: 4000 ops, `MESSAGE_BYTES - 65536`) and `cloud/rooms.js:309` (`ops.length > 5000`). Chunk at ≈500 ops and ≤1 MiB, and have the server answer `413` with a stable code for a batch over a byte or stamp budget (the client already handles `tooLarge`/`retained`). Cuts batch cost ~5-10×. [V that the cost scales; S on the exact numbers]
2. **Stop cloning the whole document per batch.** `web/cloud-ops.js:288` should clone only pages in `touched.pages` (the others are already `nodes: []` stubs); `:435/:443` clone each added node once. Saves 2-3 full-page copies. [V]
3. **Stop allocating to measure.** Replace `TextEncoder.encode(x).length` in `web/room-limits.js` `bytes()` and `room-store.js:208,233` with an allocation-free UTF-8 length. Saves one page-sized buffer per call, several calls per batch. [V]
4. **Stamps for new ids.** In `cloud/rooms.js:231-266` / `cloud-ops.js` `record`, a node that did not exist before the batch has no prior stamps: skip the per-path `SELECT`, and write stamps per node, not per property path. Removes most of the ~147,000 statements. [S on the time share; V on the count]
5. **Per-row node storage** (README Phase 2) is the structural fix: `text()` + `JSON.parse` of a whole page cannot scale past ~10 MB.
6. **Make the DO observable** (§5.5): sample 100 % of `/ops` and `/socket` DO spans with `performance.*` size attributes, so the next burst names its batch.

## 4. Test noise: how the production DSN reaches test runs

### 4.1 Mechanism [V by experiment]

1. `.env` at the repo root (git-ignored, `.gitignore:9`) defines `SENTRY_DSN_SERVER`, `SENTRY_DSN_WEB`, `SENTRY_DSN_DESKTOP` and `SENTRY_AUTH_TOKEN` (names and non-empty status checked; values never read into this report). A second git-ignored file, `.dev.vars`, defines the same four names.
2. No SENTRY variable is exported in my shell, in a login zsh, or in launchd. So tests do **not** inherit it from the environment.
3. `scripts/run-tests.mjs:601-626` builds the Worker with `vp build` and `env = {...process.env}`; the cloud harness does the same when no bundle is passed (`tests/cloud-harness.mjs:35-45`). Neither uses `scripts/env.mjs`. `web-start/build/telemetry.mjs:71-88` reads `process.env.SENTRY_DSN_SERVER` in the plugin's `config` hook and defines `__VERYNIZE_SENTRY_SERVER__`.
4. **`vp build` populates `process.env` from `.env` itself.** Experiment, in a scratch copy of the repo with `.env` present and nothing exported:
   - My first probe printed `process.env` inside a bare config: `undefined`. That was misleading. The real config is **evaluated three times**; debug prints showed `SENTRY_DSN_SERVER in process.env` = false, then true, then true.
   - A plain `vp build` of the copy produced a Worker bundle containing **one DSN literal whose project id is verynize-server's** (`4512385397424128`).
   - `webTelemetry(env = { ...process.env })` (snapshot at config load) did **not** help (still baked), and `envDir: false` did **not** help (still baked). The loader is the `vp` front-end, not Vite's `loadEnv`.
5. Worker `env` for the test harness (`tests/cloud-harness.mjs:113-170`) does not pass a DSN, so the baked define is the only path; `serverOptions` (`web-start/src/server-telemetry.ts:21-33`) uses `vars.SENTRY_DSN_SERVER || build.dsn`.
6. Release is `git rev-parse HEAD` (`telemetry.mjs:21-35`), so test events carry the **same release as the production deploy** of that commit (a63a0e9 was deployed 10:25:20, tests ran 10:35-12:19). That is why they pollute the production release's health.
7. SERVER-M's request URL is a loopback host with an ephemeral port: it ran in Miniflare on the dev machine, and geo is the developer's country (ID) rather than the Cloudflare-side US of real DO events.

Desktop tests are **not** affected: `desktop/telemetry.cjs:71-72,98` (`automatedRun`) refuses any non-loopback DSN when `VERYNIZE_SKIP_ONBOARDING`, `VERYNIZE_BLOCK_PRODUCTION_CLOUD` or `CI` is set. The Worker has no equivalent guard.

### 4.2 The exact fix [V for DSN baking, tested both directions in a scratch copy; upload gate untested]

Gate **baking** on an explicit release-build flag that only `scripts/env.mjs` sets, so any build that merely finds `.env` through `vp` stays inert.

`web-start/build/telemetry.mjs`

```diff
 function settings(dsn, env, environment) {
   return {
-    dsn: dsn || "",
+    dsn: env.VERYNIZE_RELEASE_BUILD === "1" ? dsn || "" : "",
 ...
 export function webTelemetry(env = process.env) {
-  const upload = !!env.SENTRY_AUTH_TOKEN;
+  const upload = env.VERYNIZE_RELEASE_BUILD === "1" && !!env.SENTRY_AUTH_TOKEN;
 ...
 export function sourceMapUpload({ projects, release, deleteGlobs }) {
-  const authToken = process.env.SENTRY_AUTH_TOKEN;
-  if (!authToken) return [];
+  const authToken = process.env.VERYNIZE_RELEASE_BUILD === "1" && process.env.SENTRY_AUTH_TOKEN;
+  if (!authToken) return [];
```

`scripts/env.mjs` (line with `spawnSync`): `env: { ...loaded, ...process.env, VERYNIZE_RELEASE_BUILD: "1" }`.

Experiment results (the DSN gate in `settings()` only; I did not run the upload gate, which is the same one-line condition):

- plain `vp build`, `.env` present, flag unset: **0 DSN literals** in the Worker bundle.
- `VERYNIZE_RELEASE_BUILD=1 vp build` (what `env.mjs` would set): the server DSN is baked as before.

Things the fix touches:

- `npm run build`, `deploy`, `deploy:check`, `package:mac` all go through `env.mjs` already, so release builds are unchanged.
- No SENTRY reference exists in `.github/workflows/*` or `scripts/vercel-build.mjs` (grep), so CI/Vercel builds were never baking a DSN and are unaffected. If you later bake in CI, set the flag there.
- `tests/env-build.mjs` stays green (it calls `npm run build`, i.e. `env.mjs`). Add a pure-function test for `webTelemetry({SENTRY_DSN_SERVER: "x"})` with and without the flag.
- Update `docs/telemetry.md` (Configuration) and the `.env.example` header: "tests and plain `vp build` never bake or upload; only `npm run build/deploy/package:mac` do".

**Belt and braces** [S, not run]: even with the build fixed, `vp dev` (Cloudflare plugin) hands `.dev.vars` to the local Worker as bindings, so `env.SENTRY_DSN_SERVER` arrives at runtime and `serverOptions` would use it. Add to `serverOptions` (`server-telemetry.ts:21`) `if (vars.EMAIL_PROVIDER === "outbox") return { enabled: false }` (the test harness binds `outbox`, `tests/cloud-harness.mjs`; production binds `cloudflare`, `cloudflare.config.ts:53`), and drop events whose `request.url` host is loopback in `scrubEvent`. Optionally enable Sentry's "Filter localhost events" inbound filter on verynize-server (owner action; a project setting).

### 4.3 Second leak: releases and source maps [V for the releases, S for upload]

The same loader also supplies `SENTRY_AUTH_TOKEN`, so `upload` is true in test builds and the build uploads hidden source maps and registers a release named after local HEAD. The release list shows records with no deploy and no events from builds: `87776b2` (11-06 verification), `ab6c26c` (11-06 15:50, never released), and `2630c30` (11-08 15:31:13Z, created by the local build whose output is in `.cloudflare/output`). The flag fix in §4.2 closes this too.

**Disclosure about my own probes.** To test the fix I built a scratch copy of the repo (copied `.env`, `.dev.vars`, no `.git`, no tests/docs) with plain `vp build` several times. Because the copied `.env` held the auth token, those builds may have uploaded debug-id source-map bundles to verynize-web / verynize-server. I could not read Sentry's artifact bundle list with the available tools. No new release record appeared after my probes (`find_releases` at 15:44Z shows nothing newer than `2630c30`, which predates them: it matches the mtime of the pre-existing `.cloudflare/output`). Releases need a name and my copy had no git, so I expect none were created. The scratch copy (with its `.env`) has been deleted. If you want to be sure, check Source Maps / Artifact Bundles for verynize-web and verynize-server around 15:35-15:45Z.

### 4.4 Expected 4xx: where they are reported and how to filter [V]

- **Throw site:** `rpcFail` (`cloud/http.js:121-124`) throws `new Error("[status] message")` because DO RPC loses custom error fields.
- **Report site:** the DO is wrapped by `instrument(...)` in `web-start/src/server.cloudflare.ts:30-33` (`AccountDirectory`, `PublishedApp`, `AiRun`, `DesignRoom`). `wrapMethodWithSentry` captures **any exception leaving a DO RPC method**, before the Worker's `rpc()` converts it back (`http.js:125-132`). Stack in every event: `durableobject.js:143`, `wrapMethodWithSentry.js:161`, then `cloud/apps.js:210` or `cloud/accounts.js:…`.
- **Why `reportError` is not the culprit:** it already skips `< 500` (`cloud/telemetry.js:9`), and the Worker catch reports `>= 500` only (`cloud/worker.js:964-966`). `DesignRoom.fetch` catches its own errors (`rooms.js:1083`) so it does not leak 4xx.
- **Filter once, for every runtime.** All servers pass events through `scrub.scrubEvent` (`web/telemetry-scrub.js`): the Worker through `privacyOptions().beforeSend`, Node/Vercel through `server/telemetry.mjs`'s `beforeSend`. In `scrubEvent`, return `null` when the first exception value matches `^\[[1-4]\d\d\] ` (also `^Error: \[…`). Add the case to `tests/telemetry-scrub.cjs`. `ignoreErrors` in `serverOptions` would only cover the Worker.
- Real users would produce the same issues (expired links, bad emails): today they are indistinguishable from test noise except by release/loopback, which is why the filter matters beyond tests.
- Cleanup of the existing 15 test issues (and the 3 synthetic ones) is a Sentry state change I did not make; ask the owner to bulk-resolve/ignore after the fix ships.

## 5. Coverage gaps: why desktop/web are blind, and a plan

### 5.1 Why there is no real desktop or web signal [V]

- **Opt-in, default off, hidden.** `desktop/main.cjs:76-78` calls `telemetry.start`; `desktop/telemetry.cjs` `start()` (`:206-213`) reads `userData/telemetry.json`, and with no file or `enabled !== true` returns before `initSdk`. The only UI is Settings › Preferences › Privacy (`web/src/islands/settings/telemetry.tsx`); the onboarding island has no crash-report step. Web is the same via `localStorage["verynize:telemetry"]` (`web-start/src/telemetry.ts:25`). Result: **verynize-desktop has one real trace and two synthetic events total; verynize-web has two synthetic events and zero spans.**
- **Untrusted-window filter.** `desktop/telemetry.cjs:141-143` (`getRendererName`) names any webContents whose URL is not `app://verynize` as `untrusted`, and `:130` (`keep`) drops events tagged `event.process: untrusted`. The render, PDF, preview and capture windows all use their own partitions and load non-app URLs (`desktop/render.cjs:187,350`, `desktop/preview.cjs:125,339`, `desktop/capture-remote.cjs:38-46`). A `render-process-gone` from one of them is therefore dropped by design. **These are exactly the windows behind the screenshot failures.**
- **SDK defaults under-report process loss.** `@sentry/electron` 8.3.0 `ChildProcess` integration reports events only for `abnormal-exit`, `launch-failed`, `integrity-failure` (`node_modules/@sentry/electron/main/integrations/child-process.js:8-9`). `crashed`, `oom` and `killed` become **breadcrumbs, not events**. Minidumps cover native crashes only if consent was on at launch.
- **No app-level reporting.** `reportError` in `desktop/telemetry.cjs:163-170` has zero callers outside its file. The IPC wrapper `handle()` (`desktop/main.cjs:207-211`) reports nothing. `desktop/render.cjs` swallows errors in several catches (`:318,330,335,474`). A failed screenshot returns a string to the renderer and never reaches Sentry.
- **No grep hits** for `render-process-gone`, `child-process-gone`, `unresponsive` in `desktop/*.cjs`.
- **Vitals pipeline works but is shallow.** Renderer `browserTracingIntegration()` (`web/src/telemetry.ts:30-38`) produced `pageload`, `browser.request` and `ui.webvital.lcp` in the one synthetic trace. Defaults in SDK 11: long tasks on, **long animation frames off** (`enableLongAnimationFrame` default false), INP/web vitals via the `webVitals` option. All attach to the pageload/navigation idle span, which ends at `finalTimeout` (30 s default). In an editor session that lasts hours, **nothing after the first 30 s is recorded**, and `tracesSampleRate` is 5 %.
- **No custom spans anywhere.** No `startSpan`/`PerformanceObserver` in `web/`, `web-start/`, `desktop/`. The scrubber (`web/telemetry-scrub.js:365-366`) already admits `performance.*`, `ui.*`, `electron.*`, `lcp|cls|inp|fcp|ttfb|frames|browser.web_vital.*` span attributes, so custom spans need only use those prefixes.

### 5.2 Plan A: make it collectable (consent)

- Product decision, with a technical minimum: in `desktop/telemetry.cjs` `readConsent`, honour an operator default (`telemetry-build.json` `defaultConsent: true`, or env `VERYNIZE_TELEMETRY=on`) so the owner's own dev app reports without a UI trip; add a first-run step in `web/src/islands/onboarding.tsx` for everyone else. Keep "off by default" semantics for packaged public builds if that is the intent, but then say so in the privacy copy (`docs/telemetry.md`).
- Web: document `localStorage["verynize:telemetry"]="on"` for the owner, and surface the toggle where Files/Home users see it.

### 5.3 Plan B: process loss as events (desktop)

In `initSdk` (`desktop/telemetry.cjs:~128-156`):

1. Replace the default `ChildProcess` integration with one configured to emit what matters:
   `Sentry.childProcessIntegration({ events: ["abnormal-exit","launch-failed","integrity-failure","crashed","oom","killed"] })` (remove `ChildProcess` in the `integrations` filter, then add this).
2. Stop mislabeling our own helper windows as untrusted. Add `telemetry.markInternal(webContents, label)` (a `WeakSet` + label map) and call it where windows are created (`render.cjs:187,350`, `preview.cjs:125,339`, `capture-remote.cjs:38-46`). `getRendererName` returns the label (`render`, `pdf`, `preview`, `capture`) for those; unknown contents stay `untrusted` and keep being dropped. `keep()` then lets internal windows through.
3. Add a small main-side handler for context (`app.on("render-process-gone")`): before the SDK event, `Sentry.setContext("electron", { process: label, reason, exitCode, uptime_s, windows: n, private_mb: … })` from `app.getAppMetrics()`. Contexts allow primitive fields of `electron` only (scrubber contract), so keep them flat and numeric.
4. `webContents.on("unresponsive")` / `"responsive"` on the editor window: capture a warning with the duration. Chromium's hang detector needs about 5 s, so this catches freezes, not 100-300 ms stutter (that is §5.4).
5. Report **handled** failures: wrap `handle()` in `main.cjs:207` (or the specific `render.cjs` failure sites) with `telemetry.reportError(err, { mechanism: "ipc" })` for unexpected failures, tagged by channel. Exclude validation errors by throwing a typed error (e.g. `err.expected = true`) so user-facing limits do not become issues.
6. Test: `tests/telemetry-desktop.cjs` already runs a loopback ingest server; add (a) a render window kill (`webContents.forcefullyCrashRenderer()`) and assert one scrubbed `process.render-process-gone` event with `electron.process=render`, and (b) the untrusted foreign page is still dropped.

### 5.4 Plan C: stutter measurable (renderer)

1. **Collection.** In `web/src/telemetry.ts` (desktop) and `web-start/src/telemetry.ts` (web): `browserTracingIntegration({ enableLongAnimationFrame: true })`, and use a `tracesSampler` that returns 1.0 for spans named `canvas.*` when `performance.nodes > 1000` and 0.05 otherwise (the same sampler on web).
2. **Expose a tiny API** to the legacy vanilla scripts via the existing runtime (`web/src/lib/telemetry/runtime.ts`): `window.verynizeTelemetry = { span(name, attrs, fn), mark(name, attrs) }`, a no-op when reporting is off.
3. **Spans, with allowlisted attribute names:**

   | Span            | Hook point                                                                                         | Attributes (all numbers)                                                              |
   | --------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
   | `canvas.select` | `web/canvas-interactions.js:1032` `select(ids)` and `:2959` `selectAll()`                          | `performance.selection.count`, `performance.doc.nodes`                                |
   | `canvas.render` | `web/app.js:276` `render()` (whole body)                                                           | `performance.doc.nodes`, `performance.render.visible`                                 |
   | `canvas.commit` | `web/app.js:504-509`: the `save()` plus `subscribers` loop with `structuredClone(design)` for each | `performance.subscribers`, `performance.doc.nodes`, `performance.doc.bytes` (approx.) |
   | `canvas.update` | `web/app.js:1202` `updateNodes(ids, patch)`                                                        | `performance.nodes.changed`                                                           |
   | `files.write`   | the file library's localStorage write (per README finding)                                         | `performance.bytes`                                                                   |

   These cover the costs the perf audit measured by hand (select all 6.3 s at 5K, edit 176 ms at 4.9K, per-subscriber `structuredClone`). Span names are scrubbed (id-like segments become `:id`); keep them constant.

4. **Long frames as a safety net:** with LoAF on, frames over 100 ms attach to the active span. For hours-long sessions add a `PerformanceObserver("long-animation-frame")` that opens a short span (`ui.loaf`) with `performance.loaf.duration`, `performance.loaf.blocking`, capped at N per minute, because the pageload span is closed after 30 s.
5. **Dashboards:** p75/p95 of `canvas.select` and `canvas.commit` by `performance.doc.nodes` bucket gives the stutter-versus-size curve; alert when p95 `canvas.commit` > 100 ms at ≤ 1K nodes.

### 5.5 Plan D: server spans for the DO

- `serverOptions` (`web-start/src/server-telemetry.ts:21`): add a `tracesSampler` that returns 1.0 for `/ops` and `/socket` DO requests (low volume, the failure-prone paths) and 0.05 otherwise.
- In `cloud/rooms.js` wrap the stages of `applyBatchNow` (`load`, `apply`, `commit`, `history`) with `Sentry.startSpan` and set `performance.batch.ops`, `performance.batch.bytes`, `performance.page.bytes`, `performance.stamps`, so the next 22-second turn is visible and tells you the batch that caused it.
- A pre-check that rejects (413) when `estimated peak ≈ 6.5 × message + 4 × stored page` exceeds ~60 MB turns the measurement in §3.5 into a guard instead of an alarm.

## 6. Ranked, file-level action list

### Verified (do these)

| #   | Action                                                                                   | Files                                                                                                                                                                                                         | Why / evidence                                              |
| --- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| 1   | Gate DSN baking and source-map upload on `VERYNIZE_RELEASE_BUILD`, set only by `env.mjs` | `web-start/build/telemetry.mjs` (`settings`, `webTelemetry`, `sourceMapUpload`), `scripts/env.mjs`, `tests/env-build.mjs` (+ a pure test), `docs/telemetry.md`, `.env.example`                                | §4.1-4.3: proven leak; fix tested both ways                 |
| 2   | Drop expected 4xx in the shared scrubber                                                 | `web/telemetry-scrub.js` `scrubEvent`, `tests/telemetry-scrub.cjs`                                                                                                                                            | §4.4: DO wrapper path, all runtimes                         |
| 3   | Resolve/ignore the 15 test issues + 3 synthetic ones **after** 1-2 ship                  | Sentry (owner action; not done)                                                                                                                                                                               | §1.3-1.4                                                    |
| 4   | Smaller batches: ≤ ~500 ops / ≤ 1 MiB, server `413` with a code over a budget            | `web/room-limits.js:19-37`, `cloud/rooms.js:309`                                                                                                                                                              | §3.5: 1,000-node batch is ~80 MB, 4,900 exceeds the isolate |
| 5   | Stop cloning the whole doc per batch; clone added nodes once                             | `web/cloud-ops.js:288,435,443`                                                                                                                                                                                | §3.4 #3-4                                                   |
| 6   | Allocation-free UTF-8 length                                                             | `web/room-limits.js` `bytes()`, `cloud/room-store.js:208,233`, `cloud/rooms.js:1130`                                                                                                                          | §3.4 #1,#7                                                  |
| 7   | Process-loss events and trusted internal windows                                         | `desktop/telemetry.cjs:130,141-150` (`keep`, `getRendererName`, integrations), `desktop/render.cjs:187,350`, `desktop/preview.cjs:125,339`, `desktop/capture-remote.cjs:38-46`, `tests/telemetry-desktop.cjs` | §5.1: events are dropped today                              |
| 8   | Report unexpected IPC failures                                                           | `desktop/main.cjs:207-211` (`handle`) or the `render.cjs` failure sites                                                                                                                                       | §5.1: `reportError` has no callers                          |

### Suspected (investigate or do after measuring)

| #   | Action                                                                                                   | Files                                                                                                                                                           | Status                                                                                             |
| --- | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| 9   | Skip per-path stamp SELECTs for new ids; stamp per node                                                  | `cloud/rooms.js:231-266`, `web/cloud-ops.js` `record`                                                                                                           | [S] ~147K statements per 4,900-node batch is counted [V]; its share of the 14-22 s is not measured |
| 10  | Worker runtime guard against `.dev.vars` and test bindings                                               | `web-start/src/server-telemetry.ts:21` (`EMAIL_PROVIDER === "outbox"`), loopback drop in `scrubEvent`                                                           | [S] not run                                                                                        |
| 11  | Deploy-time reconnect storm as a driver of B2/B3                                                         | `cloud/rooms.js:1147-1176`, `web/cloud-panel.js:926,937`                                                                                                        | [S] coincidence in time only                                                                       |
| 12  | Consent default and first-run step                                                                       | `desktop/telemetry.cjs` `readConsent`, `web/src/islands/onboarding.tsx`                                                                                         | Product decision                                                                                   |
| 13  | Renderer spans, LoAF, sampler                                                                            | `web/src/telemetry.ts`, `web-start/src/telemetry.ts`, `web/src/lib/telemetry/runtime.ts`, `web/app.js:276,504-509,1202`, `web/canvas-interactions.js:1032,2959` | Plan §5.4                                                                                          |
| 14  | DO spans and a 413 pre-check from the memory formula                                                     | `web-start/src/server-telemetry.ts`, `cloud/rooms.js` stages                                                                                                    | Plan §5.5                                                                                          |
| 15  | Sentry-side: localhost inbound filter, alert on SERVER-4/-5 > 0 per 15 min, dashboard on `performance.*` | Sentry (owner)                                                                                                                                                  | Recommendation                                                                                     |
| 16  | Per-row node storage (structural DO fix)                                                                 | `cloud/room-store.js`                                                                                                                                           | README Phase 2                                                                                     |

## 7. Open questions

1. **What drives the 52-132 s cadence of the 14 socket resets on 11-07 06:41-06:58?** Client backoff caps at 15 s (`web/cloud-panel.js:926`). Candidates [S]: an alarm retry (`rooms.js:543-563` loads pages for history), a cold start per reset, or server-side retry backoff. Needs a DO-level log or span (§5.5).
2. **Which batch?** No payload attributes exist; the 22.3 s `/ops` at 07:51:07 and the five 7 s asset registrations are the best anchors for correlating with R2/D1 rows by room.
3. **Is the deploy coincidence (B2/B3) causal?** Needs the rollout order vs the first reset in B3; the old version emitted the events 1-14 s after the new release record.
4. **Why quiet 07:53 → 16:07?** Possibly nobody working, possibly the poison markers holding retries; not distinguishable with current data.
5. **Source-map upload from probes:** see §4.3; confirm in Sentry's artifact bundle list.

## 8. Method notes

- Sentry: `whoami`, `search_issues` (unresolved/resolved/ignored), `get_issue_details`, `search_issue_events`, `get_issue_breadcrumbs`, `get_issue_tag_values`, `find_releases`, `search_traces`, `get_trace_details`, `search_errors`, `search_logs`, `find_dropped_events`. Nothing mutating was called.
- Code: read-only, plus two scratch artefacts under the session scratchpad: `measure-batch.mjs` (memory measurement) and probe builds in a copy of the repo (since deleted; only `measure-batch.mjs`, `dsncheck.cjs` and two small debug files remain there).
- Debug prints in the scratch copy were the only way to show that `process.env` is populated between config evaluations; no change was made in the real repo.
