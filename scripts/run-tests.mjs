#!/usr/bin/env node
// Test runner for the suite listed in scripts/test-manifest.mjs.
//
//   node scripts/run-tests.mjs --all                    every test (npm test)
//   node scripts/run-tests.mjs --changed [--base <ref>] [--head <ref>]
//                                                       tests covering the changed files
//                                                       (npm run test:changed); --files a,b
//                                                       lists the changed files explicitly
//   node scripts/run-tests.mjs --ci-event               choose from GITHUB_EVENT_NAME/GITHUB_EVENT_PATH
//
// Filters: --lane <name> and --group <name> (repeatable), --shard i/n. Output: --list / --explain
// (print the selection, run nothing), --report <dir> (results.json, junit.xml, summary.md, logs/).
// Other: --jobs <n> | --jobs <lane>=<n> (concurrency; defaults node = min(4, cpus), electron =
// $TEST_ELECTRON_JOBS or 1, cloud = $TEST_CLOUD_JOBS or 1, serial runs alone), --skip-build (do not
// rebuild web/dist; the cloud Worker is still built once unless CLOUD_WORKER_BUNDLE is set),
// --bail, --update-durations (record passing durations in tests/.durations.json for --shard).
import { execFileSync, spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as manifest from "./test-manifest.mjs";
import { testBuildPlan } from "./test-build-plan.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const DURATIONS = path.join(ROOT, "tests/.durations.json");
const DEFAULT_TIMEOUT = 10 * 60_000;
const LANES = ["node", "electron", "cloud", "serial"];

// ---------------------------------------------------------------- arguments

function parseArgs(argv) {
  const opts = {
    lanes: /** @type {string[]} */ ([]),
    groups: /** @type {string[]} */ ([]),
    mode: null,
  };
  const value = (i, name) => {
    if (i >= argv.length || argv[i].startsWith("--")) fail(`${name} needs a value`);
    return argv[i];
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--all" || arg === "--changed" || arg === "--ci-event") {
      if (opts.mode && opts.mode !== arg.slice(2))
        fail("choose one of --all, --changed, --ci-event");
      opts.mode = arg.slice(2);
    } else if (arg === "--base") opts.base = value(++i, arg);
    else if (arg === "--head") opts.head = value(++i, arg);
    else if (arg === "--files")
      (opts.files ||= []).push(...value(++i, arg).split(",").filter(Boolean));
    else if (arg === "--lane") opts.lanes.push(value(++i, arg));
    else if (arg === "--group") opts.groups.push(value(++i, arg));
    else if (arg === "--shard") {
      const match = /^(\d+)\/(\d+)$/.exec(value(++i, arg));
      if (!match || +match[1] < 1 || +match[1] > +match[2])
        fail("--shard takes i/n with 1 <= i <= n");
      opts.shard = { index: +match[1], total: +match[2] };
    } else if (arg === "--jobs") {
      // --jobs 4 sets every parallel lane; --jobs electron=2 sets one lane (repeatable).
      const match = /^(?:(node|electron|cloud)=)?(\d+)$/.exec(value(++i, arg));
      if (!match || +match[2] < 1)
        fail("--jobs takes <n> or <lane>=<n> (lanes node, electron, cloud)");
      opts.jobs ||= {};
      for (const lane of match[1] ? [match[1]] : ["node", "electron", "cloud"])
        opts.jobs[lane] = +match[2];
    } else if (arg === "--report") opts.report = path.resolve(value(++i, arg));
    else if (arg === "--list") opts.list = true;
    else if (arg === "--explain") opts.explain = true;
    else if (arg === "--skip-build") opts.skipBuild = true;
    else if (arg === "--bail") opts.bail = true;
    else if (arg === "--update-durations") opts.updateDurations = true;
    else if (arg === "--help" || arg === "-h") {
      console.log(fs.readFileSync(fileURLToPath(import.meta.url), "utf8").split("\nimport ")[0]);
      process.exit(0);
    } else fail(`unknown argument ${arg}`);
  }
  if (!opts.mode) fail("pass --all, --changed or --ci-event");
  for (const lane of opts.lanes)
    if (!LANES.includes(lane)) fail(`unknown lane ${lane} (${LANES.join(", ")})`);
  const groups = new Set(manifest.tests.map((t) => t.group));
  for (const group of opts.groups)
    if (!groups.has(group)) fail(`unknown group ${group} (${[...groups].join(", ")})`);
  return opts;
}

function fail(message) {
  console.error(`run-tests: ${message}`);
  process.exit(2);
}

// ---------------------------------------------------------------- globs and git

const globCache = new Map();
function globRegExp(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*" && glob[i + 1] === "*") {
      i++;
      if (glob[i + 1] === "/") {
        i++;
        re += "(?:.*/)?";
      } else re += ".*";
    } else if (c === "*") re += "[^/]*";
    else if (c === "?") re += "[^/]";
    else if (c === "{") {
      const end = glob.indexOf("}", i);
      re +=
        "(?:" +
        glob
          .slice(i + 1, end)
          .split(",")
          .map(escape)
          .join("|") +
        ")";
      i = end;
    } else re += escape(c);
  }
  return new RegExp("^" + re + "$");
}
function escape(text) {
  return text.replace(/[.+^$()|[\]\\]/g, "\\$&");
}
function matches(file, globs) {
  return globs.some((glob) => {
    if (!globCache.has(glob)) globCache.set(glob, globRegExp(glob));
    return globCache.get(glob).test(file);
  });
}

function git(...args) {
  return execFileSync("git", args, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}
function tryGit(...args) {
  try {
    return git(...args);
  } catch {
    return null;
  }
}

/** Parses `git diff --name-status -M` output: renames and copies count both paths. */
function nameStatus(text) {
  const files = [];
  for (const line of text.split("\n").filter(Boolean)) {
    const [status, ...paths] = line.split("\t");
    for (const p of paths) files.push({ file: p, status: status[0] });
  }
  return files;
}

/**
 * The changed files and how they were found. CI passes base and head explicitly; locally the
 * default base is the merge base with origin/staging and the working tree (staged, unstaged and
 * untracked files) is included.
 */
function changedFiles(base, head) {
  const notes = [];
  const local = !head;
  if (!base) {
    for (const ref of ["origin/staging", "staging", "origin/main", "main"]) {
      const mb = tryGit("merge-base", "HEAD", ref);
      if (mb) {
        base = mb;
        notes.push(`base = merge-base HEAD ${ref} (${mb.slice(0, 10)})`);
        break;
      }
    }
    if (!base) return { error: "no merge base with origin/staging, staging or main" };
  } else {
    const resolved = tryGit("rev-parse", "--verify", `${base}^{commit}`);
    if (!resolved) return { error: `cannot resolve base ${base} (fetch more history?)` };
    const mb = tryGit("merge-base", resolved, head || "HEAD");
    notes.push(`base = ${base}${mb && mb !== resolved ? ` (merge base ${mb.slice(0, 10)})` : ""}`);
    base = mb || resolved;
  }
  const headRef = head || "HEAD";
  if (!tryGit("rev-parse", "--verify", `${headRef}^{commit}`))
    return { error: `cannot resolve head ${headRef}` };
  const byFile = new Map();
  for (const entry of nameStatus(git("diff", "--name-status", "-M", base, headRef)))
    byFile.set(entry.file, entry);
  if (local) {
    for (const entry of nameStatus(git("diff", "--name-status", "-M", "HEAD")))
      byFile.set(entry.file, entry);
    for (const file of git("ls-files", "--others", "--exclude-standard")
      .split("\n")
      .filter(Boolean))
      byFile.set(file, { file, status: "?" });
    notes.push("plus staged, unstaged and untracked files");
  } else notes.push(`head = ${head}`);
  return { files: [...byFile.values()].sort((a, b) => a.file.localeCompare(b.file)), notes };
}

// ---------------------------------------------------------------- import graph

const SOURCE = /\.(c?js|mjs|mts|cts|ts|tsx)$/;
const SCAN_DIRS = [
  "desktop",
  "web",
  "integrations",
  "cloud",
  "server",
  "api",
  "web-start",
  "scripts",
  "tests",
];
const IMPORT = /(?:require\s*\(\s*|import\s*\(\s*|\bfrom\s+|^\s*import\s+)["'`]([^"'`]+)["'`]/gm;

function listSources() {
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) {
        if (!["node_modules", "dist", "assets", ".git"].includes(entry.name)) walk(rel);
      } else if (SOURCE.test(entry.name)) out.push(rel);
    }
  };
  for (const dir of SCAN_DIRS) if (fs.existsSync(path.join(ROOT, dir))) walk(dir);
  return out;
}

export function resolveImport(from, spec) {
  let target;
  if (spec.startsWith("@/")) target = "web/src/" + spec.slice(2);
  else if (spec === "#cloud-runtime")
    return ["cloud/platform/cloudflare/runtime.js", "cloud/platform/node/runtime.js"];
  else if (spec === "#mcp-env") return ["cloud/mcp-env.js", "cloud/platform/node/mcp-env.js"];
  else if (spec.startsWith("."))
    target = path.posix.normalize(path.posix.join(path.posix.dirname(from), spec));
  else return [];
  // Runtime wrappers load emitted ESM; test selection must follow its authoring source,
  // including on clean checkouts before the integration build has run.
  if (target.startsWith("integrations/generated/") && target.endsWith(".mjs"))
    return [
      target.replace("integrations/generated/", "integrations/src/").replace(/\.mjs$/, ".mts"),
    ];
  for (const candidate of [
    target,
    ...[".ts", ".tsx", ".mts", ".cts", ".js", ".mjs", ".cjs"].map((e) => target + e),
    ...["ts", "tsx", "js"].map((e) => `${target}/index.${e}`),
  ])
    if (
      fs.existsSync(path.join(ROOT, candidate)) &&
      fs.statSync(path.join(ROOT, candidate)).isFile()
    )
      return [candidate];
  return [target]; // a deleted or generated file: keep the edge so its importers are still found
}

function buildGraph() {
  const imports = new Map();
  const texts = new Map();
  for (const file of listSources()) {
    const text = fs.readFileSync(path.join(ROOT, file), "utf8");
    texts.set(file, text);
    const deps = new Set();
    for (const match of text.matchAll(IMPORT))
      for (const dep of resolveImport(file, match[1])) deps.add(dep);
    imports.set(file, deps);
  }
  const importers = new Map();
  for (const [file, deps] of imports)
    for (const dep of deps) {
      if (!importers.has(dep)) importers.set(dep, new Set());
      importers.get(dep).add(file);
    }
  return { imports, importers, texts };
}

/** Files a test loads, transitively, not walking through composition roots. */
function closure(graph, file) {
  const seen = new Set([file]);
  const stack = [file];
  while (stack.length) {
    const next = stack.pop();
    if (next !== file && manifest.COMPOSITION_ROOTS.includes(next)) continue;
    for (const dep of graph.imports.get(next) || [])
      if (!seen.has(dep)) {
        seen.add(dep);
        stack.push(dep);
      }
  }
  return seen;
}

/** A changed file plus every file that imports it, transitively, stopping at composition roots. */
function affected(graph, file) {
  const seen = new Set([file]);
  const stack = [file];
  while (stack.length)
    for (const importer of graph.importers.get(stack.pop()) || [])
      if (!seen.has(importer) && !manifest.COMPOSITION_ROOTS.includes(importer)) {
        seen.add(importer);
        stack.push(importer);
      }
  return seen;
}

// ---------------------------------------------------------------- manifest

function normalize(entry) {
  const file = entry.file;
  let cmd = entry.cmd;
  if (!cmd) {
    const text = fs.existsSync(path.join(ROOT, file))
      ? fs.readFileSync(path.join(ROOT, file), "utf8")
      : "";
    cmd = /["']node:test["']/.test(text) ? `node --test ${file}` : `node ${file}`;
  }
  return {
    ...entry,
    id: entry.id || file,
    cmd,
    covers: entry.covers || [],
    locks: entry.locks || [],
    timeoutMs: entry.timeoutMs || DEFAULT_TIMEOUT,
  };
}

/** Test-looking files under tests/ that the manifest does not list. */
function missingFromManifest(entries) {
  const listed = new Set(entries.map((e) => e.file));
  return fs
    .readdirSync(path.join(ROOT, "tests"))
    .filter((name) => /\.(cjs|mjs)$/.test(name))
    .map((name) => `tests/${name}`)
    .filter((file) => !matches(file, manifest.NON_ENTRY) && !listed.has(file));
}

function readDurations() {
  try {
    return JSON.parse(fs.readFileSync(DURATIONS, "utf8"));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- selection

function ciEvent() {
  const name = process.env.GITHUB_EVENT_NAME;
  if (!name) fail("--ci-event needs GITHUB_EVENT_NAME (and GITHUB_EVENT_PATH)");
  let payload = {};
  try {
    payload = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
  } catch {}
  if (name === "pull_request" || name === "pull_request_target") {
    const pr = payload.pull_request || {};
    const target = pr.base?.ref;
    if (target === "staging" && pr.base?.sha && pr.head?.sha)
      return {
        mode: "changed",
        base: pr.base.sha,
        head: pr.head.sha,
        why: `pull request into staging (${pr.base.sha.slice(0, 10)}..${pr.head.sha.slice(0, 10)})`,
      };
    return { mode: "all", why: `pull request into ${target || "unknown branch"}: full suite` };
  }
  return { mode: "all", why: `${name} event: full suite` };
}

function select(entries, opts, graph) {
  const reasons = new Map(); // id -> [reasons]
  const add = (entry, why) => {
    if (!reasons.has(entry.id)) reasons.set(entry.id, []);
    if (reasons.get(entry.id).length < 6) reasons.get(entry.id).push(why);
  };
  const summary = [];
  if (opts.files && opts.mode !== "changed") fail("--files only works with --changed");
  let mode = opts.mode;
  let base = opts.base;
  let head = opts.head;
  if (mode === "ci-event") {
    const event = ciEvent();
    summary.push(event.why);
    ({ mode } = event);
    if (event.base) ({ base, head } = event);
  }
  const fileMap = [];
  if (mode === "changed") {
    const changes = opts.files
      ? {
          files: opts.files.map((file) => ({ file, status: "M" })),
          notes: ["changed files given with --files"],
        }
      : changedFiles(base, head);
    if (changes.error) {
      summary.push(`cannot compute changed files (${changes.error}): full suite`);
      mode = "all";
    } else {
      summary.push(...changes.notes, `${changes.files.length} changed file(s)`);
      const closures = new Map(entries.map((e) => [e.id, closure(graph, e.file)]));
      const entryFiles = new Set(entries.map((e) => e.file));
      const electronEntries = entries.filter((e) => e.lane === "electron");
      let full = null;
      for (const { file, status } of changes.files) {
        const hits = new Set();
        const hit = (entry, why) => {
          hits.add(entry.id);
          add(entry, why);
        };
        if (matches(file, manifest.FULL_SUITE)) {
          full ||= `${file} changed`;
          fileMap.push({ file, status, result: "full suite" });
          continue;
        }
        for (const entry of entries) if (entry.file === file) hit(entry, `test file changed`);
        if (matches(file, manifest.CORE_ELECTRON))
          for (const entry of electronEntries) hit(entry, `core ${file}`);
        const docOnly = matches(file, manifest.NO_TESTS);
        // Other test files that import the changed file are not sources other tests cover.
        const touched = [...affected(graph, file)].filter((f) => f === file || !entryFiles.has(f));
        for (const entry of entries) {
          if (hits.has(entry.id)) continue;
          const loads = closures.get(entry.id);
          const via = touched.find((f) => loads.has(f) && f !== entry.file);
          if (via) hit(entry, via === file ? `imports ${file}` : `imports ${via} (uses ${file})`);
          else {
            // Docs and images count only where a test names them exactly (desktop/README.md is a
            // contract); area-wide globs ("cloud/**") match direct changes, not every importer.
            const narrow = entry.covers.filter((glob) => !/^[^/*]+\/\*\*$/.test(glob));
            const globs = (f) =>
              f !== file ? narrow : docOnly ? entry.covers.filter((g) => g === file) : entry.covers;
            const covered = touched.find((f) => matches(f, globs(f)));
            if (covered)
              hit(entry, covered === file ? `covers ${file}` : `covers ${covered} (uses ${file})`);
          }
        }
        // Fixtures, helpers and CLIs that tests read or spawn by path rather than import.
        if (!hits.size && !docOnly && path.posix.basename(file).length >= 8) {
          const base = path.posix.basename(file);
          const mentioning = [...graph.texts]
            .filter(([f, text]) => f !== file && text.includes(base))
            .map(([f]) => f);
          for (const entry of entries) {
            const via = mentioning.find((f) => closures.get(entry.id).has(f));
            if (via) hit(entry, `${via} mentions ${base}`);
          }
        }
        if (hits.size) fileMap.push({ file, status, result: `${hits.size} test(s)` });
        else if (docOnly) fileMap.push({ file, status, result: "no tests needed" });
        else {
          full ||= `${file} is not covered by any manifest entry`;
          fileMap.push({ file, status, result: "unmapped: full suite" });
        }
      }
      if (full) {
        summary.push(`${full}: full suite`);
        mode = "all";
      }
    }
  }
  if (mode === "all")
    for (const entry of entries) if (!reasons.has(entry.id)) add(entry, "full suite");

  const requestedGroups = new Set(opts.groups);
  const selected = [];
  const skipped = [];
  const manualGroups = new Set();
  for (const entry of entries) {
    // Manual entries (extra services or a packaged app) run only when their group is named.
    if (entry.manual && !requestedGroups.has(entry.group)) {
      if (reasons.has(entry.id)) manualGroups.add(entry.group);
      continue;
    }
    if (!reasons.has(entry.id)) continue;
    if (opts.groups.length && !requestedGroups.has(entry.group)) continue;
    if (opts.lanes.length && !opts.lanes.includes(entry.lane)) continue;
    if (entry.platforms && !entry.platforms.includes(process.platform)) {
      skipped.push({ entry, reason: `only on ${entry.platforms.join(", ")}` });
      continue;
    }
    selected.push(entry);
  }
  if (manualGroups.size)
    summary.push(`manual groups not run: ${[...manualGroups].join(", ")} (name them with --group)`);
  return { selected, skipped, reasons, summary, fileMap, mode };
}

function shard(selected, { index, total }, durations) {
  const known = durations?.tests || {};
  const byLane = {};
  for (const e of selected) if (known[e.id]) (byLane[e.lane] ||= []).push(known[e.id]);
  const median = (list) =>
    list?.length ? [...list].sort((a, b) => a - b)[list.length >> 1] : null;
  const fallback = { node: 5000, cloud: 20000, electron: 30000, serial: 30000 };
  const cost = (e) => (durations ? (known[e.id] ?? median(byLane[e.lane]) ?? fallback[e.lane]) : 1);
  const bins = Array.from({ length: total }, () => ({ load: 0, items: [] }));
  const order = [...selected].sort((a, b) => cost(b) - cost(a) || a.id.localeCompare(b.id));
  for (const entry of order) {
    const bin = bins.reduce((best, b) => (b.load < best.load ? b : best), bins[0]);
    bin.load += cost(entry);
    bin.items.push(entry.id);
  }
  const mine = new Set(bins[index - 1].items);
  return selected.filter((e) => mine.has(e.id));
}

// ---------------------------------------------------------------- running

function hasCommand(name) {
  return spawnSync("sh", ["-c", `command -v ${name}`], { stdio: "ignore" }).status === 0;
}

function needsXvfb() {
  return process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY;
}

function argv(entry) {
  const parts = entry.cmd.split(/\s+/).filter(Boolean);
  if (parts[0] === "node") parts[0] = process.execPath;
  if (entry.lane === "electron" && needsXvfb())
    return ["xvfb-run", "-a", "-s", "-screen 0 3840x2160x24", ...parts];
  return parts;
}

export function runProcess(command, args, { env, timeoutMs, cwd = ROOT }) {
  return new Promise((resolve) => {
    const started = Date.now();
    const tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), "verynize-test-"));
    const sweep = () => {
      if (process.platform !== "win32") {
        const found = spawnSync("pgrep", ["-f", tmpdir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")], {
          encoding: "utf8",
        });
        for (const pid of (found.stdout || "").trim().split(/\s+/).map(Number)) {
          if (pid > 1 && pid !== process.pid) {
            try {
              process.kill(pid, "SIGKILL");
            } catch {}
          }
        }
      }
      fs.rmSync(tmpdir, { recursive: true, force: true });
    };
    const child = spawn(command, args, {
      cwd,
      env: { ...env, TMPDIR: tmpdir, TMP: tmpdir, TEMP: tmpdir, VERYNIZE_EXIT_WITH_PARENT: "1" },
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const chunks = [];
    child.stdout.on("data", (c) => chunks.push(c));
    child.stderr.on("data", (c) => chunks.push(c));
    let timedOut = false;
    const kill = (signal) => {
      try {
        if (process.platform === "win32") child.kill(signal);
        else if (child.pid !== undefined) process.kill(-child.pid, signal);
      } catch {}
      if (signal === "SIGKILL") sweep();
    };
    let escalation;
    const timer = setTimeout(() => {
      timedOut = true;
      kill("SIGTERM");
      escalation = setTimeout(() => kill("SIGKILL"), 5000);
      escalation.unref();
    }, timeoutMs);
    running.add(kill);
    child.on("error", (error) => chunks.push(Buffer.from(`\n${error.message}\n`)));
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      clearTimeout(escalation);
      running.delete(kill);
      // Leftover children in the group (Electron helpers, servers) must not outlive the test.
      kill("SIGKILL");
      resolve({
        code,
        signal,
        timedOut,
        durationMs: Date.now() - started,
        output: Buffer.concat(chunks).toString("utf8"),
      });
    });
  });
}
const running = new Set();
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    for (const kill of running) kill("SIGKILL");
    process.exit(130);
  });

function tail(text, lines) {
  const all = text.trimEnd().split("\n");
  return (
    (all.length > lines ? `... (${all.length - lines} earlier lines)\n` : "") +
    all.slice(-lines).join("\n")
  );
}

async function prepare(selected, opts, env, results) {
  const plan = testBuildPlan(selected, opts);
  // This flag is valid only after this invocation has built the selected source.
  delete env.TEST_WEB_NODE_BUILT;
  const step = async (name, args) => {
    process.stdout.write(`build ${name} ... `);
    const run = await runProcess(process.execPath, args, { env, timeoutMs: DEFAULT_TIMEOUT });
    const ok = run.code === 0;
    console.log(`${ok ? "ok" : "FAILED"} (${(run.durationMs / 1000).toFixed(1)}s)`);
    results.builds.push({ name, ok, durationMs: run.durationMs });
    if (!ok) {
      console.log(tail(run.output, 200));
      throw new Error(`build ${name} failed`);
    }
  };
  await step("integrations", ["scripts/build-integrations.mjs"]);
  if (plan.ui) await step("ui", ["scripts/build-ui.cjs"]);
  // One Worker build for every cloud test (tests/cloud-harness.mjs reads CLOUD_WORKER_BUNDLE),
  // copied out of .cloudflare/output because tests/web-cloudflare.mjs and `vp dev` rewrite it.
  if (plan.worker && !env.CLOUD_WORKER_BUNDLE) {
    if (!fs.existsSync(path.join(ROOT, "web/dist/ui.js")))
      await step("ui", ["scripts/build-ui.cjs"]);
    await step("worker", ["node_modules/vite-plus/bin/vp", "build"]);
    const bundle = path.join(ROOT, ".cloudflare/output/v0/workers/default/bundle");
    const copy = fs.mkdtempSync(path.join(os.tmpdir(), "verynize-worker-"));
    fs.cpSync(bundle, copy, { recursive: true });
    env.CLOUD_WORKER_BUNDLE = copy;
    process.on("exit", () => fs.rmSync(copy, { recursive: true, force: true }));
  }
  if (plan.node) {
    if (!fs.existsSync(path.join(ROOT, "web/dist/ui.js")))
      await step("ui", ["scripts/build-ui.cjs"]);
    await step("web-node", ["node_modules/vite-plus/bin/vp", "build", "-c", "vite.node.config.ts"]);
    env.TEST_WEB_NODE_BUILT = "1";
  }
}

// Serialize Electron across runner instances on small development machines.
async function runElectron(command, args, options) {
  const lock = process.env.TEST_ELECTRON_LOCK || path.join(os.tmpdir(), "verynize-electron-lock");
  while (true) {
    try {
      fs.mkdirSync(lock);
      break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  const release = () => {
    try {
      fs.rmdirSync(lock);
    } catch {}
  };
  process.once("exit", release);
  try {
    return await runProcess(command, args, options);
  } finally {
    release();
    process.removeListener("exit", release);
  }
}

async function runAll(selected, opts, env) {
  const cpus = os.availableParallelism?.() ?? os.cpus().length;
  const limits = {
    node: opts.jobs?.node ?? Math.min(4, cpus),
    electron: opts.jobs?.electron ?? Number(process.env.TEST_ELECTRON_JOBS || 1),
    cloud: opts.jobs?.cloud ?? Number(process.env.TEST_CLOUD_JOBS || 1),
    serial: 1,
  };
  if (selected.some((e) => e.lane === "electron") && needsXvfb() && !hasCommand("xvfb-run"))
    throw new Error(
      "Electron tests need a display: no DISPLAY is set and xvfb-run is not installed (apt-get install xvfb)",
    );
  const durations = readDurations()?.tests || {};
  const pending = [...selected].sort((a, b) => (durations[b.id] ?? 0) - (durations[a.id] ?? 0));
  const active = new Map(); // id -> entry
  const locks = new Set();
  const results = [];
  let bailed = false;
  const width = String(selected.length).length;
  return new Promise((resolve) => {
    const startNext = () => {
      if (bailed)
        for (const left of pending.splice(0))
          results.push({ entry: left, status: "cancelled", durationMs: 0, output: "" });
      const inLane = (lane) => [...active.values()].filter((e) => e.lane === lane).length;
      const serialActive = [...active.values()].some((e) => e.lane === "serial");
      for (let i = 0; i < pending.length && !serialActive; i++) {
        const entry = pending[i];
        if (entry.lane === "serial" && active.size) continue;
        if (inLane(entry.lane) >= limits[entry.lane]) continue;
        if (entry.locks.some((lock) => locks.has(lock))) continue;
        pending.splice(i--, 1);
        active.set(entry.id, entry);
        entry.locks.forEach((lock) => locks.add(lock));
        const [command, ...args] = argv(entry);
        void (entry.lane === "electron" ? runElectron : runProcess)(command, args, {
          env: { ...env, ...entry.env },
          timeoutMs: entry.timeoutMs,
        }).then((run) => {
          active.delete(entry.id);
          entry.locks.forEach((lock) => locks.delete(lock));
          const status = run.timedOut ? "timeout" : run.code === 0 ? "pass" : "fail";
          const result = {
            entry,
            status,
            durationMs: run.durationMs,
            output: run.output,
            code: run.code,
            signal: run.signal,
          };
          results.push(result);
          const n = String(results.length).padStart(width);
          console.log(
            `[${n}/${selected.length}] ${status.toUpperCase().padEnd(7)} ${(run.durationMs / 1000).toFixed(1).padStart(6)}s  ${entry.id}`,
          );
          if (status === "fail")
            console.log(
              indent(run.output.trimEnd() || `(no output; exit ${run.code ?? run.signal})`),
            );
          if (status === "timeout")
            console.log(
              indent(
                `timed out after ${entry.timeoutMs / 1000}s; last output:\n${tail(run.output, 80)}`,
              ),
            );
          if (status !== "pass" && opts.bail) {
            bailed = true;
            for (const kill of running) kill("SIGKILL");
          }
          startNext();
        });
        if (entry.lane === "serial") break;
      }
      if (!active.size && !pending.length) resolve(results);
    };
    startNext();
  });
}

function indent(text) {
  return text
    .split("\n")
    .map((line) => "    | " + line)
    .join("\n");
}

// ---------------------------------------------------------------- reports

// XML 1.0 forbids these control characters, and test output (ANSI codes) contains them.
// oxlint-disable-next-line no-control-regex
const INVALID_XML = /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g;
function xml(text) {
  return String(text)
    .replace(INVALID_XML, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function writeReports(dir, run) {
  fs.mkdirSync(path.join(dir, "logs"), { recursive: true });
  const rows = run.results.map(({ entry, status, durationMs, output }) => {
    const log = `logs/${entry.id.replace(/[^\w.-]+/g, "_")}.log`;
    if (output) fs.writeFileSync(path.join(dir, log), output);
    return {
      id: entry.id,
      file: entry.file,
      group: entry.group,
      lane: entry.lane,
      status,
      durationMs,
      log: output ? log : null,
      reasons: run.reasons.get(entry.id) || [],
    };
  });
  for (const { entry, reason } of run.skipped)
    rows.push({
      id: entry.id,
      file: entry.file,
      group: entry.group,
      lane: entry.lane,
      status: "skipped",
      durationMs: 0,
      reason,
    });
  fs.writeFileSync(
    path.join(dir, "results.json"),
    JSON.stringify(
      {
        mode: run.mode,
        summary: run.summary,
        platform: process.platform,
        startedAt: run.startedAt,
        durationMs: run.durationMs,
        builds: run.builds,
        changed: run.fileMap,
        results: rows,
      },
      null,
      2,
    ) + "\n",
  );
  const failed = rows.filter((r) => r.status === "fail" || r.status === "timeout");
  const cases = rows.map((r) => {
    let body = "";
    const res = run.results.find((x) => x.entry.id === r.id);
    if (r.status === "fail" || r.status === "timeout")
      body = `<failure message="${xml(r.status)}">${xml(tail(res.output, 400))}</failure>`;
    else if (r.status === "skipped" || r.status === "cancelled")
      body = `<skipped message="${xml(r.reason || r.status)}"/>`;
    return `    <testcase classname="${xml(r.group)}" name="${xml(r.id)}" time="${(r.durationMs / 1000).toFixed(3)}">${body}</testcase>`;
  });
  fs.writeFileSync(
    path.join(dir, "junit.xml"),
    `<?xml version="1.0" encoding="UTF-8"?>\n<testsuites>\n  <testsuite name="verynize" tests="${rows.length}" failures="${failed.length}" skipped="${rows.filter((r) => r.status === "skipped" || r.status === "cancelled").length}" time="${(run.durationMs / 1000).toFixed(3)}">\n${cases.join("\n")}\n  </testsuite>\n</testsuites>\n`,
  );
  const count = (s) => rows.filter((r) => r.status === s).length;
  const md = [
    `### Tests (${run.mode}${run.shard ? `, shard ${run.shard.index}/${run.shard.total}` : ""}, ${process.platform})`,
    "",
    ...run.summary.map((line) => `- ${line}`),
    "",
    `**${count("pass")} passed, ${failed.length} failed, ${count("skipped")} skipped${count("cancelled") ? `, ${count("cancelled")} cancelled` : ""}** in ${(run.durationMs / 1000).toFixed(0)}s`,
    "",
    ...(failed.length
      ? [
          "| Failed | Lane | Time |",
          "| --- | --- | --- |",
          ...failed.map(
            (r) =>
              `| \`${r.id}\` (${r.status}) | ${r.lane} | ${(r.durationMs / 1000).toFixed(1)}s |`,
          ),
          "",
        ]
      : []),
    "<details><summary>All tests</summary>",
    "",
    "| Test | Status | Lane | Time |",
    "| --- | --- | --- | --- |",
    ...rows.map(
      (r) => `| \`${r.id}\` | ${r.status} | ${r.lane} | ${(r.durationMs / 1000).toFixed(1)}s |`,
    ),
    "",
    "</details>",
    "",
  ].join("\n");
  fs.writeFileSync(path.join(dir, "summary.md"), md);
  return md;
}

function updateDurations(results) {
  const current = readDurations() || {
    note: "Measured test durations in ms (scripts/run-tests.mjs --update-durations), used to balance --shard.",
    tests: {},
  };
  for (const { entry, status, durationMs } of results)
    if (status === "pass") current.tests[entry.id] = Math.round(durationMs);
  current.tests = Object.fromEntries(
    Object.entries(current.tests).sort(([a], [b]) => a.localeCompare(b)),
  );
  fs.writeFileSync(DURATIONS, JSON.stringify(current, null, 2) + "\n");
}

// ---------------------------------------------------------------- main

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  const graph = buildGraph();
  const entries = manifest.tests.map(normalize);
  const ids = new Set();
  for (const entry of entries) {
    if (ids.has(entry.id)) fail(`duplicate manifest id ${entry.id}`);
    ids.add(entry.id);
    if (!LANES.includes(entry.lane)) fail(`${entry.id}: unknown lane ${entry.lane}`);
    if (!fs.existsSync(path.join(ROOT, entry.file)))
      fail(`${entry.id}: ${entry.file} does not exist`);
    entry.usesWorker =
      !entry.env?.CLOUD_RUNTIME && closure(graph, entry.file).has("tests/cloud-harness.mjs");
  }
  const missing = missingFromManifest(entries);
  if (missing.length) {
    const message = `test files missing from scripts/test-manifest.mjs:\n  ${missing.join("\n  ")}`;
    if (opts.mode === "all" || opts.list) {
      console.error(`run-tests: ${message}`);
      process.exit(1);
    }
    console.warn(`run-tests: warning: ${message}`);
  }

  const selection = select(entries, opts, graph);
  let { selected } = selection;
  const durations = readDurations();
  if (opts.shard) {
    selected = shard(selected, opts.shard, durations);
    selection.summary.push(
      `shard ${opts.shard.index}/${opts.shard.total}: ${selected.length} test(s), balanced by ${durations ? "recorded durations" : "count"}`,
    );
  }

  if (opts.list || opts.explain) {
    for (const line of selection.summary) console.log(`# ${line}`);
    if (opts.explain && selection.fileMap.length) {
      console.log("# changed files:");
      for (const { file, status, result } of selection.fileMap)
        console.log(`#   ${status} ${file} -> ${result}`);
    }
    for (const entry of selected) {
      const why = opts.explain ? `  <- ${selection.reasons.get(entry.id).join("; ")}` : "";
      console.log(`${entry.lane.padEnd(8)} ${entry.group.padEnd(12)} ${entry.id}${why}`);
    }
    for (const { entry, reason } of selection.skipped)
      console.log(`skip     ${entry.group.padEnd(12)} ${entry.id}  (${reason})`);
    console.log(`# ${selected.length} selected, ${selection.skipped.length} skipped`);
    return 0;
  }

  for (const line of selection.summary) console.log(`# ${line}`);
  console.log(
    `# running ${selected.length} test(s)${selection.skipped.length ? `, ${selection.skipped.length} skipped` : ""}`,
  );
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const run = {
    startedAt,
    mode: selection.mode,
    summary: selection.summary,
    reasons: selection.reasons,
    skipped: selection.skipped,
    fileMap: selection.fileMap,
    shard: opts.shard,
    builds: [],
    results: [],
  };
  let buildError = null;
  try {
    if (selected.length) await prepare(selected, opts, env, run);
    run.results = selected.length ? await runAll(selected, opts, env) : [];
  } catch (error) {
    buildError = error;
    console.error(`run-tests: ${error.message}`);
    run.results = selected.map((entry) => ({
      entry,
      status: "cancelled",
      durationMs: 0,
      output: "",
    }));
  }
  run.durationMs = Date.now() - t0;

  const order = new Map(entries.map((e, i) => [e.id, i]));
  run.results.sort((a, b) => order.get(a.entry.id) - order.get(b.entry.id));
  if (run.results.length) {
    console.log(
      "\n" + ["status".padEnd(9), "time".padStart(8), "  lane".padEnd(10), "test"].join(" "),
    );
    for (const { entry, status, durationMs } of run.results)
      console.log(
        [
          status.padEnd(9),
          `${(durationMs / 1000).toFixed(1)}s`.padStart(8),
          `  ${entry.lane}`.padEnd(10),
          entry.id,
        ].join(" "),
      );
  }
  for (const { entry, reason } of selection.skipped)
    console.log(
      [
        "skipped".padEnd(9),
        "".padStart(8),
        `  ${entry.lane}`.padEnd(10),
        `${entry.id} (${reason})`,
      ].join(" "),
    );
  const bad = run.results.filter((r) => r.status !== "pass");
  const passed = run.results.length - bad.length;
  console.log(
    `\n${passed} passed, ${bad.filter((r) => r.status === "fail" || r.status === "timeout").length} failed${bad.some((r) => r.status === "cancelled") ? `, ${bad.filter((r) => r.status === "cancelled").length} cancelled` : ""}, ${selection.skipped.length} skipped in ${(run.durationMs / 1000).toFixed(1)}s`,
  );
  for (const r of bad.filter((r) => r.status !== "cancelled"))
    console.log(`  ${r.status}: ${r.entry.id}`);

  if (opts.report) {
    const md = writeReports(opts.report, run);
    if (process.env.GITHUB_STEP_SUMMARY)
      fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + "\n");
    console.log(`reports in ${opts.report}`);
  }
  if (opts.updateDurations) updateDurations(run.results);
  return buildError || bad.length ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().then(
    (code) => process.exit(code),
    (error) => {
      console.error(error);
      process.exit(1);
    },
  );
