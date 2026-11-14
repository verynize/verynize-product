import assert from "node:assert/strict";
import { test } from "node:test";
import cloudflare from "../cloud/ai-providers/cloudflare.js";
import sumopod from "../cloud/ai-providers/sumopod.js";
import { fakeGatewayUpstream } from "./helpers/fake-gateway-upstream.mjs";

const accountId = "abcdef0123456789abcdef0123456789";
const secret = "test-only-not-a-real-credential-7890";
const cloudCredential = { accountId, apiToken: secret, gatewayId: "my-gateway" };
const cases = [
  {
    provider: cloudflare,
    credential: cloudCredential,
    override: "CLOUDFLARE_AI_BASE_URL",
    secretField: "apiToken",
  },
  {
    provider: sumopod,
    credential: { apiKey: secret },
    override: "SUMOPOD_AI_BASE_URL",
    secretField: "apiKey",
  },
];
const invalid = (provider, input, field) =>
  assert.throws(
    () => provider.parseCredential(input),
    (error) =>
      error instanceof Error &&
      error.status === 400 &&
      error.field === field &&
      !error.message.includes(secret),
  );

test("Cloudflare validates account and optional gateway independently", () => {
  for (const account of [
    undefined,
    null,
    12,
    "",
    "a".repeat(31),
    "g".repeat(32),
    `${accountId}/extra`,
  ])
    invalid(cloudflare, { ...cloudCredential, accountId: account }, "accountId");
  for (const gatewayId of [123, {}, [], "a/b", "a b", "a\nb", "a".repeat(65)])
    invalid(cloudflare, { ...cloudCredential, gatewayId }, "gatewayId");
  for (const gatewayId of [undefined, null, "", "  "])
    assert.deepEqual(cloudflare.parseCredential({ ...cloudCredential, gatewayId }), {
      accountId,
      apiToken: secret,
    });
  assert.deepEqual(
    cloudflare.parseCredential({
      accountId: ` ${accountId.toUpperCase()} `,
      apiToken: ` ${secret} `,
      gatewayId: " my-gateway ",
    }),
    cloudCredential,
  );
});

for (const { provider, credential, override, secretField } of cases) {
  test(`${provider.id}: validates secrets, trims and drops unknown input`, () => {
    for (const value of [
      undefined,
      null,
      42,
      {},
      "",
      "abcd",
      "has space",
      "has\nnewline",
      "bad\u0000value",
      "nonascii-é",
      "a".repeat(4097),
    ])
      invalid(provider, { ...credential, [secretField]: value }, secretField);
    for (const input of [null, undefined, [], "key", 42])
      invalid(provider, input, provider.id === "cloudflare" ? "accountId" : "apiKey");
    const input = {
      ...credential,
      [secretField]: ` ${secret} `,
      baseURL: "https://untrusted.invalid",
      ignored: true,
    };
    assert.deepEqual(provider.parseCredential(input), credential);
    assert.equal(input.ignored, true);
    assert.equal(Object.getPrototypeOf(provider.parseCredential(input)), Object.prototype);
  });

  test(`${provider.id}: description contains only the permitted suffix`, () => {
    assert.deepEqual(provider.describe(credential), { last4: "7890", label: null });
    assert.ok(!JSON.stringify(provider.describe(credential)).includes(secret));
    const shortest = provider.parseCredential({ ...credential, [secretField]: "abcde" });
    assert.deepEqual(provider.describe(shortest), { last4: "bcde", label: null });
  });

  test(`${provider.id}: endpoint and trusted override preserve authentication`, () => {
    const expected =
      provider.id === "cloudflare"
        ? {
            baseURL: `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/v1`,
            apiKey: secret,
            headers: { "cf-aig-gateway-id": "my-gateway" },
          }
        : { baseURL: "https://ai.sumopod.com/v1", apiKey: secret };
    assert.deepEqual(provider.endpoint(credential), expected);
    assert.deepEqual(
      provider.endpoint(credential, { [override]: "http://127.0.0.1:1234/custom/v1///" }),
      { ...expected, baseURL: "http://127.0.0.1:1234/custom/v1" },
    );
    if (provider.id === "cloudflare")
      assert.deepEqual(provider.endpoint({ accountId, apiToken: secret }).headers, {
        "cf-aig-gateway-id": "default",
      });
  });

  test(`${provider.id}: verifies a minimal chat request and maps failures safely`, async (t) => {
    const upstream = await fakeGatewayUpstream();
    t.after(() => upstream.close());
    const env = { [override]: upstream.baseURL };
    let fetchCalls = 0;
    const options = {
      env,
      fetch: (url, init) => {
        assert.ok(url.startsWith(`${upstream.baseURL}/`));
        assert.equal(init.redirect, "error");
        assert.ok(init.signal instanceof AbortSignal);
        fetchCalls++;
        return fetch(url, init);
      },
    };
    assert.deepEqual(await provider.verify(credential, options), { ok: true });
    const request = upstream.requests[0];
    assert.equal(request.method, "POST");
    assert.equal(request.url, "/v1/chat/completions");
    assert.equal(request.headers.authorization, `Bearer ${secret}`);
    assert.equal(request.headers["content-type"], "application/json");
    assert.equal(request.headers["cf-aig-authorization"], undefined);
    assert.equal(
      request.headers["cf-aig-gateway-id"],
      provider.id === "cloudflare" ? "my-gateway" : undefined,
    );
    assert.deepEqual(request.body, {
      model: provider.curatedModels[0].id,
      messages: [{ role: "user", content: "Reply OK." }],
      max_tokens: 8,
      stream: false,
    });
    for (const [status, reason] of [
      [401, "rejected"],
      [403, "rejected"],
      [402, "rejected"],
      [429, "unreachable"],
      [500, "unreachable"],
      [503, "unreachable"],
      [400, "unsupported"],
      [404, "unsupported"],
      [405, "unsupported"],
      [422, "unsupported"],
    ]) {
      upstream.state.status = status;
      const result = await provider.verify(credential, options);
      assert.equal(result.ok, false);
      assert.equal(result.reason, reason, `HTTP ${status}`);
      assert.ok(!JSON.stringify(result).includes(secret));
      if (status === 402) assert.equal(result.message, provider.errorMessage("credits"));
      if (status === 429) assert.equal(result.message, provider.errorMessage("rate_limited"));
    }
    upstream.state.status = 200;
    for (const body of ["not JSON", "{}", '{"error":"upstream error"}']) {
      upstream.state.body = body;
      assert.equal((await provider.verify(credential, options)).reason, "unsupported");
    }
    upstream.state.disconnect = true;
    assert.equal((await provider.verify(credential, options)).reason, "unreachable");
    assert.equal(fetchCalls, 15);
    const failed = await provider.verify(credential, {
      env,
      fetch: async () => {
        throw Error(secret);
      },
    });
    assert.equal(failed.reason, "unreachable");
    assert.ok(!JSON.stringify(failed).includes(secret));
  });

  test(`${provider.id}: curated fallback never probes an undocumented endpoint`, async () => {
    assert.equal(
      await provider.listModels(credential, {
        fetch: () => assert.fail("must not fetch"),
        env: {},
      }),
      null,
    );
    assert.ok(provider.curatedModels.length);
    for (const model of provider.curatedModels) {
      assert.equal(typeof model.id, "string");
      assert.equal(typeof model.label, "string");
      assert.equal(model.tools, false);
    }
    for (const problem of ["disconnected", "credits", "rejected", "rate_limited"]) {
      assert.match(provider.errorMessage(problem), new RegExp(provider.label));
      assert.match(provider.errorMessage(problem), /Connect|Top up|Check|check|Wait/);
    }
  });
}

test("Sumopod declares unverified streaming and disables tools", () => {
  assert.deepEqual(sumopod.capabilities, { tools: false, streaming: "unverified" });
});

test("local upstream offers fragmented SSE tool calls for the core adapter integration", async (t) => {
  const upstream = await fakeGatewayUpstream();
  t.after(() => upstream.close());
  const response = await fetch(`${upstream.baseURL}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "fixture",
      stream: true,
      tools: [{ type: "function", function: { name: "gateway_probe" } }],
    }),
  });
  assert.equal(response.headers.get("content-type"), "text/event-stream");
  const events = (await response.text())
    .split("\n\n")
    .filter(Boolean)
    .map((line) => line.slice(6));
  assert.equal(events.pop(), "[DONE]");
  const choices = events.map((event) => JSON.parse(event).choices[0]);
  assert.equal(choices[0].delta.content, "OK");
  assert.equal(choices.at(-1).finish_reason, "tool_calls");
  assert.equal(choices[1].delta.tool_calls[0].function.name, "gateway_probe");
  assert.deepEqual(
    JSON.parse(
      choices
        .flatMap(({ delta }) => delta.tool_calls || [])
        .map((call) => call.function.arguments)
        .join(""),
    ),
    { ok: true },
  );
});
