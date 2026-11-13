// Dev server / terminal process manager (desktop/dev-server.cjs) against real child processes:
// a tiny Node http server fixture project started through `npm run dev`, URL detection, process
// group shutdown, the persisted per-project override, foreground/background commands and bounds.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { ProcessManager, RingLog, detectURL, checkArgv } = require("../desktop/dev-server.cjs");

const SERVER = `const http=require('node:http'),fs=require('node:fs');
fs.writeFileSync('server.pid',String(process.pid));
const server=http.createServer((req,res)=>{res.setHeader('content-type','text/html');res.end('<h1>Fixture app</h1>');});
server.listen(0,'127.0.0.1',()=>{console.log('\\u001b[32m  ➜  Local:\\u001b[39m   http://localhost:'+server.address().port+'/');console.error('ready in 5 ms');});
process.on('SIGTERM',()=>{console.log('shutting down');server.close();process.exit(0);});
`;

async function fixture(t, scripts = { dev: "node server.js" }, extra = {}) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "bd-dev-server-")));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(
    path.join(root, "package.json"),
    JSON.stringify({ name: "fixture", private: true, scripts, ...extra }),
  );
  await fs.writeFile(path.join(root, "server.js"), SERVER);
  return root;
}
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
async function waitGone(pid, ms = 3000) {
  const end = Date.now() + ms;
  while (alive(pid) && Date.now() < end) await new Promise((r) => setTimeout(r, 50));
  return !alive(pid);
}

test("detects package.json scripts and the package manager", async (t) => {
  const m = new ProcessManager();
  const npm = await fixture(t, { build: "x", start: "node server.js", dev: "node server.js" });
  assert.deepEqual((await m.detect(npm)).command, ["npm", "run", "dev"]);
  const pnpm = await fixture(t, { start: "node server.js" });
  await fs.writeFile(path.join(pnpm, "pnpm-lock.yaml"), "");
  assert.deepEqual((await m.detect(pnpm)).command, ["pnpm", "run", "start"]);
  const declared = await fixture(t, { dev: "vite" }, { packageManager: "yarn@4.1.0" });
  assert.equal((await m.detect(declared)).packageManager, "yarn");
  const none = await fixture(t, { build: "tsc" });
  assert.equal(await m.detect(none), null);
  await assert.rejects(m.start(none), /No dev server command found/);
});

test("URL detection, ANSI stripping, argv validation and ring buffer bounds", () => {
  assert.equal(detectURL("  Local:   http://0.0.0.0:5173/"), "http://localhost:5173/");
  assert.equal(detectURL("ready on http://127.0.0.1:3000, press h"), "http://127.0.0.1:3000/");
  assert.equal(detectURL("Network: http://192.168.1.4:5173/"), null);
  assert.equal(detectURL("see https://example.com"), null);
  assert.throws(() => checkArgv("npm run dev"), /argument array/);
  assert.throws(() => checkArgv(["npm", "a\0b"]), /NUL/);
  const log = new RingLog(2000);
  log.write("stdout", "\u001b[31mred\u001b[0m line\npartial");
  assert.equal(log.entries[0].text, "red line");
  log.flush();
  assert.equal(log.entries[1].text, "partial");
  for (let i = 0; i < 200; i++) log.write("stdout", `line ${i}\n`);
  assert.ok(log.bytes <= 2000 && log.dropped > 0, "oldest lines are dropped");
  const page = log.read({ since: 1, limit: 5 });
  assert.ok(page.dropped > 0);
  assert.equal(page.entries.length, 5);
  assert.equal(page.more, true);
});

test("starts the fixture through npm run dev, serves it, and stops the whole process group", async (t) => {
  const root = await fixture(t);
  const m = new ProcessManager();
  t.after(() => m.stopAll());
  const status = await m.start(root, { waitMs: 30000 });
  assert.equal(status.state, "running", status.tail);
  assert.match(status.url, /^http:\/\/localhost:\d+\/$/);
  assert.deepEqual(status.command, ["npm", "run", "dev"]);
  assert.equal(status.source, "package.json");
  assert.match(await (await fetch(status.url)).text(), /Fixture app/);
  assert.ok(!status.tail.includes("\u001b"), "ANSI escapes removed");
  const again = await m.start(root);
  assert.equal(again.alreadyRunning, true);
  assert.equal(again.pid, status.pid);
  const log = m.read("dev-server", { root });
  assert.ok(
    log.entries.some((e) => e.stream === "stderr" && /ready in/.test(e.text)),
    "stderr captured",
  );
  const serverPid = Number(await fs.readFile(path.join(root, "server.pid"), "utf8"));
  assert.notEqual(serverPid, status.pid, "npm spawned the server as a child");
  const stopped = await m.stop(root);
  assert.equal(stopped.wasRunning, true);
  assert.equal(stopped.state, "stopped");
  assert.ok(await waitGone(serverPid), "the grandchild server process is gone");
  await assert.rejects(fetch(status.url));
});

test("saved per-project command persists across managers; failures report output", async (t) => {
  const root = await fixture(t, { build: "tsc" });
  const configFile = path.join(root, "state", "dev-servers.json");
  const first = new ProcessManager({ configFile });
  const saved = await first.configure(root, { command: [process.execPath, "server.js"] });
  assert.deepEqual(saved.config.command, [process.execPath, "server.js"]);
  assert.equal((await fs.stat(configFile)).mode & 0o777, 0o600);
  const second = new ProcessManager({ configFile });
  t.after(() => second.stopAll());
  const status = await second.start(root, { waitMs: 20000 });
  assert.equal(status.state, "running");
  assert.equal(status.source, "saved");
  assert.equal(status.config.command[1], "server.js");
  await second.stop(root);
  await second.configure(root, { command: null });
  assert.equal((await second.status(root)).config, null);
  const failing = new ProcessManager();
  const failed = await failing.start(root, {
    command: [process.execPath, "-e", 'console.error("boom: missing module");process.exit(3)'],
    waitMs: 5000,
  });
  assert.equal(failed.state, "failed");
  assert.equal(failed.exitCode, 3);
  assert.match(failed.tail, /boom: missing module/);
  await assert.rejects(
    failing.start(root, { command: ["definitely-not-a-real-binary-bd"] }),
    /Command not found/,
  );
});

test("terminal commands: foreground output, timeout, background read/stop and stopAll", async (t) => {
  const root = await fixture(t);
  const m = new ProcessManager();
  t.after(() => m.stopAll());
  const ok = await m.run(root, [
    process.execPath,
    "-e",
    'console.log(process.cwd());console.error("warn");process.exit(2)',
  ]);
  assert.equal(ok.state, "exited");
  assert.equal(ok.exitCode, 2);
  assert.match(ok.output, new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(ok.output, /warn/);
  const big = await m.run(root, [
    process.execPath,
    "-e",
    'for(let i=0;i<20000;i++)console.log("row "+i)',
  ]);
  assert.equal(big.truncated, true);
  assert.ok(big.output.length <= 30000);
  assert.match(big.output, /row 19999$/);
  const slow = await m.run(root, [process.execPath, "-e", "setTimeout(()=>{},60000)"], {
    timeoutMs: 1000,
  });
  assert.equal(slow.state, "timed-out");
  assert.ok(slow.durationMs < 8000);
  const bg = await m.run(
    root,
    [process.execPath, "-e", 'let i=0;setInterval(()=>console.log("tick "+(i++)),50)'],
    { background: true },
  );
  assert.equal(bg.state, "running");
  assert.match(bg.id, /^job-/);
  await new Promise((r) => setTimeout(r, 400));
  const first = m.read(bg.id, { root });
  assert.ok(first.entries.length >= 2);
  assert.match(first.entries[0].text, /tick/);
  await new Promise((r) => setTimeout(r, 200));
  const next = m.read(bg.id, { since: first.nextSeq, root });
  assert.ok(
    next.entries.length >= 1 && next.entries[0].seq > first.nextSeq,
    "since returns only newer lines",
  );
  assert.ok(m.list(root).some((j) => j.id === bg.id && j.state === "running"));
  assert.throws(
    () => m.read(bg.id, { root: os.tmpdir() }),
    /Unknown terminal id/,
    "jobs are scoped to their project",
  );
  const killed = await m.kill(bg.id, { root });
  assert.equal(killed.state, "stopped");
  const orphan = await m.run(root, [process.execPath, "-e", "setInterval(()=>{},1000)"], {
    background: true,
  });
  const server = await m.start(root, { waitMs: 30000 });
  const serverPid = Number(await fs.readFile(path.join(root, "server.pid"), "utf8"));
  assert.equal(m.stopAll(), 2);
  assert.ok(
    (await waitGone(orphan.pid)) && (await waitGone(server.pid)) && (await waitGone(serverPid)),
    "app quit stops every process group",
  );
});

test("preview setup argv persists and runs before an explicitly started server", async (t) => {
  const root = await fixture(t);
  const configFile = path.join(root, "preview-config.json");
  const manager = new ProcessManager({ configFile });
  t.after(() => manager.stopAll());
  const setup = [process.execPath, "-e", "require('fs').writeFileSync('setup-done','yes')"];
  await manager.configure(root, { command: [process.execPath, "server.js"], setup });
  const restored = new ProcessManager({ configFile });
  assert.deepEqual((await restored.projectConfig(root)).setup, setup);
  assert.equal((await manager.status(root)).state, "stopped");
  const result = await manager.run(root, (await manager.projectConfig(root)).setup);
  assert.equal(result.exitCode, 0);
  assert.equal(await fs.readFile(path.join(root, "setup-done"), "utf8"), "yes");
  await assert.rejects(
    manager.configure(root, { command: ["npm", "run", "dev"], setup: "npm install" }),
    /argument array/,
  );
});

test("preview command fields roundtrip quotes, whitespace, empty and literal backslash arguments", async () => {
  const { parsePreviewCommand, formatCommand } =
    await import("../web/src/islands/code/preview-command.ts");
  const argv = [
    "node",
    "-e",
    'console.log("hello")',
    "it's a test",
    "",
    String.raw`C:\tools\app`,
    "two words",
  ];
  assert.deepEqual(parsePreviewCommand(formatCommand(argv)), argv);
  assert.throws(() => parsePreviewCommand('npm "install'), /quotation/);
});

test("preview proposal persists without configuring or executing until accepted", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "preview-proposal-"));
  try {
    const configFile = path.join(root, "config.json");
    const manager = new ProcessManager({ configFile });
    await manager.propose(root, {
      command: ["npm", "run", "dev"],
      setup: ["npm", "install"],
      port: 5173,
      chatId: "chat-a",
      name: "App",
    });
    assert.equal((await manager.status(root)).state, "stopped");
    assert.equal(await manager.projectConfig(root), null);
    const restored = new ProcessManager({ configFile });
    assert.equal((await restored.proposal(root)).chatId, "chat-a");
    assert.equal((await restored.proposal(root)).port, 5173);
    await assert.rejects(restored.propose(root, { command: ["npm"], port: 0 }), /Port/);
    await restored.propose(root, { saved: true });
    assert.equal((await new ProcessManager({ configFile }).proposal(root)).saved, true);
    await restored.propose(root, { command: null });
    assert.equal(await restored.proposal(root), null);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("ignored dependency builds recover only supported install commands without approving scripts", () => {
  const { recoverIgnoredBuilds } = require("../desktop/dev-server.cjs");
  const failure = { exitCode: 1, output: "ERR_PNPM_IGNORED_BUILDS" };
  assert.deepEqual(recoverIgnoredBuilds(["vp", "install"], failure), [
    "vp",
    "install",
    "--",
    "--config.strict-dep-builds=false",
  ]);
  assert.deepEqual(recoverIgnoredBuilds(["/bin/pnpm", "install"], failure), [
    "/bin/pnpm",
    "install",
    "--config.strict-dep-builds=false",
  ]);
  assert.equal(recoverIgnoredBuilds(["npm", "install"], failure), null);
  assert.equal(recoverIgnoredBuilds(["vp", "dev"], failure), null);
  assert.equal(
    recoverIgnoredBuilds(["vp", "install", "--", "--config.strict-dep-builds=true"], failure),
    null,
  );
  assert.equal(recoverIgnoredBuilds(["vp", "install"], { ...failure, state: "stopped" }), null);
  assert.equal(
    recoverIgnoredBuilds(["vp", "install"], { exitCode: 1, output: "network error" }),
    null,
  );
});

test("project-local executables take precedence over the host application toolchain", async (t) => {
  const root = await fixture(t);
  const bin = path.join(root, "node_modules", ".bin");
  await fs.mkdir(bin, { recursive: true });
  await fs.writeFile(path.join(bin, "node"), '#!/bin/sh\nprintf "project toolchain"\n', {
    mode: 0o755,
  });
  const manager = new ProcessManager();
  t.after(() => manager.stopAll());
  const result = await manager.run(root, ["node", "--version"]);
  assert.equal(result.exitCode, 0);
  assert.equal(result.output, "project toolchain");
});

test("Yarn devEngines declaration takes precedence over unrelated lockfiles", async (t) => {
  const root = await fixture(
    t,
    { dev: "node server.js" },
    { devEngines: { packageManager: { name: "yarn", version: "4.9.2" } } },
  );
  await fs.writeFile(path.join(root, "package-lock.json"), "{}");
  const detected = await new ProcessManager().detect(root);
  assert.deepEqual(detected.command, ["yarn", "run", "dev"]);
});

test("plain HTML starts with a real Python HTTP server without Node dependencies or Vite+", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bd-static-preview-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, "index.html"), "<h1>Plain HTML preview</h1>");
  const manager = new ProcessManager();
  t.after(() => manager.stopAll());
  const detected = await manager.detect(root);
  assert.ok(detected, "Python is available on this test machine");
  assert.equal(detected.source, "index.html");
  assert.ok(
    !path.isAbsolute(detected.command[0]),
    `the detected command stays portable: ${detected.command[0]}`,
  );
  assert.equal(detected.packageManager, null);
  const command = detected.command.map((arg) => (arg === "8000" ? "0" : arg));
  const status = await manager.start(root, { command, waitMs: 15000 });
  assert.equal(status.state, "running", status.tail);
  assert.match(await (await fetch(status.url)).text(), /Plain HTML preview/);
  assert.equal((await manager.stop(root)).state, "stopped");
  await assert.rejects(fetch(status.url));
});

test("Yarn starts a real project server without Vite+", async (t) => {
  const root = await fixture(t, { dev: "node server.js" }, { packageManager: "yarn@1.22.22" });
  const manager = new ProcessManager();
  t.after(() => manager.stopAll());
  const status = await manager.start(root, { waitMs: 15000 });
  assert.equal(status.state, "running", status.tail);
  assert.deepEqual(status.command, ["yarn", "run", "dev"]);
  assert.match(await (await fetch(status.url)).text(), /Fixture app/);
  assert.equal((await manager.stop(root)).state, "stopped");
});

test("occupied preview port fails before launching instead of briefly showing another server", async (t) => {
  const http = require("node:http");
  const server = http.createServer((_req, res) => res.end("Existing app"));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const root = await fixture(t),
    manager = new ProcessManager();
  await assert.rejects(
    manager.start(root, { url: `http://127.0.0.1:${server.address().port}/` }),
    /already in use/,
  );
  assert.equal(manager.servers.size, 0);
});

test("preview server group exits when its editor process crashes", async (t) => {
  const { spawn } = require("node:child_process");
  const root = await fixture(t);
  const script = `const fs=require('node:fs');const {ProcessManager}=require(${JSON.stringify(path.resolve(__dirname, "../desktop/dev-server.cjs"))});new ProcessManager().start(${JSON.stringify(root)},{waitMs:10000}).then(s=>fs.writeFileSync(${JSON.stringify(path.join(root, "ready.json"))},JSON.stringify(s)));setInterval(()=>{},1000);`;
  const parent = spawn(process.execPath, ["-e", script], { stdio: "ignore" });
  t.after(() => {
    try {
      parent.kill("SIGKILL");
    } catch {}
  });
  let status;
  for (let i = 0; i < 100 && !status; i++) {
    try {
      status = JSON.parse(await fs.readFile(path.join(root, "ready.json"), "utf8"));
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  assert.equal(status?.state, "running");
  const serverPid = Number(await fs.readFile(path.join(root, "server.pid"), "utf8"));
  t.after(() => {
    try {
      process.kill(-status.pid, "SIGKILL");
    } catch {}
  });
  parent.kill("SIGKILL");
  assert.ok(await waitGone(serverPid, 5000), "orphan server should be terminated");
  await assert.rejects(fetch(status.url));
});

test("preview settings: several start commands, chained setup steps, Opens at override and a stop command", async (t) => {
  const root = await fixture(t);
  const configFile = path.join(root, "preview-config.json");
  const manager = new ProcessManager({ configFile });
  t.after(() => manager.stopAll());
  const node = process.execPath;
  // A companion command that records its pid and keeps running; the primary is the Node server fixture.
  const worker = [
    node,
    "-e",
    "require('fs').writeFileSync('worker.pid',String(process.pid));console.log('worker http://localhost:1/');setInterval(()=>{},1000)",
  ];
  await manager.configure(root, {
    commands: [
      { name: "Worker", command: worker },
      { name: "Web", command: [node, "server.js"] },
    ],
    setup: [
      [node, "-e", "require('fs').writeFileSync('step1','1')"],
      [
        node,
        "-e",
        "require('fs').writeFileSync('step2',require('fs').readFileSync('step1','utf8')+'2')",
      ],
    ],
    stop: [node, "-e", "require('fs').writeFileSync('stopped','yes')"],
  });
  let config = await new ProcessManager({ configFile }).projectConfig(root);
  assert.deepEqual(
    config.commands.map((c) => c.name),
    ["Worker", "Web"],
  );
  assert.equal(config.setupSteps.length, 2);
  assert.equal(config.stopSteps.length, 1);
  assert.equal(await manager.setupPending(root), true, "a new setup is pending");
  const setup = await manager.runSteps(root, config.setupSteps);
  assert.equal(setup.exitCode, 0);
  assert.equal(await fs.readFile(path.join(root, "step2"), "utf8"), "12", "steps run in order");
  await manager.markSetupDone(root, config.setupSteps);
  assert.equal(
    await new ProcessManager({ configFile }).setupPending(root),
    false,
    "finished setup is remembered",
  );
  // Without an Opens at, the first command decides the address; give the second one an explicit address instead.
  const port = 40000 + Math.floor(Math.random() * 20000);
  await manager.configure(root, {
    commands: [
      { name: "Worker", command: worker },
      {
        name: "Web",
        command: [
          node,
          "-e",
          `require('http').createServer((q,r)=>r.end('web')).listen(${port},'127.0.0.1')`,
        ],
        url: `http://localhost:${port}/`,
      },
    ],
    setup: config.setupSteps,
    stop: config.stopSteps,
  });
  config = await manager.projectConfig(root);
  assert.equal(
    config.url,
    `http://localhost:${port}/`,
    "the command with an Opens at decides the address",
  );
  assert.equal(await manager.setupPending(root), false, "unchanged setup does not run again");
  const status = await manager.start(root, { waitMs: 15000 });
  assert.equal(status.state, "running", status.tail);
  assert.equal(status.url, `http://localhost:${port}/`);
  assert.equal(await (await fetch(status.url)).text(), "web");
  assert.equal(status.companions?.[0]?.name, "Worker");
  let workerPid = 0;
  for (
    const end = Date.now() + 5000;
    !workerPid && Date.now() < end;
    await new Promise((r) => setTimeout(r, 50))
  )
    workerPid = Number(await fs.readFile(path.join(root, "worker.pid"), "utf8").catch(() => 0));
  assert.ok(alive(workerPid), "every start command runs");
  const stopped = await manager.stop(root);
  assert.equal(stopped.state, "stopped");
  assert.ok(await waitGone(workerPid), "stopping the preview stops every start command");
  assert.equal(
    await fs.readFile(path.join(root, "stopped"), "utf8"),
    "yes",
    "the stop command runs when the preview stops",
  );
  assert.equal(stopped.stopCommand.exitCode, 0);
  // Changing setup makes it pending again; invalid shapes are refused.
  await manager.configure(root, { command: [node, "server.js"], setup: [node, "-e", "1"] });
  assert.equal(await manager.setupPending(root), true);
  await assert.rejects(manager.configure(root, { commands: [] }), /start commands/);
  await assert.rejects(
    manager.configure(root, { command: [node], stop: "docker compose down" }),
    /argument array/,
  );
});

test("a stop command that hangs is ended by its timeout as a whole process group", async (t) => {
  const root = await fixture(t);
  const manager = new ProcessManager();
  t.after(() => manager.stopAll());
  const started = Date.now();
  const result = await manager.runSteps(
    root,
    [
      [
        process.execPath,
        "-e",
        "require('fs').writeFileSync('hang.pid',String(process.pid));setInterval(()=>{},1000)",
      ],
    ],
    { timeoutMs: 1000 },
  );
  assert.notEqual(result.exitCode, 0);
  assert.ok(Date.now() - started < 8000, "bounded by the timeout");
  assert.ok(await waitGone(Number(await fs.readFile(path.join(root, "hang.pid"), "utf8"))));
});

test(
  "a piped python3 -m http.server prints its address at once and is detected without a saved URL",
  {
    skip:
      !require("node:child_process").spawnSync("python3", ["--version"]).stdout?.length &&
      "python3 not available",
  },
  async (t) => {
    const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "bd-dev-python-")));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    await fs.writeFile(path.join(root, "index.html"), "<h1>Static site</h1>");
    const net = require("node:net");
    const port = await new Promise((resolve) => {
      const s = net.createServer();
      s.listen(0, "127.0.0.1", () => {
        const p = s.address().port;
        s.close(() => resolve(p));
      });
    });
    const manager = new ProcessManager();
    t.after(() => manager.stopAll());
    const status = await manager.start(root, {
      command: ["python3", "-m", "http.server", String(port), "--bind", "127.0.0.1"],
      waitMs: 15000,
    });
    assert.equal(status.state, "running", JSON.stringify(status));
    assert.match(
      status.tail,
      /Serving HTTP on 127\.0\.0\.1 port \d+/,
      "unbuffered Python output reaches the log",
    );
    assert.match(status.url, new RegExp(`:${port}/`));
  },
);
