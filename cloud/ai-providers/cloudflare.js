// REST API gateway credentials. See docs/ai-provider-gateways.md for evidence and limits.
const invalid = (field, message) => {
  throw Object.assign(new Error(message), { status: 400, field });
};

function parseCredential(input) {
  const accountId = typeof input?.accountId === "string" ? input.accountId.trim() : "";
  if (!/^[a-f\d]{32}$/i.test(accountId))
    invalid("accountId", "Enter a Cloudflare account ID containing 32 hexadecimal characters.");
  const apiToken = typeof input?.apiToken === "string" ? input.apiToken.trim() : "";
  if (!/^[\x21-\x7e]{5,4096}$/.test(apiToken))
    invalid("apiToken", "Enter the Cloudflare API token without spaces or control characters.");
  if (input.gatewayId != null && typeof input.gatewayId !== "string")
    invalid("gatewayId", "Enter a Cloudflare gateway ID as text.");
  const gatewayId = input.gatewayId?.trim() || "";
  if (gatewayId && !/^[a-z\d_-]{1,64}$/i.test(gatewayId))
    invalid(
      "gatewayId",
      "Use up to 64 letters, numbers, underscores or hyphens for the gateway ID.",
    );
  return { accountId: accountId.toLowerCase(), apiToken, ...(gatewayId ? { gatewayId } : {}) };
}

function endpoint(credential, env = {}) {
  return {
    baseURL: String(
      env.CLOUDFLARE_AI_BASE_URL ||
        `https://api.cloudflare.com/client/v4/accounts/${credential.accountId}/ai/v1`,
    ).replace(/\/+$/, ""),
    apiKey: credential.apiToken,
    headers: { "cf-aig-gateway-id": credential.gatewayId || "default" },
  };
}

function errorMessage(problem) {
  return (
    {
      disconnected: "Connect Cloudflare AI Gateway in Settings to continue.",
      credits:
        "Cloudflare AI Gateway needs credits. Top up Cloudflare AI Gateway or check the gateway's stored provider key and billing settings.",
      rejected:
        "Cloudflare AI Gateway rejected the request. Check the account ID, gateway and API token (Workers AI Read permission), then reconnect in Settings.",
      rate_limited:
        "Cloudflare AI Gateway is rate limited. Wait and retry, or check the gateway and provider rate limits.",
    }[problem] || "Check Cloudflare AI Gateway in Settings and retry."
  );
}

async function verify(credential, { fetch: fetchImpl = globalThis.fetch, env = {} } = {}) {
  const { baseURL, apiKey, headers } = endpoint(credential, env);
  try {
    const response = await fetchImpl(`${baseURL}/chat/completions`, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
      headers: {
        ...headers,
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "openai/gpt-4.1-mini",
        messages: [{ role: "user", content: "Reply OK." }],
        max_tokens: 8,
        stream: false,
      }),
    });
    if (response.ok) {
      const body = await response.json().catch(() => null);
      return typeof body?.choices?.[0]?.message?.content === "string"
        ? { ok: true }
        : {
            ok: false,
            reason: "unsupported",
            message:
              "Cloudflare AI Gateway returned an unexpected chat response. Check the gateway model configuration.",
          };
    }
    await response.body?.cancel();
    if ([401, 402, 403].includes(response.status))
      return {
        ok: false,
        reason: "rejected",
        message: errorMessage(response.status === 402 ? "credits" : "rejected"),
      };
    if ([400, 404, 405, 422].includes(response.status))
      return {
        ok: false,
        reason: "unsupported",
        message:
          "Cloudflare AI Gateway could not run the verification model. Check gateway routing, stored provider keys and model availability.",
      };
    return {
      ok: false,
      reason: "unreachable",
      message:
        response.status === 429
          ? errorMessage("rate_limited")
          : "Cloudflare AI Gateway is unavailable. Try again shortly.",
    };
  } catch {
    // Never expose upstream bodies or network errors: either can contain credentials.
    return {
      ok: false,
      reason: "unreachable",
      message: "Could not reach Cloudflare AI Gateway. Check connectivity and retry.",
    };
  }
}

export default {
  id: "cloudflare",
  label: "Cloudflare AI Gateway",
  fields: [
    {
      name: "accountId",
      label: "Account ID",
      secret: false,
      required: true,
      help: "The 32-character Cloudflare account ID.",
    },
    {
      name: "apiToken",
      label: "API token",
      secret: true,
      required: true,
      help: "Use a Cloudflare API token with Account > Workers AI > Read permission.",
    },
    {
      name: "gatewayId",
      label: "Gateway ID",
      secret: false,
      required: false,
      placeholder: "default",
      help: "Leave blank for the default gateway. Other gateways must already exist.",
    },
  ],
  parseCredential,
  describe: (credential) => ({ last4: credential.apiToken.slice(-4), label: null }),
  endpoint,
  verify,
  listModels: async () => null,
  // Custom function calling on this REST path still needs a real-key smoke test.
  curatedModels: [{ id: "openai/gpt-4.1-mini", label: "GPT-4.1 mini", tools: false }],
  errorMessage,
};
