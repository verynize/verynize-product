const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { app, protocol } = require("electron");
let cached;
async function store() {
  if (!cached)
    cached = import(
      pathToFileURL(path.join(__dirname, "../integrations/asset-store.mjs")).href
    ).then(({ AssetStore }) => new AssetStore(path.join(app.getPath("userData"), "assets")));
  return cached;
}
function register() {
  protocol.handle("asset", async (request) => {
    try {
      const asset = await (await store()).get(request.url);
      return new Response(asset.bytes, {
        headers: {
          "Content-Type": asset.contentType,
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "public, max-age=31536000, immutable",
        },
      });
    } catch {
      return new Response("Asset unavailable", { status: 404 });
    }
  });
}
module.exports = { store, register };
