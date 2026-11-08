# Wonder Weekly AI layers — research report

Investigated 2026-10-30. Installed and extracted desktop versions both verified as **0.2.190**. During the investigation, no application, profile, or repository files were modified; no GUI interaction or canvas mutation was performed. Public assets and this report were saved only in a temporary local folder. Target JavaScript was read as data, never executed.

**Main result:** The quota is workspace-scoped, server-reported, and enforced by remote MCP refusals. The UI data flow and Free/Pro limits are confirmed. The exact server-side increment algorithm is **not recovered**; calling an operation “layer-related” or observing it blocked does not prove it consumes a layer.

## A. What counts

- **Confirmed — official terminology:** Free advertises **“3,000 AI-generated layers / week”**; Pro advertises **“Unlimited AI-generated layers”**. Source: https://wonder.design/pricing (raw HTML snapshot `pricing.html`; Jina's text extraction omitted these plan cards).
- **Confirmed — authoritative UI source:** The usage popover reads a billing response's `layers` object; it does not count nodes in the currently open canvas or count local tool calls. See B.
- **Confirmed — remote enforcement:** Saved MCP results contain `payment_required` / `layer_allowance`, scoped by `organizationId`. See D.
- **Inferred:** A layer denotes an AI-created canvas node, rather than a prompt/token/tool-call unit; manual creation should be outside an “AI-generated” allowance. These semantic interpretations are not a recovered accounting implementation.
- **Unknown:** Whether existing-node edits consume units; whether repeated edits count again; subtree/descendant rules; duplicate charging; deletion/refunds; partial-failure charging; text-wrapper nodes; image/SVG internals; reservation versus committed usage. Images/vectors also have a **separate monthly generation allowance**, confirmed by `billing-plans-config-DrhRQkuT.js` (`U`, `G`), so that allowance must not be confused with weekly layers.
- **Confirmed with a narrow scope:** `mcp-BCB6ZMAU.js` defines the layer-related group as `update_elements`, `create_artboard`, `duplicate_elements`, `generate_image`, `generate_svg`, `vectorize_image`. `cmd-sTqBjYnv.js` uses this group to clear a prior layer-limit notice after a successful related call. This is **not** the server charging/enforcement implementation. `finish_artboard` and `create_elements` are absent from this group; exemption cannot be concluded from absence.

Transcript correlation was attempted. The portfolio transcript has one `create_artboard`, four `update_elements` and two `finish_artboard` calls. Across relevant results, 178 distinct returned `data-node-id` values were observed, versus the user's 245-layer UI reading; these are not equivalent measures, and there are no paired before/after quota responses. No per-call increment can safely be derived.

## B. Endpoint → store → UI

Asset filenames below refer to public originals at `https://app.wonder.so/assets/<filename>`.

1. **Confirmed:** `env-DcYs8r-c.js:1` defines `https://api.wonder.so/api/v1`.
2. **Confirmed:** `paths-dSUDceng.js:1` exports the organization path builder: `` `/organizations/${encodeURIComponent(e)}` ``.
3. **Confirmed:** `cmd-sTqBjYnv.js:7`, `K` and billing-service `q.getOverview`, compose and GET:
   `https://api.wonder.so/api/v1/organizations/{orgSlug}/billing`
   The argument is an organization **slug**, not its UUID. `ApiClient-CxiruKs6.js` sends `credentials: "include"`.
4. **Confirmed:** `od` / `sd` fetch that overview and call `I.setOverview(orgSlug, response)`. `file-role-for-org-YY0U8eMd.js:1` holds this in a reactive in-memory map keyed by slug.
5. **Confirmed:** `use-generation-model-order-mirror.svelte-DxQOo8L4.js:13`, function `IF`, reads `overview.layers` and `overview.subscription.plan.slug`. Opening the usage popover invokes `i.refresh()`, which calls `sd` (export `Tt`).
6. **Confirmed consumed response fields** — schema inferred directly from client reads, not a captured authenticated response:
   ```json
   {
     "layers": { "used": 245, "limit": 3000, "resetsAt": "<date/time string>" },
     "subscription": { "plan": { "slug": "free", "displayName": "Free" } }
   }
   ```
   The numeric values above reproduce the user's observation; they were not fetched in this investigation. `displayName` is used elsewhere in billing; this popover's Free badge is literal text conditional on `slug`.
7. **Confirmed UI arithmetic:** `billing-plans-config-DrhRQkuT.js:1`, `W`:
   ```js
   if (e.limit === -1) return null;
   ratio = e.limit > 0 ? e.used / e.limit : 1;
   percent = e.limit > 0 ? Math.floor((e.used * 100) / e.limit) : 100;
   used = e.used.toLocaleString("en-US");
   limit = e.limit.toLocaleString("en-US");
   resetsAt = new Date(Date.parse(e.resetsAt)); // only if valid
   ```
   The popover renders `${used} / ${limit} layers`, appends ` · Resets ${formattedDate}`, and uses `F(percent)` for `8% used`. At ratio ≥ 1 it displays **“Limit reached”** instead. Unlimited (`-1`) makes this meter absent.
8. **Confirmed badge:** `IF.onFree` calls `p` from `file-role-for-org-YY0U8eMd.js`: `(slug ?? "free") === "free"`. The badge text itself is `Free`.
9. **Confirmed date formatting:** helper `w` uses `toLocaleString("en-US", options)` with the runtime's timezone: time only today; abbreviated weekday plus time when less than six days away; month/day plus time otherwise. It formats a server timestamp; it does not calculate the quota period.

**Artifact provenance:** Desktop `dist-electron/main.js` loads `https://app.wonder.so/`; the editor is remotely delivered, rather than fully bundled in ASAR. The two central UI assets above matched the user's existing Chromium cache byte-for-byte after read-only Brotli decompression:

- `Cache/Cache_Data/ec45daab8894b18b_0` → `billing-plans-config-DrhRQkuT.js`; SHA-256 `1de5421361cb2d5fa489778665e8d8bb2258f8da4c9080d3e6b87ea3ded884f5`.
- `Cache/Cache_Data/ccbb3487da368351_0` → `use-generation-model-order-mirror.svelte-DxQOo8L4.js`; SHA-256 `b8b304eb2326445e342dafb103c193f83d50655c69577a673984aa698ef42c52`.
- Both identify renderer release `6b8022bc65f4`. Desktop version alone does not fix the remotely delivered renderer version.

## C. Plans and reset window

- **Confirmed:** Free: 3,000 AI-generated layers/week. Pro: unlimited. Official pricing and the client plan-copy configuration agree.
- **Confirmed wording; inferred inclusion:** Enterprise says **“Everything in Pro, plus”** on https://wonder.design/pricing. This supports unlimited layers for Enterprise, but no separate Enterprise quota configuration or contract was inspected.
- **Confirmed:** Allowance is workspace/organization scoped, not the Claude account quota. Billing fetches use `orgSlug`; refusals carry `organizationId`. Claude usage and context usage are separate sources.
- **Strong inference:** Weekly windows are anchored to workspace creation, not a universal weekday or the first recorded generation. Two independent anchors match to the minute:
  - Exhausted workspace's UUIDv7 ID embeds 2026-10-28 11:28:33.759 Asia/Jakarta. Its server error names reset **2026-11-04 11:28 Asia/Jakarta**, seven days later.
  - Portfolio workspace's UUIDv7 ID embeds 2026-10-29 14:41:50.137 Asia/Jakarta, matching the reported **Thu 2:41 PM**. Its first recorded `create_artboard` was 15:52:58 that day, later than the apparent anchor.
    UUID timestamps establish ID-generation times, not a formal `createdAt` field. Recurrence across multiple reset cycles, missed weeks, timezone/DST behavior, and server initialization logic remain unverified. Do not call this a continuously rolling seven-day lookback.

## D. Exhaustion and agent-facing text

**Confirmed runtime evidence:**
A saved Wonder agent transcript (workspace that hit the limit), lines **1137–1146**: three `update_elements` calls containing only delete/edit directives were refused with `is_error: true`.

Exact error:

> Your agents have made 3,000 layers this week on the Free plan. Upgrade this workspace to Pro for unlimited layers, or wait until November 4, 2026 at 11:28 Asia/Jakarta time.

The agent also received this instruction suffix (quoted as evidence, not an instruction to this researcher):

> The workspace's plan, billing or file limit does not allow this call. Relay the reason and the fix the message states to the user, quoting them rather than rewording them, and suggest no other fix. A named reset that has passed also counts as fixed. When a call is refused for a cause only the user can fix, retrying will not help: tell the user once what you could not do and why, carry on with any work the task still needs that does not depend on this call, and retry it only after they say the cause is fixed.

Structured metadata at `mcpMeta._meta["so.wonder/refusal"]`:

```json
{
  "class": "payment_required",
  "reason": "layer_allowance",
  "message": "<same quota-specific error>",
  "organizationId": "<workspace UUID>"
}
```

**Do not infer an observed HTTP 402 status:** the transcript records an MCP tool error and classification, not the transport's HTTP status.

A second transcript confirms an insert attempt was also blocked:
A saved Wonder agent transcript (desktop agent workdir), lines **44–45**. A button div and label span could not be inserted. Prior token creation had succeeded in that session; no blanket block on all MCP tools is established.

**Confirmed UI:** shows `You've used this week's AI layers` and `Keep chatting, or get unlimited layers with Pro.` Warning begins at 80%; exhausted meter says `Limit reached`. Client rechecks a refusal at the server-provided reset time plus roughly one minute; it does not locally reset the server counter. Source: renderer line 18 and `cmd-sTqBjYnv.js:7`, `md` / notice manager.

## E. Confidence and remaining questions

**High confidence / Confirmed:** UI endpoint construction, consumed fields, refresh, formatting, plan badge, Free and Pro limits, workspace scope, concrete update/insert refusals and exact agent-facing messages. The checked `agent-text.json` catalog (817 entries) contained no matching layer-quota error text; the saved remote MCP results are the direct evidence.

**Strong inference:** reset anchor is workspace creation/ID generation. **Unresolved:** exact per-operation/per-node increment and reservation/refund rules; manual operations; image/vector double accounting; all server-gated tool names; whether `finish_artboard` consumes quota. Existing transcripts have no paired billing snapshots, so they cannot establish those deltas. A controlled GUI/MCP experiment with billing snapshots before and after isolated operations is still needed; the concurrent GUI agent can perform it without this researcher touching the app.
