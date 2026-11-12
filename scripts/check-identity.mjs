#!/usr/bin/env node
// Identity/PII guard. Fails when committed content or commit metadata carries the owner's
// personal identity: real email addresses, home-directory paths, terminal prompts
// (user@host), private app.wonder.so workspace URLs, or identifying image metadata. Optionally
// OCRs changed images with tesseract. See docs/identity-guard.md.
//
//   node scripts/check-identity.mjs --staged [--author]          pre-commit (index blobs)
//   node scripts/check-identity.mjs --range BASE..HEAD [--author] CI (PR commits and blobs)
//   node scripts/check-identity.mjs --all [--ocr]                 audit of the tracked tree
//
// Options: --no-ocr, --ocr (force on, also for --all), --ocr=required (missing tesseract is an
// error), --root DIR (repository, default cwd). Exit 1 on any hit, 2 on usage/runtime errors.
// No dependencies beyond Node and git.
import { execFileSync, execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { inflateSync } from "node:zlib";

const MAX_TEXT_BYTES = 5 * 1024 * 1024;
const IMAGE_EXT = /\.(png|jpe?g|webp|gif)$/i;
// Commit author/committer emails allowed in this repository: the owner's GitHub noreply address
// (with or without the numeric id prefix) and Claude co-authored/authored commits.
const ALLOWED_IDENTITY_EMAILS = [
  /^(?:55482107\+)?AdamAbd@users\.noreply\.github\.com$/i,
  /^noreply@anthropic\.com$/i,
];
// Committers may additionally be GitHub itself (web merges, squash merges).
const ALLOWED_COMMITTER_EMAILS = [...ALLOWED_IDENTITY_EMAILS, /^noreply@github\.com$/i];

// ---------- text patterns ----------

const EMAIL_RE =
  /(?<![\w.%+-])[A-Za-z0-9][\w.%+-]*@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*\.[A-Za-z]{2,24}(?![\w-])/g;
// "TLDs" that are really file extensions (icon@2x.png, chunk@hash.js) or package specifiers.
const FILE_TLDS = new Set(
  "png jpg jpeg gif webp svg avif ico js mjs cjs jsx ts tsx css scss json md html htm txt map wasm woff woff2 ttf otf zip gz tgz pdf mp4 webm mov yml yaml toml lock sh py rb go rs".split(
    " ",
  ),
);
const PLACEHOLDER_DOMAINS =
  /(?:^|\.)(?:example\.[a-z]{1,6}|example|test|invalid|localhost|local|domain\.com|email\.com|yourdomain\.com|company\.com|acme\.(?:com|test)|users\.noreply\.github\.com)$/i;
const ALLOWED_EMAILS = new Set([
  "noreply@anthropic.com",
  // Codex (OpenAI) co-author trailer on agent commits: a role mailbox, like Anthropic's above.
  "noreply@openai.com",
  "noreply@github.com",
  "git@github.com",
  "git@gitlab.com",
  "git@bitbucket.org",
]);
// Obvious placeholder mailboxes in UI copy and docs ("you@studio.com", "teammate@company.com").
const PLACEHOLDER_LOCALS =
  /^(?:you|your|your[._-]?(?:name|email)|teammate|colleague|user|username|name|someone|somebody|email|recipient|foo|bar|jane|john(?:\.doe)?|jane\.doe)$/i;

const HOME_RE =
  /(?<![\w.$-])(?:\/(Users|home)\/([A-Za-z0-9._-]+)|[A-Za-z]:\\{1,2}Users\\{1,2}([A-Za-z0-9._-]+))/g;
// Generic or system home directories. Short real-looking names (even "me") are real accounts and
// are reported.
const HOME_PLACEHOLDERS = new Set([
  "runner", // GitHub Actions runner home
  "node", // node:* Docker images
  "ubuntu", // cloud image default user
  "shared", // macOS /Users/Shared
  "public",
  "default",
  "user",
  "username",
  "you",
  "your-name",
  "yourname",
  "name",
]);

// user@host prompts: "user@host:~/dir$", "user@host ~ %", "[user@host dir]$".
const PROMPT_RE =
  /(?<![\w.%+@/-])([A-Za-z_][\w-]{0,31})@([A-Za-z][\w-]*(?:\.[\w-]+)*)(?::(?:~|\/)\S*\s?[$#%]|\s(?:~|\/|\.{0,2}\/?[\w.-]+)[^\s]*\s?[%$#]|\s?[\]][$#%]?)(?=\s|$)/g;
const PROMPT_PLACEHOLDERS =
  /^(?:user|you|me|name|username|root|host|hostname|machine|computer|localhost)$/i;

const WONDER_RE = /app\.wonder\.so\/([^\s"'`<>)\]}\\,]*)/g;

function redact(s) {
  if (s.length <= 4) return "*".repeat(s.length);
  const keep = Math.min(3, Math.floor(s.length / 4));
  return s.slice(0, keep) + "*".repeat(Math.max(3, s.length - keep * 2)) + s.slice(s.length - keep);
}

function emailAllowed(email) {
  const lower = email.toLowerCase();
  if (ALLOWED_EMAILS.has(lower)) return true;
  const [local, domain] = lower.split("@");
  const tld = domain.slice(domain.lastIndexOf(".") + 1);
  if (FILE_TLDS.has(tld)) return true;
  if (PLACEHOLDER_DOMAINS.test(domain)) return true;
  if (PLACEHOLDER_LOCALS.test(local)) return true;
  return false;
}

export function scanText(text) {
  const hits = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const add = (kind, match, index) => hits.push({ line: i + 1, column: index + 1, kind, match });
    for (const m of line.matchAll(EMAIL_RE)) if (!emailAllowed(m[0])) add("email", m[0], m.index);
    for (const m of line.matchAll(HOME_RE)) {
      const name = (m[2] ?? m[3] ?? "").toLowerCase();
      if (!name || HOME_PLACEHOLDERS.has(name) || /^\.+$/.test(name)) continue;
      add("home-path", m[0], m.index);
    }
    for (const m of line.matchAll(PROMPT_RE)) {
      if (PROMPT_PLACEHOLDERS.test(m[1]) || PROMPT_PLACEHOLDERS.test(m[2])) continue;
      // An email immediately followed by ']' or a path is not a prompt; emails are covered above.
      if (/\.[A-Za-z]{2,}$/.test(m[2]) && /[\]]/.test(m[0])) continue;
      add("shell-prompt", m[0].trim(), m.index);
    }
    for (const m of line.matchAll(WONDER_RE)) {
      const rest = m[1];
      // Bare domain, public static assets, and doc placeholders ("app.wonder.so/<workspace>", ".../").
      if (!rest || rest.startsWith("assets/") || /^(?:\.{3}|…|<|\$\{|\*)/.test(rest)) continue;
      add("wonder-url", m[0], m.index);
    }
  }
  return hits;
}

// ---------- image metadata ----------

const IDENTITY_KEYS = /^(?:author|artist|owner|creator|copyright|by-?line|xpauthor)$/i;

function pngMetadata(buf) {
  const out = [];
  if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47) return out;
  let off = 8;
  while (off + 12 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString("latin1", off + 4, off + 8);
    const data = buf.subarray(off + 8, Math.min(buf.length, off + 8 + len));
    off += 12 + len;
    try {
      if (type === "tEXt") {
        const z = data.indexOf(0);
        out.push({
          chunk: type,
          key: data.toString("latin1", 0, z),
          text: data.toString("latin1", z + 1),
        });
      } else if (type === "zTXt") {
        const z = data.indexOf(0);
        out.push({
          chunk: type,
          key: data.toString("latin1", 0, z),
          text: inflateSync(data.subarray(z + 2)).toString("latin1"),
        });
      } else if (type === "iTXt") {
        const z = data.indexOf(0);
        const key = data.toString("latin1", 0, z);
        const compressed = data[z + 1] === 1;
        let p = z + 3;
        p = data.indexOf(0, p) + 1; // language tag
        p = data.indexOf(0, p) + 1; // translated keyword
        const body = data.subarray(p);
        out.push({
          chunk: type,
          key,
          text: (compressed ? inflateSync(body) : body).toString("utf8"),
        });
      } else if (type === "eXIf") {
        out.push(...exifEntries(data, type));
      } else if (type === "IEND") break;
    } catch {
      out.push({ chunk: type, key: "(unreadable)", text: "" });
    }
  }
  return out;
}

// Minimal TIFF/Exif reader: identity tags from IFD0 plus every ASCII run for pattern scanning.
function exifEntries(tiff, chunk) {
  const out = [];
  const strings = tiff.toString("latin1").match(/[\x20-\x7e]{4,}/g) ?? [];
  out.push({ chunk, key: "strings", text: strings.join("\n") });
  try {
    const le = tiff.toString("latin1", 0, 2) === "II";
    const u16 = (o) => (le ? tiff.readUInt16LE(o) : tiff.readUInt16BE(o));
    const u32 = (o) => (le ? tiff.readUInt32LE(o) : tiff.readUInt32BE(o));
    const ifd = u32(4);
    const count = u16(ifd);
    for (let i = 0; i < count; i++) {
      const e = ifd + 2 + i * 12;
      const tag = u16(e);
      const name = { 0x013b: "Artist", 0x8298: "Copyright", 0x9c9d: "XPAuthor" }[tag];
      if (!name) continue;
      const n = u32(e + 4);
      const size = u16(e + 2) === 1 ? n : n * (u16(e + 2) === 3 ? 2 : 1);
      const at = size <= 4 ? e + 8 : u32(e + 8);
      const raw = tiff.subarray(at, at + size);
      const text = (tag === 0x9c9d ? raw.toString("utf16le") : raw.toString("latin1")).replace(
        /\0+$/,
        "",
      );
      if (text.trim()) out.push({ chunk, key: name, text });
    }
  } catch {
    /* malformed Exif: strings above still scanned */
  }
  return out;
}

function jpegMetadata(buf) {
  const out = [];
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return out;
  let off = 2;
  while (off + 4 <= buf.length && buf[off] === 0xff) {
    const marker = buf[off + 1];
    if (marker === 0xda || marker === 0xd9) break;
    const len = buf.readUInt16BE(off + 2);
    const seg = buf.subarray(off + 4, off + 2 + len);
    off += 2 + len;
    if (marker === 0xe1) {
      if (seg.toString("latin1", 0, 6) === "Exif\0\0")
        out.push(...exifEntries(seg.subarray(6), "APP1/Exif"));
      else out.push(...xmpEntries(seg.toString("utf8"), "APP1/XMP"));
    } else if (marker === 0xfe)
      out.push({ chunk: "COM", key: "comment", text: seg.toString("latin1") });
  }
  return out;
}

function xmpEntries(xml, chunk) {
  const out = [{ chunk, key: "xmp", text: xml }];
  for (const m of xml.matchAll(
    /<(dc:creator|tiff:Artist|photoshop:AuthorsPosition|xmpRights:Owner)\b[^>]*>([\s\S]*?)<\/\1>/g,
  )) {
    const text = m[2].replace(/<[^>]+>/g, " ").trim();
    if (text) out.push({ chunk, key: m[1], text });
  }
  return out;
}

function webpMetadata(buf) {
  const out = [];
  if (buf.toString("latin1", 0, 4) !== "RIFF" || buf.toString("latin1", 8, 12) !== "WEBP")
    return out;
  let off = 12;
  while (off + 8 <= buf.length) {
    const type = buf.toString("latin1", off, off + 4);
    const len = buf.readUInt32LE(off + 4);
    const data = buf.subarray(off + 8, off + 8 + len);
    off += 8 + len + (len & 1);
    if (type === "EXIF")
      out.push(
        ...exifEntries(
          data.toString("latin1", 0, 6) === "Exif\0\0" ? data.subarray(6) : data,
          "EXIF",
        ),
      );
    if (type === "XMP ") out.push(...xmpEntries(data.toString("utf8"), "XMP"));
  }
  return out;
}

function gifMetadata(buf) {
  if (buf.toString("latin1", 0, 3) !== "GIF") return [];
  // Comment extensions and XMP application blocks are rare; scan printable runs.
  const strings = buf.toString("latin1").match(/[\x20-\x7e]{6,}/g) ?? [];
  return [{ chunk: "GIF", key: "strings", text: strings.join("\n") }];
}

export function imageMetadataHits(buf) {
  const entries = [
    ...pngMetadata(buf),
    ...jpegMetadata(buf),
    ...webpMetadata(buf),
    ...gifMetadata(buf),
  ];
  const hits = [];
  for (const entry of entries) {
    const where = `${entry.chunk}${entry.key ? ` ${entry.key}` : ""}`;
    if (
      IDENTITY_KEYS.test(entry.key) ||
      /^(?:dc:creator|tiff:Artist|xmpRights:Owner)$/.test(entry.key)
    ) {
      hits.push({ line: 0, kind: `image-metadata(${where})`, match: entry.text.slice(0, 80) });
      continue;
    }
    for (const h of scanText(entry.text))
      hits.push({ line: 0, kind: `image-metadata(${where}) ${h.kind}`, match: h.match });
  }
  return hits;
}

// ---------- allowlist ----------

function globToRegExp(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*" && glob[i + 1] === "*") {
      re += glob[i + 2] === "/" ? "(?:.*/)?" : ".*";
      i += glob[i + 2] === "/" ? 2 : 1;
    } else if (c === "*") re += "[^/]*";
    else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

export function parseAllowlist(text) {
  const rules = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const colon = line.indexOf(":");
    const glob = colon < 0 ? line : line.slice(0, colon);
    const pattern = colon < 0 ? null : line.slice(colon + 1);
    rules.push({ path: globToRegExp(glob), pattern });
  }
  return rules;
}

function allowed(rules, file, match) {
  // The allowlist necessarily spells out the substrings it allows.
  if (file === ".identity-allow")
    return rules.some((r) => r.pattern !== null && r.pattern.includes(match));
  return rules.some((r) => r.path.test(file) && (r.pattern === null || match.includes(r.pattern)));
}

// ---------- git helpers ----------

function git(root, args, opts = {}) {
  return execFileSync("git", args, { cwd: root, maxBuffer: 1 << 30, ...opts });
}

function gitText(root, args) {
  return git(root, args, { encoding: "utf8" });
}

// Reads many blobs with one `git cat-file --batch`. Returns Map(name -> Buffer|null).
function readBlobs(root, names) {
  const result = new Map();
  const unique = [...new Set(names)].filter((n) => !n.includes("\n"));
  for (let start = 0; start < unique.length; start += 500) {
    const chunk = unique.slice(start, start + 500);
    const out = git(root, ["cat-file", "--batch"], { input: chunk.join("\n") + "\n" });
    let off = 0;
    for (const name of chunk) {
      const nl = out.indexOf(10, off);
      const header = out.toString("utf8", off, nl);
      off = nl + 1;
      if (header.endsWith(" missing") || header.endsWith(" ambiguous")) {
        result.set(name, null);
        continue;
      }
      const [, type, size] = header.split(" ");
      const n = Number(size);
      result.set(name, type === "blob" ? out.subarray(off, off + n) : null);
      off += n + 1;
    }
  }
  return result;
}

// Parses `--raw -z` diff output (":mode mode sha sha status\0path\0[path\0]") into new blobs.
function rawDiff(out) {
  const parts = splitZ(out);
  const entries = [];
  for (let i = 0; i < parts.length; i++) {
    if (!parts[i].startsWith(":")) continue;
    const [, newMode, , sha, status] = parts[i].slice(1).split(" ");
    const file = /^[RC]/.test(status) ? parts[(i += 2)] : parts[++i];
    if (newMode === "160000") continue; // submodule commit
    entries.push({ file, sha });
  }
  return entries;
}

function splitZ(s) {
  return s.split("\0").filter(Boolean);
}

// ---------- OCR ----------

function hasTesseract() {
  try {
    execFileSync("tesseract", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function ocr(buf, ext) {
  const dir = mkdtempSync(path.join(tmpdir(), "identity-ocr-"));
  const file = path.join(dir, `image${ext}`);
  writeFileSync(file, buf);
  return new Promise((resolve) => {
    execFile(
      "tesseract",
      [file, "stdout", "--psm", "3", "quiet"],
      // Four images already run concurrently. Keep each OCR process single-threaded so
      // OpenMP workers do not oversubscribe small CI runners and exhaust the timeout.
      { maxBuffer: 64 << 20, timeout: 120000, env: { ...process.env, OMP_THREAD_LIMIT: "1" } },
      (error, stdout) => {
        rmSync(dir, { recursive: true, force: true });
        resolve(error ? { error: String(error.message).split("\n")[0] } : { text: stdout });
      },
    );
  });
}

async function pool(items, size, fn) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) await fn(items[next++]);
    }),
  );
}

// ---------- main ----------

function parseArgs(argv) {
  const o = { mode: null, author: false, ocr: "auto", root: process.cwd() };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--staged" || a === "--all") o.mode = a.slice(2);
    else if (a === "--range" || a.startsWith("--range=")) {
      o.mode = "range";
      o.range = a === "--range" ? argv[++i] : a.slice(8);
    } else if (a === "--author") o.author = true;
    else if (a === "--no-ocr") o.ocr = "off";
    else if (a === "--ocr") o.ocr = "on";
    else if (a === "--ocr=required") o.ocr = "required";
    else if (a === "--root") o.root = path.resolve(argv[++i]);
    else throw new Error(`Unknown argument: ${a}`);
  }
  if (!o.mode) throw new Error("Pass one of --staged, --range BASE..HEAD, --all");
  if (o.mode === "range" && !/^[^.\s]+\.\.[^.\s]+$/.test(o.range ?? ""))
    throw new Error("--range needs BASE..HEAD");
  if (o.mode === "all" && o.ocr === "auto") o.ocr = "off";
  return o;
}

export async function run(argv, log = console.log) {
  const o = parseArgs(argv);
  const root = gitText(o.root, ["rev-parse", "--show-toplevel"]).trim();
  // The allowlist is read from the same snapshot that is scanned (index, PR head, or tree).
  let allowText = null;
  if (o.mode === "all") {
    try {
      allowText = readFileSync(path.join(root, ".identity-allow"), "utf8");
    } catch {
      /* no allowlist */
    }
  } else {
    const name =
      o.mode === "staged" ? ":.identity-allow" : `${o.range.split("..")[1]}:.identity-allow`;
    allowText = readBlobs(root, [name]).get(name)?.toString("utf8") ?? null;
  }
  const rules = allowText ? parseAllowlist(allowText) : [];
  const hits = [];
  const notes = [];
  // `file` is the repository path used for allowlist globs; `label` is what gets printed.
  const report = (file, hit, label = file) => {
    if (allowed(rules, file, hit.match)) return;
    hits.push({ file: label, ...hit });
  };

  // Collect targets: [{ file, name (git object name or null), disk (path or null) }]
  let targets = [];
  if (o.mode === "staged") {
    const files = splitZ(
      gitText(root, ["diff", "--cached", "--name-only", "-z", "--diff-filter=d"]),
    );
    targets = files.map((file) => ({ file, name: `:${file}` }));
  } else if (o.mode === "range") {
    const [base, head] = o.range.split("..");
    // Final state of every file the PR adds or modifies (relative to the merge base)...
    const seen = new Set();
    const add = (entries, label) => {
      for (const { file, sha } of entries) {
        if (seen.has(`${file}@${sha}`)) continue;
        seen.add(`${file}@${sha}`);
        targets.push({ file, name: sha, label: label ? `${file}@${label}` : file });
      }
    };
    add(
      rawDiff(
        gitText(root, [
          "diff",
          "--raw",
          "-z",
          "--no-abbrev",
          "--diff-filter=d",
          `${base}...${head}`,
        ]),
      ),
    );
    // ...and every blob added or modified by each commit in the range, so content added and
    // later removed is still caught (history is published with the PR).
    const commits = gitText(root, ["rev-list", "--no-merges", `${base}..${head}`])
      .split("\n")
      .filter(Boolean);
    for (const commit of commits) {
      const raw = gitText(root, [
        "diff-tree",
        "-r",
        "-z",
        "--raw",
        "--no-abbrev",
        "--no-commit-id",
        "--root",
        "--diff-filter=d",
        commit,
      ]);
      add(rawDiff(raw), commit.slice(0, 8));
    }
    // Commit messages.
    for (const commit of splitZ(
      gitText(root, ["rev-list", "-z", `${base}..${head}`]).replace(/\n/g, "\0"),
    )) {
      const message = gitText(root, ["log", "-1", "--format=%B", commit]);
      for (const h of scanText(message)) report(`commit ${commit.slice(0, 12)} message`, h);
    }
  } else {
    targets = splitZ(gitText(root, ["ls-files", "-z"])).map((file) => ({
      file,
      disk: path.join(root, file),
    }));
  }

  // Identity of commits.
  if (o.author) {
    const check = (where, role, email, allow) => {
      if (!allow.some((re) => re.test(email)))
        hits.push({ file: where, line: 0, kind: `${role}-email`, match: email || "(empty)" });
    };
    if (o.mode === "staged") {
      const ident = (v) => /<([^>]*)>/.exec(gitText(root, ["var", v]))?.[1] ?? "";
      check("commit (staged)", "author", ident("GIT_AUTHOR_IDENT"), ALLOWED_IDENTITY_EMAILS);
      check("commit (staged)", "committer", ident("GIT_COMMITTER_IDENT"), ALLOWED_COMMITTER_EMAILS);
    } else if (o.mode === "range") {
      const [base, head] = o.range.split("..");
      // base..head of the PR head SHA: GitHub's synthetic refs/pull/N/merge commit is never included.
      const lines = gitText(root, ["log", "--format=%H%x00%ae%x00%ce", `${base}..${head}`])
        .split("\n")
        .filter(Boolean);
      for (const line of lines) {
        const [sha, ae, ce] = line.split("\0");
        check(`commit ${sha.slice(0, 12)}`, "author", ae, ALLOWED_IDENTITY_EMAILS);
        check(`commit ${sha.slice(0, 12)}`, "committer", ce, ALLOWED_COMMITTER_EMAILS);
      }
    } else notes.push("--author is ignored with --all");
  }

  const ocrWanted = o.ocr !== "off";
  const tesseract = ocrWanted && hasTesseract();
  if (o.ocr === "required" && !tesseract)
    throw new Error("--ocr=required but tesseract is not on PATH");
  if (o.ocr === "on" && !tesseract) notes.push("tesseract not found; OCR skipped");

  // Load content.
  const blobs = readBlobs(
    root,
    targets.filter((t) => t.name).map((t) => t.name),
  );
  const images = [];
  for (const t of targets) {
    let buf;
    if (t.disk) {
      try {
        const st = statSync(t.disk);
        if (!st.isFile()) continue;
        if (st.size > MAX_TEXT_BYTES && !IMAGE_EXT.test(t.file)) {
          notes.push(`${t.file}: skipped text scan (${(st.size / 1048576).toFixed(1)} MB > 5 MB)`);
          continue;
        }
        buf = readFileSync(t.disk);
      } catch {
        continue; // tracked but deleted in working tree
      }
    } else buf = blobs.get(t.name);
    if (!buf) continue; // submodule, symlink target missing, or deleted
    const label = t.label ?? t.file;
    if (IMAGE_EXT.test(t.file)) {
      for (const h of imageMetadataHits(buf)) report(t.file, h, label);
      if (tesseract) images.push({ label, file: t.file, buf });
      continue;
    }
    if (buf.length > MAX_TEXT_BYTES) {
      notes.push(`${label}: skipped text scan (${(buf.length / 1048576).toFixed(1)} MB > 5 MB)`);
      continue;
    }
    if (buf.subarray(0, 8192).includes(0)) continue; // binary, not an image
    for (const h of scanText(buf.toString("utf8"))) report(t.file, h, label);
  }

  if (images.length) {
    await pool(images, 4, async (img) => {
      const r = await ocr(img.buf, path.extname(img.file));
      if (r.error) {
        if (o.ocr === "required")
          hits.push({ file: img.label, line: 0, kind: "ocr-error", match: r.error });
        else notes.push(`${img.label}: OCR failed (${r.error})`);
        return;
      }
      for (const h of scanText(r.text))
        report(img.file, { ...h, line: 0, kind: `ocr ${h.kind}` }, img.label);
    });
  }

  for (const n of notes) log(`note: ${n}`);
  hits.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  for (const h of hits) log(`${h.file}:${h.line}: ${h.kind}: ${redact(h.match)}`);
  const scanned = `${targets.length} file(s)${images.length ? `, OCR ${images.length} image(s)` : ""}`;
  if (hits.length) {
    log(
      `identity check: ${hits.length} hit(s) in ${scanned}. Redact them, or add a documented .identity-allow entry for a genuine false positive (docs/identity-guard.md).`,
    );
    return 1;
  }
  log(`identity check: clean (${scanned})`);
  return 0;
}

if (
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("check-identity.mjs")
) {
  run(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error) => {
      console.error(`identity check: ${error.message}`);
      process.exit(2);
    },
  );
}
