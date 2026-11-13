import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { eachPaintColor } from "./node-style.mjs";
import { dropAliases } from "./variables.mjs";
import * as core from "./document-core.mjs";
import { syncComponents } from "./component-core.mjs";

const LIMIT = 20 * 1024 * 1024;
const clone = (value) => JSON.parse(JSON.stringify(value));
// The document schema (validateDocument, variables, bindings, room asset URLs) lives in web/document-core.js,
// shared with the canvas (web/app.js) through integrations/document-core.mjs. Re-exported for existing callers.
export const { VARIABLE_TYPES, BINDABLE, VARIABLE_NAME, isRoomAssetUrl, checkVariableValue } = core;
const RESERVED_NAMES = core.RESERVED_NAMES;
/** The shared schema plus this store's size limit (files above 20 MiB are refused on read too). */
export function validateDocument(document) {
  core.validateDocument(document);
  if (Buffer.byteLength(JSON.stringify(document)) + 1 > LIMIT)
    throw new Error("Document exceeds 20 MiB");
  return document;
}
export function applyOperations(document, operations) {
  const d = clone(document);
  if (!Array.isArray(operations) || !operations.length || operations.length > 500)
    throw new Error("Provide 1–500 operations");
  for (const op of operations) {
    const page = op.pageId ? d.pages.find((p) => p.id === op.pageId) : null;
    if (op.pageId && !page) throw new Error("Page not found");
    switch (op.type) {
      case "create_page":
        d.pages.push({ id: op.id || randomUUID(), name: op.name, nodes: [] });
        break;
      case "rename_page":
        page.name = op.name;
        break;
      case "delete_page":
        if (d.views) d.views = d.views.filter((v) => v.page !== op.pageId);
        d.pages = d.pages.filter((p) => p.id !== op.pageId);
        if (d.activePage === op.pageId) d.activePage = d.pages[0]?.id;
        break;
      case "create_node":
        page.nodes.push({
          id: randomUUID(),
          type: "rectangle",
          name: "Rectangle",
          x: 0,
          y: 0,
          w: 200,
          h: 120,
          color: "#8b7cf8",
          text: "",
          fontSize: 24,
          radius: 0,
          parentId: null,
          ...clone(op.node),
        });
        break;
      case "update_node": {
        const node = page.nodes.find((n) => n.id === op.nodeId);
        if (!node) throw new Error("Node not found");
        if ("id" in op.properties) throw new Error("Node id cannot be changed");
        if ("text" in op.properties && !("textRuns" in op.properties)) node.textRuns = [];
        Object.assign(node, clone(op.properties));
        break;
      }
      case "delete_node": {
        if (!page.nodes.some((n) => n.id === op.nodeId)) throw new Error("Node not found");
        const removed = new Set([op.nodeId]);
        let changed = true;
        while (changed) {
          changed = false;
          for (const n of page.nodes)
            if (removed.has(n.parentId) && !removed.has(n.id)) {
              removed.add(n.id);
              changed = true;
            }
        }
        page.nodes = page.nodes.filter((n) => !removed.has(n.id));
        break;
      }
      case "set_token":
        if (["__proto__", "prototype", "constructor"].includes(op.name))
          throw new Error("Reserved token name");
        d.tokens[op.name] = op.value;
        break;
      case "set_variable":
        if (RESERVED_NAMES.includes(op.name)) throw new Error("Reserved token name");
        if (Object.hasOwn(d.tokens, op.name)) throw new Error(`${op.name} is a color token`);
        {
          const value =
            op.variableType === "dimension" || op.variableType === "number"
              ? Number(op.value)
              : String(op.value);
          if (!checkVariableValue(op.variableType, value))
            throw new Error(`Invalid ${op.variableType} value for ${op.name}`);
          d.variables = { ...d.variables, [op.name]: { type: op.variableType, value } };
        }
        break;
      case "delete_token": {
        const color = Object.hasOwn(d.tokens, op.name),
          typed = Object.hasOwn(d.variables || {}, op.name);
        if (!color && !typed) throw new Error(`Token ${op.name} does not exist`);
        dropAliases(d, op.name);
        for (const p of d.pages)
          for (const n of p.nodes) {
            if (color) {
              if (n.token === op.name) {
                n.color = d.tokens[op.name];
                n.token = "";
              }
              if (n.svgColorToken === op.name) {
                n.svgColor = d.tokens[op.name];
                delete n.svgColorToken;
              }
              eachPaintColor(n, (c) => {
                if (c.token === op.name) {
                  c.color = d.tokens[op.name];
                  delete c.token;
                }
              });
            }
            if (typed && n.bindings) {
              for (const [k, v] of Object.entries(n.bindings))
                if (v === op.name) delete n.bindings[k];
              if (!Object.keys(n.bindings).length) delete n.bindings;
            }
          }
        if (color) delete d.tokens[op.name];
        else {
          delete d.variables[op.name];
          if (!Object.keys(d.variables).length) delete d.variables;
        }
        break;
      }
      case "rename_document":
        d.name = op.name;
        break;
      default:
        throw new Error("Unknown operation");
    }
  }
  for (const page of d.pages)
    for (const node of page.nodes)
      if (node.fontWeight !== undefined) node.fontWeight = String(node.fontWeight);
  syncComponents(document, d); // instances follow their mains (web/component-core.js)
  validateDocument(d);
  return core.validateWorldBoundsChange(document, d);
}
const revision = (bytes) => createHash("sha256").update(bytes).digest("hex");
export class DesignStore {
  constructor(root) {
    this.root = root;
  }
  static async open(root) {
    if (!root) throw new Error("Explicit existing document root required");
    const real = await fs.realpath(root);
    if (!(await fs.stat(real)).isDirectory()) throw new Error("Document root must be a directory");
    return new DesignStore(real);
  }
  file(name) {
    if (typeof name !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/.test(name))
      throw new Error("Document name must contain only letters, numbers, hyphen or underscore");
    return path.join(this.root, name + ".verynize.json");
  }
  async list() {
    return (await fs.readdir(this.root, { withFileTypes: true }))
      .filter((e) => e.isFile() && e.name.endsWith(".verynize.json"))
      .map((e) => e.name.slice(0, -".verynize.json".length))
      .sort();
  }
  async read(name) {
    const file = this.file(name);
    const st = await fs.lstat(file);
    if (!st.isFile() || st.isSymbolicLink() || st.size > LIMIT)
      throw new Error("Not a regular document or exceeds 20 MiB");
    const bytes = await fs.readFile(file, "utf8");
    return { document: validateDocument(JSON.parse(bytes)), revision: revision(bytes) };
  }
  async mutate(name, fn) {
    const file = this.file(name),
      lock = file + ".lock";
    const handle = await fs.open(lock, "wx", 0o600).catch(() => {
      throw new Error("Document is locked; another writer may be active");
    });
    let temp;
    try {
      const document = await fn();
      validateDocument(document);
      const pretty = JSON.stringify(document, null, 2) + "\n";
      const bytes = Buffer.byteLength(pretty) > LIMIT ? JSON.stringify(document) + "\n" : pretty;
      temp = file + "." + randomUUID() + ".tmp";
      await fs.writeFile(temp, bytes, { flag: "wx", mode: 0o600 });
      await fs.rename(temp, file);
      return { document, revision: revision(bytes) };
    } finally {
      if (temp) await fs.unlink(temp).catch(() => {});
      await handle.close();
      await fs.unlink(lock).catch(() => {});
    }
  }
  async create(name, title) {
    return this.mutate(name, async () => {
      try {
        await fs.lstat(this.file(name));
        throw new Error("Document already exists");
      } catch (e) {
        if (e.code !== "ENOENT") throw e;
      }
      return {
        version: 2,
        name: title,
        pages: [{ id: randomUUID(), name: "Page 1", nodes: [] }],
        tokens: {},
      };
    });
  }
  async update(name, expectedRevision, operations) {
    return this.mutate(name, async () => {
      const current = await this.read(name);
      if (current.revision !== expectedRevision)
        throw new Error("Revision conflict; read the document again before editing");
      return applyOperations(current.document, operations);
    });
  }
}
