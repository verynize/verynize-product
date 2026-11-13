import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createPreferenceStore,
  defaultPreferencesPath,
  MAX_PREFERENCES,
  MAX_PREFERENCE_LENGTH,
} from "./preferences.mjs";

async function temp(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "bd-prefs-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}

test("default path honours VERYNIZE_PREFERENCES", () => {
  assert.equal(
    defaultPreferencesPath({ VERYNIZE_PREFERENCES: "/tmp/x/prefs.json" }),
    "/tmp/x/prefs.json",
  );
  assert.match(defaultPreferencesPath({}), /Verynize[\\/]design-preferences\.json$/);
});

test("CRUD, dedupe, validation and atomic file format", async (t) => {
  const file = path.join(await temp(t), "nested", "design-preferences.json");
  const store = createPreferenceStore(file);
  assert.deepEqual(await store.list(), []);
  const a = await store.save("  Use 8px   corner radius ");
  assert.equal(a.text, "Use 8px corner radius");
  assert.equal(a.duplicate, false);
  assert.match(a.id, /^pref_[0-9a-f]{10}$/);
  const again = await store.save("use 8px corner RADIUS");
  assert.equal(again.duplicate, true);
  assert.equal(again.id, a.id);
  const b = await store.save("Never use purple gradients");
  assert.deepEqual(
    (await store.list()).map((p) => p.id),
    [a.id, b.id],
  );
  const updated = await store.update(b.id, "Avoid gradients entirely");
  assert.equal(updated.text, "Avoid gradients entirely");
  assert.ok(updated.updated >= updated.created);
  await assert.rejects(store.update(b.id, "use 8px corner radius"), /already saved/);
  await assert.rejects(store.update("pref_nope", "x"), /No design preference/);
  await assert.rejects(store.save(""), /empty/);
  await assert.rejects(store.save("x".repeat(MAX_PREFERENCE_LENGTH + 1)), /280/);
  assert.equal(
    (await store.save("y".repeat(MAX_PREFERENCE_LENGTH))).text.length,
    MAX_PREFERENCE_LENGTH,
    "exactly at the limit is accepted",
  );
  await store.remove((await store.list()).at(-1).id);
  assert.deepEqual(await store.remove(a.id), { deleted: true, id: a.id });
  assert.deepEqual(
    (await store.list()).map((p) => p.text),
    ["Avoid gradients entirely"],
  );
  const raw = JSON.parse(await fs.readFile(file, "utf8"));
  assert.equal(raw.version, 1);
  assert.equal(raw.preferences.length, 1);
  assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
  assert.deepEqual(
    (await fs.readdir(path.dirname(file))).filter((f) => f.endsWith(".tmp")),
    [],
    "no temp files left",
  );
});

test("limits are 50 preferences of 280 characters", () => {
  assert.equal(MAX_PREFERENCES, 50);
  assert.equal(MAX_PREFERENCE_LENGTH, 280);
});

test("reading a file over the limits trims it to the limits", async (t) => {
  const file = path.join(await temp(t), "p.json");
  const preferences = Array.from({ length: MAX_PREFERENCES + 5 }, (_, i) => ({
    id: `pref_${i}`,
    text: "z".repeat(MAX_PREFERENCE_LENGTH + 40) + i,
  }));
  await fs.writeFile(file, JSON.stringify({ version: 1, preferences }));
  const list = await createPreferenceStore(file).list();
  assert.equal(list.length, MAX_PREFERENCES);
  assert.ok(list.every((p) => p.text.length === MAX_PREFERENCE_LENGTH));
});

test("concurrent saves are serialized and the 50 limit is enforced", async (t) => {
  const store = createPreferenceStore(path.join(await temp(t), "p.json"));
  await Promise.all(
    Array.from({ length: MAX_PREFERENCES }, (_, i) => store.save(`Rule number ${i}`)),
  );
  assert.equal((await store.list()).length, MAX_PREFERENCES);
  await assert.rejects(store.save("One too many"), /At most 50/);
  assert.equal(
    (await store.save("Rule number 5")).duplicate,
    true,
    "duplicates are fine at the limit",
  );
});

test("persisted preference records validate fields and normalize malformed timestamps", async (t) => {
  const file = path.join(await temp(t), "p.json");
  await fs.writeFile(
    file,
    JSON.stringify({
      preferences: [
        null,
        42,
        { id: 7, text: "invalid" },
        { id: "bad", text: false },
        { id: "pref_valid", text: "Keep whitespace", created: 123, updated: { invalid: true } },
        { id: "pref_date", text: "Use readable text", created: "2026-01-01", updated: null },
      ],
    }),
  );
  assert.deepEqual(await createPreferenceStore(file).list(), [
    { id: "pref_valid", text: "Keep whitespace", created: null, updated: null },
    { id: "pref_date", text: "Use readable text", created: "2026-01-01", updated: "2026-01-01" },
  ]);
});

test("separate stores serialize a shared file and recover after a rejected write", async (t) => {
  const file = path.join(await temp(t), "p.json");
  const first = createPreferenceStore(file),
    second = createPreferenceStore(file);
  await assert.rejects(first.save(""), /empty/);
  await Promise.all([first.save("First rule"), second.save("Second rule")]);
  assert.deepEqual(
    (await first.list()).map((p) => p.text),
    ["First rule", "Second rule"],
  );
});
