// Session counts must work after Better Auth's one-day freshness window.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { APIError } from "better-auth/api";
import { errorResponse, HttpError } from "../cloud/http.js";
import { Miniflare, cloudOptions, passwordUser, signIn } from "./cloud-harness.mjs";

for (const [error, status] of [
  [new HttpError(400, "Invalid input"), 400],
  [new HttpError(503, "Unavailable"), 503],
  [new APIError("UNAUTHORIZED", { message: "Unauthorized" }), 401],
  [new APIError("FORBIDDEN", { message: "Session is not fresh", code: "SESSION_NOT_FRESH" }), 403],
  [new APIError("TOO_MANY_REQUESTS", { message: "Try later" }), 429],
  [new APIError("SERVICE_UNAVAILABLE", { message: "Try later" }), 503],
  [new Error("Durable Object exceeded its CPU time limit and was reset"), 500],
  [new Error("Network connection lost"), 500],
  [new Error("Unexpected failure"), 500],
]) {
  const response = errorResponse(error);
  assert.equal(response.status, status);
  assert.deepEqual(await response.json(), { error: error.message });
  assert.equal(response.headers.get("access-control-allow-origin"), "*");
}
console.log("PASS errorResponse: 9 status/message mappings");

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "verynize-session-count-"));
let mf;
try {
  mf = new Miniflare(await cloudOptions(dir));
  const fetchLocal = (url, init) => mf.dispatchFetch(url, init);
  const email = "session-count@example.test";
  const bearer = await passwordUser("http://local", email, "Session Count", fetchLocal);
  const legacy = await signIn("http://local", email, fetchLocal);
  const send = (route, token = bearer, method = "GET") =>
    fetchLocal("http://local" + route, {
      method,
      headers: { "x-verynize-session": token },
    });
  const data = async (response, status) => {
    const body = await response.json();
    assert.equal(response.status, status, JSON.stringify(body));
    return body;
  };
  const db = await mf.getD1Database("DB");
  const user = await db.prepare('SELECT id FROM "user" WHERE email = ?').bind(email).first();
  const now = Date.now();
  const old = new Date(now - 2 * 86400000).toISOString();
  const future = new Date(now + 86400000).toISOString();
  // Another active session and an expired session for this user; a different user's session
  // must not count. Use real D1 rows with the same ISO date storage as Better Auth.
  for (const [id, expires] of [
    ["extra-active", future],
    ["extra-expired", old],
  ]) {
    await db
      .prepare(
        'INSERT INTO "session" (id, token, userId, expiresAt, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .bind(id, id, user.id, expires, old, old)
      .run();
  }
  await passwordUser(
    "http://local",
    "other-session@example.test",
    "Other",
    fetchLocal,
    "192.0.2.2",
  );
  const listed = await data(await send("/api/auth/list-sessions"), 200);
  assert.equal(listed.length, 2);
  const fresh = await data(await send("/api/me"), 200);
  assert.equal(fresh.sessions, listed.length + 1, "includes the legacy session");
  await db.prepare('UPDATE "session" SET createdAt = ? WHERE userId = ?').bind(old, user.id).run();
  await data(await send("/api/auth/list-sessions"), 403);
  const aged = await data(await send("/api/me"), 200);
  assert.equal(aged.sessions, fresh.sessions);
  assert.equal(aged.account.id, fresh.account.id);
  assert.equal(aged.personalOrganizationId, fresh.personalOrganizationId);
  const denied = await data(await send("/api/auth/signout-all", bearer, "POST"), 403);
  assert.equal(denied.error, "Sign in again to sign out other devices");
  assert.equal((await data(await send("/api/me"), 200)).sessions, 3);
  await data(await send("/api/me", legacy.session), 200);
  // Reauthentication keeps the sensitive operation usable and revokes both session types.
  const signedIn = await fetchLocal("http://local/api/auth/sign-in/email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "a long enough password" }),
  });
  assert.equal(signedIn.status, 200);
  const renewed = signedIn.headers.get("set-auth-token");
  const revoked = await data(await send("/api/auth/signout-all", renewed, "POST"), 200);
  assert.equal(revoked.sessions, 4);
  for (const token of [bearer, renewed, legacy.session])
    await data(await send("/api/me", token), 401);
  console.log(
    "PASS session counts: fresh and aged sessions, expiry/user isolation, legacy totals, protected revocation and reauthentication",
  );
} finally {
  await mf?.dispose();
  await fs.rm(dir, { recursive: true, force: true });
}
