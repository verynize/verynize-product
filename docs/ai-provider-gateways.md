# Cloudflare and Sumopod provider handoff

Implemented on `feat/ai-providers-gateways`, based on staging commit `c37adc5657a585eeb7b01dd5279ff702884fc13f`. Research checked 2026-11-14 using Context7 and the official pages below. No real credentials were available and no authenticated request was made to either service. Local fixtures prove our HTTP contract only.

## Official evidence and changes from the brief

- [Cloudflare unified API](https://developers.cloudflare.com/ai-gateway/usage/chat-completion/): “For standard single-model chat completions, this endpoint is deprecated.” The module uses the recommended `https://api.cloudflare.com/client/v4/accounts/{accountId}/ai/v1` SDK base, never the gateway `/compat` base.
- [Cloudflare REST API](https://developers.cloudflare.com/ai-gateway/usage/rest-api/): “To use a specific gateway, include the `cf-aig-gateway-id` header.” Its chat-completions example explicitly includes `"stream": true`; token permission is **Account > Workers AI > Read**. Thus gateway selection and streaming are now documented, contrary to the earlier research. Real-key behavior still needs checking. The current REST model naming for Workers AI is `@cf/author/model`, not the legacy `workers-ai/@cf/...` prefix. The documented OpenAI SDK configuration puts the Cloudflare token in `apiKey`, producing the Cloudflare Authorization bearer header; it is not a provider API key.
- [Manage gateways](https://developers.cloudflare.com/ai-gateway/configuration/manage-gateway/): “When no gateway named `default` exists in your account, AI Gateway creates it on the first authenticated request.” Custom gateways must already exist. The documented gateway-name limit is 64 characters.
- [Cloudflare BYOK](https://developers.cloudflare.com/ai-gateway/configuration/bring-your-own-keys/): “AI Gateway substitutes the stored provider key only when the provider authorization header is absent.” Keys live in Secrets Store. The page's examples use provider-native URLs and `cf-aig-authorization`; do not transplant those authentication headers into the REST integration. This module sends only the Cloudflare token, not a provider key. Confirm stored-key precedence on the chosen REST route with the smoke test below.
- [Unified Billing](https://developers.cloudflare.com/ai-gateway/features/unified-billing/): “A 5% fee is applied to all credits purchased through Unified Billing.” Credits are prepaid; supported third-party providers listed are OpenAI, Anthropic, Google AI Studio, Google Vertex AI, xAI and Groq. Recognized request credentials take precedence over a stored default-alias key, which takes precedence over Unified Billing. Gateway `byok_only: true` disables that fallback; the request-level equivalent is `cf-aig-no-wholesale: true`. These settings remain controlled in Cloudflare, not in the stored Verynize credential.
- [Sumopod OpenAI-compatible API](https://docs.sumopod.com/guides/ai/openai-compatible-api), modified November 4, 2026: “Use the API Key in the Authorization header.” and “Sumopod models can generate text only.” The documented base is `https://ai.sumopod.com/v1`; Context7's official-page example uses `gpt-4o-mini` and redacts the Authorization value. **Bearer is an assumption**, supported by the OpenAI SDK compatibility claim, not an independently documented scheme. This page provides no explicit streaming, custom-function-calling or model-list API contract.

No custom function-call example on Cloudflare's REST chat-completions path was established by this research. Provider-native tools such as web search are not proof of client-executed function calling. Neither module advertises tools. No compatible models-list endpoint was established for either provider; both return `null` without fetching, so the core uses the curated list.

## Fields and normalized credentials

| Provider   | Field       | Secret | Required | Normalization / validation                                                                                 |
| ---------- | ----------- | ------ | -------- | ---------------------------------------------------------------------------------------------------------- |
| Cloudflare | `accountId` | no     | yes      | Trim; exactly 32 hex characters; lowercase                                                                 |
| Cloudflare | `apiToken`  | yes    | yes      | Trim; 5–4096 printable ASCII characters, no internal whitespace/control characters                         |
| Cloudflare | `gatewayId` | no     | no       | Trim; empty/null/omitted is omitted from normalized JSON; otherwise 1–64 ASCII letters, digits, `_` or `-` |
| Sumopod    | `apiKey`    | yes    | yes      | Same token hygiene as `apiToken`                                                                           |

The token lengths/character restrictions and gateway slug alphabet are local input hygiene, not claims about vendor-issued key formats. Tokens are opaque: no undocumented `sk-` prefix or fixed Cloudflare token length is required. The five-character minimum ensures `describe()` never returns an entire accepted credential in `last4`. Unknown fields are discarded; normalized objects contain only the fields above. Validation throws `Error` with `status: 400` and the offending `field`. Optional gateway null is treated as absent. `describe()` always returns only `{last4, label: null}`; it never copies caller-provided labels, account IDs, gateway IDs or upstream bodies into public metadata.

`endpoint()` returns `baseURL`, `apiKey`, and Cloudflare's `headers: {"cf-aig-gateway-id": gatewayId || "default"}`. Explicit `default` works with Workers AI too. Sumopod needs no extra headers. The shared adapter must use `apiKey` for bearer auth and merge `headers` into its default headers. Trusted server env overrides `CLOUDFLARE_AI_BASE_URL` and `SUMOPOD_AI_BASE_URL` replace the **entire SDK base**, with trailing slashes removed. Credential input cannot override a URL. No new dependency is required.

Curated models are deliberately small: Cloudflare `openai/gpt-4.1-mini` (from the billing example), Sumopod `gpt-4o-mini` (from the official example), each with `tools: false`. Model availability is account-dependent and must be smoke-tested.

## Verification and contract decisions

Both verification calls POST to `<baseURL>/chat/completions`, with one user message `Reply OK.`, the first curated model, `max_tokens: 8`, and `stream: false`. This is a potentially billable inference probe, not a free token introspection endpoint. It may fail with valid credentials if the probe model or gateway configuration is unavailable. Success requires a successful HTTP response with a string at `choices[0].message.content`; an HTML login page, error JSON or malformed payload does not count. Requests have a 10-second abort signal and refuse redirects. No automatic retries occur.

| Response                                   | Contract result                                        |
| ------------------------------------------ | ------------------------------------------------------ |
| 2xx with chat content                      | `{ok:true}`                                            |
| 2xx with invalid/missing chat content      | `unsupported`                                          |
| 401 / 403                                  | `rejected`, actionable account/key/permission guidance |
| 402                                        | `rejected`, credits-specific message                   |
| 400 / 404 / 405 / 422                      | `unsupported`, model/routing guidance                  |
| 429                                        | `unreachable`, rate-limit-specific message             |
| 5xx / other unsuccessful statuses          | `unreachable`                                          |
| Network error, timeout or refused redirect | `unreachable`                                          |

The given reason union has no `credits` or `rate_limited` variant; the choices above preserve it exactly and use the optional message to distinguish those conditions. No upstream body or thrown network-error text is surfaced. `errorMessage()` covers all four requested runtime problems with a provider name and next step.

**Only contract extension:** Sumopod exports `capabilities: {tools:false, streaming:"unverified"}` as requested. The registry/core must retain this metadata, restrict Sumopod to chat-only, and use non-streaming upstream completions until support is verified (the UI may still receive synthesized text events). It must also honor each curated model's `tools:false`, including Cloudflare. These modules do not implement that enforcement; it belongs to the core branch. Cloudflare streaming is documented but custom tools remain disabled pending evidence. No adapter, routing, DB, UI or package files were modified.

## Tests and core integration follow-up

`tests/ai-provider-gateways.mjs` is registered in the cloud group / node lane with source globs for both modules and `tests/helpers/fake-gateway-upstream.mjs`. The helper binds only loopback. Tests cover field errors, normalization, secret-safe descriptions, defaults/overrides, actual request bodies and headers, 200/401/402/403/429/5xx, unsupported and malformed responses, dropped connections, sanitized exceptions, curated fallback, capability metadata and actionable errors. The helper also emits SSE text and fragmented function arguments ending in `[DONE]`; its fixture test does not exercise the shared SDK adapter.

The core branch should import this helper, instantiate its real `OpenAIBaseChatCompletionsTextAdapter` with each module's endpoint settings, and assert translated text, tool start/argument/end events, JSON argument reassembly, cancellation and headers. Inject tools explicitly only for that protocol fixture; do not enable live Sumopod tools. Also run non-streaming Sumopod through the executor with no offered tools, assert runtime 401/402/429 messages, and test reconnect/key rotation. No SDK source was vendored here.

## Manual real-key smoke tests (not executed)

Use a local terminal with shell tracing disabled. Provide secrets through a secure local environment; do not paste them in this report, source files or screenshots. These commands make billable requests. `jq` is used to construct JSON. Keep tokens and request/response logs private.

Set `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_GATEWAY_ID` (an existing non-default test gateway), and `SUMOPOD_API_KEY` in that environment. The Cloudflare token needs Workers AI Read for this account. No placeholder secret values are supplied below.

```sh
set +x
: "${CLOUDFLARE_ACCOUNT_ID:?set account ID}"
: "${CLOUDFLARE_API_TOKEN:?load token securely}"
: "${CLOUDFLARE_GATEWAY_ID:?set existing test gateway ID}"
: "${SUMOPOD_API_KEY:?load key securely}"
CF_BASE="https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/ai/v1"
SUMO_BASE='https://ai.sumopod.com/v1'
CF_MODEL='openai/gpt-4.1-mini'
SUMO_MODEL='gpt-4o-mini'
```

1. **Minimal verification / Bearer scheme / model availability.** Expect 200 with `choices[0].message.content`. A 401/403 from Sumopod leaves the scheme unresolved: consult its authenticated Quick Start; do not change the implementation based solely on an invalid key response.

```sh
curl -sS --max-time 30 -i "$CF_BASE/chat/completions" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" -H 'Content-Type: application/json' \
  --data "$(jq -nc --arg model "$CF_MODEL" '{model:$model,messages:[{role:"user",content:"Reply OK."}],max_tokens:8,stream:false}')"
curl -sS --max-time 30 -i "$SUMO_BASE/chat/completions" \
  -H "Authorization: Bearer $SUMOPOD_API_KEY" -H 'Content-Type: application/json' \
  --data "$(jq -nc --arg model "$SUMO_MODEL" '{model:$model,messages:[{role:"user",content:"Reply OK."}],max_tokens:8,stream:false}')"
```

2. **Streaming.** Expect event-stream output with multiple `data:` JSON deltas and `[DONE]`; inspect time to first delta and natural completion. A buffered 200 JSON response does not prove streaming. Run for each curated model before updating capability metadata.

```sh
curl -sS -N --max-time 60 -i "$CF_BASE/chat/completions" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" -H 'Content-Type: application/json' \
  --data "$(jq -nc --arg model "$CF_MODEL" '{model:$model,messages:[{role:"user",content:"Count from one to ten."}],max_tokens:64,stream:true}')"
curl -sS -N --max-time 60 -i "$SUMO_BASE/chat/completions" \
  -H "Authorization: Bearer $SUMOPOD_API_KEY" -H 'Content-Type: application/json' \
  --data "$(jq -nc --arg model "$SUMO_MODEL" '{model:$model,messages:[{role:"user",content:"Count from one to ten."}],max_tokens:64,stream:true}')"
```

3. **Custom functions with and without streaming.** The function is a harmless protocol probe; execute no returned command. Expect a `gateway_probe` function call with JSON `{ok:true}`. In SSE, confirm function IDs/names and complete reassembled arguments; plain text saying it called a function is not success. Repeat the commands with `stream:false` in the JSON helper to separate tool support from streaming support.

```sh
gateway_tool_probe() {
  jq -nc --arg model "$1" '{model:$model,messages:[{role:"user",content:"Call gateway_probe with ok true."}],max_tokens:128,stream:true,tools:[{type:"function",function:{name:"gateway_probe",description:"Return a harmless test flag",parameters:{type:"object",properties:{ok:{type:"boolean"}},required:["ok"],additionalProperties:false}}}],tool_choice:{type:"function",function:{name:"gateway_probe"}}}'
}
curl -sS -N --max-time 60 -i "$CF_BASE/chat/completions" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" -H 'Content-Type: application/json' \
  --data "$(gateway_tool_probe "$CF_MODEL")"
curl -sS -N --max-time 60 -i "$SUMO_BASE/chat/completions" \
  -H "Authorization: Bearer $SUMOPOD_API_KEY" -H 'Content-Type: application/json' \
  --data "$(gateway_tool_probe "$SUMO_MODEL")"
```

Before enabling tools, follow a returned call with an assistant message containing its exact `tool_calls` and a `role:"tool"` message referencing its `tool_call_id`. For each provider, use the following non-streaming round trip. Select Cloudflare first, then repeat with the Sumopod assignments shown:

```sh
PROBE_BASE="$CF_BASE"
PROBE_KEY="$CLOUDFLARE_API_TOKEN"
PROBE_MODEL="$CF_MODEL"
# Repeat with these three assignments instead:
# PROBE_BASE="$SUMO_BASE"
# PROBE_KEY="$SUMOPOD_API_KEY"
# PROBE_MODEL="$SUMO_MODEL"
PROBE_ASSISTANT=$(curl -fsS --max-time 60 "$PROBE_BASE/chat/completions" \
  -H "Authorization: Bearer $PROBE_KEY" -H 'Content-Type: application/json' \
  --data "$(gateway_tool_probe "$PROBE_MODEL" | jq '.stream = false')" | jq -ce '.choices[0].message | select(.tool_calls[0].function.name == "gateway_probe")')
PROBE_BODY=$(jq -nc --arg model "$PROBE_MODEL" --argjson assistant "$PROBE_ASSISTANT" '{model:$model,messages:[{role:"user",content:"Call gateway_probe with ok true."},$assistant,{role:"tool",tool_call_id:$assistant.tool_calls[0].id,content:"{\"ok\":true}"}],max_tokens:64,stream:false}')
curl -sS --max-time 60 -i "$PROBE_BASE/chat/completions" \
  -H "Authorization: Bearer $PROBE_KEY" -H 'Content-Type: application/json' --data "$PROBE_BODY"
unset PROBE_KEY
```

Expect a final assistant response that uses the tool result; test the same round trip through the real adapter/executor after the branches are integrated.

4. **Cloudflare gateway selection, auto-creation and billing precedence.** Run the minimal request above without a gateway header, then with explicit `default`, then with the named gateway. Check the corresponding gateway's logs and response request IDs; 200 alone does not establish correct routing. Auto-creation should be tested in an account without a default gateway, without deleting an existing gateway.

```sh
for GATEWAY in default "$CLOUDFLARE_GATEWAY_ID"; do
  curl -sS --max-time 30 -i "$CF_BASE/chat/completions" \
    -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
    -H "cf-aig-gateway-id: $GATEWAY" -H 'Content-Type: application/json' \
    --data "$(jq -nc --arg model "$CF_MODEL" '{model:$model,messages:[{role:"user",content:"Reply OK."}],max_tokens:8,stream:false}')"
done
```

On the disposable named gateway, configure an OpenAI provider key with the default alias and enable **Require provider credentials** (`byok_only`). Run the named-gateway request; check provider usage and Cloudflare billing. Remove that stored key and repeat: expect 400 / error 2044, not Unified Billing. Disable the restriction and repeat with prepaid credits: confirm Cloudflare credit usage. Do not send an OpenAI Authorization header to the Cloudflare REST host. These dashboard changes are manual; the module does not mutate billing settings.

5. **Model listing discovery (optional, not used by this implementation).** A successful body must contain a documented/stable model list before adopting discovery. An endpoint existing does not establish tool capability flags.

```sh
curl -sS --max-time 30 -i "$CF_BASE/models" -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN"
curl -sS --max-time 30 -i "$SUMO_BASE/models" -H "Authorization: Bearer $SUMOPOD_API_KEY"
```

Still unproven: Sumopod Bearer scheme, live model availability for either account, Sumopod streaming and function calling, Cloudflare REST custom-function round trips, actual gateway routing/auto-creation in the user's account, REST stored-key/billing precedence, models-list availability/schema, and real SDK/executor behavior (including streaming cancellation). Cloudflare REST streaming and gateway selection are documented, but have not been live-tested here. Node-only tests do not establish workerd/Vercel runtime execution; production modules use only standard web APIs and no Node imports.

## Validation record

Executed on the Mac with Node `v24.15.0`:

- `npm ci --ignore-scripts`: passed; installed pinned dependencies without changing the lockfile. npm reported the existing `cf` dependency wants a newer Node 24 minor and reported two moderate audit findings. No dependency upgrades were made.
- `node --test tests/ai-provider-gateways.mjs`: passed, 13 tests, zero failures.
- `node scripts/run-tests.mjs --changed --explain`: passed; recognizes the new cloud/node test, selects 292 tests because changing the manifest selects the full suite. This command executes no tests.
- `npm run format -- cloud/ai-providers/cloudflare.js cloud/ai-providers/sumopod.js tests/ai-provider-gateways.mjs tests/helpers/fake-gateway-upstream.mjs scripts/test-manifest.mjs docs/ai-provider-gateways.md`: passed; all six touched files formatted.
- `npm run lint`: passed after generating missing UI assets.
- `npm run check`: passed after generating missing UI assets; async-wait guard, CSS guard, syntax and entry asset checks all passed.
- `npm run build:ui`: passed as the prerequisite for those checks. It reported the existing unresolved `x.png` reference. The initial lint/check attempts failed solely because the fresh checkout lacked `web/dist/ui.css`; both were rerun successfully after this build.
- `git diff --check`: passed.

No real-key requests, full suite, VM, workerd/Vercel execution or real shared-adapter integration were run. No push or PR is part of this handoff.
