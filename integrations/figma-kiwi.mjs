// Figma binary scene containers: an original reader/writer for the public "kiwi" schema-based binary
// encoding (the format is documented by its MIT-licensed reference project, github.com/evanw/kiwi), the
// "fig-kiwi" archive that Figma uses for clipboard payloads and the canvas of .fig files, the .fig zip
// container, and the clipboard text/html wrapper. No vendor code or schema is bundled: every archive
// carries its own binary schema, which is decoded first and then drives message decoding.
//
//   decodeSchema(bytes) / encodeSchema(schema)          binary schema <-> {definitions:[{name,kind,fields}]}
//   decodeMessage(schema, bytes, root?) / encodeMessage(schema, value, root?)
//   readArchive(bytes) -> {prelude, version, chunks}     writeArchive({prelude?, version?, chunks})
//   decodeScene(bytes) -> {schema, message}              fig-kiwi archive -> decoded root message
//   encodeScene(schema, message, {compression}) -> bytes (fixtures and tests)
//   readZip(bytes) -> Map(name -> bytes)                 writeZip(entries) (stored entries; fixtures)
//   readFigFile(bytes) -> {schema, message, images: Map(hashHex -> bytes), meta}
//   parseClipboardHtml(html) -> {meta, bytes} | null     buildClipboardHtml(meta, bytes)
import zlib from "node:zlib";

export const LIMITS = {
  archive: 200 * 1024 * 1024,
  inflated: 400 * 1024 * 1024,
  definitions: 4000,
  fields: 2000,
  depth: 200,
  array: 5_000_000,
};
const KINDS = ["ENUM", "STRUCT", "MESSAGE"];
// Built-in type ids are negative in the binary schema.
const BUILTIN = {
  "-1": "bool",
  "-2": "byte",
  "-3": "int",
  "-4": "uint",
  "-5": "float",
  "-6": "string",
  "-7": "int64",
  "-8": "uint64",
};
const BUILTIN_ID = Object.fromEntries(
  Object.entries(BUILTIN).map(([id, name]) => [name, Number(id)]),
);
const f32 = new Float32Array(1),
  i32 = new Int32Array(f32.buffer);
const utf8 = new TextDecoder("utf-8", { fatal: false });

class Reader {
  constructor(bytes) {
    this.b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    this.i = 0;
  }
  need(n) {
    if (this.i + n > this.b.length) throw new Error("Figma data ends unexpectedly");
  }
  byte() {
    this.need(1);
    return this.b[this.i++];
  }
  bytes(n) {
    this.need(n);
    const out = this.b.subarray(this.i, this.i + n);
    this.i += n;
    return out;
  }
  uint() {
    let value = 0,
      shift = 0,
      byte;
    do {
      byte = this.byte();
      value |= (byte & 127) << shift;
      shift += 7;
    } while (byte & 128 && shift < 35);
    return value >>> 0;
  }
  int() {
    const v = this.uint();
    return v & 1 ? ~(v >>> 1) : v >>> 1;
  }
  uint64() {
    let value = 0n,
      shift = 0n,
      byte;
    do {
      byte = this.byte();
      if (shift === 56n) {
        value |= BigInt(byte) << shift;
        break;
      }
      value |= BigInt(byte & 127) << shift;
      shift += 7n;
    } while (byte & 128);
    return value;
  }
  int64() {
    const v = this.uint64();
    return v & 1n ? ~(v >> 1n) : v >> 1n;
  }
  float() {
    const first = this.byte();
    if (first === 0) return 0;
    this.need(3);
    const bits =
      first | (this.b[this.i] << 8) | (this.b[this.i + 1] << 16) | (this.b[this.i + 2] << 24);
    this.i += 3;
    i32[0] = (bits << 23) | (bits >>> 9);
    return f32[0];
  }
  string() {
    const start = this.i;
    while (true) {
      this.need(1);
      if (this.b[this.i++] === 0) break;
    }
    return utf8.decode(this.b.subarray(start, this.i - 1));
  }
}

class Writer {
  constructor() {
    this.b = new Uint8Array(256);
    this.n = 0;
  }
  grow(k) {
    if (this.n + k <= this.b.length) return;
    const next = new Uint8Array(Math.max(this.b.length * 2, this.n + k));
    next.set(this.b.subarray(0, this.n));
    this.b = next;
  }
  byte(v) {
    this.grow(1);
    this.b[this.n++] = v & 255;
  }
  bytes(v) {
    this.grow(v.length);
    this.b.set(v, this.n);
    this.n += v.length;
  }
  uint(v) {
    v >>>= 0;
    do {
      let byte = v & 127;
      v >>>= 7;
      if (v) byte |= 128;
      this.byte(byte);
    } while (v);
  }
  int(v) {
    this.uint((v << 1) ^ (v >> 31));
  }
  uint64(v) {
    v = BigInt.asUintN(64, BigInt(v));
    for (let i = 0; i < 9; i++) {
      if (i === 8) {
        this.byte(Number(v & 255n));
        return;
      }
      let byte = Number(v & 127n);
      v >>= 7n;
      if (v) byte |= 128;
      this.byte(byte);
      if (!v) return;
    }
  }
  int64(v) {
    v = BigInt(v);
    this.uint64((v << 1n) ^ (v >> 63n));
  }
  float(v) {
    f32[0] = v;
    let bits = i32[0];
    bits = (bits >>> 23) | (bits << 9);
    if ((bits & 255) === 0) {
      this.byte(0);
      return;
    }
    this.byte(bits);
    this.byte(bits >>> 8);
    this.byte(bits >>> 16);
    this.byte(bits >>> 24);
  }
  string(v) {
    this.bytes(new TextEncoder().encode(String(v)));
    this.byte(0);
  }
  done() {
    return this.b.slice(0, this.n);
  }
}

/** Binary schema -> {definitions:[{name, kind, fields:[{name, type, isArray, value}]}]}. */
export function decodeSchema(bytes) {
  const r = new Reader(bytes),
    count = r.uint();
  if (count > LIMITS.definitions) throw new Error("Figma schema is too large");
  const raw = [];
  for (let d = 0; d < count; d++) {
    const name = r.string(),
      kind = KINDS[r.byte()],
      fieldCount = r.uint();
    if (!kind || fieldCount > LIMITS.fields) throw new Error("Invalid Figma schema definition");
    const fields = [];
    for (let f = 0; f < fieldCount; f++)
      fields.push({
        name: r.string(),
        typeId: r.int(),
        isArray: !!(r.byte() & 1),
        value: r.uint(),
      });
    raw.push({ name, kind, fields });
  }
  for (const def of raw)
    for (const field of def.fields) {
      const type = field.typeId < 0 ? BUILTIN[field.typeId] : raw[field.typeId]?.name;
      if (!type) throw new Error("Invalid Figma schema type reference");
      field.type = type;
      delete field.typeId;
    }
  return { definitions: raw };
}

export function encodeSchema(schema) {
  const w = new Writer(),
    index = new Map(schema.definitions.map((d, i) => [d.name, i]));
  w.uint(schema.definitions.length);
  for (const def of schema.definitions) {
    w.string(def.name);
    w.byte(KINDS.indexOf(def.kind));
    w.uint(def.fields.length);
    def.fields.forEach((field, i) => {
      const id = BUILTIN_ID[field.type] ?? index.get(field.type);
      if (id === undefined) throw new Error(`Unknown schema type ${field.type}`);
      w.string(field.name);
      w.int(id);
      w.byte(field.isArray ? 1 : 0);
      w.uint(field.value ?? (def.kind === "ENUM" ? i : i + 1));
    });
  }
  return w.done();
}

function compiled(schema) {
  if (schema._compiled) return schema._compiled;
  const defs = new Map();
  for (const def of schema.definitions)
    defs.set(def.name, {
      ...def,
      byValue: new Map(def.fields.map((f) => [f.value, f])),
      byName: new Map(def.fields.map((f) => [f.name, f])),
    });
  Object.defineProperty(schema, "_compiled", { value: defs, enumerable: false });
  return defs;
}

/** Decode one message (default root: the first MESSAGE definition named "Message", else the first message). */
export function decodeMessage(schema, bytes, root) {
  const defs = compiled(schema),
    r = new Reader(bytes);
  const rootName =
    root ||
    (defs.has("Message") ? "Message" : schema.definitions.find((d) => d.kind === "MESSAGE")?.name);
  if (!rootName || !defs.has(rootName)) throw new Error("Figma schema has no root message");
  const one = (type, depth) => {
    switch (type) {
      case "bool":
        return r.byte() !== 0;
      case "byte":
        return r.byte();
      case "int":
        return r.int();
      case "uint":
        return r.uint();
      case "float":
        return r.float();
      case "string":
        return r.string();
      case "int64":
        return r.int64();
      case "uint64":
        return r.uint64();
    }
    const def = defs.get(type);
    if (depth > LIMITS.depth) throw new Error("Figma data nests too deeply");
    if (def.kind === "ENUM") {
      const v = r.uint();
      return def.byValue.get(v)?.name ?? v;
    }
    const out = {};
    if (def.kind === "STRUCT") {
      for (const f of def.fields) out[f.name] = field(f, depth);
      return out;
    }
    while (true) {
      const id = r.uint();
      if (id === 0) return out;
      const f = def.byValue.get(id);
      if (!f) throw new Error(`Figma data uses unknown field ${id} of ${def.name}`);
      out[f.name] = field(f, depth);
    }
  };
  const field = (f, depth) => {
    if (!f.isArray) return one(f.type, depth + 1);
    const n = r.uint();
    if (n > LIMITS.array) throw new Error("Figma array is too large");
    if (f.type === "byte") return r.bytes(n).slice();
    return Array.from({ length: n }, () => one(f.type, depth + 1));
  };
  return one(rootName, 0);
}

export function encodeMessage(schema, value, root) {
  const defs = compiled(schema),
    w = new Writer();
  const rootName =
    root ||
    (defs.has("Message") ? "Message" : schema.definitions.find((d) => d.kind === "MESSAGE")?.name);
  const one = (type, v) => {
    switch (type) {
      case "bool":
        return w.byte(v ? 1 : 0);
      case "byte":
        return w.byte(v);
      case "int":
        return w.int(v | 0);
      case "uint":
        return w.uint(v);
      case "float":
        return w.float(v);
      case "string":
        return w.string(v);
      case "int64":
        return w.int64(v);
      case "uint64":
        return w.uint64(v);
    }
    const def = defs.get(type);
    if (!def) throw new Error(`Unknown schema type ${type}`);
    if (def.kind === "ENUM") {
      const f = def.byName.get(v);
      if (!f) throw new Error(`Unknown ${type} value ${v}`);
      return w.uint(f.value);
    }
    if (def.kind === "STRUCT") {
      for (const f of def.fields) field(f, v?.[f.name]);
      return;
    }
    for (const [name, item] of Object.entries(v || {})) {
      if (item === undefined) continue;
      const f = def.byName.get(name);
      if (!f) throw new Error(`Unknown field ${name} of ${type}`);
      w.uint(f.value);
      field(f, item);
    }
    w.uint(0);
  };
  const field = (f, v) => {
    if (!f.isArray) return one(f.type, v);
    const list = v || [];
    w.uint(list.length);
    if (f.type === "byte")
      return w.bytes(list instanceof Uint8Array ? list : Uint8Array.from(list));
    for (const item of list) one(f.type, item);
  };
  one(rootName, value);
  return w.done();
}

const ascii = (bytes) => String.fromCharCode(...bytes);
/** fig-kiwi archive: 8-byte prelude, uint32 LE version, then (uint32 LE length, bytes) chunks. */
export function readArchive(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (b.length > LIMITS.archive) throw new Error("Figma data exceeds the import size limit");
  if (b.length < 12) throw new Error("Not a Figma scene archive");
  const prelude = ascii(b.subarray(0, 8));
  if (!/^fig-[a-z]{4}$|^fig-jam\.$/.test(prelude)) throw new Error("Not a Figma scene archive");
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength),
    version = view.getUint32(8, true),
    chunks = [];
  let at = 12;
  while (at + 4 <= b.length) {
    const size = view.getUint32(at, true);
    at += 4;
    if (at + size > b.length) throw new Error("Figma scene archive is truncated");
    chunks.push(b.subarray(at, at + size));
    at += size;
  }
  if (chunks.length < 2) throw new Error("Figma scene archive has no scene data");
  return { prelude, version, chunks };
}

export function writeArchive({ prelude = "fig-kiwi", version = 15, chunks }) {
  const total = 12 + chunks.reduce((n, c) => n + 4 + c.length, 0),
    out = new Uint8Array(total),
    view = new DataView(out.buffer);
  out.set(new TextEncoder().encode(prelude.padEnd(8).slice(0, 8)), 0);
  view.setUint32(8, version, true);
  let at = 12;
  for (const c of chunks) {
    view.setUint32(at, c.length, true);
    out.set(c, at + 4);
    at += 4 + c.length;
  }
  return out;
}

/** Chunks are raw deflate (older payloads), zstd (newer payloads) or, rarely, stored. */
export function inflateChunk(chunk) {
  const opts = { maxOutputLength: LIMITS.inflated };
  if (chunk[0] === 0x28 && chunk[1] === 0xb5 && chunk[2] === 0x2f && chunk[3] === 0xfd) {
    if (typeof zlib.zstdDecompressSync !== "function")
      throw new Error("This runtime cannot read zstd-compressed Figma data");
    return new Uint8Array(zlib.zstdDecompressSync(chunk, opts));
  }
  try {
    return new Uint8Array(zlib.inflateRawSync(chunk, opts));
  } catch {}
  try {
    return new Uint8Array(zlib.inflateSync(chunk, opts));
  } catch {}
  return chunk;
}

export function decodeScene(bytes) {
  const { prelude, version, chunks } = readArchive(bytes);
  const schema = decodeSchema(inflateChunk(chunks[0]));
  const message = decodeMessage(schema, inflateChunk(chunks[1]));
  return { prelude, version, schema, message };
}

export function encodeScene(
  schema,
  message,
  { compression = "deflate", prelude = "fig-kiwi", version = 15 } = {},
) {
  const pack = (bytes) =>
    compression === "zstd"
      ? zlib.zstdCompressSync(bytes)
      : compression === "none"
        ? bytes
        : zlib.deflateRawSync(bytes);
  return writeArchive({
    prelude,
    version,
    chunks: [
      new Uint8Array(zlib.deflateRawSync(encodeSchema(schema))),
      new Uint8Array(pack(encodeMessage(schema, message))),
    ],
  });
}

// ---------- zip (central directory reader; stored + deflate) ----------
export function readZip(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes),
    view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (b.length > LIMITS.archive) throw new Error("Figma file exceeds the import size limit");
  let end = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 65535); i--)
    if (view.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  if (end < 0) throw new Error("Not a zip archive");
  const count = view.getUint16(end + 10, true),
    files = new Map();
  let at = view.getUint32(end + 16, true),
    inflated = 0;
  for (let n = 0; n < count; n++) {
    if (at + 46 > b.length || view.getUint32(at, true) !== 0x02014b50)
      throw new Error("Corrupt zip directory");
    const method = view.getUint16(at + 10, true),
      size = view.getUint32(at + 20, true),
      plain = view.getUint32(at + 24, true);
    const nameLen = view.getUint16(at + 28, true),
      extra = view.getUint16(at + 30, true),
      comment = view.getUint16(at + 32, true),
      local = view.getUint32(at + 42, true);
    const name = utf8.decode(b.subarray(at + 46, at + 46 + nameLen));
    at += 46 + nameLen + extra + comment;
    if (name.endsWith("/")) continue;
    if (local + 30 > b.length || view.getUint32(local, true) !== 0x04034b50)
      throw new Error("Corrupt zip entry");
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    if (start + size > b.length) throw new Error("Corrupt zip entry");
    inflated += plain;
    if (inflated > LIMITS.inflated)
      throw new Error("Figma file expands beyond the import size limit");
    const data = b.subarray(start, start + size);
    if (method === 0) files.set(name, data);
    else if (method === 8)
      files.set(
        name,
        new Uint8Array(zlib.inflateRawSync(data, { maxOutputLength: Math.max(1, plain) })),
      );
    else throw new Error("Unsupported zip compression");
  }
  return files;
}

export function writeZip(entries) {
  const parts = [],
    dir = [];
  let offset = 0;
  for (const [name, raw] of entries) {
    const data = raw instanceof Uint8Array ? raw : new TextEncoder().encode(String(raw)),
      nameBytes = new TextEncoder().encode(name),
      crc = zlib.crc32(data) >>> 0;
    const head = new Uint8Array(30 + nameBytes.length),
      h = new DataView(head.buffer);
    h.setUint32(0, 0x04034b50, true);
    h.setUint16(4, 20, true);
    h.setUint32(14, crc, true);
    h.setUint32(18, data.length, true);
    h.setUint32(22, data.length, true);
    h.setUint16(26, nameBytes.length, true);
    head.set(nameBytes, 30);
    const central = new Uint8Array(46 + nameBytes.length),
      c = new DataView(central.buffer);
    c.setUint32(0, 0x02014b50, true);
    c.setUint16(4, 20, true);
    c.setUint16(6, 20, true);
    c.setUint32(16, crc, true);
    c.setUint32(20, data.length, true);
    c.setUint32(24, data.length, true);
    c.setUint16(28, nameBytes.length, true);
    c.setUint32(42, offset, true);
    central.set(nameBytes, 46);
    parts.push(head, data);
    dir.push(central);
    offset += head.length + data.length;
  }
  const dirSize = dir.reduce((n, d) => n + d.length, 0),
    end = new Uint8Array(22),
    e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true);
  e.setUint16(8, dir.length, true);
  e.setUint16(10, dir.length, true);
  e.setUint32(12, dirSize, true);
  e.setUint32(16, offset, true);
  return new Uint8Array(Buffer.concat([...parts, ...dir, end]));
}

const hexOf = (bytes) => Buffer.from(bytes).toString("hex");
/** A .fig file is either a bare fig-kiwi archive or a zip holding canvas.fig, meta.json and images/<sha1>. */
export function readFigFile(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes),
    images = new Map();
  if (b[0] === 0x50 && b[1] === 0x4b) {
    const files = readZip(b),
      canvas = files.get("canvas.fig");
    if (!canvas) throw new Error("The .fig archive has no canvas.fig scene");
    for (const [name, data] of files) {
      const m = /^images\/([0-9a-f]{40})$/i.exec(name);
      if (m) images.set(m[1].toLowerCase(), data);
    }
    let meta = null;
    try {
      meta = files.has("meta.json") ? JSON.parse(utf8.decode(files.get("meta.json"))) : null;
    } catch {}
    return { ...decodeScene(canvas), images, meta };
  }
  return { ...decodeScene(b), images, meta: null };
}
export { hexOf };

// ---------- clipboard ----------
const META = /\(figmeta\)([A-Za-z0-9+/=\s]+)\(\/figmeta\)/,
  DATA = /\(figma\)([A-Za-z0-9+/=\s]+)\(\/figma\)/;
export const isFigmaClipboard = (html) => typeof html === "string" && DATA.test(html);
/** Figma writes two marked base64 blocks into text/html: JSON metadata and the fig-kiwi scene. */
export function parseClipboardHtml(html) {
  if (typeof html !== "string" || html.length > LIMITS.archive * 1.4) return null;
  const data = DATA.exec(html);
  if (!data) return null;
  let meta = null;
  const metaMatch = META.exec(html);
  if (metaMatch)
    try {
      meta = JSON.parse(Buffer.from(metaMatch[1].replace(/\s/g, ""), "base64").toString("utf8"));
    } catch {}
  return { meta, bytes: new Uint8Array(Buffer.from(data[1].replace(/\s/g, ""), "base64")) };
}
export function buildClipboardHtml(meta, bytes) {
  const m = Buffer.from(JSON.stringify(meta)).toString("base64"),
    d = Buffer.from(bytes).toString("base64");
  return `<meta charset="utf-8"><span data-metadata="<!--(figmeta)${m}(/figmeta)-->"></span><span data-buffer="<!--(figma)${d}(/figma)-->"></span>`;
}
