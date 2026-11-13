// Room assets: binary files (images, SVG, fonts, video) stored once in the ASSETS_BUCKET R2
// bucket and referenced from the room document by URL, so collaborators receive a short URL
// operation instead of a data URI and no binary data lives in room storage. Metadata lives in D1
// (`room_asset`, cloud/migrations/0004_room_assets.sql). API and the read authorization model:
// cloud/README.md, "Room assets". Server-side extraction of inline data: URLs (room creation,
// snapshot writes, HTTP operations, hosted MCP edits, migration of older rooms) goes through
// storeAsset() from cloud/inline-binaries.js.
//
//   POST /api/rooms/:id/assets {contentType,size,sha256}   editor → {id,url,uploadUrl,method,expiresAt}
//   PUT  /api/rooms/:id/assets/:assetId?expires&signature   signed upload of the raw bytes
//   GET  /api/rooms/:id/assets/:assetId?sig=…               signed read (what documents store)
//   GET  /api/rooms/:id/assets/:assetId                     room viewer (capability or session)
import { and, count, eq } from "drizzle-orm";
import "../web/room-limits.js";
import "../web/storage-limits.js";
import { database } from "./db.js";
import { roomAsset, roomThumbnail } from "./schema.js";
import {
  atLeast,
  bytesHex,
  corsHeaders,
  fail,
  json,
  readBytes,
  readJson,
  sameDigest,
} from "./http.js";

const Limits = globalThis.VerynizeStorageLimits;
export const MAX_ASSET = Limits.ASSET_LIMIT_BYTES;
export const MAX_ASSETS_PER_ROOM = 2000;
export const UPLOAD_TTL = 10 * 60 * 1000;
/** Content type → file extension of what a room asset may hold (web/storage-limits.js ASSET_TYPES). */
export const ASSET_TYPES = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
  "image/svg+xml": "svg",
  "font/woff2": "woff2",
  "font/woff": "woff",
  "font/ttf": "ttf",
  "font/otf": "otf",
  "video/mp4": "mp4",
  "video/webm": "webm",
};
const SHA256 = /^[0-9a-f]{64}$/;
const SIGNATURE = /^[0-9a-f]{64}$/;
const MP4_BRANDS = new Set([
  "isom",
  "iso2",
  "iso4",
  "iso5",
  "iso6",
  "mp41",
  "mp42",
  "mp71",
  "avc1",
  "M4V ",
  "M4VP",
  "dash",
  "qt  ",
]);

/** The content type the bytes really are (magic numbers, or an SVG root element), or null. */
export function sniffAsset(bytes) {
  const at = (offset, text) =>
    [...text].every((char, i) => bytes[offset + i] === char.charCodeAt(0));
  if (
    bytes.length >= 8 &&
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => bytes[i] === b)
  )
    return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return "image/jpeg";
  if (bytes.length >= 6 && (at(0, "GIF87a") || at(0, "GIF89a"))) return "image/gif";
  if (bytes.length >= 12 && at(0, "RIFF") && at(8, "WEBP")) return "image/webp";
  if (bytes.length >= 16 && at(4, "ftyp")) {
    // ISO-BMFF: major brand at 8, compatible brands from 16 up to the end of the ftyp box.
    const boxSize = Math.min(
      bytes.length,
      (bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3],
    );
    const brands = [];
    for (let offset = 8; offset + 4 <= boxSize; offset += offset === 8 ? 8 : 4)
      brands.push(String.fromCharCode(...bytes.subarray(offset, offset + 4)));
    if (brands.some((brand) => brand === "avif" || brand === "avis")) return "image/avif";
    if (brands.some((brand) => MP4_BRANDS.has(brand))) return "video/mp4";
    return null;
  }
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x1a &&
    bytes[1] === 0x45 &&
    bytes[2] === 0xdf &&
    bytes[3] === 0xa3
  )
    return "video/webm";
  if (bytes.length >= 4 && at(0, "wOF2")) return "font/woff2";
  if (bytes.length >= 4 && at(0, "wOFF")) return "font/woff";
  if (bytes.length >= 4 && at(0, "OTTO")) return "font/otf";
  if (
    bytes.length >= 4 &&
    ((bytes[0] === 0 && bytes[1] === 1 && bytes[2] === 0 && bytes[3] === 0) || at(0, "true"))
  )
    return "font/ttf";
  if (isSvg(bytes)) return "image/svg+xml";
  return null;
}
// UTF-8 text whose first element (after an XML declaration, comments and a doctype) is <svg>.
function isSvg(bytes) {
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, 4096));
  } catch {
    // The 4 KB window may end inside a multi-byte character; decode leniently then.
    text = new TextDecoder().decode(bytes.subarray(0, 4096));
    if (text.slice(0, -4).includes("\ufffd")) return false;
  }
  let rest = text.replace(/^\ufeff/, "").trimStart();
  for (;;) {
    const next = rest
      .replace(/^<\?xml[\s\S]*?\?>/, "")
      .replace(/^<!--[\s\S]*?-->/, "")
      .replace(/^<!DOCTYPE\s+svg[^>]*>/i, "")
      .trimStart();
    if (next === rest) break;
    rest = next;
  }
  return /^<svg[\s>/]/.test(rest);
}
const KIND = (type) =>
  type.startsWith("font/") ? "Font" : type.startsWith("video/") ? "Video" : "Image";
const describeTypes = () =>
  "PNG, JPEG, WebP, GIF, AVIF and SVG images, WOFF2, WOFF, TTF and OTF fonts, and MP4 and WebM video";

let cachedKey = null;
async function signingKey(env) {
  const secret = env.ASSET_SIGNING_SECRET;
  if (typeof secret !== "string" || secret.length < 16)
    fail(503, "Room assets are not configured on this server");
  if (cachedKey?.secret !== secret)
    cachedKey = {
      secret,
      key: crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
      ),
    };
  return cachedKey.key;
}
async function sign(env, ...parts) {
  const mac = await crypto.subtle.sign(
    "HMAC",
    await signingKey(env),
    new TextEncoder().encode(["verynize-room-asset-v1", ...parts].join("\n")),
  );
  return Array.from(new Uint8Array(mac), (n) => n.toString(16).padStart(2, "0")).join("");
}
const readSignature = (env, roomId, assetId) => sign(env, "read", roomId, assetId);
const uploadSignature = (env, row, expires) =>
  sign(
    env,
    "put",
    row.roomId,
    row.id,
    row.sha256,
    String(row.size),
    row.contentType,
    String(expires),
  );

const objectKey = (row) => `rooms/${row.roomId}/${row.sha256}`;
const assetPath = (roomId, assetId) => `/api/rooms/${roomId}/assets/${assetId}`;
/** The stable, signed read URL stored in documents (see "Room assets" in cloud/README.md). */
async function readUrl(env, origin, row) {
  return `${origin}${assetPath(row.roomId, row.id)}?sig=${await readSignature(env, row.roomId, row.id)}`;
}
const describe = async (env, origin, row) => ({
  id: row.id,
  url: await readUrl(env, origin, row),
  contentType: row.contentType,
  size: row.size,
  sha256: row.sha256,
});

function configured(env) {
  if (!env.ASSETS_BUCKET || !env.DB) fail(503, "Room assets are not configured on this server");
}
const find = (env, roomId, assetId) =>
  database(env)
    .select()
    .from(roomAsset)
    .where(and(eq(roomAsset.roomId, roomId), eq(roomAsset.id, assetId)))
    .get();

function checkDeclaration(rawType, size) {
  const contentType = String(rawType || "").toLowerCase();
  if (!ASSET_TYPES[contentType]) fail(415, `Only ${describeTypes()} can be uploaded`);
  if (!Number.isSafeInteger(size) || size < 1 || size > MAX_ASSET)
    fail(
      413,
      `${KIND(contentType)} files must be between 1 byte and ${MAX_ASSET / 1024 / 1024} MB; this one is larger than the upload limit`,
    );
  return contentType;
}
function checkSniffed(bytes, contentType) {
  const sniffed = sniffAsset(bytes);
  if (sniffed !== contentType)
    fail(
      415,
      `The uploaded bytes are ${sniffed || "not a supported file type"}, not ${contentType}`,
    );
}

/** The room's row for these bytes: an existing one (ready or pending) or a new pending one. */
async function register(env, roomId, sha256, size, contentType, accountId) {
  const db = database(env);
  const byHash = () =>
    db
      .select()
      .from(roomAsset)
      .where(and(eq(roomAsset.roomId, roomId), eq(roomAsset.sha256, sha256)))
      .get();
  let row = await byHash();
  if (row?.status === "ready") return row;
  if (row) {
    // A pending registration of the same bytes: take the new declaration.
    if (row.size !== size || row.contentType !== contentType)
      await db.update(roomAsset).set({ size, contentType }).where(eq(roomAsset.id, row.id));
    return { ...row, size, contentType };
  }
  const [{ total }] = await db
    .select({ total: count() })
    .from(roomAsset)
    .where(eq(roomAsset.roomId, roomId));
  if (total >= MAX_ASSETS_PER_ROOM)
    fail(507, `This room has reached its limit of ${MAX_ASSETS_PER_ROOM} assets`);
  await db
    .insert(roomAsset)
    .values({
      id: crypto.randomUUID(),
      roomId,
      sha256,
      size,
      contentType,
      status: "pending",
      createdBy: accountId || null,
      createdAt: Date.now(),
      uploadedAt: null,
    })
    .onConflictDoNothing();
  // A concurrent registration of the same bytes wins; use its row.
  return byHash();
}
async function putObject(env, row, bytes) {
  await env.ASSETS_BUCKET.put(objectKey(row), bytes, {
    httpMetadata: { contentType: row.contentType },
    sha256: row.sha256,
    customMetadata: { roomId: row.roomId, assetId: row.id },
  });
  await database(env)
    .update(roomAsset)
    .set({ status: "ready", uploadedAt: Date.now() })
    .where(eq(roomAsset.id, row.id));
}

/** True when this server stores room assets (R2 bucket, D1 and a signing secret). */
export const assetsConfigured = (env) =>
  !!(
    env.ASSETS_BUCKET &&
    env.DB &&
    typeof env.ASSET_SIGNING_SECRET === "string" &&
    env.ASSET_SIGNING_SECRET.length >= 16
  );

/**
 * Store bytes the server already holds (an inline data: URL extracted from a document) as an
 * asset of `roomId`, checked like an upload (type, size, magic number), deduplicated by sha256.
 * Returns {id, url, contentType, size, sha256, existing}. The caller checked the editor role.
 */
export async function storeAsset(env, origin, roomId, bytes, contentType, accountId) {
  configured(env);
  const type = checkDeclaration(contentType, bytes.byteLength);
  checkSniffed(bytes, type);
  const sha256 = await bytesHex(bytes);
  const row = await register(env, roomId, sha256, bytes.byteLength, type, accountId);
  if (row.status === "ready") return { ...(await describe(env, origin, row)), existing: true };
  await putObject(env, row, bytes);
  return { ...(await describe(env, origin, row)), existing: false };
}

/** POST /api/rooms/:id/assets: register an upload (or find the room's copy of these bytes). */
async function createAsset(request, env, url, roomId, access) {
  const { role, account } = await access();
  if (!role) fail(401, "Unauthorized");
  if (!atLeast(role, "editor")) fail(403, `This needs the editor role; you are a ${role}`);
  const data = await readJson(request, 16 * 1024);
  const contentType = checkDeclaration(data.contentType, data.size);
  const sha256 = String(data.sha256 || "").toLowerCase();
  if (!SHA256.test(sha256)) fail(400, "sha256 must be 64 hex characters");
  let row = await register(env, roomId, sha256, data.size, contentType, account?.id);
  if (row.status === "ready")
    return json({ ...(await describe(env, url.origin, row)), existing: true });
  const expires = Date.now() + UPLOAD_TTL;
  const signature = await uploadSignature(env, row, expires);
  return json(
    {
      ...(await describe(env, url.origin, row)),
      existing: false,
      method: "PUT",
      uploadUrl: `${url.origin}${assetPath(roomId, row.id)}?expires=${expires}&signature=${signature}`,
      expiresAt: expires,
    },
    201,
  );
}

/** PUT <uploadUrl>: the raw bytes, checked against the registration. */
async function uploadAsset(request, env, url, roomId, assetId) {
  const expires = Number(url.searchParams.get("expires"));
  const signature = url.searchParams.get("signature") || "";
  if (!Number.isSafeInteger(expires) || !SIGNATURE.test(signature))
    fail(403, "Upload URL is invalid");
  const row = await find(env, roomId, assetId);
  if (!row) fail(403, "Upload URL is invalid");
  if (!sameDigest(signature, await uploadSignature(env, row, expires)))
    fail(403, "Upload URL is invalid");
  if (expires < Date.now()) fail(403, "Upload URL has expired; register the file again");
  if (expires > Date.now() + UPLOAD_TTL + 60_000) fail(403, "Upload URL is invalid");
  if (row.status === "ready") {
    await request.body?.cancel();
    return json({ ...(await describe(env, url.origin, row)), existing: true });
  }
  const bytes = await readBytes(request, row.size);
  if (bytes.byteLength !== row.size)
    fail(400, `Expected ${row.size} bytes, received ${bytes.byteLength}`);
  if ((await bytesHex(bytes)) !== row.sha256) fail(400, "The uploaded bytes do not match sha256");
  checkSniffed(bytes, row.contentType);
  await putObject(env, row, bytes);
  return json({ ...(await describe(env, url.origin, row)), existing: false });
}

/** GET|HEAD: a signed read URL, or room viewer access through headers. */
async function serveAsset(request, env, url, roomId, assetId, access) {
  const sig = url.searchParams.get("sig");
  if (sig !== null) {
    if (!SIGNATURE.test(sig) || !sameDigest(sig, await readSignature(env, roomId, assetId)))
      fail(403, "Asset URL is invalid");
  } else if (!(await access()).role) fail(401, "Unauthorized");
  const row = await find(env, roomId, assetId);
  if (!row || row.status !== "ready") fail(404, "Asset not found");
  const etag = `"${row.sha256}"`;
  const headers = new Headers({
    ...corsHeaders,
    "content-type": row.contentType,
    "x-content-type-options": "nosniff",
    // Private: browsers keep the bytes (the URL is immutable), shared caches do not.
    "cache-control": "private, max-age=31536000, immutable",
    etag,
    // SVG documents may style themselves and embed data: images, never run script or fetch.
    "content-security-policy":
      row.contentType === "image/svg+xml"
        ? "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; sandbox"
        : "default-src 'none'; sandbox",
    "content-disposition": `inline; filename="${row.id}.${ASSET_TYPES[row.contentType]}"`,
    "cross-origin-resource-policy": "cross-origin",
    "referrer-policy": "no-referrer",
  });
  if (request.headers.get("if-none-match") === etag)
    return new Response(null, { status: 304, headers });
  const object = await env.ASSETS_BUCKET.get(objectKey(row));
  if (!object) fail(404, "Asset not found");
  headers.set("content-length", String(object.size));
  return new Response(request.method === "HEAD" ? null : object.body, { status: 200, headers });
}

/**
 * Route /api/rooms/:id/assets[/:assetId]. `access()` resolves the caller's room role through the
 * room (`{role, account}`; role is null without access) and is only called when needed.
 */
export async function handleRoomAssets(request, env, url, roomId, assetId, access) {
  configured(env);
  if (!assetId && request.method === "POST") return createAsset(request, env, url, roomId, access);
  if (assetId && request.method === "PUT") return uploadAsset(request, env, url, roomId, assetId);
  if (assetId && ["GET", "HEAD"].includes(request.method))
    return serveAsset(request, env, url, roomId, assetId, access);
  return json({ error: "Not found" }, 404);
}

// Covers have a reserved, mutable key: never a room_asset row or a SHA-256 asset key.
export const MAX_THUMBNAIL = 2 * 1024 * 1024;
const thumbnailKey = (roomId) => `rooms/${roomId}/thumbnail`;
const thumbnailSignature = (env, roomId, sha256) => sign(env, "thumbnail-read", roomId, sha256);

async function serveThumbnail(request, env, url, roomId, access) {
  const version = url.searchParams.get("v");
  const sig = url.searchParams.get("sig");
  if (sig !== null) {
    if (
      !SHA256.test(version || "") ||
      !SIGNATURE.test(sig) ||
      !sameDigest(sig, await thumbnailSignature(env, roomId, version))
    )
      fail(403, "Thumbnail URL is invalid");
  } else if (!(await access()).role) fail(401, "Unauthorized");
  const row = await database(env)
    .select()
    .from(roomThumbnail)
    .where(eq(roomThumbnail.roomId, roomId))
    .get();
  if (!row || (version !== null && version !== row.sha256)) fail(404, "Thumbnail not found");
  const object = await env.ASSETS_BUCKET.get(thumbnailKey(roomId));
  if (!object) fail(404, "Thumbnail not found");
  // Never label bytes from a concurrent overwrite with another version's hash.
  if (object.customMetadata?.sha256 !== row.sha256) fail(409, "Thumbnail is changing; retry");
  const etag = `"${row.sha256}"`;
  const headers = new Headers({
    ...corsHeaders,
    "content-type": row.contentType,
    "content-length": String(object.size),
    "x-content-type-options": "nosniff",
    "cache-control": "private, no-cache",
    "content-security-policy": "default-src 'none'; sandbox",
    "content-disposition": "inline",
    "cross-origin-resource-policy": "cross-origin",
    "referrer-policy": "no-referrer",
    etag,
  });
  const matches = (request.headers.get("if-none-match") || "")
    .split(",")
    .some((value) => value.trim().replace(/^W\//, "") === etag || value.trim() === "*");
  if (matches) {
    headers.delete("content-length");
    await object.body.cancel();
    return new Response(null, { status: 304, headers });
  }
  if (request.method === "HEAD") await object.body.cancel();
  return new Response(request.method === "HEAD" ? null : object.body, { headers });
}

/** One independently stored raster cover per room; metadata never enters the document. */
export async function handleRoomThumbnail(request, env, url, roomId, access) {
  configured(env);
  if (url.pathname.endsWith("/image")) {
    if (["GET", "HEAD"].includes(request.method))
      return serveThumbnail(request, env, url, roomId, access);
    return json({ error: "Not found" }, 404);
  }
  const { role } = await access();
  if (!role) fail(401, "Unauthorized");
  if (!["GET", "PUT", "DELETE"].includes(request.method)) return json({ error: "Not found" }, 404);
  if (request.method !== "GET" && !atLeast(role, "editor"))
    fail(403, `This needs the editor role; you are a ${role}`);
  const db = database(env);
  const answer = (thumbnail) => {
    const response = json({ thumbnail });
    response.headers.set("cache-control", "private, no-store");
    return response;
  };
  const describeThumbnail = async (row) => ({
    url: `${url.origin}/api/rooms/${roomId}/thumbnail/image?v=${row.sha256}&sig=${await thumbnailSignature(env, roomId, row.sha256)}`,
    nodeId: row.nodeId,
    pageId: row.pageId,
    sha256: row.sha256,
    contentType: row.contentType,
    size: row.size,
    updatedAt: row.updatedAt,
  });
  if (request.method === "DELETE") {
    await env.ROOMS.getByName(roomId).writeThumbnail(roomId, null, null);
    return answer(null);
  }
  if (request.method === "PUT") {
    const nodeId = url.searchParams.get("nodeId") || null;
    const pageId = url.searchParams.get("pageId");
    const validId = (value) =>
      typeof value === "string" && value.trim().length > 0 && value.length <= 200;
    if (
      (nodeId === null ? !validId(pageId) : !validId(nodeId)) ||
      (pageId !== null && !validId(pageId))
    )
      fail(
        400,
        "A thumbnail needs nodeId, or pageId when nodeId is empty (IDs up to 200 characters)",
      );
    const contentType = (request.headers.get("content-type") || "")
      .split(";")[0]
      .trim()
      .toLowerCase();
    if (!["image/png", "image/jpeg", "image/webp"].includes(contentType))
      fail(415, "File thumbnails must be PNG, JPEG or WebP images");
    const bytes = await readBytes(request, MAX_THUMBNAIL);
    if (!bytes.length) fail(400, "Thumbnail image body is empty");
    checkSniffed(bytes, contentType);
    const sha256 = await bytesHex(bytes);
    const row = {
      roomId,
      sha256,
      contentType,
      size: bytes.length,
      nodeId,
      pageId,
      updatedAt: Date.now(),
    };
    // Resolve signing configuration before making any storage changes.
    const description = await describeThumbnail(row);
    await env.ROOMS.getByName(roomId).writeThumbnail(roomId, row, bytes);
    return answer(description);
  }
  const row = await db.select().from(roomThumbnail).where(eq(roomThumbnail.roomId, roomId)).get();
  return answer(row ? await describeThumbnail(row) : null);
}

/** Called only by the room's serialized writer, after the Worker validates access and bytes. */
export async function storeRoomThumbnail(env, roomId, row, bytes) {
  const db = database(env);
  if (!row) {
    await env.ASSETS_BUCKET.delete(thumbnailKey(roomId));
    await db.delete(roomThumbnail).where(eq(roomThumbnail.roomId, roomId));
    return;
  }
  await env.ASSETS_BUCKET.put(thumbnailKey(roomId), bytes, {
    httpMetadata: { contentType: row.contentType },
    customMetadata: { sha256: row.sha256 },
  });
  await db.insert(roomThumbnail).values(row).onConflictDoUpdate({
    target: roomThumbnail.roomId,
    set: row,
  });
}
