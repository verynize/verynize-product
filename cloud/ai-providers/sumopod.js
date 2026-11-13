// OpenAI-compatible text chat only; streaming/function calling are not documented.
function parseCredential(input) {
  const apiKey = typeof input?.apiKey === "string" ? input.apiKey.trim() : "";
  if (!/^[\x21-\x7e]{5,4096}$/.test(apiKey))
    throw Object.assign(
      new Error("Enter the Sumopod API key without spaces or control characters."),
      {
        status: 400,
        field: "apiKey",
      },
    );
  return { apiKey };
}

function endpoint(credential, env = {}) {
  return {
    baseURL: String(env.SUMOPOD_AI_BASE_URL || "https://ai.sumopod.com/v1").replace(/\/+$/, ""),
    apiKey: credential.apiKey,
  };
}

function errorMessage(problem) {
  return (
    {
      disconnected: "Connect Sumopod in Settings to continue.",
      credits: "Sumopod is out of credits. Top up your Sumopod AI balance, then retry.",
      rejected:
        "Sumopod rejected the API key. Create or check your key in the Sumopod AI dashboard, then reconnect in Settings.",
      rate_limited: "Sumopod is rate limited. Wait and retry, or check your Sumopod plan limits.",
    }[problem] || "Check Sumopod in Settings and retry."
  );
}

async function verify(credential, { fetch: fetchImpl = globalThis.fetch, env = {} } = {}) {
  const { baseURL, apiKey } = endpoint(credential, env);
  try {
    const response = await fetchImpl(`${baseURL}/chat/completions`, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
      // Bearer is an explicit compatibility assumption; the docs redact the scheme.
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini",
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
              "Sumopod returned an unexpected chat response. Check the model in the Sumopod AI dashboard.",
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
          "Sumopod could not run the verification model. Check model availability in the Sumopod AI dashboard.",
      };
    return {
      ok: false,
      reason: "unreachable",
      message:
        response.status === 429
          ? errorMessage("rate_limited")
          : "Sumopod is unavailable. Try again shortly.",
    };
  } catch {
    return {
      ok: false,
      reason: "unreachable",
      message: "Could not reach Sumopod. Check connectivity and retry.",
    };
  }
}

export default {
  id: "sumopod",
  label: "Sumopod",
  fields: [
    {
      name: "apiKey",
      label: "API key",
      secret: true,
      required: true,
      help: "Create an API key in the Sumopod AI dashboard.",
    },
  ],
  parseCredential,
  describe: (credential) => ({ last4: credential.apiKey.slice(-4), label: null }),
  endpoint,
  verify,
  listModels: async () => null,
  curatedModels: [{ id: "gpt-4o-mini", label: "GPT-4o mini", tools: false }],
  capabilities: { tools: false, streaming: "unverified" },
  errorMessage,
};
