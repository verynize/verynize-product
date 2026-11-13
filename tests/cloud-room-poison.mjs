import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Miniflare, cloudOptions } from "./cloud-harness.mjs";
const persistence = await fs.mkdtemp(path.join(os.tmpdir(), "room-poison-"));
const options = await cloudOptions(persistence);
const config = options.workers[0].config;
// Real workerd reset after the marker flush, before apply/ack. No production fault hook.
config.manifest.modules["poison-test.js"] = {
  type: "esm",
  contents: `
  import worker, { DesignRoom as Base } from "./index.js";
  export * from "./index.js";
  export default worker;
  export class DesignRoom extends Base {
    applyBatchNow(data, role, who) {
      if (data.client === "poison" && data.batch === 1) this.ctx.abort("test interrupted batch");
      return super.applyBatchNow(data, role, who);
    }
  }
`,
};
config.manifest.mainModule = "poison-test.js";
let mf = new Miniflare(options);
const request = (route, method = "GET", data, token) =>
  mf.dispatchFetch("http://local" + route, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(data ? { body: JSON.stringify(data) } : {}),
  });
try {
  const document = { pages: [{ id: "p", nodes: [{ id: "a", x: 0 }] }] };
  const room = await (await request("/api/rooms", "POST", { document })).json();
  const url = `/api/rooms/${room.id}`;
  const batch = {
    client: "poison",
    batch: 1,
    ops: [{ t: "node", page: "p", id: "a", key: "x", value: 99 }],
  };
  try {
    await request(url + "/ops", "POST", batch, room.token);
  } catch {}
  // Reopen from disk too, proving the marker is durable rather than an instance flag.
  await mf.dispose();
  mf = new Miniflare(options);
  const untouched = await (await request(url, "GET", null, room.token)).json();
  assert.deepEqual(untouched.document, document);
  assert.equal(untouched.revision, 0);
  const rejected = await request(url + "/ops", "POST", batch, room.token);
  assert.equal(rejected.status, 413);
  const receipt = await rejected.json();
  assert.equal(receipt.retained, true);
  assert.equal(receipt.tooLarge, true);
  assert.equal(receipt.rejected, 1);
  assert.match(receipt.error, /interrupted room processing/);
  // Restore the production class: a duplicate must retain the persisted receipt.
  await mf.dispose();
  config.manifest.mainModule = "index.js";
  mf = new Miniflare(options);
  const duplicate = await (await request(url + "/ops", "POST", batch, room.token)).json();
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.retained, true);
  assert.equal(duplicate.error, receipt.error);
  const upgrade = await mf.dispatchFetch(
    `http://local${url}/socket?token=${room.token}&client=poison`,
    { headers: { Upgrade: "websocket" } },
  );
  const socket = upgrade.webSocket;
  const snapshot = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error("missing snapshot")), 5000);
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.type === "snapshot") {
        clearTimeout(timer);
        resolve(message);
      }
    });
  });
  socket.accept();
  const saved = await snapshot;
  assert.equal(saved.acked, 1);
  assert.deepEqual(saved.rejectedBatches, [1]);
  assert.deepEqual(saved.document, document);
  socket.close();
  const next = { ...batch, batch: 2 };
  const results = await Promise.all(
    Array.from({ length: 3 }, () =>
      request(url + "/ops", "POST", next, room.token).then((r) => r.json()),
    ),
  );
  assert.equal(results.filter((r) => !r.duplicate).length, 1);
  assert.ok(results.every((r) => r.revision === 1));
  const updated = await (await request(url, "GET", null, room.token)).json();
  assert.equal(updated.document.pages[0].nodes[0].x, 99);
  assert.equal(updated.revision, 1);
  console.log(
    "PASS poison reset durability, retained rejection, restart duplicate receipt, reconnect snapshot, concurrent duplicates and recovery",
  );
} finally {
  await mf.dispose();
  await fs.rm(persistence, { recursive: true, force: true });
}
