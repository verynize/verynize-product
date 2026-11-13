// Document storage limits and inline-binary rules shared by the renderer (window.storageLimits),
// the islands (web/src/islands/storage/limits.ts) and the server (cloud/inline-binaries.js imports
// this file for its side effect; Node reads globalThis.VerynizeStorageLimits). Loaded as a
// classic script, like web/cloud-ops.js, after web/room-limits.js: the page and document limits
// are the room's (globalThis.VerynizeRoomLimits, enforced by cloud/room-store.js); this file only
// adds the asset and inline-binary rules.
//
// Binary data (images, fonts, video) never lives inside a shared document: data: URLs larger
// than INLINE_LIMIT_BYTES are stored as room assets (cloud/assets.js, R2) and the document keeps
// only the asset URL. The byte sizes measured here therefore count a data: URL that will become
// an asset as the length of its URL, so a local file reports the size it will have once shared.
(function (scope) {
  "use strict";
  const Room = scope.VerynizeRoomLimits;
  if (!Room) throw new Error("web/room-limits.js must load before web/storage-limits.js");
  const KiB = 1024;
  const MiB = 1024 * KiB;
  const limits = {
    /** Serialized JSON of one page (VerynizeRoomLimits.PAGE_BYTES). */
    PAGE_LIMIT_BYTES: Room.PAGE_BYTES,
    /** Serialized JSON of the whole document, every page included (VerynizeRoomLimits.DOCUMENT_BYTES). */
    DOCUMENT_LIMIT_BYTES: Room.DOCUMENT_BYTES,
    /** One room asset (cloud/assets.js MAX_ASSET). */
    ASSET_LIMIT_BYTES: 20 * MiB,
    /** data: URLs longer than this become room assets; smaller ones stay inline. */
    INLINE_LIMIT_BYTES: 8 * KiB,
    /** SVG stays inline up to this size (icons and recolourable SVGs need their source). */
    SVG_INLINE_LIMIT_BYTES: 256 * KiB,
    /** Share of a limit at which the editor warns. */
    WARN_RATIO: 0.8,
  };
  // An asset URL is about this long (origin, room and asset ids, read signature).
  const ASSET_URL_BYTES = 180;
  // MIME types a room asset can hold (cloud/assets.js ASSET_TYPES).
  const ASSET_TYPES = [
    "image/png",
    "image/jpeg",
    "image/webp",
    "image/gif",
    "image/avif",
    "image/svg+xml",
    "font/woff2",
    "font/woff",
    "font/ttf",
    "font/otf",
    "video/mp4",
    "video/webm",
  ];
  const ALIASES = {
    "image/jpg": "image/jpeg",
    "application/font-woff": "font/woff",
    "application/font-woff2": "font/woff2",
    "application/x-font-ttf": "font/ttf",
    "application/x-font-otf": "font/otf",
    "font/sfnt": "font/ttf",
  };
  const DATA_URL = /^data:([a-z0-9.+-]+\/[a-z0-9.+-]+)((?:;[a-z0-9.+=-]+)*?)(;base64)?,/i;
  // Binary families: a large data: URL of another type (text/plain…) is ordinary text.
  const BINARY_FAMILY =
    /^(image|font|video|audio)\/|^application\/(octet-stream|pdf|font-|x-font-)/;

  /** {mime, base64, offset} of a data: URL, or null. `mime` is normalised (image/jpg → image/jpeg). */
  function parseDataUrl(value) {
    if (typeof value !== "string" || value.charCodeAt(0) !== 100 || !value.startsWith("data:"))
      return null;
    const match = DATA_URL.exec(value.slice(0, 300));
    if (!match) return null;
    const raw = match[1].toLowerCase();
    return { mime: ALIASES[raw] || raw, base64: !!match[3], offset: match[0].length };
  }

  /**
   * What happens to this string in a shared document: 'inline' (stays as it is), 'asset' (a
   * large binary data: URL stored as a room asset) or 'reject' (a large binary data: URL of a type
   * rooms cannot store). Strings that are not data: URLs are 'inline'.
   */
  function classify(value) {
    if (typeof value !== "string" || value.length <= limits.INLINE_LIMIT_BYTES) return "inline";
    const data = parseDataUrl(value);
    if (!data || !BINARY_FAMILY.test(data.mime)) return "inline";
    if (data.mime === "image/svg+xml" && value.length <= limits.SVG_INLINE_LIMIT_BYTES)
      return "inline";
    if (!data.base64 && data.mime !== "image/svg+xml") return "reject";
    return ASSET_TYPES.includes(data.mime) ? "asset" : "reject";
  }
  /** Approximate decoded byte size of a data: URL. */
  function decodedSize(value) {
    const data = parseDataUrl(value);
    if (!data) return 0;
    const body = value.length - data.offset;
    return data.base64 ? Math.floor((body * 3) / 4) : body;
  }

  // Properties whose strings are user text, never binary data.
  const TEXT_KEYS = new Set(["text", "name", "description", "css"]);
  /**
   * Visit every large binary data: URL in a JSON value: `visit(value, path, kind)` where kind is
   * 'asset' or 'reject'. `path` is an array of keys from the root.
   */
  function walk(value, visit, path = []) {
    if (typeof value === "string") {
      const kind = classify(value);
      if (kind !== "inline") visit(value, path, kind);
    } else if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) walk(value[i], visit, path.concat(i));
    } else if (value && typeof value === "object") {
      for (const key of Object.keys(value))
        if (!TEXT_KEYS.has(key)) walk(value[key], visit, path.concat(key));
    }
  }
  /** Large binary data: URLs of a JSON value: [{value, path, kind, mime, bytes}]. */
  function inlineBinaries(value) {
    const found = [];
    walk(value, (text, path, kind) =>
      found.push({
        value: text,
        path,
        kind,
        mime: parseDataUrl(text).mime,
        bytes: decodedSize(text),
      }),
    );
    return found;
  }
  /** Copy of a JSON value with every large binary data: URL replaced by `replace(value, path, kind)`. */
  function mapBinaries(value, replace, path = []) {
    if (typeof value === "string") {
      const kind = classify(value);
      return kind === "inline" ? value : replace(value, path, kind);
    }
    if (Array.isArray(value))
      return value.map((item, i) => mapBinaries(item, replace, path.concat(i)));
    if (value && typeof value === "object") {
      const out = {};
      for (const key of Object.keys(value))
        out[key] = TEXT_KEYS.has(key)
          ? value[key]
          : mapBinaries(value[key], replace, path.concat(key));
      return out;
    }
    return value;
  }

  /** UTF-8 byte length of a string: the room's measure (VerynizeRoomLimits.bytes). */
  const utf8Length = (text) => Room.bytes(String(text));
  const PLACEHOLDER = "x".repeat(ASSET_URL_BYTES);
  // Large binaries that become assets count as an asset URL; the rest count as they are.
  const replacer = (key, value) =>
    typeof value === "string" && !TEXT_KEYS.has(key) && classify(value) === "asset"
      ? PLACEHOLDER
      : value;
  /** Serialized size of a JSON value once shared (asset binaries counted as their URL). */
  const sharedSize = (value) => utf8Length(JSON.stringify(value, replacer) ?? "");

  /**
   * Size report of a document: {total, pages: [{id, name, bytes}], inline: {count, bytes,
   * tooLarge: [{pageId, path, mime, bytes}], rejected: [...]}}. Never call it per pointer move:
   * it serializes the whole document (callers debounce, see web/storage-meter in the islands).
   */
  function measure(doc) {
    const pages = (Array.isArray(doc?.pages) ? doc.pages : []).map((page) => ({
      id: String(page?.id ?? ""),
      name: String(page?.name ?? "Page"),
      bytes: sharedSize(page),
    }));
    const binaries = inlineBinaries(doc);
    const pageOf = (path) =>
      path[0] === "pages" && Array.isArray(doc.pages) ? String(doc.pages[path[1]]?.id ?? "") : null;
    const described = (item) => ({
      pageId: pageOf(item.path),
      path: item.path,
      mime: item.mime,
      bytes: item.bytes,
    });
    return {
      total: sharedSize(doc),
      pages,
      inline: {
        count: binaries.filter((item) => item.kind === "asset").length,
        bytes: binaries
          .filter((item) => item.kind === "asset")
          .reduce((sum, item) => sum + item.bytes, 0),
        tooLarge: binaries
          .filter((item) => item.kind === "asset" && item.bytes > limits.ASSET_LIMIT_BYTES)
          .map(described),
        rejected: binaries.filter((item) => item.kind === "reject").map(described),
      },
    };
  }

  /** 'ok' | 'warn' | 'over' for a byte count against a limit. */
  const level = (bytes, limit) =>
    bytes > limit ? "over" : bytes >= limit * limits.WARN_RATIO ? "warn" : "ok";

  /**
   * The problems of a report: [{level: 'warn'|'over', scope: 'document'|'page'|'asset',
   * pageId?, bytes, limit, message}], worst first.
   */
  function problems(report) {
    const out = [];
    const mb = (bytes, limit) => {
      const value = bytes / MiB;
      let text = Number.isInteger(value) ? String(value) : value.toFixed(value >= 10 ? 0 : 1);
      // Just over a limit must not read as the limit itself ("2.0 MB, over the 2 MB limit").
      if (limit && bytes > limit && Number(text) <= limit / MiB) text = value.toFixed(2);
      return `${text} MB`;
    };
    const total = level(report.total, limits.DOCUMENT_LIMIT_BYTES);
    if (total !== "ok")
      out.push({
        level: total,
        scope: "document",
        bytes: report.total,
        limit: limits.DOCUMENT_LIMIT_BYTES,
        message:
          total === "over"
            ? `This file is ${mb(report.total, limits.DOCUMENT_LIMIT_BYTES)}, over the ${mb(limits.DOCUMENT_LIMIT_BYTES)} limit for shared files. Split it into several files or remove unused pages.`
            : `This file is ${mb(report.total)} of the ${mb(limits.DOCUMENT_LIMIT_BYTES)} limit for shared files.`,
      });
    for (const page of report.pages) {
      const state = level(page.bytes, limits.PAGE_LIMIT_BYTES);
      if (state === "ok") continue;
      out.push({
        level: state,
        scope: "page",
        pageId: page.id,
        bytes: page.bytes,
        limit: limits.PAGE_LIMIT_BYTES,
        message:
          state === "over"
            ? `Page “${page.name}” is ${mb(page.bytes, limits.PAGE_LIMIT_BYTES)}, over the ${mb(limits.PAGE_LIMIT_BYTES)} page limit. Move content to another file.`
            : `Page “${page.name}” is ${mb(page.bytes)} of the ${mb(limits.PAGE_LIMIT_BYTES)} page limit. Pages share the file budget.`,
      });
    }
    for (const item of report.inline.tooLarge)
      out.push({
        level: "over",
        scope: "asset",
        pageId: item.pageId,
        bytes: item.bytes,
        limit: limits.ASSET_LIMIT_BYTES,
        message: `An embedded ${item.mime.split("/")[0]} is ${mb(item.bytes, limits.ASSET_LIMIT_BYTES)}, over the ${mb(limits.ASSET_LIMIT_BYTES)} upload limit. Replace it with a smaller file.`,
      });
    for (const item of report.inline.rejected)
      out.push({
        level: "over",
        scope: "asset",
        pageId: item.pageId,
        bytes: item.bytes,
        limit: limits.INLINE_LIMIT_BYTES,
        message: `Embedded ${item.mime} data cannot be shared. Remove it or use an image, font or video file.`,
      });
    const rank = { over: 0, warn: 1 };
    return out.sort((a, b) => rank[a.level] - rank[b.level]);
  }

  const api = Object.freeze({
    ...limits,
    ASSET_TYPES: Object.freeze(ASSET_TYPES.slice()),
    parseDataUrl,
    classify,
    decodedSize,
    inlineBinaries,
    mapBinaries,
    utf8Length,
    sharedSize,
    measure,
    level,
    problems,
  });
  scope.VerynizeStorageLimits = api;
  if (typeof window === "undefined" || scope !== window) return;

  // ---- Renderer: the measured open document, refreshed after edits settle. ----
  const DEBOUNCE = 700;
  const listeners = new Set();
  let report = null,
    timer = null,
    measuredDoc = null,
    latestDoc = null;
  function run() {
    timer = null;
    const doc = latestDoc || window.design?.getDocument?.();
    latestDoc = null;
    if (!doc) return report;
    if (doc !== measuredDoc || !report) {
      measuredDoc = doc;
      report = measure(doc);
      report.problems = problems(report);
      report.measuredAt = Date.now();
      for (const fn of listeners)
        try {
          fn(report);
        } catch (error) {
          console.warn(error);
        }
    }
    return report;
  }
  // Every edit restarts the timer, so a drag (one change per pointer move) measures once, after it ends.
  function schedule(doc) {
    latestDoc = doc && typeof doc === "object" ? doc : null;
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (typeof window.requestIdleCallback === "function")
        window.requestIdleCallback(run, { timeout: 1000 });
      else run();
    }, DEBOUNCE);
  }

  /**
   * A sync, save or share stopped by a size limit: the size island shows it (event
   * `storage-limit-error`). `action` is 'sync' (default), 'save' or 'share'.
   */
  function reportError(problem, action) {
    // Errors from the desktop bridge arrive as "Error invoking remote method 'x': Error: …".
    const clean = (text) =>
      String(text).replace(/^Error invoking remote method '[^']*': (?:\w*Error: )?/, "");
    const detail = {
      ...(typeof problem === "string"
        ? { level: "over", scope: "document", message: clean(problem) }
        : { ...problem, message: clean(problem.message) }),
      action: action || problem?.action || "sync",
    };
    window.dispatchEvent(new CustomEvent("storage-limit-error", { detail }));
    return detail;
  }
  // Server answers that mean "too large" (room size limits, inline binaries, asset caps). Room
  // receipts carry a `code` (web/room-sync.js); an error with a `code` is decided by it alone, and
  // the text is matched only for errors without one (desktop bridge messages, older servers).
  const SIZE_CODES = new Set(["storage_limit", "too_large"]);
  const SIZE_ERROR =
    /exceeds|too large|larger than|over the .* limit|inline .*data|limit for shared/i;
  const isSizeError = (error) => {
    if (error?.status === 413) return true;
    if (error && typeof error === "object" && "code" in error) return SIZE_CODES.has(error.code);
    return SIZE_ERROR.test(String(error?.message || error || ""));
  };
  /**
   * Throws (and reports) the first blocking problem of `doc` before it is shared or synced.
   * Returns the report when nothing blocks.
   */
  function assertShareable(doc) {
    const result = measure(doc);
    const blocking = problems(result).find((problem) => problem.level === "over");
    if (blocking) {
      reportError(blocking, "share");
      throw Object.assign(new Error(blocking.message), {
        code: "storage_limit",
        problem: blocking,
      });
    }
    return result;
  }

  window.storageLimits = Object.freeze({
    ...api,
    /** The last report of the open document, or null before the first measurement. */
    current: () => report,
    /** Measure the open document now (e.g. when the share panel opens). */
    refresh: () => {
      clearTimeout(timer);
      measuredDoc = null;
      latestDoc = null;
      return run();
    },
    /**
     * The open document changed (the storage island forwards the islands' one design
     * subscription, web/src/lib/bridge.ts, so measuring adds no document copy per render).
     */
    noteChange: schedule,
    subscribe(fn) {
      listeners.add(fn);
      if (!report) schedule(null);
      return () => listeners.delete(fn);
    },
    reportError,
    isSizeError,
    assertShareable,
  });
})(typeof globalThis !== "undefined" ? globalThis : this);
