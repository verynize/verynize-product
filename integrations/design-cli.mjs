#!/usr/bin/env node
import { DesignStore } from "./design-store.mjs";
import { inlineAssets, sidecarAssets } from "./asset-store.mjs";
import { exportHTML } from "./export-html.mjs";
import { importHtmlFrom } from "./codec-html.mjs";
import { documentToJsx, jsxToDocument, documentToHtml } from "./codec-source.mjs";
import { readFile } from "node:fs/promises";
const usage = `Verynize command interface
Usage: design-cli.mjs --root DIRECTORY COMMAND [ARGS]
  list                              List document names
  read NAME                         Read document and revision
  create NAME TITLE                 Create an empty document
  apply NAME REVISION               Read operations JSON array from stdin and atomically apply
  export NAME [PAGE_ID]              Export standalone HTML to stdout
  export-jsx NAME [PAGE_ID]          Export the page as Tailwind JSX (lossless, readable by import-jsx)
  export-css NAME [PAGE_ID]          Export the page as HTML with a class stylesheet (lossless, readable by import-html)
  import-html NAME FILE [--viewport WxH]  New document from a local HTML file and its local stylesheets
  import-jsx NAME FILE               New document from Tailwind JSX (export-jsx output or codec JSX)

Documents are NAME.verynize.json inside the existing root directory.
Errors use stderr and exit code 1. No commands execute code or contact a network (import-html reads only files inside the page's folder).`;
async function stdin() {
  let bytes = 0,
    text = "";
  for await (const chunk of process.stdin) {
    bytes += chunk.length;
    if (bytes > 20 * 1024 * 1024) throw Error("Input exceeds 20 MiB");
    text += chunk;
  }
  return JSON.parse(text);
}
try {
  const args = process.argv.slice(2);
  if (args.includes("--help")) {
    console.log(usage);
    process.exit(0);
  }
  const index = args.indexOf("--root");
  if (index < 0 || !args[index + 1]) throw Error(usage);
  const root = args.splice(index, 2)[1],
    [command, name, ...rest] = args;
  const store = await DesignStore.open(root);
  let output;
  const fresh = async (name, doc) =>
    store.mutate(name, async () => {
      try {
        await store.read(name);
        throw Error("Document already exists");
      } catch (e) {
        if (e.message === "Document already exists" || e.code !== "ENOENT") throw e;
      }
      return doc;
    });
  const vp = (() => {
    const i = rest.indexOf("--viewport");
    if (i < 0) return null;
    const m = /^(\d+)x(\d+)$/.exec(rest[i + 1] || "");
    if (!m) throw Error("--viewport expects WIDTHxHEIGHT");
    rest.splice(i, 2);
    return { width: Number(m[1]), height: Number(m[2]) };
  })();
  switch (command) {
    case "list":
      if (name) throw Error("list takes no arguments");
      output = await store.list();
      break;
    case "read":
      output = await store.read(name);
      break;
    case "create":
      output = await store.create(name, rest.join(" "));
      break;
    case "apply":
      if (rest.length !== 1) throw Error("apply requires the revision returned by read");
      output = await store.update(name, rest[0], await stdin());
      break;
    case "export": {
      const { document } = await store.read(name);
      process.stdout.write(
        (await inlineAssets(exportHTML(document, rest[0]), (ref) =>
          sidecarAssets(store.file(name)).get(ref),
        )) + "\n",
      );
      process.exit(0);
    }
    case "export-jsx": {
      const { document } = await store.read(name);
      process.stdout.write(
        await inlineAssets(documentToJsx(document, rest[0]), (ref) =>
          sidecarAssets(store.file(name)).get(ref),
        ),
      );
      process.exit(0);
    }
    case "export-css": {
      const { document } = await store.read(name);
      process.stdout.write(
        (await inlineAssets(documentToHtml(document, rest[0]), (ref) =>
          sidecarAssets(store.file(name)).get(ref),
        )) + "\n",
      );
      process.exit(0);
    }
    case "import-html": {
      if (rest.length !== 1) throw Error("import-html requires NAME FILE");
      const r = await importHtmlFrom(rest[0], {
        viewport: vp || undefined,
        name,
        assetSink: (bytes, type) => sidecarAssets(store.file(name)).put(bytes, type),
      });
      const saved = await fresh(name, r.document);
      output = { ...saved, warnings: r.warnings, stats: r.stats };
      break;
    }
    case "import-jsx": {
      if (rest.length !== 1) throw Error("import-jsx requires NAME FILE");
      const r = jsxToDocument(await readFile(rest[0], "utf8"), { name, viewport: vp });
      const saved = await fresh(name, r.document);
      output = { ...saved, warnings: r.warnings };
      break;
    }
    default:
      throw Error(usage);
  }
  process.stdout.write(JSON.stringify(output, null, 2) + "\n");
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
