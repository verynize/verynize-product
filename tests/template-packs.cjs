// .zip template packs (desktop/template-packs.cjs): round trip with embedded image assets, interoperability
// with the system zip/unzip tools, and rejection of zip-slip paths, unexpected files, oversize and damaged entries.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const {
  writeZip,
  readZip,
  encodePack,
  decodePack,
  safeEntryName,
  crc32,
  MAX_ENTRY,
} = require("../desktop/template-packs.cjs");

const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const doc = (name) => ({
  version: 2,
  name,
  activePage: "p1",
  pages: [
    {
      id: "p1",
      name: "Page",
      nodes: [
        { id: "f", type: "frame", name: "Frame", x: 0, y: 0, w: 100, h: 80, parentId: null },
        { id: "i", type: "image", name: "Logo", x: 4, y: 4, w: 10, h: 10, parentId: "f", src: PNG },
      ],
    },
  ],
  tokens: { brand: "#7555c8" },
  views: [],
});
const PACK = {
  format: "verynize-template-pack",
  version: 1,
  exportedAt: "2026-10-30T00:00:00.000Z",
  templates: [
    {
      id: "t1",
      name: "Hero",
      category: "website",
      description: "A hero",
      createdAt: 5,
      document: doc("Hero"),
    },
    {
      id: "t2",
      name: "Card",
      category: "mine",
      description: "",
      createdAt: 6,
      document: doc("Card"),
    },
  ],
  components: [
    {
      id: "c1",
      name: "Badge",
      version: 3,
      updatedAt: 7,
      nodes: [
        { id: "b", type: "image", name: "Icon", x: 0, y: 0, w: 8, h: 8, parentId: null, src: PNG },
      ],
    },
  ],
};

test("crc32 matches the IEEE reference value", () => {
  assert.equal(crc32(Buffer.from("123456789")), 0xcbf43926);
});

test("pack round trip: manifest, documents, components and one shared asset", async (t) => {
  const zip = encodePack(PACK);
  const files = readZip(zip);
  assert.deepEqual(
    [...files.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
    [
      "assets/" + [...files.keys()].find((k) => k.startsWith("assets/")).slice(7),
      "components/c1.json",
      "manifest.json",
      "templates/t1.verynize.json",
      "templates/t2.verynize.json",
    ].sort(),
  );
  assert.equal(
    [...files.keys()].filter((k) => k.startsWith("assets/")).length,
    1,
    "the same image is stored once",
  );
  assert.doesNotMatch(files.get("templates/t1.verynize.json").toString(), /base64/);
  assert.match(
    files.get("templates/t1.verynize.json").toString(),
    /verynize-asset:assets\/[a-f0-9]{32}\.png/,
  );
  const manifest = JSON.parse(files.get("manifest.json"));
  assert.deepEqual(
    manifest.templates.map((x) => [x.name, x.file]),
    [
      ["Hero", "templates/t1.verynize.json"],
      ["Card", "templates/t2.verynize.json"],
    ],
  );
  assert.deepEqual(decodePack(zip), PACK);

  // The system unzip accepts our archive, and we read archives made by the system zip.
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "template-zip-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await fs.writeFile(path.join(dir, "ours.zip"), zip);
  assert.match(
    execFileSync("unzip", ["-t", path.join(dir, "ours.zip")], { encoding: "utf8" }),
    /No errors detected/,
  );
  const work = path.join(dir, "work");
  execFileSync("unzip", ["-q", path.join(dir, "ours.zip"), "-d", work]);
  execFileSync("zip", ["-q", "-r", path.join(dir, "theirs.zip"), "."], { cwd: work });
  assert.deepEqual(decodePack(await fs.readFile(path.join(dir, "theirs.zip"))), PACK);
});

test("zip-slip and unexpected paths are rejected", () => {
  for (const name of [
    "../evil.json",
    "/etc/passwd",
    "C:/x.json",
    "templates\\..\\x.json",
    "templates/../../x.verynize.json",
    "templates/./a.verynize.json",
  ]) {
    assert.throws(() => safeEntryName(name), /Unsafe path/, name);
    const zip = writeZip([
      { name: "manifest.json", data: Buffer.from("{}") },
      { name, data: Buffer.from("x") },
    ]);
    assert.throws(() => readZip(zip), /Unsafe path/, name);
  }
  assert.throws(
    () => readZip(writeZip([{ name: "run.sh", data: Buffer.from("echo") }])),
    /Unexpected file/,
  );
  assert.throws(
    () => readZip(writeZip([{ name: "other/", data: Buffer.alloc(0) }])),
    /Unexpected folder/,
  );
  assert.equal(safeEntryName("assets/"), null);
});

test("oversize, lying, damaged and duplicate entries are rejected", () => {
  // Real oversize entry: compresses to a few KB but expands past the limit.
  const big = writeZip([
    { name: "templates/big.verynize.json", data: Buffer.alloc(MAX_ENTRY + 1, 32) },
  ]);
  assert.ok(big.length < 100 * 1024);
  assert.throws(() => readZip(big), /larger than 20 MB/);
  // A header that under-reports the size: the inflated data no longer matches.
  const lying = writeZip([{ name: "templates/lie.verynize.json", data: Buffer.alloc(4096, 32) }]);
  const central = lying.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  lying.writeUInt32LE(10, central + 24);
  assert.throws(() => readZip(lying), /size or checksum mismatch/);
  // A flipped CRC.
  const crc = writeZip([{ name: "manifest.json", data: Buffer.from('{"a":1}') }]);
  crc.writeUInt32LE(
    crc.readUInt32LE(crc.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])) + 16) ^ 1,
    crc.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])) + 16,
  );
  assert.throws(() => readZip(crc), /checksum/);
  assert.throws(
    () =>
      readZip(
        writeZip([
          { name: "manifest.json", data: Buffer.from("{}") },
          { name: "manifest.json", data: Buffer.from("{}") },
        ]),
      ),
    /twice/,
  );
  assert.throws(() => readZip(Buffer.from("not a zip at all, definitely not")), /not a zip/);
  assert.throws(
    () => decodePack(writeZip([{ name: "templates/a.verynize.json", data: Buffer.from("{}") }])),
    /no manifest/,
  );
  assert.throws(
    () =>
      decodePack(
        writeZip([
          {
            name: "manifest.json",
            data: Buffer.from(
              JSON.stringify({
                format: "verynize-template-pack",
                version: 1,
                templates: [{ name: "x", file: "templates/missing.verynize.json" }],
              }),
            ),
          },
        ]),
      ),
    /missing/,
  );
  assert.throws(() => encodePack({ format: "other" }), /Not a Verynize template pack/);
});
