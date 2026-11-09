// Immutable local content-addressed blobs. Documents contain only asset:<sha256>.
import { promises as fs, constants } from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { sanitizeSvg } from "./assets.mjs";
import { sniffImageType } from "./images.mjs";
import { mapAssetUrls, assetUrls } from "./asset-urls.cjs";
export const ASSET_REF = /^asset:([a-f0-9]{64})$/;
export const ASSET_LIMIT = 20 * 1024 * 1024;
export function prepareAsset(input, contentType) {
  let bytes = Buffer.from(input);
  if (!bytes.length || bytes.length > ASSET_LIMIT)
    throw Error(`Asset exceeds limit ${ASSET_LIMIT} bytes (received ${bytes.length} bytes)`);
  const image = sniffImageType(bytes);
  const signature = bytes.subarray(0, 4).toString("ascii");
  const font =
    signature === "wOF2"
      ? "font/woff2"
      : signature === "wOFF"
        ? "font/woff"
        : signature === "OTTO"
          ? "font/otf"
          : bytes.length >= 4 && bytes.readUInt32BE(0) === 0x10000
            ? "font/ttf"
            : null;
  const mime = image || font;
  if (!mime || (contentType && contentType !== mime))
    throw Error("Unsupported asset or MIME signature mismatch");
  if (mime === "image/svg+xml") {
    const clean = sanitizeSvg(bytes.toString("utf8"));
    if (!clean) throw Error("Unsafe SVG asset");
    bytes = Buffer.from(clean);
  }
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  return { bytes, ref: `asset:${sha256}`, sha256, size: bytes.length, contentType: mime };
}
export class AssetStore {
  constructor(directory) {
    this.directory = path.resolve(directory);
  }
  async directoryPath() {
    await fs.mkdir(this.directory, { recursive: true });
    if ((await fs.lstat(this.directory)).isSymbolicLink())
      throw Error("Asset directory cannot be a symlink");
    return this.directory;
  }
  async put(bytes, contentType) {
    const asset = prepareAsset(bytes, contentType);
    const dir = await this.directoryPath();
    const target = path.join(dir, asset.sha256);
    const tmp = path.join(dir, "." + randomUUID());
    try {
      await fs.writeFile(tmp, asset.bytes, { flag: "wx", mode: 0o600 });
      // link is atomic and cannot overwrite a concurrent writer or follow a target symlink.
      await fs.link(tmp, target).catch((error) => {
        if (error.code !== "EEXIST") throw error;
      });
      await this.get(asset.ref);
    } finally {
      await fs.unlink(tmp).catch(() => {});
    }
    const { bytes: _bytes, ...meta } = asset;
    return meta;
  }
  async get(ref) {
    const hash = ASSET_REF.exec(ref)?.[1];
    if (!hash) throw Error("Invalid asset reference");
    const dir = await this.directoryPath();
    let handle;
    try {
      handle = await fs.open(path.join(dir, hash), constants.O_RDONLY | constants.O_NOFOLLOW);
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > ASSET_LIMIT) throw Error("Invalid asset file");
      const bytes = await handle.readFile();
      if (createHash("sha256").update(bytes).digest("hex") !== hash)
        throw Error("Asset hash mismatch");
      const asset = prepareAsset(bytes);
      if (asset.sha256 !== hash) throw Error("Asset is not sanitized");
      return asset;
    } catch (error) {
      throw Error(`Asset ${hash} unavailable: ${error.message}`);
    } finally {
      await handle?.close();
    }
  }
}
export const sidecarAssets = (file) =>
  new AssetStore(file.replace(/\.verynize\.json$/, "") + ".verynize.assets");

export function assetRefs(document) {
  const refs = new Set();
  function visit(value, key) {
    if (key === "src" && typeof value === "string" && ASSET_REF.test(value)) refs.add(value);
    else if (Array.isArray(value)) value.forEach((item) => visit(item));
    else if (value && typeof value === "object")
      Object.entries(value).forEach(([key, item]) => visit(item, key));
  }
  visit(document);
  return [...refs];
}
export async function copyAssets(document, source, target) {
  for (const ref of assetRefs(document)) {
    const asset = await source.get(ref);
    await target.put(asset.bytes, asset.contentType);
  }
}

/** Explicit portable export: inline once per unique ref, replacing in one pass. */
export async function inlineAssets(html, get) {
  const refs = assetUrls(html);
  const values = new Map();
  for (const ref of refs) {
    if (!get) throw Error("Asset resolver required for portable export");
    const asset = await get(ref);
    values.set(ref, `data:${asset.contentType};base64,${asset.bytes.toString("base64")}`);
  }
  return mapAssetUrls(html, (ref) => values.get(ref));
}
