import { createChatCompletionsAdapter } from "../cloud/ai-providers/openai-compatible.js";
// Cancel of a model API run reaches the provider request (cloud/ai-executor.js openRouterAdapter): the model
// stream ends right after the run's abort signal fires, including on the first request of the process, where
// Node's cloned Request (the SDK sends `request.clone()`) does not follow the original's signal. Without the
// adapter's own fetch the stream stays open until the provider closes it (the fake never does here).
import assert from "node:assert/strict";
import { chat } from "@tanstack/ai";
import { openRouterAdapter } from "../cloud/ai-executor.js";
import { startFakeOpenRouter } from "./helpers/fake-openrouter.mjs";

const fake = await startFakeOpenRouter({ default: [[{ text: "Working on it" }, { hang: true }]] });
try {
  for (const provider of ["openrouter", "vercel"]) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      const controller = new AbortController();
      const stream = chat({
        adapter: (provider === "openrouter" ? openRouterAdapter : createChatCompletionsAdapter)(
          "fake/model",
          {
            id: provider,
            apiKey: "test-key",
            baseUrl: fake.baseUrl,
            endpoint: { baseURL: fake.baseUrl, apiKey: "test-key" },
            endpointFor: (credential) => ({ baseURL: fake.baseUrl, apiKey: credential.apiKey }),
            current: async () => (provider === "openrouter" ? "test-key" : { apiKey: "test-key" }),
          },
          controller.signal,
        ),
        threadId: `cancel-${attempt}`,
        runId: `cancel-run-${attempt}`,
        messages: [{ role: "user", content: "Work for a while" }],
        abortController: controller,
      });
      let abortedAt = 0;
      const consumed = (async () => {
        try {
          for await (const chunk of stream)
            if (!abortedAt && chunk.type === "TEXT_MESSAGE_CONTENT")
              // After the text has arrived, while the provider keeps the stream open.
              setTimeout(() => {
                abortedAt = Date.now();
                controller.abort("cancelled");
              }, 300);
        } catch {}
        return "ended";
      })();
      const outcome = await Promise.race([
        consumed,
        new Promise((resolve) => setTimeout(() => resolve("still open"), 5000)),
      ]);
      assert.equal(outcome, "ended", `request ${attempt}: the model stream ends after cancel`);
      assert.ok(abortedAt && Date.now() - abortedAt < 2000, `request ${attempt}: ended promptly`);
    }
  }
  console.log(
    "PASS model API cancel: the provider stream ends on the run's abort, first request included",
  );
} finally {
  await fake.close();
}
