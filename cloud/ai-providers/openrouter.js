import { openRouterBase } from "../ai-credentials.js";

export default {
  id: "openrouter",
  label: "OpenRouter",
  oauth: true,
  fields: [{ name: "apiKey", label: "API key", secret: true, required: true }],
  parseCredential(input) {
    const apiKey = typeof input?.apiKey === "string" ? input.apiKey.trim() : "";
    if (!apiKey || apiKey.length > 512 || !/^[\x21-\x7e]+$/.test(apiKey))
      throw Object.assign(new Error("apiKey must be an OpenRouter API key"), {
        status: 400,
        field: "apiKey",
      });
    return { apiKey };
  },
  describe: (credential) => ({ last4: credential.apiKey.slice(-4), label: null }),
  endpoint: (credential, env) => ({ baseURL: openRouterBase(env), apiKey: credential.apiKey }),
  async verify(credential, { fetch, env }) {
    try {
      const response = await fetch(`${openRouterBase(env)}/key`, {
        headers: { authorization: `Bearer ${credential.apiKey}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (response.ok) {
        const body = await response.json().catch(() => null);
        return { ok: true, info: body?.data && typeof body.data === "object" ? body.data : {} };
      }
      await response.body?.cancel();
      return {
        ok: false,
        reason: [400, 401, 402, 403].includes(response.status) ? "rejected" : "unreachable",
        message:
          response.status === 402
            ? "This OpenRouter key has no credits left."
            : "OpenRouter rejected this key. Check it and try again.",
      };
    } catch {
      return { ok: false, reason: "unreachable" };
    }
  },
  async listModels() {
    return null;
  },
  curatedModels: [{ id: "openrouter/auto", label: "Auto (OpenRouter)", tools: true }],
  errorMessage(problem) {
    if (problem === "disconnected")
      return "Your OpenRouter account was disconnected during this run. Reconnect it in Settings to continue.";
    if (problem === "credits")
      return "Your OpenRouter account is out of credits. Add credits on openrouter.ai, or reconnect another account in Settings.";
    if (problem === "rate_limited") return "OpenRouter is rate limiting requests. Try again later.";
    return "Your OpenRouter key was rejected. Reconnect your OpenRouter account in Settings.";
  },
};
