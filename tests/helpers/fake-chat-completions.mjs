// Same streaming Chat Completions wire protocol (including fragmented tool_calls), with a
// gateway /models catalog. Keeping one SSE implementation exercises both adapters identically.
import { startFakeOpenRouter } from "./fake-openrouter.mjs";
export { toolMessages, userText } from "./fake-openrouter.mjs";
export const startFakeChatCompletions = (scenarios) =>
  startFakeOpenRouter(scenarios, {
    models: ["anthropic/claude-sonnet-4.5", "openai/gpt-5", "unknown/no-tool-capability"],
  });
