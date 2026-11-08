// Per-account model API credentials (docs/ai-runtime.md "Credentials"): each account brings its
// own OpenRouter key, connected with OpenRouter's OAuth PKCE flow or pasted by hand. The key is
// stored in the backend database (migration 0007, table ai_credential) encrypted with AES-GCM
// under a key derived with HKDF-SHA256 from BETTER_AUTH_SECRET (info "verynize-ai-credentials-v1"),
// so the operator sets no new secret. The additional data of each ciphertext is
// "<accountId>:<provider>", so a row copied to another account does not decrypt. WebCrypto only:
// the same code runs on workerd, Node and Vercel.
//
// The plaintext key is decrypted per run by resolveProvider (cloud/ai.js) and handed to the
// provider adapter; it is never returned to the browser, stored elsewhere, or logged.
//
// OAuth state: a pending sign-in is a row in ai_oauth_state (cross-instance: the callback may land
// on any instance), keyed by SHA-256 of the random state value, holding the encrypted PKCE verifier,
// the account that started it, the SHA-256 of a browser nonce (HttpOnly cookie set by the start
// response) and a same-origin return path. The callback is a top-level navigation from
// openrouter.ai without the session header, so it authenticates through that row: it must exist,
// be unexpired, be claimed once (deleted on use) and come with the same browser's cookie. The
// cookie stops a forwarded authorize link from attaching the clicker's OpenRouter key to the
// account of whoever started the flow.
import { and, eq, lt } from "drizzle-orm";
import {
  createS256CodeChallenge,
  exchangeOpenRouterCode,
  generateCodeVerifier,
} from "@tanstack/ai-openrouter/pkce";
import { database } from "./db.js";
import { aiCredential, aiOauthState } from "./schema.js";
import { digestHex, sameDigest } from "./http.js";

export const OPENROUTER = "openrouter";
export const DEFAULT_OPENROUTER_BASE = "https://openrouter.ai/api/v1";
const HKDF_INFO = "verynize-ai-credentials-v1";
const HKDF_SALT = "verynize-ai-credentials";
export const OAUTH_TTL_MS = 10 * 60_000;
export const OAUTH_COOKIE = "vz_openrouter_oauth";
export const OAUTH_PATH = "/api/ai/credentials/openrouter/oauth";
export const DEFAULT_RETURN = "/settings/agents";
const encoder = new TextEncoder();
const decoder = new TextDecoder();

const toBase64 = (bytes) => {
  let binary = "";
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary);
};
const fromBase64 = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
const randomToken = (bytes = 32) =>
  toBase64(crypto.getRandomValues(new Uint8Array(bytes)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

/** The OpenRouter API base (`OPENROUTER_BASE_URL`, tests point it at a local fake). */
export const openRouterBase = (env) =>
  String(env.OPENROUTER_BASE_URL || DEFAULT_OPENROUTER_BASE).replace(/\/+$/, "");

/** OpenRouter's sign-in page: `/auth` on the API's origin (https://openrouter.ai/auth). */
export const openRouterAuthUrl = (env) => new URL("/auth", openRouterBase(env)).toString();

/** The AES-GCM key of this deployment, derived from BETTER_AUTH_SECRET (HKDF-SHA256). */
async function credentialKey(secret) {
  if (!secret) throw Error("BETTER_AUTH_SECRET is not set");
  const material = await crypto.subtle.importKey("raw", encoder.encode(secret), "HKDF", false, [
    "deriveKey",
  ]);
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: encoder.encode(HKDF_SALT),
      info: encoder.encode(HKDF_INFO),
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/** Encrypt `plaintext` bound to `context` (additional data). Returns base64 `{ciphertext, iv}`. */
export async function sealSecret(secret, plaintext, context) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: encoder.encode(context) },
    await credentialKey(secret),
    encoder.encode(plaintext),
  );
  return { ciphertext: toBase64(sealed), iv: toBase64(iv) };
}

/** Decrypt a sealSecret result; throws when the secret, context or ciphertext differ. */
export async function openSecret(secret, { ciphertext, iv }, context) {
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64(iv), additionalData: encoder.encode(context) },
    await credentialKey(secret),
    fromBase64(ciphertext),
  );
  return decoder.decode(plain);
}

const credentialContext = (accountId, provider) => `${accountId}:${provider}`;

/** The stored credential row of an account (no plaintext), or undefined. */
export const credentialRow = (env, accountId, provider = OPENROUTER) =>
  database(env)
    .select()
    .from(aiCredential)
    .where(and(eq(aiCredential.accountId, accountId), eq(aiCredential.provider, provider)))
    .get();

/**
 * The account's plaintext key, or null when none is stored or it cannot be decrypted (for
 * example after BETTER_AUTH_SECRET changed: the user reconnects).
 */
export async function readCredential(env, accountId, provider = OPENROUTER) {
  const row = await credentialRow(env, accountId, provider);
  if (!row) return null;
  try {
    return await openSecret(env.BETTER_AUTH_SECRET, row, credentialContext(accountId, provider));
  } catch {
    console.error("ai credential could not be decrypted", provider);
    return null;
  }
}

/** Store (insert or replace) the account's key, encrypted. */
export async function saveCredential(env, accountId, { apiKey, source, label }, now = Date.now()) {
  const provider = OPENROUTER;
  const sealed = await sealSecret(
    env.BETTER_AUTH_SECRET,
    apiKey,
    credentialContext(accountId, provider),
  );
  const fields = {
    ...sealed,
    last4: apiKey.slice(-4),
    label: label ? String(label).slice(0, 120) : null,
    source,
    updatedAt: now,
  };
  await database(env)
    .insert(aiCredential)
    .values({ accountId, provider, ...fields, createdAt: now })
    .onConflictDoUpdate({ target: [aiCredential.accountId, aiCredential.provider], set: fields })
    .run();
}

export async function deleteCredential(env, accountId, provider = OPENROUTER) {
  const result = await database(env)
    .delete(aiCredential)
    .where(and(eq(aiCredential.accountId, accountId), eq(aiCredential.provider, provider)))
    .run();
  return !!result.meta?.changes;
}

/**
 * GET <base>/key with the key: `{ok: true, info}` (OpenRouter's `data`: label, limit, usage,
 * limit_remaining, …), `{ok: false, status}` when OpenRouter refuses it (401/402/403), or throws
 * when OpenRouter cannot be reached.
 */
export async function checkOpenRouterKey(env, apiKey, signal) {
  const response = await fetch(`${openRouterBase(env)}/key`, {
    headers: { authorization: `Bearer ${apiKey}` },
    signal,
  });
  if (response.ok) {
    const body = await response.json().catch(() => null);
    return { ok: true, info: body?.data && typeof body.data === "object" ? body.data : {} };
  }
  await response.body?.cancel();
  if ([400, 401, 402, 403].includes(response.status)) return { ok: false, status: response.status };
  throw Error(`OpenRouter answered ${response.status}`);
}

/**
 * A safe same-origin return path (pathname + search, no fragment) for the end of the OAuth flow,
 * or DEFAULT_RETURN. Never an absolute or protocol-relative URL (no open redirect).
 */
export function safeReturnPath(value, origin) {
  if (typeof value !== "string" || value.length > 512 || !/^\/(?![/\\])/.test(value))
    return DEFAULT_RETURN;
  // No backslashes or control characters (browsers treat some as path separators or drop them).
  if (value.includes("\\") || value.split("").some((c) => c.charCodeAt(0) < 0x20 || c === "\x7f"))
    return DEFAULT_RETURN;
  try {
    const url = new URL(value, origin);
    if (url.origin !== origin) return DEFAULT_RETURN;
    url.searchParams.delete("openrouter");
    url.searchParams.delete("openrouter_error");
    return url.pathname + url.search;
  } catch {
    return DEFAULT_RETURN;
  }
}

/**
 * Begin an OpenRouter PKCE sign-in for `accountId`. Returns the authorize URL and the browser
 * nonce to set as the HttpOnly cookie. Expired pending sign-ins are swept here.
 */
export async function startOAuth(env, { accountId, origin, returnTo }, now = Date.now()) {
  const db = database(env);
  await db.delete(aiOauthState).where(lt(aiOauthState.expiresAt, now)).run();
  const state = randomToken(32);
  const browser = randomToken(32);
  const verifier = generateCodeVerifier(64);
  const challenge = await createS256CodeChallenge(verifier);
  const stateHash = await digestHex(state);
  const sealed = await sealSecret(env.BETTER_AUTH_SECRET, verifier, `oauth:${stateHash}`);
  await db
    .insert(aiOauthState)
    .values({
      stateHash,
      accountId,
      provider: OPENROUTER,
      verifier: sealed.ciphertext,
      iv: sealed.iv,
      browserHash: await digestHex(browser),
      returnTo: safeReturnPath(returnTo, origin),
      expiresAt: now + OAUTH_TTL_MS,
      createdAt: now,
    })
    .run();
  const url = new URL(openRouterAuthUrl(env));
  url.searchParams.set("callback_url", `${origin}${OAUTH_PATH}/callback`);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", state);
  url.searchParams.set("key_label", "Verynize");
  return { authorizeUrl: url.toString(), browser };
}

/**
 * Claim the pending sign-in of `state` once: it is deleted whatever happens next, so a state is
 * never usable twice. Returns `{accountId, verifier, returnTo}` or an `{error}` code:
 * `invalid_state` (unknown, replayed or forged), `expired`, `wrong_browser` (cookie missing or
 * from another flow).
 */
export async function claimOAuth(env, { state, browser }, now = Date.now()) {
  if (typeof state !== "string" || !/^[\w-]{20,128}$/.test(state))
    return { error: "invalid_state" };
  const db = database(env);
  const stateHash = await digestHex(state);
  const row = await db
    .select()
    .from(aiOauthState)
    .where(eq(aiOauthState.stateHash, stateHash))
    .get();
  if (!row) return { error: "invalid_state" };
  const claimed = await db.delete(aiOauthState).where(eq(aiOauthState.stateHash, stateHash)).run();
  if (!claimed.meta?.changes) return { error: "invalid_state" };
  if (row.expiresAt < now) return { error: "expired", returnTo: row.returnTo };
  if (!browser || !sameDigest(await digestHex(browser), row.browserHash))
    return { error: "wrong_browser", returnTo: row.returnTo };
  const verifier = await openSecret(
    env.BETTER_AUTH_SECRET,
    { ciphertext: row.verifier, iv: row.iv },
    `oauth:${stateHash}`,
  );
  return { accountId: row.accountId, verifier, returnTo: row.returnTo };
}

/** The URL of a fetch() input (string, URL or Request). */
const urlOf = (input) =>
  typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

/**
 * Exchange an authorization code for the user's key at <base>/auth/keys (POST {code,
 * code_verifier, code_challenge_method}) with @tanstack/ai-openrouter's PKCE helper; its fixed
 * openrouter.ai URL is mapped onto OPENROUTER_BASE_URL.
 */
export function exchangeOAuthCode(env, { code, verifier }) {
  const base = openRouterBase(env);
  return exchangeOpenRouterCode({
    code,
    codeVerifier: verifier,
    codeChallengeMethod: "S256",
    fetchImpl: (input, init) => fetch(urlOf(input).replace(DEFAULT_OPENROUTER_BASE, base), init),
  });
}
