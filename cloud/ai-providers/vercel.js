const label = "Vercel AI Gateway";
const curatedModels = [
  { id: "anthropic/claude-sonnet-4.5", label: "Claude Sonnet 4.5", tools: true },
  { id: "openai/gpt-5", label: "GPT-5", tools: true },
];

function parseCredential(input) {
  const apiKey = typeof input?.apiKey === "string" ? input.apiKey.trim() : "";
  if (!apiKey || apiKey.length > 512 || !/^[\x21-\x7e]+$/.test(apiKey))
    throw Object.assign(new Error(`apiKey must be a ${label} API key`), {
      status: 400,
      field: "apiKey",
    });
  return { apiKey };
}
const endpoint = (credential, env) => ({
  baseURL: String(env.VERCEL_AI_GATEWAY_BASE_URL || "https://ai-gateway.vercel.sh/v1").replace(
    /\/+$/,
    "",
  ),
  apiKey: credential.apiKey,
});
async function gatewayResponse(credential, { fetch, env }, resource) {
  const { baseURL, apiKey } = endpoint(credential, env);
  return fetch(`${baseURL}/${resource}`, {
    headers: { authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(10_000),
  });
}
export default {
  id: "vercel",
  label,
  fields: [{ name: "apiKey", label: "API key", secret: true, required: true }],
  parseCredential,
  describe: (credential) => ({ last4: credential.apiKey.slice(-4), label: null }),
  endpoint,
  async verify(credential, options) {
    try {
      // The model catalog is public; credits checks authentication without a billable generation.
      const response = await gatewayResponse(credential, options, "credits");
      await response.body?.cancel();
      if (response.ok) return { ok: true };
      return {
        ok: false,
        reason: [401, 403].includes(response.status) ? "rejected" : "unreachable",
      };
    } catch {
      return { ok: false, reason: "unreachable" };
    }
  },
  async listModels(credential, options) {
    try {
      const response = await gatewayResponse(credential, options, "models");
      if (!response.ok) {
        await response.body?.cancel();
        return null;
      }
      const body = await response.json();
      if (!Array.isArray(body?.data)) return null;
      return body.data
        .filter((model) => typeof model.id === "string")
        .map((model) => ({
          id: model.id,
          label: model.name || model.id,
          tools: curatedModels.some((entry) => entry.id === model.id && entry.tools),
        }));
    } catch {
      return null;
    }
  },
  curatedModels,
  errorMessage(problem) {
    if (problem === "disconnected")
      return `Your ${label} account was disconnected during this run. Reconnect it in Settings to continue.`;
    if (problem === "credits")
      return `Your ${label} account is out of credits. Add credits or reconnect another account in Settings.`;
    if (problem === "rate_limited") return `${label} is rate limiting requests. Try again later.`;
    return `Your ${label} key was rejected. Reconnect your account in Settings.`;
  },
};
