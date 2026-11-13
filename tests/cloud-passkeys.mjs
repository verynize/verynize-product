// Passkeys on local workerd: registration and sign-in ceremonies produced by a software
// authenticator written here (WebCrypto keys, CBOR/COSE encoding, real signatures), plus the
// handoff used by the desktop app and the failure cases the verifier must reject.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Miniflare, cloudOptions, signIn } from "./cloud-harness.mjs";

const b64 = (bytes) => Buffer.from(bytes).toString("base64url");
const sha256 = async (bytes) => new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
function cbor(value) {
  const head = (major, n) =>
    n < 24
      ? [(major << 5) | n]
      : n < 256
        ? [(major << 5) | 24, n]
        : n < 65536
          ? [(major << 5) | 25, n >> 8, n & 255]
          : [(major << 5) | 26, (n >>> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255];
  if (typeof value === "number")
    return Uint8Array.from(value >= 0 ? head(0, value) : head(1, -1 - value));
  if (typeof value === "string") {
    const text = new TextEncoder().encode(value);
    return Uint8Array.from([...head(3, text.length), ...text]);
  }
  if (value instanceof Uint8Array) return Uint8Array.from([...head(2, value.length), ...value]);
  if (value instanceof Map) {
    const parts = [Uint8Array.from(head(5, value.size))];
    for (const [k, v] of value) parts.push(cbor(k), cbor(v));
    return Uint8Array.from(parts.flatMap((p) => [...p]));
  }
  throw Error("unsupported");
}
const rawToDer = (raw) => {
  const int = (bytes) => {
    let i = 0;
    while (i < bytes.length - 1 && bytes[i] === 0) i++;
    let v = bytes.slice(i);
    if (v[0] & 0x80) v = [0, ...v];
    return [0x02, v.length, ...v];
  };
  const body = [...int(raw.slice(0, 32)), ...int(raw.slice(32))];
  return Uint8Array.from([0x30, body.length, ...body]);
};

/** A minimal platform authenticator holding discoverable credentials. */
class SoftwareAuthenticator {
  constructor(algorithm = "ES256") {
    this.algorithm = algorithm;
    this.credentials = [];
  }
  async create(options, origin, { flags = 0x45 } = {}) {
    const id = crypto.getRandomValues(new Uint8Array(16));
    const keys =
      this.algorithm === "ES256"
        ? await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
            "sign",
            "verify",
          ])
        : await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
    const jwk = await crypto.subtle.exportKey("jwk", keys.publicKey);
    const cose =
      this.algorithm === "ES256"
        ? new Map([
            [1, 2],
            [3, -7],
            [-1, 1],
            [-2, Buffer.from(jwk.x, "base64url")],
            [-3, Buffer.from(jwk.y, "base64url")],
          ])
        : new Map([
            [1, 1],
            [3, -8],
            [-1, 6],
            [-2, Buffer.from(jwk.x, "base64url")],
          ]);
    for (const [k, v] of cose) if (Buffer.isBuffer(v)) cose.set(k, new Uint8Array(v));
    const credential = { id, keys, userHandle: options.user.id, rpId: options.rp.id, counter: 0 };
    this.credentials.push(credential);
    const coseBytes = cbor(cose);
    const authData = Uint8Array.from([
      ...(await sha256(new TextEncoder().encode(options.rp.id))),
      flags,
      0,
      0,
      0,
      0,
      ...new Uint8Array(16),
      0,
      id.length,
      ...id,
      ...coseBytes,
    ]);
    const clientDataJSON = new TextEncoder().encode(
      JSON.stringify({ type: "webauthn.create", challenge: options.challenge, origin }),
    );
    const attestationObject = cbor(
      new Map([
        ["fmt", "none"],
        ["attStmt", new Map()],
        ["authData", authData],
      ]),
    );
    return {
      id: b64(id),
      type: "public-key",
      response: { clientDataJSON: b64(clientDataJSON), attestationObject: b64(attestationObject) },
    };
  }
  async get(
    options,
    origin,
    { credential = this.credentials[0], counter, type = "webauthn.get", rpId = options.rpId } = {},
  ) {
    credential.counter = counter ?? credential.counter + 1;
    const c = credential.counter;
    const authData = Uint8Array.from([
      ...(await sha256(new TextEncoder().encode(rpId))),
      0x05,
      (c >>> 24) & 255,
      (c >> 16) & 255,
      (c >> 8) & 255,
      c & 255,
    ]);
    const clientDataJSON = new TextEncoder().encode(
      JSON.stringify({ type, challenge: options.challenge, origin }),
    );
    const signed = Uint8Array.from([...authData, ...(await sha256(clientDataJSON))]);
    let signature = new Uint8Array(
      await crypto.subtle.sign(
        this.algorithm === "ES256" ? { name: "ECDSA", hash: "SHA-256" } : { name: "Ed25519" },
        credential.keys.privateKey,
        signed,
      ),
    );
    if (this.algorithm === "ES256") signature = rawToDer(signature);
    return {
      id: b64(credential.id),
      type: "public-key",
      response: {
        clientDataJSON: b64(clientDataJSON),
        authenticatorData: b64(authData),
        signature: b64(signature),
        userHandle: credential.userHandle,
      },
    };
  }
}

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "verynize-passkeys-"));
const options = await cloudOptions(path.join(dir, "state"));
let mf = new Miniflare(options);
try {
  let origin = (await mf.ready).origin.replace("127.0.0.1", "localhost");
  const local = (url, init) => mf.dispatchFetch(url, init);
  const call = async (route, body, { session, status = 200 } = {}) => {
    const response = await local(origin + route, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        "content-type": "application/json",
        ...(session ? { "x-verynize-session": session } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const data = await response.json();
    assert.equal(response.status, status, `${route}: ${JSON.stringify(data)}`);
    return data;
  };
  const alice = await signIn(origin, "alice@example.test", local);

  // The ceremony page runs on the server origin with a strict CSP and a same-origin script.
  const page = await local(origin + "/passkey");
  assert.match(page.headers.get("content-security-policy"), /script-src 'self'/);
  assert.match(await page.text(), /<script src="\/passkey.js"><\/script>/);
  assert.equal(
    (await local(origin + "/passkey.js")).headers.get("content-type"),
    "text/javascript; charset=utf-8",
  );
  // oxlint-disable-next-line typescript/no-implied-eval -- compiles (never runs) the served script to prove it parses
  new Function(await (await local(origin + "/passkey.js")).text());

  // Registration needs a ticket minted by a signed-in session.
  await call("/api/auth/passkeys/ticket", {}, { status: 401 });
  const { ticket } = await call(
    "/api/auth/passkeys/ticket",
    {},
    { session: alice.session, status: 201 },
  );
  const registerOptions = await call("/api/auth/passkeys/register/options", { ticket });
  assert.equal(registerOptions.rp.id, "localhost");
  assert.deepEqual(
    registerOptions.pubKeyCredParams.map((p) => p.alg),
    [-7, -8, -257],
  );
  assert.equal(registerOptions.authenticatorSelection.residentKey, "required");
  const device = new SoftwareAuthenticator("ES256");
  // Wrong origin and replayed challenges are refused.
  const forged = await device.create(registerOptions, "https://evil.example");
  assert.match(
    (
      await call(
        "/api/auth/passkeys/register/verify",
        { ticket, challenge: registerOptions.challenge, credential: forged },
        { status: 400 },
      )
    ).error,
    /Origin mismatch/,
  );
  await call(
    "/api/auth/passkeys/register/verify",
    { ticket, challenge: registerOptions.challenge, credential: forged },
    { status: 401 },
  );
  device.credentials = [];
  const fresh = await call("/api/auth/passkeys/register/options", { ticket });
  const credential = await device.create(fresh, origin);
  const registered = await call(
    "/api/auth/passkeys/register/verify",
    { ticket, challenge: fresh.challenge, credential, label: "Laptop" },
    { status: 201 },
  );
  assert.deepEqual([registered.passkey.label, registered.passkey.alg], ["Laptop", -7]);
  await call("/api/auth/passkeys/register/options", { ticket }, { status: 401 }); // tickets end with a successful registration
  // A second, Ed25519 passkey on another authenticator.
  const { ticket: second } = await call(
    "/api/auth/passkeys/ticket",
    {},
    { session: alice.session, status: 201 },
  );
  const edOptions = await call("/api/auth/passkeys/register/options", { ticket: second });
  assert.deepEqual(
    edOptions.excludeCredentials.map((c) => c.id),
    [credential.id],
  );
  const key = new SoftwareAuthenticator("Ed25519");
  await call(
    "/api/auth/passkeys/register/verify",
    {
      ticket: second,
      challenge: edOptions.challenge,
      credential: await key.create(edOptions, origin),
    },
    { status: 201 },
  );
  const listed = await call("/api/me/passkeys", undefined, { session: alice.session });
  assert.deepEqual(
    listed.passkeys.map((p) => p.alg),
    [-7, -8],
  );

  // Desktop handoff sign-in: the page signs in for the handoff id; only the secret holder claims it.
  const handoff = await call("/api/auth/handoff", {}, { status: 201 });
  assert.equal(
    (
      await call(
        "/api/auth/handoff/claim",
        { id: handoff.id, secret: handoff.secret },
        { status: 202 },
      )
    ).pending,
    true,
  );
  await call(
    "/api/auth/handoff/claim",
    { id: handoff.id, secret: "0".repeat(64) },
    { status: 404 },
  );
  let loginOptions = await call("/api/auth/passkeys/login/options", { handoff: handoff.id });
  assert.deepEqual([loginOptions.rpId, loginOptions.allowCredentials], ["localhost", []]);
  await call("/api/auth/passkeys/login/verify", {
    challenge: loginOptions.challenge,
    credential: await device.get(loginOptions, origin),
  });
  const claimed = await call("/api/auth/handoff/claim", {
    id: handoff.id,
    secret: handoff.secret,
    label: "Desktop",
  });
  assert.equal(claimed.account.email, "alice@example.test");
  assert.equal(
    (await call("/api/me", undefined, { session: claimed.session })).account.id,
    alice.account.id,
  );
  await call(
    "/api/auth/handoff/claim",
    { id: handoff.id, secret: handoff.secret },
    { status: 404 },
  ); // single use
  await call("/api/auth/passkeys/login/options", { handoff: handoff.id }, { status: 404 });

  // Email-scoped options list the account's credential ids (embedded windows have no chooser).
  const scoped = await call("/api/auth/passkeys/login/options", { email: "Alice@example.test" });
  assert.deepEqual(
    scoped.allowCredentials.map((c) => c.id).sort(),
    listed.passkeys.map((p) => p.id).sort(),
  );
  assert.match(
    (
      await call(
        "/api/auth/passkeys/login/options",
        { email: "nobody@example.test" },
        { status: 404 },
      )
    ).error,
    /No passkey/,
  );
  await call("/api/auth/passkeys/login/verify", {
    challenge: scoped.challenge,
    credential: await device.get(scoped, origin),
  });
  // Direct sign-in (no handoff) with the Ed25519 key returns a session.
  loginOptions = await call("/api/auth/passkeys/login/options", {});
  const direct = await call("/api/auth/passkeys/login/verify", {
    challenge: loginOptions.challenge,
    credential: await key.get(loginOptions, origin),
  });
  assert.match(direct.session, /^vs_[0-9a-f]{64}$/);

  // Rejections: tampered signature, wrong type, other relying party, replayed challenge, counter regression.
  const reject = async (mutate, pattern, status = 400) => {
    const opts = await call("/api/auth/passkeys/login/options", {});
    const assertion = await mutate(opts);
    assert.match(
      (
        await call(
          "/api/auth/passkeys/login/verify",
          { challenge: opts.challenge, credential: assertion },
          { status },
        )
      ).error,
      pattern,
    );
  };
  await reject(
    async (o) => {
      const a = await device.get(o, origin);
      const sig = Buffer.from(a.response.signature, "base64url");
      sig[sig.length - 1] ^= 1;
      a.response.signature = b64(sig);
      return a;
    },
    /signature is invalid/,
    401,
  );
  await reject(
    (o) => device.get(o, origin, { type: "webauthn.create" }),
    /Unexpected ceremony type/,
  );
  await reject((o) => device.get(o, origin, { rpId: "example.com" }), /another site/);
  await reject((o) => device.get(o, origin, { counter: 1 }), /counter did not advance/, 401);
  await reject(
    async (o) => {
      const a = await device.get(o, origin);
      a.response.userHandle = b64(new TextEncoder().encode("someone-else"));
      return a;
    },
    /user does not match/,
    401,
  );
  const once = await call("/api/auth/passkeys/login/options", {});
  const assertion = await device.get(once, origin);
  await call("/api/auth/passkeys/login/verify", {
    challenge: once.challenge,
    credential: assertion,
  });
  await call(
    "/api/auth/passkeys/login/verify",
    { challenge: once.challenge, credential: assertion },
    { status: 401 },
  );

  // Passkeys and their counters survive a restart; removing one stops it from signing in.
  await mf.dispose();
  mf = new Miniflare(options);
  origin = (await mf.ready).origin.replace("127.0.0.1", "localhost");
  await reject(
    (o) => device.get(o, origin, { counter: device.credentials[0].counter }),
    /counter did not advance/,
    401,
  );
  const removed = await local(`${origin}/api/me/passkeys/${credential.id}`, {
    method: "DELETE",
    headers: { "x-verynize-session": alice.session },
  });
  assert.equal(removed.status, 200);
  await reject((o) => device.get(o, origin), /not registered/, 401);
  assert.equal(
    (
      await local(`${origin}/api/me/passkeys/${credential.id}`, {
        method: "DELETE",
        headers: { "x-verynize-session": direct.session },
      })
    ).status,
    404,
  );
  console.log(
    "PASS passkeys: ceremony page CSP, ticketed registration (ES256 + Ed25519), origin/challenge replay rejection, exclude list, handoff sign-in with secret claim (single use), direct sign-in, tampered signature, ceremony type, RP id, counter regression, user handle, restart persistence, removal",
  );
} finally {
  await mf.dispose();
  await fs.rm(dir, { recursive: true, force: true });
}
