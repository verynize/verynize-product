// Legacy signed room URLs become local hash refs before raster/PDF rendering. The page itself
// still has no network access. No arbitrary URL is fetched: use the shared room-asset schema.
const pending = new Map();
const RESOURCE =
  /(url\(\s*(?:&quot;|["'])?|\bsrc(?:&quot;|["'])?\s*[:=]\s*(?:&quot;|["']))(https?:\/\/[^\s"'<>)&]*)/g;
async function hydrateRoomAssets(html) {
  const { isRoomAssetUrl } = await import("../integrations/document-core.mjs");
  const urls = [...new Set([...html.matchAll(RESOURCE)].map((match) => match[2]))].filter(
    isRoomAssetUrl,
  );
  if (!urls.length) return html;
  const replacements = new Map();
  for (const url of urls) {
    if (!pending.has(url)) {
      const load = (async () => {
        const response = await fetch(url, {
          signal: AbortSignal.timeout(10000),
          redirect: "error",
        });
        if (!response.ok) throw Error(`Room asset unavailable (HTTP ${response.status})`);
        const maxBytes = 20 * 1024 * 1024;
        if (Number(response.headers.get("content-length")) > maxBytes)
          throw Error("Room asset exceeds limit 20971520 bytes");
        const reader = response.body.getReader(),
          chunks = [];
        let size = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > maxBytes) {
            await reader.cancel();
            throw Error("Room asset exceeds limit 20971520 bytes");
          }
          chunks.push(Buffer.from(value));
        }
        return (await (await require("./assets.cjs").store()).put(Buffer.concat(chunks))).ref;
      })();
      pending.set(url, load);
      load.catch(() => pending.delete(url));
      if (pending.size > 128) pending.delete(pending.keys().next().value);
    }
    replacements.set(url, await pending.get(url));
  }
  // The map has only complete, schema-checked URLs. A single replacement pass avoids
  // repeatedly copying a growing HTML string. Only resource positions are transformed.
  return html.replace(RESOURCE, (all, prefix, url) =>
    replacements.has(url) ? prefix + replacements.get(url) : all,
  );
}
module.exports = { hydrateRoomAssets };
