import OpenAI from "openai";
import { OpenAIBaseChatCompletionsTextAdapter } from "@tanstack/openai-base";
import { getProvider } from "./index.js";

/** Chat Completions only. Bind fetch directly to the run's signal: cloned SDK Requests can
 * otherwise leave the upstream stream running after cancellation (see openRouterAdapter). */
export function createChatCompletionsAdapter(
  model,
  resolvedProvider,
  signal,
  onCredentialProblem = () => {},
) {
  const definition = getProvider(resolvedProvider.id);
  const endpoint = resolvedProvider.endpoint;
  const client = new OpenAI({
    baseURL: endpoint.baseURL,
    apiKey: endpoint.apiKey,
    defaultHeaders: endpoint.headers,
    maxRetries: 0,
    async fetch(input, init) {
      const credential = await resolvedProvider.current();
      if (!credential) {
        const message = definition.errorMessage("disconnected");
        onCredentialProblem(message);
        throw new Error(message);
      }
      // Resolve again so rotated multi-field credentials update headers and endpoint together.
      const current = resolvedProvider.endpointFor
        ? resolvedProvider.endpointFor(credential)
        : definition.endpoint(credential, {});
      const headers = new Headers(
        init?.headers || (input instanceof Request ? input.headers : undefined),
      );
      for (const name of Object.keys(endpoint.headers || {})) headers.delete(name);
      for (const [name, value] of Object.entries(current.headers || {})) headers.set(name, value);
      headers.set("authorization", `Bearer ${current.apiKey}`);
      const url = String(input instanceof Request ? input.url : input).replace(
        endpoint.baseURL,
        current.baseURL,
      );
      const request = input instanceof Request ? new Request(url, input) : url;
      const response = await fetch(request, { ...init, headers, signal });
      const problem = { 401: "rejected", 403: "rejected", 402: "credits", 429: "rate_limited" }[
        response.status
      ];
      if (problem) onCredentialProblem(definition.errorMessage(problem));
      return response;
    },
  });
  return new OpenAIBaseChatCompletionsTextAdapter(model, definition.id, client, {
    fetch: client.fetch,
  });
}
