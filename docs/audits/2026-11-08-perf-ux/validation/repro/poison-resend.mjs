// Validation repro (claim 7, server half, local workerd): the durable poison marker is keyed by
// (client, batch), so the same content under a new batch number is applied again and resets the
// room again. Fault injection mirrors tests/cloud-room-poison.mjs (subclass, no production change):
// any batch that adds node "big" aborts the Durable Object, standing in for an out-of-memory reset.
// Usage: CLOUD_WORKER_BUNDLE=$PWD/.cloudflare/output/v0/workers/default/bundle \
//          node docs/audits/2026-11-08-perf-ux/validation/repro/poison-resend.mjs
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
const root = new URL("../../../../../", import.meta.url);
const { Miniflare, cloudOptions } = await import(new URL("tests/cloud-harness.mjs", root).href);
const persistence = await fs.mkdtemp(path.join(os.tmpdir(), "validate-poison-"));
const options = await cloudOptions(persistence);
const config = options.workers[0].config;
config.manifest.modules["poison-resend.js"] = {
  type: "esm",
  contents: `
  import worker, { DesignRoom as Base } from "./index.js";
  export * from "./index.js";
  export default worker;
  export class DesignRoom extends Base {
    applyBatchNow(data, role, who) {
      if (data.ops?.some((op) => op.id === "big" && op.t === "add")) this.ctx.abort("simulated reset");
      return super.applyBatchNow(data, role, who);
    }
  }`,
};
config.manifest.mainModule = "poison-resend.js";
const mf = new Miniflare(options);
const request = async (route, method = "GET", data, token) => {
  try {
    const res = await mf.dispatchFetch("http://local" + route, {
      method,
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      ...(data ? { body: JSON.stringify(data) } : {}),
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  } catch (e) {
    return { reset: true, error: String(e.message || e).slice(0, 80) };
  }
};
const big = { t: "add", page: "p", id: "big", value: { id: "big", type: "rectangle", x: 1 } };
const small = { t: "node", page: "p", id: "a", key: "x", value: 777 };
try {
  const room = (
    await request("/api/rooms", "POST", {
      document: { pages: [{ id: "p", nodes: [{ id: "a", x: 0 }] }] },
    })
  ).body;
  const url = `/api/rooms/${room.id}`;
  const steps = [];
  const post = async (label, batch, ops) => {
    const r = await request(url + "/ops", "POST", { client: "resend0001", batch, ops }, room.token);
    steps.push({
      label,
      batch,
      reset: !!r.reset,
      status: r.status ?? null,
      error: r.body?.error ?? r.error ?? null,
      revision: r.body?.revision ?? null,
    });
  };
  await post("original batch", 1, [big]);
  await post("retry same batch number", 1, [big]);
  // What retryRetained() sends (client-receive.mjs claim7): the retained content plus the new edit, new number.
  await post("client re-sends as new batch", 2, [small, big]);
  const stored = (await request(url, "GET", null, room.token)).body;
  console.log(
    JSON.stringify(
      {
        steps,
        stored: { revision: stored?.revision, a_x: stored?.document?.pages?.[0]?.nodes?.[0]?.x },
      },
      null,
      2,
    ),
  );
} finally {
  await mf.dispose();
  await fs.rm(persistence, { recursive: true, force: true });
}
