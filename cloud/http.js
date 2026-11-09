import { APIError } from "better-auth/api";

// Shared HTTP helpers for the collaboration Worker and its Durable Objects.
export const MAX_JSON = 2 * 1024 * 1024;
export const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
  // sentry-trace/baggage: distributed tracing from opted-in desktop and web clients.
  "access-control-allow-headers":
    "Content-Type,Authorization,X-Verynize-Session,If-None-Match,sentry-trace,baggage",
  "access-control-expose-headers": "ETag",
};
export const jsonHeaders = {
  "content-type": "application/json",
  "cache-control": "no-store",
  ...corsHeaders,
};
export const json = (data, status = 200) => Response.json(data, { status, headers: jsonHeaders });

/**
 * JSON with a strong ETag of its body; 304 without a body when the request's If-None-Match names
 * it. Still `no-store`: clients send If-None-Match themselves and keep their own copy.
 */
export async function jsonWithEtag(request, data) {
  const body = JSON.stringify(data);
  const etag = `"${(await digestHex(body)).slice(0, 32)}"`;
  const headers = { ...jsonHeaders, etag };
  const known = (request.headers.get("if-none-match") || "").split(",").map((tag) => tag.trim());
  if (known.includes(etag) || known.includes(`W/${etag}`))
    return new Response(null, { status: 304, headers });
  return new Response(body, { status: 200, headers });
}

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
export const fail = (status, message) => {
  throw new HttpError(status, message);
};

export const randomHex = (bytes = 32) =>
  Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (n) =>
    n.toString(16).padStart(2, "0"),
  ).join("");
export const digest = async (text) =>
  new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
export const digestHex = async (text) =>
  Array.from(await digest(text), (n) => n.toString(16).padStart(2, "0")).join("");
export const bytesHex = async (bytes) =>
  Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (n) =>
    n.toString(16).padStart(2, "0"),
  ).join("");

/** Constant-time comparison of two equal-length hex digests. */
export function sameDigest(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  const encoder = new TextEncoder();
  const left = encoder.encode(a),
    right = encoder.encode(b);
  // Workers provide crypto.subtle.timingSafeEqual; other runtimes compare every byte.
  if (crypto.subtle.timingSafeEqual) return crypto.subtle.timingSafeEqual(left, right);
  let difference = left.length ^ right.length;
  for (let i = 0; i < left.length; i++) difference |= left[i] ^ right[i];
  return difference === 0;
}

/** Read a request body as bytes with a hard size limit (streams; never trusts Content-Length alone). */
export async function readBytes(request, limit) {
  if (!request.body) return new Uint8Array(0);
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit)
    fail(413, `Body exceeds ${Math.round(limit / 1024 / 1024)} MB`);
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      fail(413, `Body exceeds ${Math.round(limit / 1024 / 1024)} MB`);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function readJson(request, limit = MAX_JSON) {
  if (!request.body) fail(400, "Missing JSON body");
  const bytes = await readBytes(request, limit);
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    fail(400, "Body must be JSON");
  }
}

export function documentText(document) {
  if (document === null || typeof document !== "object")
    fail(400, "Document must be a JSON object or array");
  const text = JSON.stringify(document);
  if (new TextEncoder().encode(text).length > MAX_JSON - 1024) fail(400, "Document exceeds 2 MB");
  return text;
}

/** Keep client errors distinct from unexpected infrastructure/application failures. */
export function errorStatus(error) {
  if (error instanceof HttpError) return error.status;
  if (error instanceof APIError) return error.statusCode;
  return 500;
}

export const errorResponse = (error) =>
  json({ error: error?.message || "Request failed" }, errorStatus(error));

export const escapeHtml = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );

export const ROLES = ["viewer", "commenter", "editor", "owner"];
export const roleRank = (role) => ROLES.indexOf(role);
export const atLeast = (role, wanted) => roleRank(role) >= roleRank(wanted);

// Durable Object RPC loses custom error fields, so status codes travel in the message.
export const rpcFail = (status, message) => {
  throw new Error(`[${status}] ${message}`);
};
export async function rpc(promise) {
  try {
    return await promise;
  } catch (error) {
    const match = /\[(\d{3})\] ([\s\S]*)$/.exec(error?.message || "");
    if (match) throw new HttpError(Number(match[1]), match[2]);
    throw error;
  }
}
