// Regression tests for scripts/check-identity.mjs (identity/PII guard). Builds throwaway git repos.
// Leaky fixtures are assembled at runtime so this file itself passes the guard.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync, execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const script = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "scripts",
  "check-identity.mjs",
);
const OWNER = "55482107+AdamAbd@users.noreply.github.com";
const leakEmail = ["alice.personal", "gmail.com"].join("@");
const leakHome = ["", "Users", "alice", "Projects", "x"].join("/");
const leakPrompt = ["alice", "Alices-MacBook-Pro"].join("@") + " ~ % ls";
const leakWonder = ["app.wonder.so", "acme-private", "file", "123"].join("/");

function crc32(buf) {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
// 1x1 grey PNG, optionally with tEXt chunks [[key, value], ...].
function png(texts = []) {
  const ihdr = Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 0, 0, 0, 0]);
  const idat = Buffer.from("789c63680000008200811d6ee1e5", "hex");
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    chunk("IHDR", ihdr),
    ...texts.map(([k, v]) => chunk("tEXt", Buffer.from(`${k}\0${v}`, "latin1"))),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function repo(email = OWNER) {
  const dir = mkdtempSync(path.join(tmpdir(), "identity-check-"));
  const g = (...args) => execFileSync("git", args, { cwd: dir, encoding: "utf8" });
  g("init", "-q", "-b", "main");
  g("config", "user.name", "Test");
  g("config", "user.email", email);
  g("config", "commit.gpgsign", "false");
  const write = (file, content) => {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    writeFileSync(path.join(dir, file), content);
  };
  const commit = (message) => {
    g("add", "-A");
    g("commit", "-q", "--no-verify", "--allow-empty", "-m", message);
    return g("rev-parse", "HEAD").trim();
  };
  return { dir, g, write, commit, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function check(dir, ...args) {
  const env = { ...process.env };
  for (const k of [
    "GIT_AUTHOR_EMAIL",
    "GIT_COMMITTER_EMAIL",
    "GIT_AUTHOR_NAME",
    "GIT_COMMITTER_NAME",
    "EMAIL",
  ])
    delete env[k];
  const r = spawnSync(process.execPath, [script, "--root", dir, "--no-ocr", ...args], {
    encoding: "utf8",
    env,
  });
  return { code: r.status, out: r.stdout + r.stderr };
}

test("--staged scans index blobs, reports redacted hits and ignores unstaged edits", (t) => {
  const r = repo();
  t.after(r.cleanup);
  r.write("README.md", "clean\n");
  r.commit("init");

  r.write(
    "notes.md",
    `ok\ncontact ${leakEmail}\npath ${leakHome}\n${leakPrompt}\nsee https://${leakWonder}\n`,
  );
  r.g("add", "notes.md");
  let res = check(r.dir, "--staged");
  assert.equal(res.code, 1, res.out);
  assert.match(res.out, /notes\.md:2: email: /);
  assert.match(res.out, /notes\.md:3: home-path: /);
  assert.match(res.out, /notes\.md:4: shell-prompt: /);
  assert.match(res.out, /notes\.md:5: wonder-url: /);
  for (const raw of [leakEmail, "/alice/", "acme-private"])
    assert.ok(!res.out.includes(raw), `output re-leaks ${raw}`);

  // The working copy differs from the index: only the staged blob counts.
  r.write("notes.md", "clean now but not staged\n");
  assert.equal(check(r.dir, "--staged").code, 1);
  r.g("add", "notes.md");
  r.write("notes.md", `unstaged ${leakEmail}\n`);
  res = check(r.dir, "--staged");
  assert.equal(res.code, 0, res.out);
});

test("placeholders and allowed addresses are not hits", (t) => {
  const r = repo();
  t.after(r.cleanup);
  r.write(
    "docs.md",
    [
      "you@studio.com user@example.com dev@example.org a@b.test git@github.com",
      "noreply@anthropic.com noreply@openai.com " + OWNER + " icon@2x.png",
      "/Users/<name>/Library /home/runner/work ~/Library",
      "@scope/pkg @Component() npm i foo@1.2.3",
      "https://app.wonder.so https://app.wonder.so/assets/logo.svg app.wonder.so/<workspace>",
    ].join("\n"),
  );
  r.g("add", "-A");
  const res = check(r.dir, "--staged");
  assert.equal(res.code, 0, res.out);
});

test("PNG text chunks with identity data fail; pixel-only PNGs pass", (t) => {
  const r = repo();
  t.after(r.cleanup);
  r.write("clean.png", png());
  r.write("tool.png", png([["Software", "Shottr"]]));
  r.g("add", "-A");
  assert.equal(check(r.dir, "--staged").code, 0);

  r.write("design/wonder/shot.png", png([["Comment", `saved from ${leakHome}`]]));
  r.write("design/wonder/author.png", png([["Author", "Alice Example"]]));
  r.g("add", "-A");
  const res = check(r.dir, "--staged");
  assert.equal(res.code, 1, res.out);
  assert.match(res.out, /design\/wonder\/shot\.png:0: image-metadata\(tEXt Comment\) home-path/);
  assert.match(res.out, /design\/wonder\/author\.png:0: image-metadata\(tEXt Author\)/);
});

test(".identity-allow suppresses documented false positives only", (t) => {
  const r = repo();
  t.after(r.cleanup);
  r.write("README.md", "base\n");
  const base = r.commit("base");
  r.write("fixtures/a.txt", `${leakEmail}\n`);
  r.write("other.txt", `${leakEmail}\n`);
  r.write(".identity-allow", `# fixture mailbox\nfixtures/**:${leakEmail}\n`);
  r.g("add", "-A");
  const res = check(r.dir, "--staged");
  assert.equal(res.code, 1);
  assert.match(res.out, /other\.txt:1: email/);
  assert.ok(!/fixtures\/a\.txt/.test(res.out), res.out);
  assert.ok(!/^\.identity-allow:/m.test(res.out), res.out);

  // The allowlist at the range head also covers blobs from earlier commits in the range.
  r.write("other.txt", "clean\n");
  const head = r.commit("leak in fixtures");
  assert.equal(check(r.dir, "--range", `${base}..${head}`).code, 0);

  // The staged allowlist is used, not the working copy.
  r.write("fixtures/b.txt", `${leakEmail}\n`);
  r.g("add", "fixtures/b.txt");
  r.write(".identity-allow", "# emptied\n");
  assert.equal(check(r.dir, "--staged").code, 0);
  r.g("add", ".identity-allow");
  assert.equal(check(r.dir, "--staged").code, 1);
});

test("--author checks the configured commit identity", (t) => {
  const r = repo(leakEmail);
  t.after(r.cleanup);
  r.write("a.txt", "clean\n");
  r.g("add", "-A");
  assert.equal(check(r.dir, "--staged").code, 0);
  const res = check(r.dir, "--staged", "--author");
  assert.equal(res.code, 1, res.out);
  assert.match(res.out, /author-email/);
  assert.ok(!res.out.includes(leakEmail));
  r.g("config", "user.email", OWNER);
  assert.equal(check(r.dir, "--staged", "--author").code, 0);
  r.g("config", "user.email", "noreply@anthropic.com");
  assert.equal(check(r.dir, "--staged", "--author").code, 0);
});

test("--range catches leaks removed later in the range, commit messages and author emails", (t) => {
  const r = repo();
  t.after(r.cleanup);
  r.write("a.txt", "base\n");
  const base = r.commit("base");

  r.write("b.txt", "fine\n");
  r.commit("clean change");
  let head = r.g("rev-parse", "HEAD").trim();
  assert.equal(check(r.dir, "--range", `${base}..${head}`, "--author").code, 0);

  // Leak added then removed: the head tree is clean but history is not.
  r.write("c.txt", `${leakHome}\n`);
  r.commit("add debug output");
  r.write("c.txt", "redacted\n");
  head = r.commit("redact");
  let res = check(r.dir, "--range", `${base}..${head}`);
  assert.equal(res.code, 1, res.out);
  assert.match(res.out, /c\.txt@[0-9a-f]{8}:1: home-path/);

  // Message leak and a commit by a personal address.
  const r2 = repo();
  t.after(r2.cleanup);
  r2.write("a.txt", "base\n");
  const base2 = r2.commit("base");
  r2.write("a.txt", "x\n");
  r2.commit(`fix from ${leakEmail}`);
  r2.g("config", "user.email", leakEmail);
  r2.write("a.txt", "y\n");
  const head2 = r2.commit("tweak");
  res = check(r2.dir, "--range", `${base2}..${head2}`);
  assert.equal(res.code, 1, res.out);
  assert.match(res.out, /message:1: email/);
  assert.ok(!/author-email/.test(res.out));
  res = check(r2.dir, "--range", `${base2}..${head2}`, "--author");
  assert.match(res.out, /author-email/);
  assert.match(res.out, /committer-email/);
  // Commits before base are not re-checked.
  assert.equal(check(r2.dir, "--range", `${head2}..${head2}`, "--author").code, 0);
});

test("--all audits the tracked tree and usage errors exit 2", (t) => {
  const r = repo();
  t.after(r.cleanup);
  r.write("x.json", JSON.stringify({ cwd: leakHome }));
  r.commit("tree");
  assert.equal(check(r.dir, "--all").code, 1);
  assert.equal(check(r.dir).code, 2);
  assert.equal(check(r.dir, "--range", "nope").code, 2);
});
