import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, copyFile, writeFile, readFile, symlink, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
test("ratchet rejects increases and configuration errors; updates only decrease debt", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "verynize-ratchet-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(path.join(dir, "scripts"));
  await copyFile(
    path.join(root, "scripts/typecheck-ratchet.mjs"),
    path.join(dir, "scripts/typecheck-ratchet.mjs"),
  );
  await symlink(path.join(root, "node_modules"), path.join(dir, "node_modules"), "dir");
  const areas = ["desktop", "legacy-web", "integrations", "cloud"];
  const config = {
    compilerOptions: { allowJs: true, checkJs: true, noEmit: true, types: [], skipLibCheck: true },
    files: ["fixture.js"],
  };
  for (const area of areas)
    await writeFile(path.join(dir, `tsconfig.${area}.json`), JSON.stringify(config));
  await writeFile(path.join(dir, "checked.ts"), "export const checked = true;\n");
  await writeFile(
    path.join(dir, "tsconfig.integrations-build.json"),
    JSON.stringify({
      compilerOptions: { strict: true, noEmit: true, types: [], skipLibCheck: true },
      files: ["checked.ts"],
    }),
  );
  const baselinePath = path.join(dir, "typecheck-baseline.json");
  const empty = JSON.stringify(
    Object.fromEntries(areas.map((area) => [area, { total: 0, files: {} }])),
  );
  await writeFile(baselinePath, empty);
  await writeFile(path.join(dir, "fixture.js"), "const n = 1; n.toUpperCase();\n");
  const run = (...args) =>
    spawnSync(process.execPath, ["scripts/typecheck-ratchet.mjs", ...args], {
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, CI: "" },
    });
  const increase = run();
  assert.equal(increase.status, 1, increase.stderr);
  assert.match(increase.stderr, /exceeds 0/);
  assert.equal(run("--update").status, 1);
  assert.equal(await readFile(baselinePath, "utf8"), empty, "update must not bless new errors");
  const debt = Object.fromEntries(
    areas.map((area) => [area, { total: 1, files: { "fixture.js TS2339": 1 } }]),
  );
  await writeFile(baselinePath, JSON.stringify(debt));
  assert.equal(run().status, 0);
  await writeFile(path.join(dir, "fixture.js"), "const n = 1; n.toFixed();\n");
  assert.equal(run("--update").status, 0);
  assert.deepEqual(JSON.parse(await readFile(baselinePath, "utf8")), JSON.parse(empty));
  await writeFile(
    path.join(dir, "tsconfig.desktop.json"),
    '{"compilerOptions":{"target":"invalid"}}',
  );
  const badConfig = run();
  assert.equal(badConfig.status, 1);
  assert.match(badConfig.stderr, /Configuration error/);
  await writeFile(path.join(dir, "tsconfig.desktop.json"), JSON.stringify(config));
  await writeFile(path.join(dir, "checked.ts"), "export const bad: string = 42;\n");
  const strictError = run("--update");
  assert.equal(strictError.status, 1);
  assert.match(strictError.stderr, /Strict integrations check failed/);
  assert.deepEqual(JSON.parse(await readFile(baselinePath, "utf8")), JSON.parse(empty));
});
