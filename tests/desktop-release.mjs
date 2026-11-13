import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { checksum, releaseName, validateReleaseTag } from "../scripts/desktop-release.mjs";

test("desktop release tags bind alpha builds to the exact package version", () => {
  assert.equal(validateReleaseTag("desktop-v0.18.0-alpha.1", "0.18.0"), "desktop-v0.18.0-alpha.1");
  for (const tag of [
    "v0.18.0",
    "desktop-v0.17.0-alpha.1",
    "desktop-v0.18.0-alpha.0",
    "desktop-v0.18.0-alpha.1/extra",
  ])
    assert.throws(() => validateReleaseTag(tag, "0.18.0"));
});

test("download names distinguish architectures and reject unsafe filenames", () => {
  assert.equal(releaseName("0.18.0", "arm64"), "Verynize-0.18.0-macos-arm64.zip");
  assert.equal(releaseName("0.18.0", "x64"), "Verynize-0.18.0-macos-x64.zip");
  assert.throws(() => releaseName("../escape", "arm64"));
  assert.throws(() => releaseName("0.18.0", "universal"));
});

test("download checksum matches archive bytes and changes when bytes change", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "verynize-release-"));
  try {
    const file = path.join(dir, "artifact.zip");
    await fs.writeFile(file, "abc");
    const before = await checksum(file);
    assert.equal(before, "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    await fs.appendFile(file, "changed");
    assert.notEqual(await checksum(file), before);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
