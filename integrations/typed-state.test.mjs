import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, mkdir, copyFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));

test("migrated state contracts reject wrong revisions and preference IDs without suppressions", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "verynize-state-types-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const fixture = path.join(dir, "contract.mts");
  const config = path.join(dir, "tsconfig.json");
  await writeFile(
    config,
    JSON.stringify({
      compilerOptions: {
        strict: true,
        noEmit: true,
        skipLibCheck: true,
        target: "ES2022",
        module: "NodeNext",
        moduleResolution: "NodeNext",
        types: ["node"],
        typeRoots: [path.join(root, "node_modules/@types")],
      },
      files: [fixture],
    }),
  );
  const imports = `import { createReceipt, finishGate } from ${JSON.stringify(path.join(root, "integrations/src/verification.mjs"))};\nimport { createPreferenceStore } from ${JSON.stringify(path.join(root, "integrations/src/preferences.mjs"))};\n`;
  const compile = () =>
    spawnSync(
      process.execPath,
      [path.join(root, "node_modules/typescript/bin/tsc"), "-p", config, "--pretty", "false"],
      { encoding: "utf8" },
    );
  await writeFile(
    fixture,
    imports +
      `const receipt = createReceipt({documentRevision: "rev", artboardId: "art"});\nconst result = finishGate({receipt, currentRevision: "rev"});\nif (result.status === "blocked") { const allowed: false = result.allowFinish; }\nawait createPreferenceStore("/tmp/unused-preference-file").remove("pref_1");\n`,
  );
  const good = compile();
  assert.equal(good.status, 0, good.stdout + good.stderr);
  await writeFile(
    fixture,
    imports +
      `createReceipt({documentRevision: 42, artboardId: "art"});\ncreatePreferenceStore("/tmp/unused-preference-file").remove(42);\n`,
  );
  const bad = compile();
  assert.notEqual(bad.status, 0);
  assert.match(bad.stdout, /TS2322/);
  assert.match(bad.stdout, /TS2345/);
  assert.equal((bad.stdout.match(/error TS/g) || []).length, 2, bad.stdout);
});

test("affected-test graph follows emitted module imports back to TypeScript sources", async () => {
  const { resolveImport } = await import("../scripts/run-tests.mjs");
  for (const name of ["preferences", "verification"])
    assert.deepEqual(resolveImport(`integrations/${name}.mjs`, `./generated/${name}.mjs`), [
      `integrations/src/${name}.mts`,
    ]);
});

test("emitted integration entries run from a source-free package directory", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "verynize-state-package-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(path.join(dir, "generated"));
  for (const name of ["preferences", "verification"]) {
    await copyFile(path.join(root, `integrations/${name}.mjs`), path.join(dir, `${name}.mjs`));
    await copyFile(
      path.join(root, `integrations/generated/${name}.mjs`),
      path.join(dir, `generated/${name}.mjs`),
    );
  }
  const { createPreferenceStore } = await import(
    pathToFileURL(path.join(dir, "preferences.mjs")).href
  );
  const { createReceipt, finishGate } = await import(
    pathToFileURL(path.join(dir, "verification.mjs")).href
  );
  const preference = await createPreferenceStore(path.join(dir, "state.json")).save(
    "Readable contrast",
  );
  assert.equal(preference.text, "Readable contrast");
  const receipt = createReceipt({
    documentRevision: "rev",
    artboardId: "art",
    screenshot: { sha256: "hash", source: "live" },
    reviewNote: "Reviewed",
  });
  assert.equal(finishGate({ receipt, currentRevision: "rev" }).status, "verified");
});
