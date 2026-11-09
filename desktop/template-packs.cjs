// Template packs as .zip archives (Templates gallery, web/views-templates.js). JSON packs keep working; this
// module converts a pack object to and from a zip:
//
//   manifest.json                {format:'verynize-template-pack', version:1, templates:[{id,name,category,description,
//                                 createdAt,file}], components:[{id,name,version,updatedAt,file}]}
//   templates/<n>.verynize.json  one design document per template
//   components/<n>.json          {nodes:[…]} per library component
//   assets/<sha256>.<ext>        embedded images: every `data:image/…;base64` value in a document or component is
//                                stored once here and referenced as `verynize-asset:assets/<name>`
//
// The zip writer/reader is our own minimal implementation over Node's zlib (stored + deflate entries, no zip64,
// no encryption, no multi-disk). Reading rejects absolute paths, `..`, backslashes, drive letters and anything
// outside the folders above (zip-slip), duplicate names, more than MAX_ENTRIES entries, entries larger than
// MAX_ENTRY bytes uncompressed (checked against the header and enforced while inflating), a total above
// MAX_TOTAL, CRC mismatches, and archives above MAX_ARCHIVE.
const zlib = require("node:zlib");
const crypto = require("node:crypto");

const MAX_ARCHIVE = 50 * 1024 * 1024;
const MAX_ENTRY = 20 * 1024 * 1024;
const MAX_TOTAL = 100 * 1024 * 1024;
const MAX_ENTRIES = 2000;
const ASSET_PREFIX = "verynize-asset:";
const FORMAT = "verynize-template-pack";
const MIME_EXT = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "font/woff2": "woff2", "font/woff": "woff", "font/ttf": "ttf", "font/otf": "otf",
};
const EXT_MIME = Object.fromEntries(Object.entries(MIME_EXT).map(([mime, ext]) => [ext, mime]));

// --- CRC-32 (IEEE) -----------------------------------------------------------------------------------
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();
function crc32(buffer) {
  let c = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// --- writer ------------------------------------------------------------------------------------------
/** entries: [{name, data:Buffer}] → zip Buffer (deflate when it helps, else stored). Fixed 1980-01-01 timestamps. */
function writeZip(entries) {
  const locals = [],
    centrals = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBytes = Buffer.from(name, "utf8");
    const deflated = zlib.deflateRawSync(data, { level: 9 });
    const useDeflate = deflated.length < data.length;
    const body = useDeflate ? deflated : data;
    const crc = crc32(data);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x0800, 6); // UTF-8 names
    header.writeUInt16LE(useDeflate ? 8 : 0, 8);
    header.writeUInt16LE(0, 10);
    header.writeUInt16LE(0x21, 12);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(body.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(nameBytes.length, 26);
    header.writeUInt16LE(0, 28);
    locals.push(header, nameBytes, body);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(useDeflate ? 8 : 0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBytes);
    offset += 30 + nameBytes.length + body.length;
  }
  const centralSize = centrals.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

// --- reader ------------------------------------------------------------------------------------------
const ALLOWED =
  /^(manifest\.json|templates\/[A-Za-z0-9_-]{1,80}\.verynize\.json|components\/[A-Za-z0-9_-]{1,80}\.json|assets\/[a-f0-9]{16,64}\.(png|jpg|gif|webp|svg))$/;
/** Validate an entry name; throws on zip-slip style or unexpected paths. Directory entries return null. */
function safeEntryName(name) {
  if (typeof name !== "string" || !name || name.length > 300 || name.includes("\0"))
    throw Error("The pack contains an invalid file name");
  if (
    name.includes("\\") ||
    name.startsWith("/") ||
    /^[A-Za-z]:/.test(name) ||
    name.split("/").some((part) => part === ".." || part === ".")
  )
    throw Error(`Unsafe path in the pack: ${name.slice(0, 80)}`);
  if (name.endsWith("/")) {
    if (!/^(templates|components|assets)\/$/.test(name))
      throw Error(`Unexpected folder in the pack: ${name.slice(0, 80)}`);
    return null;
  }
  if (!ALLOWED.test(name)) throw Error(`Unexpected file in the pack: ${name.slice(0, 80)}`);
  return name;
}

/** zip Buffer → Map(name → Buffer). */
function readZip(input) {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input);
  if (buffer.length > MAX_ARCHIVE) throw Error("Template packs must be under 50 MB");
  let end = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 22 - 65535); i--)
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      end = i;
      break;
    }
  if (end < 0) throw Error("That file is not a zip archive");
  const count = buffer.readUInt16LE(end + 10),
    centralSize = buffer.readUInt32LE(end + 12),
    centralOffset = buffer.readUInt32LE(end + 16);
  if (count > MAX_ENTRIES) throw Error("The pack has too many files");
  if (centralOffset + centralSize > end) throw Error("The zip directory is damaged");
  const files = new Map();
  let p = centralOffset,
    total = 0;
  for (let i = 0; i < count; i++) {
    if (p + 46 > end || buffer.readUInt32LE(p) !== 0x02014b50)
      throw Error("The zip directory is damaged");
    const flags = buffer.readUInt16LE(p + 8),
      method = buffer.readUInt16LE(p + 10),
      crc = buffer.readUInt32LE(p + 16);
    const compressed = buffer.readUInt32LE(p + 20),
      size = buffer.readUInt32LE(p + 24);
    const nameLength = buffer.readUInt16LE(p + 28),
      extraLength = buffer.readUInt16LE(p + 30),
      commentLength = buffer.readUInt16LE(p + 32);
    const localOffset = buffer.readUInt32LE(p + 42);
    const rawName = buffer.subarray(p + 46, p + 46 + nameLength).toString("utf8");
    p += 46 + nameLength + extraLength + commentLength;
    const name = safeEntryName(rawName);
    if (!name) continue;
    if (flags & 0x1) throw Error("Encrypted packs are not supported");
    if (files.has(name)) throw Error(`The pack lists ${name} twice`);
    if (size > MAX_ENTRY || compressed > MAX_ARCHIVE) throw Error(`${name} is larger than 20 MB`);
    total += size;
    if (total > MAX_TOTAL) throw Error("The pack expands to more than 100 MB");
    if (localOffset + 30 > buffer.length || buffer.readUInt32LE(localOffset) !== 0x04034b50)
      throw Error("The zip data is damaged");
    const start =
      localOffset +
      30 +
      buffer.readUInt16LE(localOffset + 26) +
      buffer.readUInt16LE(localOffset + 28);
    if (start + compressed > buffer.length) throw Error("The zip data is damaged");
    const body = buffer.subarray(start, start + compressed);
    let data;
    if (method === 0) data = Buffer.from(body);
    else if (method === 8) {
      try {
        data = zlib.inflateRawSync(body, { maxOutputLength: MAX_ENTRY });
      } catch {
        throw Error(`${name} could not be decompressed or is larger than 20 MB`);
      }
    } else throw Error(`${name} uses an unsupported compression method`);
    if (data.length !== size || crc32(data) !== crc)
      throw Error(`${name} is damaged (size or checksum mismatch)`);
    files.set(name, data);
  }
  return files;
}

// --- packs ------------------------------------------------------------------------------------------
/** Replace embedded data-URL images by asset references; `assets` collects name → Buffer. */
function extractAssets(value, assets) {
  if (typeof value === "string") {
    if (/^asset:[a-f0-9]{64}$/.test(value)) throw Error("Resolve asset references before encoding a portable pack");
    const m = /^data:((?:image\/(?:png|jpeg|gif|webp|svg\+xml)|font\/(?:woff2|woff|ttf|otf)));base64,([A-Za-z0-9+/=\s]+)$/.exec(
      value,
    );
    if (!m) return value;
    const bytes = Buffer.from(m[2], "base64");
    const name = `assets/${crypto.createHash("sha256").update(bytes).digest("hex").slice(0, 32)}.${MIME_EXT[m[1]]}`;
    assets.set(name, bytes);
    return ASSET_PREFIX + name;
  }
  if (Array.isArray(value)) return value.map((v) => extractAssets(v, assets));
  if (value && typeof value === "object")
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, extractAssets(v, assets)]));
  return value;
}
function restoreAssets(value, files) {
  if (typeof value === "string") {
    if (!value.startsWith(ASSET_PREFIX)) return value;
    const name = value.slice(ASSET_PREFIX.length),
      data = files.get(name);
    if (!data || !name.startsWith("assets/"))
      throw Error(`The pack is missing ${name.slice(0, 80)}`);
    return `data:${EXT_MIME[name.split(".").pop()]};base64,${data.toString("base64")}`;
  }
  if (Array.isArray(value)) return value.map((v) => restoreAssets(v, files));
  if (value && typeof value === "object")
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, restoreAssets(v, files)]));
  return value;
}

const text = (value, limit) => (typeof value === "string" ? value.slice(0, limit) : "");
/** Pack object ({format, version, templates, components}) → zip Buffer. */
function encodePack(pack) {
  if (!pack || pack.format !== FORMAT || pack.version !== 1)
    throw Error("Not a Verynize template pack");
  const templates = Array.isArray(pack.templates) ? pack.templates.slice(0, 500) : [];
  const components = Array.isArray(pack.components) ? pack.components.slice(0, 500) : [];
  const assets = new Map(),
    entries = [];
  const manifest = {
    format: FORMAT,
    version: 1,
    exportedAt: text(pack.exportedAt, 40) || new Date().toISOString(),
    templates: [],
    components: [],
  };
  templates.forEach((t, i) => {
    if (!t?.document) return;
    const file = `templates/t${i + 1}.verynize.json`;
    entries.push({
      name: file,
      data: Buffer.from(JSON.stringify(extractAssets(t.document, assets))),
    });
    manifest.templates.push({
      id: text(t.id, 80),
      name: text(t.name, 80),
      category: text(t.category, 20),
      description: text(t.description, 200),
      createdAt: Number(t.createdAt) || 0,
      file,
    });
  });
  components.forEach((c, i) => {
    if (!Array.isArray(c?.nodes)) return;
    const file = `components/c${i + 1}.json`;
    entries.push({
      name: file,
      data: Buffer.from(JSON.stringify({ nodes: extractAssets(c.nodes, assets) })),
    });
    manifest.components.push({
      id: text(c.id, 80),
      name: text(c.name, 80),
      version: Math.max(1, Math.floor(Number(c.version) || 1)),
      updatedAt: Number(c.updatedAt) || 0,
      file,
    });
  });
  for (const [name, data] of assets) entries.push({ name, data });
  for (const e of entries)
    if (e.data.length > MAX_ENTRY) throw Error(`${e.name} is larger than 20 MB`);
  return writeZip([
    { name: "manifest.json", data: Buffer.from(JSON.stringify(manifest, null, 2)) },
    ...entries,
  ]);
}

/** zip Buffer → pack object with documents and components restored (images embedded again). */
function decodePack(input) {
  const files = readZip(input);
  const raw = files.get("manifest.json");
  if (!raw) throw Error("The pack has no manifest.json");
  let manifest;
  try {
    manifest = JSON.parse(raw.toString("utf8"));
  } catch {
    throw Error("manifest.json is not valid JSON");
  }
  if (manifest?.format !== FORMAT || manifest.version !== 1)
    throw Error("That file is not a Verynize template pack");
  const json = (name) => {
    const data = typeof name === "string" && files.get(name);
    if (!data) throw Error(`The pack is missing ${String(name).slice(0, 80)}`);
    try {
      return JSON.parse(data.toString("utf8"));
    } catch {
      throw Error(`${name} is not valid JSON`);
    }
  };
  const templates = (Array.isArray(manifest.templates) ? manifest.templates : []).map((t) => ({
    id: text(t.id, 80),
    name: text(t.name, 80),
    category: text(t.category, 20),
    description: text(t.description, 200),
    createdAt: Number(t.createdAt) || 0,
    document: restoreAssets(json(t.file), files),
  }));
  const components = (Array.isArray(manifest.components) ? manifest.components : []).map((c) => ({
    id: text(c.id, 80),
    name: text(c.name, 80),
    version: Math.max(1, Math.floor(Number(c.version) || 1)),
    updatedAt: Number(c.updatedAt) || 0,
    nodes: restoreAssets(json(c.file).nodes, files),
  }));
  return {
    format: FORMAT,
    version: 1,
    exportedAt: text(manifest.exportedAt, 40),
    templates,
    components,
  };
}

/** IPC: the renderer passes bytes in and gets bytes / a pack object back (no file system access). */
function registerTemplatePacks(handle) {
  const bytes = (value) => {
    if (value instanceof Uint8Array)
      return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
    if (value instanceof ArrayBuffer) return Buffer.from(value);
    throw Error("Choose a .zip template pack");
  };
  handle("templatePackEncode", async (pack) => {
    const { inlineAssets } = await import("../integrations/asset-store.mjs");
    const store = await require("./assets.cjs").store();
    const portable = JSON.parse(await inlineAssets(JSON.stringify(pack), (ref) => store.get(ref)));
    return new Uint8Array(encodePack(portable));
  });
  handle("templatePackDecode", (data) => decodePack(bytes(data)));
}

module.exports = {
  writeZip,
  readZip,
  safeEntryName,
  encodePack,
  decodePack,
  crc32,
  registerTemplatePacks,
  MAX_ENTRY,
  MAX_ARCHIVE,
};
