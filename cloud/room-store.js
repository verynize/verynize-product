// Per-page storage of a room's design document in the room's SQLite (cloud/rooms.js).
//
// A version-2 document (`pages[].nodes[]`) is stored as:
// - its metadata: every top-level field except `pages` (name, variables, styles, …), key `m`;
// - one record per page, keyed by page id: a `pages` row (position, size, node count) and the
//   page's properties as JSON (key `h:<id>`);
// - the page's nodes, one `node_rows` row per node (JSON, ordered by `position`), so an edit
//   rewrites the nodes it changed and not the page. Rooms stored before node rows (or with
//   ROOM_NODE_STORAGE=page) keep each page's nodes as one JSON text instead (key `n:<id>`);
//   `meta.nodes` = "rows" tells the two apart;
// - `node_pages`: node id → page id, so node ids stay unique across pages that a batch does not load.
// Texts live in `parts` rows of at most 256 Ki UTF-16 units (≤ 1 MiB of UTF-8), because a
// Durable Object SQLite row holds at most 2 MB; a node larger than that keeps its JSON in parts
// (key `r:<slot>`, `data` NULL). Other JSON documents (no pages, or a repeated page id) are one
// text, `w`.
//
// Operation batches load only the pages they touch (VerynizeOps.touchedPages); the pages they
// leave out are stubs (`nodes: []`) that are never written back. Writes are validated against the
// limits of cloud/limits.js before anything is stored. Snapshots are assembled from the rows when
// they are read; nothing keeps a whole document in memory between requests.
//
// Rooms created before per-page records kept the whole document in `room.document`. `migrate`
// converts such a room on first open, and converts page texts to node rows (or back, with
// ROOM_NODE_STORAGE=page), inside the constructor's synchronous turn, page by page.
import "../web/cloud-ops.js";
import "../web/document-core.js";
import { fail } from "./http.js";
import { DOCUMENT_BYTES, META_BYTES, PAGE_BYTES, byteSize } from "./limits.js";

const Ops = globalThis.VerynizeOps;
const { NODE_LIMITS, nodeLimitMessage } = globalThis.VerynizeDocument;
const PART_CHARS = 256 * 1024;
// Node positions leave gaps, so inserting or moving a node renumbers only that node.
const GAP = 65536;
const MB = (bytes) => `${Math.round((bytes / 1024 / 1024) * 10) / 10} MB`;
// `null` keeps the key's position, so assembled documents serialize like the stored ones.
const headText = (page) => JSON.stringify({ ...page, nodes: null });
const metaText = (doc) => JSON.stringify({ ...doc, pages: null });
// JSON length of a node list from its nodes' lengths: brackets and commas.
const listBytes = (count, sum) => sum + 2 + Math.max(0, count - 1);

/** Split a text into parts without separating a UTF-16 surrogate pair. */
function chunks(text) {
  const out = [];
  for (let start = 0; start < text.length;) {
    let end = Math.min(text.length, start + PART_CHARS);
    const code = text.charCodeAt(end - 1);
    if (end < text.length && code >= 0xd800 && code <= 0xdbff) end--;
    out.push(text.slice(start, end));
    start = end;
  }
  return out;
}

/** Indexes of the longest strictly increasing run of `values` (kept node positions). */
function increasing(values) {
  const tails = [],
    previous = Array.from({ length: values.length });
  values.forEach((value, index) => {
    let low = 0,
      high = tails.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (values[tails[middle]] < value) low = middle + 1;
      else high = middle;
    }
    previous[index] = low ? tails[low - 1] : -1;
    tails[low] = index;
  });
  const kept = new Set();
  for (let index = tails[tails.length - 1] ?? -1; index >= 0; index = previous[index])
    kept.add(index);
  return kept;
}

/**
 * Positions for a page's nodes in order: stored rows keep theirs where the order allows, the
 * others take free positions between their neighbours. Null when a gap is used up.
 */
function positions(rows) {
  const stored = [];
  rows.forEach((row, index) => {
    if (row) stored.push(index);
  });
  const keep = increasing(stored.map((index) => rows[index].position));
  const fixed = new Map([...keep].map((k) => [stored[k], rows[stored[k]].position]));
  const out = Array.from({ length: rows.length });
  let previous = null;
  for (let index = 0; index < rows.length;) {
    if (fixed.has(index)) {
      previous = out[index] = fixed.get(index);
      index++;
      continue;
    }
    let end = index;
    while (end < rows.length && !fixed.has(end)) end++;
    const count = end - index;
    const next = end < rows.length ? fixed.get(end) : null;
    const low = previous ?? (next === null ? -GAP : next - (count + 1) * GAP);
    const high = next ?? low + (count + 1) * GAP;
    const step = Math.floor((high - low) / (count + 1));
    if (step < 1) return null;
    for (let k = 0; k < count; k++) out[index + k] = low + step * (k + 1);
    previous = out[end - 1];
    index = end;
  }
  return out;
}

const tooLarge = (message) => fail(413, message);
// Page records are keyed by id; a document repeating a page id is kept as one text instead.
const paged = (doc) =>
  Ops.isStructured(doc) && new Set(doc.pages.map((page) => page.id)).size === doc.pages.length;
const pageLabel = (page) =>
  typeof page.name === "string" && page.name ? `Page "${page.name.slice(0, 60)}"` : "A page";

export class RoomStore {
  /** `rows`: store nodes one per row (default) or, false, as one text per page. */
  constructor(sql, { rows = true } = {}) {
    this.sql = sql;
    this.rowsWanted = rows;
    sql.exec(`
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS pages (id TEXT PRIMARY KEY, position INTEGER NOT NULL, bytes INTEGER NOT NULL, nodes INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS parts (key TEXT NOT NULL, part INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY (key, part));
      CREATE TABLE IF NOT EXISTS node_pages (node_id TEXT PRIMARY KEY, page_id TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS node_pages_page ON node_pages (page_id);
      CREATE TABLE IF NOT EXISTS node_rows (slot INTEGER PRIMARY KEY, page_id TEXT NOT NULL, position INTEGER NOT NULL, node_id TEXT NOT NULL, bytes INTEGER NOT NULL, data TEXT);
      CREATE INDEX IF NOT EXISTS node_rows_page ON node_rows (page_id, position);
    `);
  }

  setting(key) {
    return this.sql.exec("SELECT value FROM meta WHERE key=?", key).toArray()[0]?.value ?? null;
  }
  setSetting(key, value) {
    this.sql.exec("INSERT OR REPLACE INTO meta (key,value) VALUES (?,?)", key, String(value));
  }
  /** "pages" (per-page records), "json" (one text) or null (legacy `room.document`). */
  get layout() {
    return this.setting("layout");
  }
  /** True when the pages' nodes are stored one per row (`node_rows`). */
  get nodeRows() {
    return this.setting("nodes") === "rows";
  }

  text(key) {
    return this.sql
      .exec("SELECT data FROM parts WHERE key=? ORDER BY part", key)
      .toArray()
      .map((row) => row.data)
      .join("");
  }
  writeText(key, text) {
    this.sql.exec("DELETE FROM parts WHERE key=?", key);
    chunks(text).forEach((data, part) =>
      this.sql.exec("INSERT INTO parts (key,part,data) VALUES (?,?,?)", key, part, data),
    );
  }
  dropRows(id) {
    this.sql.exec(
      "DELETE FROM parts WHERE key IN (SELECT 'r:' || slot FROM node_rows WHERE page_id=? AND data IS NULL)",
      id,
    );
    this.sql.exec("DELETE FROM node_rows WHERE page_id=?", id);
  }
  dropPage(id) {
    this.sql.exec("DELETE FROM pages WHERE id=?", id);
    this.sql.exec("DELETE FROM parts WHERE key=? OR key=?", "h:" + id, "n:" + id);
    this.dropRows(id);
    this.sql.exec("DELETE FROM node_pages WHERE page_id=?", id);
  }
  clear() {
    this.sql.exec("DELETE FROM pages");
    this.sql.exec("DELETE FROM node_pages");
    this.sql.exec("DELETE FROM node_rows");
    this.sql.exec("DELETE FROM parts WHERE key<>'pub'");
  }

  /**
   * Convert a legacy room (whole document in `room.document`) once, and the stored nodes to the
   * wanted format (rows or page texts). Returns true when something was converted. Size limits
   * are not applied: the room already held the document. The caller runs it in one transaction.
   */
  migrate(row) {
    if (!row) return false;
    if (this.layout) return this.convertNodes(this.rowsWanted);
    const document = JSON.parse(row.document);
    this.replace(document, { enforce: false });
    this.sql.exec("UPDATE room SET document='' WHERE id=1");
    return true;
  }
  /** Store every page's nodes as rows (`rows`) or as one text per page, one page at a time. */
  convertNodes(rows) {
    if (this.layout !== "pages" || this.nodeRows === rows) return false;
    for (const { id } of this.index()) {
      const { nodes } = this.readNodes(id);
      if (rows) {
        this.insertRows(id, nodes);
        this.sql.exec("DELETE FROM parts WHERE key=?", "n:" + id);
      } else {
        this.writeText("n:" + id, JSON.stringify(nodes));
        this.dropRows(id);
      }
    }
    if (rows) this.setSetting("nodes", "rows");
    else this.sql.exec("DELETE FROM meta WHERE key='nodes'");
    return true;
  }

  /** Page records in order: [{id, bytes, nodes}] (empty for documents without pages). */
  index() {
    if (this.layout !== "pages") return [];
    return this.sql.exec("SELECT id,bytes,nodes FROM pages ORDER BY position").toArray();
  }
  /**
   * The stored nodes of a page in order. With node rows, `rows` maps each node object to its
   * row ({slot, position, bytes, overflow}); otherwise `text` is the page's node JSON.
   */
  readNodes(id) {
    if (!this.nodeRows) {
      const text = this.text("n:" + id);
      return { nodes: JSON.parse(text), text };
    }
    const nodes = [],
      rows = new Map();
    for (const row of this.sql.exec(
      "SELECT slot,position,bytes,data FROM node_rows WHERE page_id=? ORDER BY position,slot",
      id,
    )) {
      const overflow = row.data === null;
      const node = JSON.parse(overflow ? this.text("r:" + row.slot) : row.data);
      nodes.push(node);
      rows.set(node, { slot: row.slot, position: row.position, bytes: row.bytes, overflow });
    }
    return { nodes, rows };
  }
  /** The JSON text of a page's nodes, as one page text would hold it. */
  nodesText(id) {
    if (!this.nodeRows) return this.text("n:" + id);
    const texts = [];
    for (const row of this.sql.exec(
      "SELECT slot,data FROM node_rows WHERE page_id=? ORDER BY position,slot",
      id,
    ))
      texts.push(row.data ?? this.text("r:" + row.slot));
    return "[" + texts.join(",") + "]";
  }
  /** The page `id` with its nodes, or null. */
  page(id) {
    if (this.layout !== "pages") return null;
    if (!this.sql.exec("SELECT 1 AS found FROM pages WHERE id=?", id).toArray().length) return null;
    const page = JSON.parse(this.text("h:" + id));
    page.nodes = this.readNodes(id).nodes;
    return page;
  }
  /** Page id holding a node (node ids are unique per document), or null. */
  nodePage(id) {
    return (
      this.sql.exec("SELECT page_id FROM node_pages WHERE node_id=?", id).toArray()[0]?.page_id ??
      null
    );
  }
  metadata() {
    if (this.layout === "pages") return JSON.parse(this.text("m"));
    if (this.layout === "json") return JSON.parse(this.text("w"));
    return null;
  }
  title() {
    try {
      const doc = this.metadata();
      return typeof doc?.name === "string" ? doc.name.slice(0, 120) : "Shared design";
    } catch {
      return "Shared design";
    }
  }

  /**
   * The document with the pages in `ids` (all with null) holding their nodes and the others as
   * stubs (their properties, `nodes: []`). Returns {doc, stubs: Set of stub ids, texts, meta}:
   * `texts` holds what `commit` needs to skip unchanged records (the stored rows or texts).
   */
  load(ids = null) {
    if (this.layout === "json") {
      const text = this.text("w");
      return { doc: JSON.parse(text), stubs: new Set(), texts: new Map(), meta: text };
    }
    const meta = this.text("m");
    const doc = JSON.parse(meta);
    const stubs = new Set(),
      texts = new Map();
    doc.pages = this.index().map(({ id }) => {
      const head = this.text("h:" + id);
      const page = JSON.parse(head);
      if (ids && !ids.has(id)) {
        page.nodes = [];
        stubs.add(id);
        return page;
      }
      const stored = this.readNodes(id);
      page.nodes = stored.nodes;
      texts.set(id, {
        head,
        nodes: stored.text,
        rows: stored.rows,
        ids: page.nodes.map((node) => node.id),
      });
      return page;
    });
    return { doc, stubs, texts, meta };
  }
  /** The whole document. */
  read() {
    return this.load(null).doc;
  }

  /** Store `document` in place of everything (create, migration, conversion of the layout). */
  replace(document, { enforce = true } = {}) {
    if (!paged(document)) return this.writeJson(document, enforce);
    this.commit({ doc: { pages: [] }, stubs: new Set(), texts: new Map(), meta: null }, document, {
      replace: true,
      enforce,
    });
  }

  writeJson(document, enforce = true) {
    if (document === null || typeof document !== "object")
      fail(400, "Document must be a JSON object or array");
    const text = JSON.stringify(document);
    if (enforce && byteSize(text) > META_BYTES)
      tooLarge(`Documents without pages are limited to ${MB(META_BYTES)}`);
    this.clear();
    this.writeText("w", text);
    this.setSetting("layout", "json");
    this.sql.exec("DELETE FROM meta WHERE key='nodes'");
  }

  /**
   * The node rows to write for a loaded page: nodes the change left alone (the same objects as
   * loaded) keep their rows; others are serialized once, and a row whose JSON is unchanged is
   * kept too. Returns {entries: [{node, row, text, bytes, position}], dropped: rows, bytes}.
   */
  planRows(page, previous) {
    const loaded = previous?.rows || new Map();
    const byId = new Map();
    for (const [node, row] of loaded) {
      if (!byId.has(node.id)) byId.set(node.id, []);
      byId.get(node.id).push({ node, row });
    }
    const claimed = new Set();
    let sum = 0;
    const entries = page.nodes.map((node) => {
      let row = loaded.get(node);
      let text = null;
      if (!row || claimed.has(row.slot)) {
        row = null;
        text = JSON.stringify(node);
        const match = byId.get(node.id)?.find((item) => !claimed.has(item.row.slot));
        if (match) {
          row = match.row;
          if (text === JSON.stringify(match.node)) text = null;
        }
      }
      if (row) claimed.add(row.slot);
      const bytes = text === null ? row.bytes : byteSize(text);
      sum += bytes;
      return { node, row, text, bytes };
    });
    const order = positions(entries.map((entry) => entry.row)) || entries.map((_, i) => i * GAP);
    entries.forEach((entry, index) => {
      entry.position = order[index];
    });
    const dropped = [...loaded.values()].filter((row) => !claimed.has(row.slot));
    return { entries, dropped, bytes: listBytes(entries.length, sum) };
  }
  writeRow(slot, pageId, entry) {
    const overflow = entry.text.length > PART_CHARS;
    if (overflow) this.writeText("r:" + slot, entry.text);
    else if (entry.row?.overflow) this.sql.exec("DELETE FROM parts WHERE key=?", "r:" + slot);
    this.sql.exec(
      "INSERT INTO node_rows (slot,page_id,position,node_id,bytes,data) VALUES (?,?,?,?,?,?) ON CONFLICT(slot) DO UPDATE SET page_id=excluded.page_id, position=excluded.position, node_id=excluded.node_id, bytes=excluded.bytes, data=excluded.data",
      slot,
      pageId,
      entry.position,
      entry.node.id,
      entry.bytes,
      overflow ? null : entry.text,
    );
  }
  /** Store a page's nodes as new rows (conversion; the page has no rows yet). */
  insertRows(id, nodes) {
    let slot = this.nextSlot();
    nodes.forEach((node, index) => {
      const text = JSON.stringify(node);
      this.writeRow(slot++, id, { node, text, bytes: byteSize(text), position: index * GAP });
    });
  }
  nextSlot() {
    return (this.sql.exec("SELECT max(slot) AS slot FROM node_rows").toArray()[0]?.slot ?? 0) + 1;
  }

  /**
   * Store `after`, a change of the loaded `state` (load()). Only the metadata, the loaded or
   * new pages that changed and, with node rows, the nodes that changed are written; stub pages
   * keep their stored records. Removed pages are deleted and positions follow `after.pages`.
   * Throws 413 before writing anything when a page, the metadata or the whole document exceeds
   * its limit.
   */
  commit(state, after, { replace = false, enforce = true } = {}) {
    if (!paged(after)) return this.writeJson(after, enforce);
    if (!replace && this.layout !== "pages") return this.replace(after, { enforce });
    const rows = replace ? this.rowsWanted : this.nodeRows;
    const meta = metaText(after);
    const metaBytes = byteSize(meta) - 4;
    if (enforce && metaBytes > META_BYTES)
      tooLarge(`The document's settings and variables exceed ${MB(META_BYTES)}`);
    const stored = new Map(
      replace
        ? []
        : this.sql
            .exec("SELECT id,position,bytes,nodes FROM pages")
            .toArray()
            .map((row) => [row.id, row]),
    );
    const writes = [];
    let total = metaBytes;
    let nodeCount = 0;
    for (const page of after.pages) {
      if (stored.has(page.id) && state.stubs.has(page.id)) {
        total += stored.get(page.id).bytes;
        nodeCount += stored.get(page.id).nodes;
        continue;
      }
      nodeCount += page.nodes.length;
      if (enforce && page.nodes.length > NODE_LIMITS.perPage)
        tooLarge(nodeLimitMessage(page.nodes.length, NODE_LIMITS.perPage, page.name ?? page.id));
      const previous = stored.has(page.id) ? state.texts.get(page.id) : null;
      const head = headText(page);
      const plan = rows ? this.planRows(page, previous) : null;
      const nodes = rows ? null : JSON.stringify(page.nodes);
      const bytes = byteSize(head) - 4 + (rows ? plan.bytes : byteSize(nodes));
      // Logical page budget is independent of the bounded physical rows.
      if (enforce && bytes > PAGE_BYTES)
        tooLarge(`${pageLabel(page)} exceeds the ${MB(PAGE_BYTES)} page limit`);
      total += bytes;
      const unchanged = rows
        ? !plan.dropped.length &&
          plan.entries.every(
            (entry) => entry.text === null && entry.position === entry.row.position,
          )
        : previous?.nodes === nodes;
      if (previous && previous.head === head && unchanged) continue;
      writes.push({ page, head, nodes, plan, bytes, previous });
    }
    if (enforce && nodeCount > NODE_LIMITS.perDocument)
      tooLarge(nodeLimitMessage(nodeCount, NODE_LIMITS.perDocument));
    if (enforce && total > DOCUMENT_BYTES)
      tooLarge(`The document exceeds the ${MB(DOCUMENT_BYTES)} room limit`);

    if (replace) this.clear();
    const kept = new Set(after.pages.map((page) => page.id));
    for (const id of stored.keys()) if (!kept.has(id)) this.dropPage(id);
    if (meta !== state.meta) this.writeText("m", meta);
    // Node index: removals of every written page first, so a node moved between pages keeps its row.
    const added = [];
    for (const { page, previous } of writes) {
      const now = new Set(page.nodes.map((node) => node.id));
      const before = new Set(previous?.ids || []);
      for (const id of before)
        if (!now.has(id))
          this.sql.exec("DELETE FROM node_pages WHERE node_id=? AND page_id=?", id, page.id);
      for (const id of now) if (!before.has(id)) added.push([id, page.id]);
    }
    for (const [id, page] of added)
      this.sql.exec("INSERT OR REPLACE INTO node_pages (node_id,page_id) VALUES (?,?)", id, page);
    let slot = null;
    for (const { page, head, nodes, plan, bytes, previous } of writes) {
      if (previous?.head !== head) this.writeText("h:" + page.id, head);
      if (rows) {
        for (const row of plan.dropped) {
          if (row.overflow) this.sql.exec("DELETE FROM parts WHERE key=?", "r:" + row.slot);
          this.sql.exec("DELETE FROM node_rows WHERE slot=?", row.slot);
        }
        for (const entry of plan.entries) {
          if (entry.text !== null) {
            let target = entry.row?.slot;
            if (target === undefined) {
              slot ??= this.nextSlot();
              target = slot++;
            }
            this.writeRow(target, page.id, entry);
          } else if (entry.position !== entry.row.position)
            this.sql.exec(
              "UPDATE node_rows SET position=? WHERE slot=?",
              entry.position,
              entry.row.slot,
            );
        }
      } else if (previous?.nodes !== nodes) this.writeText("n:" + page.id, nodes);
      this.sql.exec(
        "INSERT INTO pages (id,position,bytes,nodes) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET bytes=excluded.bytes, nodes=excluded.nodes",
        page.id,
        stored.get(page.id)?.position ?? -1,
        bytes,
        page.nodes.length,
      );
    }
    after.pages.forEach((page, position) => {
      if (stored.get(page.id)?.position !== position)
        this.sql.exec("UPDATE pages SET position=? WHERE id=?", position, page.id);
    });
    if (this.layout !== "pages") this.setSetting("layout", "pages");
    if (replace && rows) this.setSetting("nodes", "rows");
    else if (replace) this.sql.exec("DELETE FROM meta WHERE key='nodes'");
  }

  // ---- public snapshot (frozen copy of the whole document) --------------------------------
  publish() {
    this.writeText("pub", JSON.stringify(this.read()));
  }
  unpublish() {
    this.sql.exec("DELETE FROM parts WHERE key='pub'");
  }
  /** The published document: the legacy `room.public_document` copy, or the stored parts. */
  published(row) {
    if (row.public_document) return JSON.parse(row.public_document);
    const text = this.text("pub");
    return text ? JSON.parse(text) : null;
  }
}
