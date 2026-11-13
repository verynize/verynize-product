// Stock photos and remote images for designs. Canvas image nodes only render embedded data: URLs, so
// remote photos are downloaded (https only, type-sniffed, size-capped) and embedded. Unsplash is used when
// an access key is configured (UNSPLASH_ACCESS_KEY or {accessKey}); otherwise the keyless Openverse API
// (commercially usable licenses only). Network is fully injectable through the `fetch` option.
import { isIP } from "node:net";
import { sanitizeSvg } from "./assets.mjs";

export const UNSPLASH_API = "https://api.unsplash.com/search/photos";
export const OPENVERSE_API = "https://api.openverse.org/v1/images/";
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const USER_AGENT = "Verynize/0.4 (+https://github.com/verynize)";

function withTimeout(fetchImpl, ms) {
  const f = fetchImpl || globalThis.fetch;
  return (url, opts = {}) =>
    f(url, { redirect: "follow", signal: AbortSignal.timeout(ms), ...opts });
}
const errText = (e) => (e?.name === "TimeoutError" ? "timed out" : e?.message || String(e));

/** https URL to a public host (no credentials, localhost or private/link-local IP literals). */
export function isSafeRemoteUrl(value) {
  let u;
  try {
    u = new URL(value);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" || u.username || u.password) return false;
  const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  )
    return false;
  if (isIP(host) === 4) {
    const [a, b] = host.split(".").map(Number);
    if (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      a >= 224
    )
      return false;
  }
  if (
    isIP(host) === 6 &&
    (host === "::1" ||
      host === "::" ||
      /^(fc|fd|fe8|fe9|fea|feb)/.test(host) ||
      host.startsWith("::ffff:"))
  )
    return false;
  return true;
}

const ORIENTATION = {
  unsplash: {
    landscape: "landscape",
    wide: "landscape",
    portrait: "portrait",
    tall: "portrait",
    square: "squarish",
    squarish: "squarish",
  },
  openverse: {
    landscape: "wide",
    wide: "wide",
    portrait: "tall",
    tall: "tall",
    square: "square",
    squarish: "square",
  },
};

function unsplashResult(p) {
  const raw = p?.urls?.raw;
  const url = raw
    ? `${raw}${raw.includes("?") ? "&" : "?"}w=1600&q=80&fm=jpg&fit=max`
    : p?.urls?.regular;
  return {
    url,
    thumbnail: p?.urls?.small,
    width: p?.width,
    height: p?.height,
    alt: p?.alt_description || p?.description || "",
    author: p?.user?.name || "",
    authorUrl: p?.user?.links?.html
      ? `${p.user.links.html}?utm_source=verynize&utm_medium=referral`
      : "",
    license: "Unsplash License",
    licenseUrl: "https://unsplash.com/license",
    pageUrl: p?.links?.html || "",
    source: "unsplash",
    downloadLocation: p?.links?.download_location || "",
    color: p?.color,
  };
}
function openverseResult(r) {
  const license = r?.license
    ? `${r.license === "cc0" || r.license === "pdm" ? r.license.toUpperCase() : "CC " + r.license.toUpperCase()}${r.license_version ? " " + r.license_version : ""}`
    : "";
  return {
    url: r?.url,
    thumbnail: r?.thumbnail,
    width: r?.width ?? null,
    height: r?.height ?? null,
    alt: r?.title || "",
    author: r?.creator || "",
    authorUrl: r?.creator_url || "",
    license,
    licenseUrl: r?.license_url || "",
    pageUrl: r?.foreign_landing_url || "",
    source: "openverse",
    provider: r?.provider || r?.source || "",
    attributionText: r?.attribution || "",
  };
}

/**
 * Search stock photos. -> {results:[{url, width, height, alt, author, authorUrl, license, licenseUrl, pageUrl, source, ...}], source, error?}
 * Never throws; network/API failures come back as {results:[], error}.
 */
export async function searchStockPhotos(
  query,
  { orientation, count = 6, fetch, accessKey = process.env.UNSPLASH_ACCESS_KEY, timeoutMs } = {},
) {
  const q = String(query || "")
    .trim()
    .slice(0, 200);
  if (!q) return { results: [], source: null, error: "empty query" };
  const n = Math.max(1, Math.min(20, Number(count) || 6));
  // Openverse answers uncached queries slowly (~30 s observed); Unsplash is fast.
  const get = withTimeout(fetch, timeoutMs ?? (accessKey ? 15000 : 45000));
  if (accessKey) {
    const params = new URLSearchParams({ query: q, per_page: String(n), content_filter: "high" });
    if (ORIENTATION.unsplash[orientation])
      params.set("orientation", ORIENTATION.unsplash[orientation]);
    try {
      const res = await get(`${UNSPLASH_API}?${params}`, {
        headers: {
          authorization: `Client-ID ${accessKey}`,
          "accept-version": "v1",
          "user-agent": USER_AGENT,
        },
      });
      if (!res.ok) return { results: [], source: "unsplash", error: `Unsplash HTTP ${res.status}` };
      const body = await res.json();
      const results = (body?.results || [])
        .map(unsplashResult)
        .filter((r) => isSafeRemoteUrl(r.url));
      return { results, source: "unsplash" };
    } catch (e) {
      return { results: [], source: "unsplash", error: `Unsplash: ${errText(e)}` };
    }
  }
  const params = new URLSearchParams({
    q,
    license_type: "commercial",
    page_size: String(n),
    mature: "false",
  });
  if (ORIENTATION.openverse[orientation])
    params.set("aspect_ratio", ORIENTATION.openverse[orientation]);
  try {
    const res = await get(`${OPENVERSE_API}?${params}`, {
      headers: { accept: "application/json", "user-agent": USER_AGENT },
    });
    if (!res.ok) return { results: [], source: "openverse", error: `Openverse HTTP ${res.status}` };
    const body = await res.json();
    const results = (body?.results || [])
      .map(openverseResult)
      .filter((r) => isSafeRemoteUrl(r.url));
    return { results, source: "openverse" };
  } catch (e) {
    return { results: [], source: "openverse", error: `Openverse: ${errText(e)}` };
  }
}

/** Unsplash API guidelines: ping download_location when a photo is actually used. Never throws. */
export async function trackUnsplashDownload(
  photo,
  { fetch, accessKey = process.env.UNSPLASH_ACCESS_KEY } = {},
) {
  if (
    !accessKey ||
    !photo?.downloadLocation ||
    !photo.downloadLocation.startsWith("https://api.unsplash.com/")
  )
    return false;
  try {
    const res = await withTimeout(fetch, 10000)(photo.downloadLocation, {
      headers: { authorization: `Client-ID ${accessKey}` },
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Human-readable credit line. */
export function attribution(photo) {
  if (!photo) return "";
  if (photo.source === "unsplash") return `Photo by ${photo.author || "unknown"} on Unsplash`;
  if (photo.attributionText) return photo.attributionText;
  const title = photo.alt ? `"${photo.alt}"` : "Photo";
  return `${title}${photo.author ? ` by ${photo.author}` : ""}${photo.license ? `, ${photo.license}` : ""}${photo.provider ? ` (via ${photo.provider}, Openverse)` : ""}`;
}

// ---- download & embed -------------------------------------------------------------------------
export function sniffImageType(buf) {
  if (buf.length >= 8 && buf[0] === 0x89 && buf.subarray(1, 4).toString("latin1") === "PNG")
    return "image/png";
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length >= 6 && /^GIF8[79]a$/.test(buf.subarray(0, 6).toString("latin1")))
    return "image/gif";
  if (
    buf.length >= 12 &&
    buf.subarray(0, 4).toString("latin1") === "RIFF" &&
    buf.subarray(8, 12).toString("latin1") === "WEBP"
  )
    return "image/webp";
  const head = buf.subarray(0, 1024).toString("utf8").replace(/^﻿/, "").trimStart();
  if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE svg[^>]*>\s*)?<svg[\s>]/i.test(head))
    return "image/svg+xml";
  return null;
}

/** Intrinsic pixel size for png/gif/jpeg/webp (svg: width/height or viewBox). null if unknown. */
export function imageSize(buf, type = sniffImageType(buf)) {
  try {
    if (type === "image/png") return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    if (type === "image/gif") return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
    if (type === "image/webp") {
      const chunk = buf.subarray(12, 16).toString("latin1");
      if (chunk === "VP8 ")
        return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
      if (chunk === "VP8L") {
        const b = buf.readUInt32LE(21);
        return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 };
      }
      if (chunk === "VP8X")
        return { width: buf.readUIntLE(24, 3) + 1, height: buf.readUIntLE(27, 3) + 1 };
    }
    if (type === "image/jpeg") {
      let i = 2;
      while (i + 9 < buf.length) {
        if (buf[i] !== 0xff) {
          i++;
          continue;
        }
        const marker = buf[i + 1];
        if (
          marker === 0xd8 ||
          marker === 0x01 ||
          (marker >= 0xd0 && marker <= 0xd7) ||
          marker === 0xff
        ) {
          i += marker === 0xff ? 1 : 2;
          continue;
        }
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker))
          return { width: buf.readUInt16BE(i + 7), height: buf.readUInt16BE(i + 5) };
        i += 2 + buf.readUInt16BE(i + 2);
      }
    }
    if (type === "image/svg+xml") {
      const tag = buf.toString("utf8").match(/<svg\b[^>]*>/i)?.[0] || "";
      const num = (k) =>
        Number(tag.match(new RegExp(`\\s${k}\\s*=\\s*["']?([\\d.]+)(px)?["'\\s>]`))?.[1]);
      const vb = tag.match(
        /viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i,
      );
      const width = num("width") || Number(vb?.[1]),
        height = num("height") || Number(vb?.[2]);
      if (width > 0 && height > 0) return { width, height };
    }
  } catch {}
  return null;
}

const ALLOWED_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/svg+xml",
]);

async function readCapped(res, maxBytes) {
  if (!res.body?.getReader) {
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > maxBytes) throw Error(`image exceeds ${maxBytes} bytes`);
    return buf;
  }
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw Error(`image exceeds ${maxBytes} bytes`);
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

/**
 * Download an https image and embed it. -> {ok:true, dataUrl, mimeType, bytes, width, height} | {ok:false, error}
 * Accepts png/jpeg/webp/gif and SVG (sanitized). Existing data:image URLs of those types pass through. Never throws.
 */
export async function fetchImageAsDataUrl(
  url,
  { maxBytes = MAX_IMAGE_BYTES, fetch, timeoutMs = 20000 } = {},
) {
  const cap = Math.min(MAX_IMAGE_BYTES, Math.max(1, Number(maxBytes) || MAX_IMAGE_BYTES));
  const value = String(url || "").trim();
  try {
    let buf;
    if (value.startsWith("data:")) {
      const m = value.match(
        /^data:(image\/(?:png|jpeg|gif|webp|svg\+xml));base64,([a-z0-9+/=\s]+)$/i,
      );
      if (!m)
        return {
          ok: false,
          error: "only base64 data:image URLs of png/jpeg/gif/webp/svg are accepted",
        };
      buf = Buffer.from(m[2], "base64");
      if (buf.length > cap) return { ok: false, error: `image exceeds ${cap} bytes` };
    } else {
      if (!isSafeRemoteUrl(value))
        return { ok: false, error: "image URL must be https:// on a public host" };
      const res = await withTimeout(fetch, timeoutMs)(value, {
        headers: {
          accept: "image/avif;q=0,image/webp,image/png,image/jpeg,image/gif,image/svg+xml;q=0.8",
          "user-agent": USER_AGENT,
        },
      });
      if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
      if (res.url && res.url !== value && !isSafeRemoteUrl(res.url))
        return { ok: false, error: "redirected to a non-public URL" };
      const declared = String(res.headers?.get?.("content-type") || "")
        .split(";")[0]
        .trim()
        .toLowerCase();
      if (
        declared &&
        !declared.startsWith("image/") &&
        declared !== "application/octet-stream" &&
        declared !== "binary/octet-stream"
      )
        return { ok: false, error: `not an image (content-type ${declared})` };
      const length = Number(res.headers?.get?.("content-length"));
      if (Number.isFinite(length) && length > cap)
        return { ok: false, error: `image exceeds ${cap} bytes` };
      buf = await readCapped(res, cap);
    }
    const type = sniffImageType(buf);
    if (!type || !ALLOWED_TYPES.has(type))
      return { ok: false, error: "unsupported image format (use png, jpeg, webp, gif or svg)" };
    if (type === "image/svg+xml") {
      const svg = sanitizeSvg(buf.toString("utf8"), { maxBytes: cap });
      if (!svg) return { ok: false, error: "invalid SVG" };
      buf = Buffer.from(svg);
    }
    const size = imageSize(buf, type);
    return {
      ok: true,
      dataUrl: `data:${type};base64,${buf.toString("base64")}`,
      mimeType: type,
      bytes: buf.length,
      width: size?.width ?? null,
      height: size?.height ?? null,
    };
  } catch (e) {
    return { ok: false, error: errText(e) };
  }
}
