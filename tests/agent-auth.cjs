const test = require("node:test"),
  assert = require("node:assert/strict");
const fs = require("node:fs/promises"),
  os = require("node:os"),
  path = require("node:path");
const { AgentAuth, COMMANDS } = require("../desktop/agent-auth.cjs");
test("auth uses exact CLI arguments, sanitizes status and never logs in automatically", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "auth-fixture-")),
    log = path.join(root, "calls.jsonl"),
    events = [];
  const files = {};
  for (const agent of ["codex", "claude"]) {
    const file = path.join(root, agent);
    files[agent] = file;
    await fs.writeFile(
      file,
      "#!/usr/bin/env node\n" +
        `const fs=require('node:fs');const args=process.argv.slice(2);fs.appendFileSync(${JSON.stringify(log)},JSON.stringify({agent:${JSON.stringify(agent)},args})+'\\n');if(args.includes('status')){if(${JSON.stringify(agent)}==='claude')console.log(JSON.stringify({loggedIn:true,authMethod:'claude.ai',accessToken:'sk-SECRET',email:'private@example.com'}));else console.error('Logged in using an API key - sk-SECRET');}else if(args.includes('login')){console.log('SECRET https://provider.example/?token=sk-SECRET');setInterval(()=>{},1000)}else if(args.includes('logout'))console.log('SECRET logout');`,
    );
    await fs.chmod(file, 0o755);
  }
  const auth = new AgentAuth({
    discover: async () =>
      Object.entries(files).map(([id, path]) => ({ id, path, available: true })),
    emit: (event) => events.push(event),
  });
  try {
    await assert.rejects(() => fs.access(log));
    assert.deepEqual(await auth.status({ agent: "codex" }), {
      agent: "codex",
      installed: true,
      loggedIn: true,
      method: "API key",
    });
    assert.deepEqual(await auth.status({ agent: "claude" }), {
      agent: "claude",
      installed: true,
      loggedIn: true,
      method: "claude.ai",
    });
    let calls = (await fs.readFile(log, "utf8")).trim().split("\n").map(JSON.parse);
    assert.deepEqual(
      calls.map((c) => c.args),
      [COMMANDS.codex.status, COMMANDS.claude.status],
    );
    assert.doesNotMatch(JSON.stringify(events), /SECRET/);
    const login = await auth.login({ agent: "codex" });
    await new Promise((resolve, reject) => {
      const end = Date.now() + 3000;
      const poll = () => {
        if (events.some((e) => e.id === login.id && e.type === "waiting")) return resolve();
        if (Date.now() > end) return reject(Error("No progress event"));
        setTimeout(poll, 10);
      };
      poll();
    });
    await assert.rejects(() => auth.logout({ agent: "codex" }), /pending/);
    assert.deepEqual(auth.cancel({ id: login.id }), { canceled: true });
    assert.ok(events.some((e) => e.type === "canceled"));
    assert.doesNotMatch(JSON.stringify(events), /SECRET|provider\.example|sk-/);
    assert.deepEqual(await auth.logout({ agent: "claude" }), { loggedOut: true });
    calls = (await fs.readFile(log, "utf8")).trim().split("\n").map(JSON.parse);
    assert.deepEqual(calls[2].args, ["login"]);
    assert.deepEqual(calls[3].args, ["auth", "logout"]);
    await assert.rejects(() => auth.status({ agent: "not-a-provider" }), /Choose/);
  } finally {
    auth.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});
test("missing provider reports unavailable without launching", async () => {
  let launches = 0;
  const auth = new AgentAuth({
    discover: async () => [],
    spawnProcess: () => {
      launches++;
      throw Error("Should not execute");
    },
  });
  assert.deepEqual(await auth.status({ agent: "claude" }), {
    agent: "claude",
    installed: false,
    loggedIn: false,
    method: "unavailable",
  });
  await assert.rejects(() => auth.login({ agent: "claude" }), /not installed/);
  assert.equal(launches, 0);
});
