// Figma account connection against a local fixture OAuth server: PKCE (S256) authorization code flow with a
// loopback redirect, encrypted token storage, refresh, state checking, denial, disconnect, and the connected
// account's bearer token reaching the REST import. The fixture server implements the authorize/token/refresh
// endpoints itself; the browser hop is a real HTTP redirect followed by fetch. Electron's safeStorage is
// replaced by an AES-GCM implementation with the same interface (Electron is not available under node --test).
const { test } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createFigmaOAuth, endpoints } = require("../desktop/figma-oauth.cjs");
const { importFigma } = require("../desktop/figma.cjs");

function sealedStorage() {
  const key = crypto.randomBytes(32);
  return {
    available: true,
    async isAsyncEncryptionAvailable() {
      return this.available;
    },
    async encryptStringAsync(text) {
      const iv = crypto.randomBytes(12),
        c = crypto.createCipheriv("aes-256-gcm", key, iv),
        body = Buffer.concat([c.update(text, "utf8"), c.final()]);
      return Buffer.concat([iv, c.getAuthTag(), body]);
    },
    async decryptStringAsync(buf) {
      const d = crypto.createDecipheriv("aes-256-gcm", key, buf.subarray(0, 12));
      d.setAuthTag(buf.subarray(12, 28));
      const result = Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString("utf8");
      return { result, shouldReEncrypt: false };
    },
  };
}
const b64url = (buf) =>
  Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const freePort = () =>
  new Promise((resolve) => {
    const s = http.createServer().listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
const form = (req) =>
  new Promise((resolve) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => resolve(Object.fromEntries(new URLSearchParams(body))));
  });

async function fixtureServer({ deny = false } = {}) {
  const state = { codes: new Map(), requests: [], issued: 0, refreshes: 0 };
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    state.requests.push(req.method + " " + url.pathname);
    if (url.pathname === "/oauth") {
      const q = Object.fromEntries(url.searchParams);
      state.authorize = q;
      const back = new URL(q.redirect_uri);
      back.searchParams.set("state", q.state);
      if (deny) back.searchParams.set("error", "access_denied");
      else {
        const code = "code-" + crypto.randomUUID();
        state.codes.set(code, {
          challenge: q.code_challenge,
          redirect: q.redirect_uri,
          client: q.client_id,
        });
        back.searchParams.set("code", code);
      }
      res.writeHead(302, { location: back.href }).end();
      return;
    }
    const json = (status, data) =>
      res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(data));
    if (url.pathname === "/v1/oauth/token" && req.method === "POST") {
      const body = await form(req);
      state.tokenRequest = { body, authorization: req.headers.authorization };
      const grant = state.codes.get(body.code);
      state.codes.delete(body.code);
      if (
        !grant ||
        body.grant_type !== "authorization_code" ||
        grant.redirect !== body.redirect_uri ||
        grant.client !== body.client_id
      )
        return json(400, { error: "invalid_grant" });
      if (
        b64url(
          crypto
            .createHash("sha256")
            .update(body.code_verifier || "")
            .digest(),
        ) !== grant.challenge
      )
        return json(400, { error: "invalid_code_verifier" });
      state.issued++;
      return json(200, {
        access_token: "access-1",
        refresh_token: "refresh-1",
        expires_in: 3600,
        user_id: "42",
      });
    }
    if (url.pathname === "/v1/oauth/refresh" && req.method === "POST") {
      const body = await form(req);
      state.refreshRequest = body;
      if (body.refresh_token !== "refresh-1") return json(400, { error: "invalid_refresh" });
      state.refreshes++;
      return json(200, { access_token: "access-" + (state.refreshes + 1), expires_in: 7200 });
    }
    res.writeHead(404).end();
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return {
    state,
    origin: `http://127.0.0.1:${server.address().port}`,
    close: () =>
      new Promise((r) => {
        server.closeAllConnections();
        server.close(r);
      }),
  };
}
// The "browser": follows the authorization redirect to the loopback listener like a user agent would.
const browser = (opened) => async (url) => {
  opened.push(url);
  setImmediate(async () => {
    const first = await fetch(url, { redirect: "manual" });
    const next = first.headers.get("location");
    if (next) {
      const page = await fetch(next);
      opened.page = await page.text();
      opened.status = page.status;
    }
  });
};

test("PKCE authorization code flow, encrypted storage, refresh and disconnect", async () => {
  const fixture = await fixtureServer(),
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "figma-oauth-")),
    file = path.join(dir, "figma-oauth.json"),
    storage = sealedStorage(),
    opened = [];
  let clock = Date.now();
  const oauth = createFigmaOAuth({
    file,
    safeStorage: storage,
    openExternal: browser(opened),
    origin: fixture.origin,
    now: () => clock,
  });
  try {
    await assert.rejects(oauth.connect(), /client ID/);
    const port = await freePort();
    let status = await oauth.configure({
      clientId: "client-abc",
      port,
      clientSecret: "shh-secret",
    });
    assert.deepEqual(
      [status.clientId, status.port, status.connected, status.hasClientSecret, status.redirectUri],
      ["client-abc", port, false, true, `http://127.0.0.1:${port}/figma/callback`],
    );
    status = await oauth.connect();
    assert.deepEqual([status.connected, status.userId, status.pending], [true, "42", false]);
    const auth = fixture.state.authorize;
    assert.deepEqual(
      [
        auth.client_id,
        auth.response_type,
        auth.scope,
        auth.code_challenge_method,
        auth.redirect_uri,
      ],
      [
        "client-abc",
        "code",
        "file_content:read",
        "S256",
        `http://127.0.0.1:${port}/figma/callback`,
      ],
    );
    assert.match(auth.code_challenge, /^[A-Za-z0-9_-]{43}$/);
    assert.match(auth.state, /^[A-Za-z0-9_-]{22}$/);
    assert.equal(
      fixture.state.tokenRequest.authorization,
      "Basic " + Buffer.from("client-abc:shh-secret").toString("base64"),
    );
    assert.match(opened.page, /Figma is connected/);
    // Tokens and secret are only stored sealed.
    const disk = await fs.readFile(file, "utf8");
    for (const secret of ["access-1", "refresh-1", "shh-secret"])
      assert.equal(disk.includes(secret), false);
    assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
    assert.equal(await oauth.accessToken(), "access-1");
    assert.equal(fixture.state.refreshes, 0);
    // Close to expiry: one refresh even for concurrent callers, then the new token is persisted.
    clock += 3600 * 1000 - 30 * 1000;
    assert.deepEqual(await Promise.all([oauth.accessToken(), oauth.accessToken()]), [
      "access-2",
      "access-2",
    ]);
    assert.equal(fixture.state.refreshes, 1);
    assert.equal(fixture.state.refreshRequest.grant_type, "refresh_token");
    const reopened = createFigmaOAuth({
      file,
      safeStorage: storage,
      openExternal: browser([]),
      origin: fixture.origin,
      now: () => clock,
    });
    assert.equal(await reopened.accessToken(), "access-2");
    // A different machine key cannot read the sealed tokens.
    assert.equal(
      await createFigmaOAuth({
        file,
        safeStorage: sealedStorage(),
        openExternal: browser([]),
        origin: fixture.origin,
      }).accessToken(),
      null,
    );
    status = await oauth.disconnect();
    assert.deepEqual(
      [status.connected, status.clientId, status.hasClientSecret],
      [false, "client-abc", true],
    );
    assert.equal(await oauth.accessToken(), null);
  } finally {
    await fixture.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("denied authorization, forged state, busy port and missing secure storage fail safely", async () => {
  const denied = await fixtureServer({ deny: true }),
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "figma-oauth-")),
    storage = sealedStorage();
  try {
    const port = await freePort(),
      oauth = createFigmaOAuth({
        file: path.join(dir, "a.json"),
        safeStorage: storage,
        openExternal: browser([]),
        origin: denied.origin,
      });
    await oauth.configure({ clientId: "client-abc", port });
    await assert.rejects(oauth.connect(), /denied/);
    assert.equal((await oauth.status()).connected, false);
    // A callback with the wrong state is rejected and the listener keeps waiting; cancel ends it.
    const port2 = await freePort();
    const waiting = createFigmaOAuth({
      file: path.join(dir, "b.json"),
      safeStorage: storage,
      openExternal: async () => {},
      origin: denied.origin,
    });
    await waiting.configure({ clientId: "client-abc", port: port2 });
    const pending = waiting.connect();
    await new Promise((r) => setTimeout(r, 50));
    const forged = await fetch(`http://127.0.0.1:${port2}/figma/callback?code=stolen&state=wrong`);
    assert.equal(forged.status, 400);
    assert.equal((await waiting.status()).pending, true);
    await assert.rejects(waiting.connect(), /already in progress/);
    waiting.cancel();
    await assert.rejects(pending, /cancelled/);
    // Busy redirect port.
    const blocker = http.createServer().listen(port2, "127.0.0.1");
    await new Promise((r) => blocker.once("listening", r));
    await assert.rejects(waiting.connect(), /in use/);
    blocker.close();
    // Timeout.
    const slow = createFigmaOAuth({
      file: path.join(dir, "c.json"),
      safeStorage: storage,
      openExternal: async () => {},
      origin: denied.origin,
      timeoutMs: 100,
    });
    await slow.configure({ clientId: "client-abc", port: await freePort() });
    await assert.rejects(slow.connect(), /timed out/);
    // No secure storage: nothing secret is written in the clear.
    const plain = { ...sealedStorage(), available: false };
    const none = createFigmaOAuth({
      file: path.join(dir, "d.json"),
      safeStorage: plain,
      openExternal: async () => {},
      origin: denied.origin,
    });
    await none.configure({ clientId: "client-abc" });
    await assert.rejects(none.configure({ clientSecret: "x" }), /Secure storage/);
    await assert.rejects(none.connect(), /Secure storage/);
    await assert.rejects(none.configure({ clientId: "bad id!" }), /client ID/);
    await assert.rejects(none.configure({ port: 80 }), /port/);
    // Endpoint overrides are restricted to loopback http.
    assert.throws(() => endpoints("https://evil.example"), /loopback/);
    assert.equal(endpoints("").token, "https://api.figma.com/v1/oauth/token");
  } finally {
    await denied.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("connected account token is sent as a bearer token to the Figma API only", async () => {
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url, options });
    return new Response(
      JSON.stringify({
        name: "Doc",
        nodes: {
          "1:2": {
            document: {
              id: "1:2",
              type: "FRAME",
              name: "F",
              absoluteBoundingBox: { x: 0, y: 0, width: 10, height: 10 },
              children: [],
            },
          },
        },
      }),
      { headers: { "content-type": "application/json" } },
    );
  };
  const result = await importFigma(
    { url: "https://www.figma.com/design/ABC/x?node-id=1-2", bearer: "oauth-token" },
    fetcher,
  );
  assert.equal(result.document.pages[0].nodes[0].name, "F");
  assert.equal(calls[0].options.headers.Authorization, "Bearer oauth-token");
  assert.equal(calls[0].options.headers["X-Figma-Token"], undefined);
  assert.equal(new URL(calls[0].url).searchParams.get("geometry"), "paths");
  assert.equal(new URL(calls[0].url).hostname, "api.figma.com");
  await assert.rejects(
    importFigma(
      { url: "https://www.figma.com/design/ABC", bearer: "expired" },
      async () => new Response("", { status: 403 }),
    ),
    /Reconnect your Figma account/,
  );
});
