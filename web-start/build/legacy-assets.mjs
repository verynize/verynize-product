import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/** Copy, never bundle, classic scripts. Keys retain the original shell names for subset selection. */
export function buildLegacyAssets(webDir, shell) {
  const assetUrls = {};
  const files = new Map();
  const visiting = new Set();
  const origin = "https://legacy.invalid";
  const add = (reference, parent = "/", allowMissing = false) => {
    if (/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(reference)) return reference;
    const url = new URL(reference, origin + parent);
    const relative = decodeURIComponent(url.pathname.slice(1));
    if (assetUrls[url.pathname]) return assetUrls[url.pathname] + url.search + url.hash;
    if (visiting.has(relative)) throw new Error(`Circular legacy CSS dependency: ${relative}`);
    const absolute = path.resolve(webDir, relative);
    if (!absolute.startsWith(path.resolve(webDir) + path.sep))
      throw new Error(`Legacy asset outside web/: ${reference}`);
    // Tailwind can emit unused fixture utilities (e.g. url(x.png)). Preserve their original
    // resolution instead of breaking the build or redirecting them under /assets/legacy/.
    if (allowMissing && !fs.existsSync(absolute)) return url.pathname + url.search + url.hash;
    visiting.add(relative);
    let source = fs.readFileSync(absolute);
    if (path.extname(relative) === ".css") {
      // Resolve URLs against the ORIGINAL stylesheet, before moving it. Data/external/fragment
      // references stay intact. Dependencies are hashed first so their changes invalidate CSS too.
      source = Buffer.from(
        source
          .toString()
          .replace(
            /url\(\s*(?:"([^"\n]*)"|'([^'\n]*)'|([^\s)]*))\s*\)/gi,
            (_, double, single, bare) =>
              `url(${JSON.stringify(add(double ?? single ?? bare, url.pathname, true))})`,
          ),
      );
    }
    const extension = path.extname(relative);
    const name = path.basename(relative, extension);
    const hash = createHash("sha256").update(source).digest("hex").slice(0, 16);
    const fileName = `assets/legacy/${name}-${hash}${extension}`;
    files.set(fileName, source);
    assetUrls[url.pathname] = "/" + fileName;
    visiting.delete(relative);
    return "/" + fileName + url.search + url.hash;
  };
  for (const reference of [
    ...shell.styles.map((style) => style.href),
    ...shell.scripts.map((script) => script.attrs.src),
  ]) {
    // These desktop entries are replaced/skipped by the web boot loader.
    if (!reference || /(?:^|\/)dist\/(?:ui|telemetry)\.js(?:\?|$)/.test(reference)) continue;
    assetUrls[reference] = add(reference);
  }
  return { assetUrls, files };
}
