// Verynize document schema: ONE validator for the live canvas (web/app.js, loaded as a classic <script>
// after web/node-style.js, web/shaders.js and web/vector-geometry.js) and the headless engine
// (integrations/design-store.mjs, which imports this file through integrations/document-core.mjs). Registers
// globalThis.VerynizeDocument.
//
// validateDocument(d)              strict, never mutates, throws Error on the first problem. What a file on
//                                  disk, an agent edit or a cloud room snapshot must satisfy.
// normalizeDocument(d, defaults[, repairs])
//                                  the canvas' repairs before validation (mutates d): fills every layer with
//                                  the editor defaults, defaults the document/page names, the token map and
//                                  the active page, and coerces values the canvas already rendered as their
//                                  default (numeric or unknown font weights, unknown animated palettes). With a
//                                  `repairs` array (loading, never editing) it also repairs limits older
//                                  documents may break and records each change as {path, before, after}.
// resolveAliases(d)                copies each alias' resolved value into the aliased variable (in place).
// prepareDocument(d, defaults[, repairs])  normalize + validate + resolve aliases: what the canvas loads.
// documentProblems(d)              every validation problem as [{path, message}] (validateDocument stops at one).
//
// Rules apply to a key when it is present. The canvas fills defaults first, so for it the optional keys
// below are effectively required; headless documents may omit them. Byte-size limits are storage policy
// and stay with each store (integrations/design-store.mjs, cloud/http.js).
(function (root) {
  "use strict";
  // Provisional limits under contention; see docs/canvas-performance/node-cap-2026-11-06.md.
  const NODE_LIMITS = Object.freeze({ perPage: 10000, perDocument: 50000 });
  const nodeLimitMessage = (count, limit, pageName) =>
    pageName === undefined
      ? `Document has ${count} nodes; limit is ${limit}. Split the design into multiple documents.`
      : `Page "${pageName}" has ${count} nodes; limit is ${limit}. Split the page into multiple pages or documents.`;
  const WORLD_COORDINATE_LIMIT = 1e6;
  // Product policy, not a browser canvas-size limit.
  const WORLD_ADVISORY_LIMIT = 100000;
  /** Stored layout boxes in world space, including ancestor rotations/flips. Hidden and clipped
   * descendants count too: hiding content must not bypass the guardrail. CSS effects are not geometry.
   * Iterative traversal handles deep trees without exhausting the JS stack. */
  function pageWorldBounds(page, measuredRects) {
    const byId = new Map(page.nodes.map((n) => [n.id, n]));
    const transforms = new Map(),
      rects = new Map();
    let bounds = null;
    for (const node of page.nodes) {
      const chain = [],
        seen = new Set();
      let current = node;
      while (current && !transforms.has(current.id)) {
        if (seen.has(current.id)) throw new Error("Parent cycle");
        seen.add(current.id);
        chain.push(current);
        if (current.parentId && !byId.has(current.parentId))
          throw new Error("Parent must reference a frame on the same page");
        current = current.parentId ? byId.get(current.parentId) : null;
      }
      while (chain.length) {
        const n = chain.pop();
        const p = transforms.get(n.parentId) || [1, 0, 0, 1, 0, 0];
        const angle = ((n.rotation || 0) * Math.PI) / 180;
        const cos = Math.cos(angle),
          sin = Math.sin(angle);
        const sx = n.flipX ? -1 : 1,
          sy = n.flipY ? -1 : 1;
        const a = cos * sx,
          b = sin * sx,
          c = -sin * sy,
          d = cos * sy;
        const parent = byId.get(n.parentId);
        const borders = [0, 1, 2, 3].map((side) =>
          parent?.layout !== "free" || parent?.strokeHidden || parent?.strokeHiddenSides?.[side]
            ? 0
            : (parent?.strokeWidths?.[side] ?? parent?.strokeWidth ?? 0),
        );
        const tx = n.x + borders[3] + n.w / 2 - (a * n.w) / 2 - (c * n.h) / 2;
        const ty = n.y + borders[0] + n.h / 2 - (b * n.w) / 2 - (d * n.h) / 2;
        const t = [
          p[0] * a + p[2] * b,
          p[1] * a + p[3] * b,
          p[0] * c + p[2] * d,
          p[1] * c + p[3] * d,
          p[0] * tx + p[2] * ty + p[4],
          p[1] * tx + p[3] * ty + p[5],
        ];
        transforms.set(n.id, t);
        const points = [
          [0, 0],
          [n.w, 0],
          [0, n.h],
          [n.w, n.h],
        ].map(([x, y]) => [t[0] * x + t[2] * y + t[4], t[1] * x + t[3] * y + t[5]]);
        const measured = measuredRects?.get(n.id);
        const x = measured?.x ?? Math.min(...points.map((p) => p[0])),
          y = measured?.y ?? Math.min(...points.map((p) => p[1]));
        const right = measured ? measured.x + measured.w : Math.max(...points.map((p) => p[0])),
          bottom = measured ? measured.y + measured.h : Math.max(...points.map((p) => p[1]));
        const rect = { x, y, w: right - x, h: bottom - y };
        rects.set(n.id, rect);
        bounds = bounds
          ? {
              x: Math.min(bounds.x, x),
              y: Math.min(bounds.y, y),
              right: Math.max(bounds.right, right),
              bottom: Math.max(bounds.bottom, bottom),
            }
          : { x, y, right, bottom };
      }
    }
    const exceeds = (limit) =>
      bounds !== null &&
      [bounds.x, bounds.y, bounds.right, bounds.bottom].some(
        (v) => !Number.isFinite(v) || Math.abs(v) > limit + 1e-7,
      );
    return {
      rects,
      bounds: bounds && {
        x: bounds.x,
        y: bounds.y,
        w: bounds.right - bounds.x,
        h: bounds.bottom - bounds.y,
      },
      outOfRange: exceeds(WORLD_COORDINATE_LIMIT),
      advisory: exceeds(WORLD_ADVISORY_LIMIT),
    };
  }
  function validateWorldBounds(page, measuredRects) {
    if (pageWorldBounds(page, measuredRects).outOfRange)
      throw new Error(
        `Page "${page.name}" exceeds world bounds ±${WORLD_COORDINATE_LIMIT}. Move content closer to the origin.`,
      );
  }
  // Compare the farthest world edge, so existing overflow can shrink (including recentering).
  // Loading/validating a document is deliberately independent of this edit policy.
  function validateWorldBoundsChange(before, after) {
    const previous = new Map(before.pages.map((p) => [p.id, p]));
    const extent = (page) => {
      const b = page && pageWorldBounds(page).bounds;
      return b
        ? Math.max(WORLD_COORDINATE_LIMIT, -b.x, -b.y, b.x + b.w, b.y + b.h)
        : WORLD_COORDINATE_LIMIT;
    };
    for (const page of after.pages) {
      const old = extent(previous.get(page.id));
      const next = extent(page);
      if (!Number.isFinite(next) || next > old + 1e-7)
        throw new Error(
          `Page "${page.name}" exceeds world bounds ±${WORLD_COORDINATE_LIMIT}. Move content closer to the origin.`,
        );
    }
    return after;
  }
  const IMAGE_FILL_TYPES = Object.freeze(["frame", "rectangle"]);
  const NODE_TYPES = ["rectangle", "text", "frame", "image", "shader", "vector"];
  const LAYOUTS = ["free", "flex", "grid", "block", "inline"];
  const ANIMATED = ["", "aurora", "sunset", "ocean"];
  const VARIABLE_TYPES = ["dimension", "number", "fontFamily", "fontWeight"];
  const VARIABLE_NAME = /^[a-zA-Z0-9][a-zA-Z0-9_./ -]{0,99}$/;
  const RESERVED_NAMES = ["__proto__", "prototype", "constructor"];
  const HEX = /^#[0-9a-f]{6}([0-9a-f]{2})?$/i;
  const FONT_WEIGHT = /^(normal|bold|[1-9][0-9]{0,2}|1000)$/;
  const LOOPBACK = ["localhost", "127.0.0.1", "[::1]"];
  // Typed design variables (Wonder: Dimensions, Numbers, Font family, Font weight) live next to the color
  // `tokens` map: `variables: {name: {type, value}}`. Layers bind a property to one with
  // `bindings: {property: name}`; the property itself always holds the resolved value, so every reader that
  // ignores variables still renders correctly. Dimensions also drive size, min/max size, axis padding and each
  // corner radius (see integrations/variables.mjs); a Dimension bound to line height becomes a multiplier.
  const BINDABLE = {
    radius: ["dimension", "number"],
    gap: ["dimension", "number"],
    padding: ["dimension", "number"],
    strokeWidth: ["dimension", "number"],
    fontSize: ["dimension", "number"],
    letterSpacing: ["dimension", "number"],
    lineHeight: ["number", "dimension"],
    opacity: ["number"],
    fontFamily: ["fontFamily"],
    fontWeight: ["fontWeight"],
    w: ["dimension"],
    h: ["dimension"],
    minW: ["dimension"],
    maxW: ["dimension"],
    minH: ["dimension"],
    maxH: ["dimension"],
    paddingX: ["dimension"],
    paddingY: ["dimension"],
    radiusTopLeft: ["dimension"],
    radiusTopRight: ["dimension"],
    radiusBottomRight: ["dimension"],
    radiusBottomLeft: ["dimension"],
  };
  const NUMERIC_KEYS = [
    "fontSize",
    "radius",
    "gap",
    "padding",
    "columns",
    "zIndex",
    "rotation",
    "opacity",
    "strokeWidth",
    "letterSpacing",
  ];
  const STRING_KEYS = [
    "color",
    "fontFamily",
    "textAlign",
    "direction",
    "layout",
    "token",
    "gradient",
    "mask",
    "animated",
    "strokeColor",
    "shadow",
    "alignItems",
    "justifyContent",
    "variantClasses",
  ];
  const BOOLEAN_KEYS = [
    "locked",
    "hidden",
    "flipX",
    "flipY",
    "ellipse",
    "labelHidden",
    "clipContent",
  ];
  const TYPE_NAMES = {
    rectangle: "Rectangle",
    text: "Text",
    frame: "Frame",
    image: "Image",
    shader: "Shader",
    vector: "Vector",
  };

  const own = (object, key) => !!object && typeof object === "object" && Object.hasOwn(object, key);
  const plainObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);
  const validName = (name) =>
    typeof name === "string" && VARIABLE_NAME.test(name) && !RESERVED_NAMES.includes(name);
  function requireString(value, label, max = 200) {
    if (typeof value !== "string" || !value.trim() || value.length > max)
      throw new Error(`${label} must be a nonempty string of at most ${max} characters`);
  }
  // node-style.js and shaders.js are loaded first (a <script> tag before app.js; imports in document-core.mjs).
  const nodeStyle = () => root.BetterNodeStyle;
  const shaders = () => root.BetterShaders;
  // web/vector-geometry.js (integrations/vector-geometry.mjs) parses path data; loaded before this file.
  const vectors = () => root.VerynizeVector;

  /** Room asset URLs (cloud/assets.js): https (http only on loopback), no credentials, exactly
   * /api/rooms/<uuid>/assets/<uuid> with an optional ?sig=<64 hex>. */
  const isAssetRef = (value) => typeof value === "string" && /^asset:[a-f0-9]{64}$/.test(value);
  function isRoomAssetUrl(value) {
    if (typeof value !== "string" || value.length > 512) return false;
    let url;
    try {
      url = new URL(value);
    } catch {
      return false;
    }
    const loopback = LOOPBACK.includes(url.hostname);
    return (
      url.href === value &&
      (url.protocol === "https:" || (url.protocol === "http:" && loopback)) &&
      !url.username &&
      !url.password &&
      !url.hash &&
      /^\/api\/rooms\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/assets\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
        url.pathname,
      ) &&
      /^(\?sig=[0-9a-f]{64})?$/.test(url.search)
    );
  }
  function checkVariableValue(type, value) {
    if (type === "dimension" || type === "number")
      return Number.isFinite(value) && Math.abs(value) <= 1e6;
    if (type === "fontFamily")
      return (
        typeof value === "string" &&
        !!value.trim() &&
        value.length <= 200 &&
        !/[;{}<>\\]/.test(value) &&
        !/url\s*\(/i.test(value)
      );
    if (type === "fontWeight") return FONT_WEIGHT.test(String(value));
    return false;
  }
  /** 'color' for a colour variable, the variable type for a typed one, null when the name is unknown. */
  function variableKind(document, name) {
    if (own(document.tokens, name)) return "color";
    if (own(document.variables, name)) return document.variables[name]?.type ?? null;
    return null;
  }

  function validateVariables(document) {
    if (document.variables === undefined) return;
    const vars = document.variables;
    if (!plainObject(vars)) throw new Error("variables must be an object");
    const entries = Object.entries(vars);
    if (entries.length > 500) throw new Error("At most 500 variables");
    for (const [name, variable] of entries) {
      if (!VARIABLE_NAME.test(name) || RESERVED_NAMES.includes(name))
        throw new Error(`Invalid variable name ${JSON.stringify(name)}`);
      if (Object.hasOwn(document.tokens, name))
        throw new Error(`Variable ${name} collides with a color token`);
      if (
        !variable ||
        typeof variable !== "object" ||
        !VARIABLE_TYPES.includes(variable.type) ||
        !checkVariableValue(variable.type, variable.value)
      )
        throw new Error(`Invalid variable ${name}`);
    }
  }
  /** Variable aliases {name: target}: malformed names, type mismatches and cycles throw. Aliases to deleted
   * variables are tolerated (integrations/variables.mjs). */
  function validateAliases(document) {
    if (document.aliases === undefined) return;
    const aliases = document.aliases;
    if (!plainObject(aliases)) throw new Error("aliases must be an object");
    const entries = Object.entries(aliases);
    if (entries.length > 500) throw new Error("At most 500 variable aliases");
    for (const [name, target] of entries) {
      if (!validName(name) || !validName(target) || name === target)
        throw new Error(`Invalid variable alias ${JSON.stringify(name)}`);
      const a = variableKind(document, name),
        b = variableKind(document, target);
      if (a && b && a !== b)
        throw new Error(`Variable ${name} can only reference a variable of the same type`);
      const seen = new Set([name]);
      for (let current = target; own(aliases, current); current = aliases[current]) {
        if (seen.has(current)) throw new Error(`Variable alias ${name} forms a cycle`);
        seen.add(current);
      }
    }
  }
  /** The aliased entries hold the resolved literal value, so readers that ignore aliases render correctly. */
  function resolveAliases(document) {
    const aliases = document.aliases;
    if (!plainObject(aliases)) return document;
    for (const name of Object.keys(aliases)) {
      const kind = variableKind(document, name);
      if (!kind) continue;
      let resolved = name;
      const seen = new Set([name]);
      while (
        own(aliases, resolved) &&
        !seen.has(aliases[resolved]) &&
        variableKind(document, aliases[resolved]) === kind
      ) {
        resolved = aliases[resolved];
        seen.add(resolved);
      }
      if (resolved === name) continue;
      if (kind === "color") document.tokens[name] = document.tokens[resolved];
      else
        document.variables[name] = {
          ...document.variables[name],
          value: document.variables[resolved].value,
        };
    }
    return document;
  }
  function validateIcons(document) {
    if (document.icons === undefined) return;
    if (!Array.isArray(document.icons) || document.icons.length > 500)
      throw new Error("icons must be an array of at most 500 icons");
    const ids = new Set();
    for (const icon of document.icons) {
      if (!icon || typeof icon.id !== "string" || !icon.id || ids.has(icon.id))
        throw new Error("Icons need unique ids");
      ids.add(icon.id);
      if (typeof icon.name !== "string" || !icon.name.trim() || icon.name.length > 100)
        throw new Error("Invalid icon name");
      if (
        typeof icon.src !== "string" ||
        icon.src.length > 200000 ||
        !icon.src.startsWith("data:image/svg+xml;base64,")
      )
        throw new Error("Icon source must be an embedded SVG");
    }
  }
  // Embedded @font-face fonts from web page capture (desktop/capture-core.cjs).
  function validateFontFaces(document) {
    if (document.fontFaces === undefined) return;
    if (!Array.isArray(document.fontFaces) || document.fontFaces.length > 40)
      throw new Error("fontFaces must be an array of at most 40 fonts");
    for (const f of document.fontFaces) {
      if (
        !f ||
        typeof f.family !== "string" ||
        !/^[^;{}<>\\"]{1,100}$/.test(f.family) ||
        !/^(normal|bold|[1-9]00( [1-9]00)?)$/.test(String(f.weight)) ||
        !["normal", "italic", "oblique"].includes(f.style)
      )
        throw new Error("Invalid embedded font descriptor");
      if (
        typeof f.src !== "string" ||
        f.src.length > 3e6 ||
        !(
          /^data:font\/(woff2|woff|ttf|otf);base64,[A-Za-z0-9+/=]+$/.test(f.src) ||
          /^asset:[a-f0-9]{64}$/.test(f.src) || isRoomAssetUrl(f.src)
        )
      )
        throw new Error("Embedded font source must be a base64 font data URL or a room asset URL");
      if (
        f.unicodeRange !== undefined &&
        (typeof f.unicodeRange !== "string" || !/^[\w+?, -]{1,2000}$/.test(f.unicodeRange))
      )
        throw new Error("Invalid embedded font unicode-range");
    }
  }
  function validateBindings(bindings) {
    if (bindings === undefined) return;
    if (!plainObject(bindings)) throw new Error("Invalid node bindings");
    for (const [key, name] of Object.entries(bindings))
      if (!Object.hasOwn(BINDABLE, key) || typeof name !== "string" || !VARIABLE_NAME.test(name))
        throw new Error(`Invalid binding ${key}`);
  }
  // Running-app preview frame (desktop/preview.cjs): a top-level frame pointing at a loopback dev server.
  function validatePreview(node) {
    const v = node.preview;
    if (
      node.type !== "frame" ||
      node.parentId ||
      !plainObject(v) ||
      typeof v.root !== "string" ||
      v.root.length > 4096 ||
      ["name", "chatId", "url", "template", "repo"].some(
        (k) => v[k] !== undefined && (typeof v[k] !== "string" || v[k].length > 4096),
      )
    )
      throw new Error("Invalid preview configuration");
    if (v.url) {
      let u;
      try {
        u = new URL(v.url);
      } catch {
        throw new Error("Invalid preview URL");
      }
      if (
        !["http:", "https:"].includes(u.protocol) ||
        !LOOPBACK.includes(u.hostname) ||
        u.username ||
        u.password
      )
        throw new Error("Invalid preview URL");
    }
  }
  // Components (web/component-core.js, spec design/component-audit/README.md): only the types are checked. A
  // dangling instanceOf/sourceId is not an error (lazy cloud pages, partial documents) and component cycles are
  // ignored by the sync, never rejected here.
  const LINK_ID = (value) => typeof value === "string" && value.length > 0 && value.length <= 200;
  function componentError(node) {
    for (const key of ["component", "slot"])
      if (node[key] !== undefined && typeof node[key] !== "boolean") return `Invalid node ${key}`;
    for (const key of ["instanceOf", "sourceId"])
      if (node[key] !== undefined && !LINK_ID(node[key])) return `Invalid node ${key}`;
    if (
      node.overrides !== undefined &&
      (!Array.isArray(node.overrides) ||
        node.overrides.length > 500 ||
        node.overrides.some((k) => typeof k !== "string" || !k || k.length > 120))
    )
      return "Invalid node overrides";
    if (node.slot !== undefined && node.type !== "frame") return "Only frames can be slots";
    if (
      node.slotName !== undefined &&
      (typeof node.slotName !== "string" || node.slotName.length > 100)
    )
      return "Invalid node slotName";
    return null;
  }
  // Vector layers (docs/vector-nodes.md): SVG path data in viewBox units, drawn stretched over the layer box. Fill is
  // the paint model of every layer (`color`/`token` or `fills`); the stroke is `strokeWidth`/`strokeColor`/
  // `strokeToken` plus the vector-only cap, join, miter limit and dash pattern (layer pixels).
  const VECTOR_ONLY = ["paths", "viewBox", "strokeCap", "strokeJoin", "strokeMiter", "strokeDash"];
  function vectorError(node) {
    if (node.type !== "vector") {
      const key = VECTOR_ONLY.find((k) => node[k] !== undefined);
      return key ? `${key} belongs to vector layers` : "";
    }
    const geometry = vectors();
    const limits = geometry?.LIMITS || { paths: 500, pathChars: 200000, totalChars: 500000 };
    const paths = node.paths;
    if (!Array.isArray(paths) || !paths.length || paths.length > limits.paths)
      return `A vector layer needs 1–${limits.paths} paths`;
    let chars = 0;
    for (const p of paths) {
      if (!plainObject(p) || Object.keys(p).some((k) => k !== "d" && k !== "fillRule"))
        return "Vector paths are {d, fillRule?}";
      if (p.fillRule !== undefined && p.fillRule !== "nonzero" && p.fillRule !== "evenodd")
        return "Vector fillRule must be nonzero or evenodd";
      // Without the geometry module (a loader that only needs the limits) the characters are checked.
      const error = geometry
        ? geometry.pathError(p.d)
        : typeof p.d === "string" &&
            p.d.length <= limits.pathChars &&
            /^\s*[Mm][\d\s,.eE+\-MmLlHhVvCcSsQqTtAaZz]*$/.test(p.d)
          ? ""
          : "Invalid path data";
      if (error) return `Invalid vector path: ${error}`;
      chars += p.d.length;
    }
    if (chars > limits.totalChars)
      return `A vector layer holds at most ${limits.totalChars} characters of path data`;
    const vb = node.viewBox;
    if (
      !Array.isArray(vb) ||
      vb.length !== 4 ||
      !vb.every((v) => Number.isFinite(v) && Math.abs(v) <= 1e7) ||
      !(vb[2] > 0) ||
      !(vb[3] > 0)
    )
      return "A vector viewBox is [x, y, width, height] with a positive size";
    if (node.strokeCap !== undefined && !["butt", "round", "square"].includes(node.strokeCap))
      return "Invalid stroke cap";
    if (node.strokeJoin !== undefined && !["miter", "round", "bevel"].includes(node.strokeJoin))
      return "Invalid stroke join";
    if (
      node.strokeMiter !== undefined &&
      (!Number.isFinite(node.strokeMiter) || node.strokeMiter < 1 || node.strokeMiter > 100)
    )
      return "Invalid stroke miter limit";
    if (
      node.strokeDash !== undefined &&
      (!Array.isArray(node.strokeDash) ||
        node.strokeDash.length > 16 ||
        node.strokeDash.some((v) => !Number.isFinite(v) || v < 0 || v > 10000))
    )
      return "strokeDash is at most 16 lengths of 0–10000";
    return "";
  }
  function validateNode(node) {
    const S = nodeStyle(),
      shader = shaders();
    if (!NODE_TYPES.includes(node.type)) throw new Error("Unsupported node type");
    requireString(node.name, "Node name");
    {
      const ce = componentError(node);
      if (ce) throw new Error(ce);
    }
    for (const key of ["x", "y", "w", "h"])
      if (
        !Number.isFinite(node[key]) ||
        Math.abs(node[key]) > 1e6 ||
        (["w", "h"].includes(key) && node[key] < 1)
      )
        throw new Error(`Invalid node ${key}`);
    if (node.text !== undefined && (typeof node.text !== "string" || node.text.length > 1000000))
      throw new Error("Invalid node text");
    if (
      node.textRuns !== undefined &&
      (!Array.isArray(node.textRuns) ||
        node.textRuns.some(
          (r) =>
            !r ||
            !Number.isInteger(r.start) ||
            !Number.isInteger(r.end) ||
            r.start < 0 ||
            r.end <= r.start ||
            r.end > (node.text || "").length ||
            typeof r.bold !== "boolean" ||
            typeof r.italic !== "boolean" ||
            (r.color !== undefined &&
              (typeof r.color !== "string" || !/^#[0-9a-f]{6}$/i.test(r.color))) ||
            (r.fontSize !== undefined &&
              (!Number.isFinite(r.fontSize) || r.fontSize < 8 || r.fontSize > 200)),
        ))
    )
      throw new Error("Invalid text ranges");
    if (
      node.src &&
      !/^data:image\/(png|jpeg|webp|gif|svg\+xml);/i.test(node.src) &&
      !/^asset:[a-f0-9]{64}$/.test(node.src) &&
      !isRoomAssetUrl(node.src)
    )
      throw new Error("Image source must be an embedded image or a room asset URL");
    for (const key of NUMERIC_KEYS)
      if (node[key] !== undefined && !Number.isFinite(node[key]))
        throw new Error(`Invalid node ${key}`);
    for (const key of STRING_KEYS)
      if (node[key] !== undefined && (typeof node[key] !== "string" || node[key].length > 4000))
        throw new Error(`Invalid node ${key}`);
    for (const key of BOOLEAN_KEYS)
      if (node[key] !== undefined && typeof node[key] !== "boolean")
        throw new Error(`Invalid node ${key}`);
    {
      const te = S.typographyError(node);
      if (te) throw new Error(te);
    } // line height (number | 'auto') + type settings
    if (node.preview !== undefined) validatePreview(node);
    if (node.opacity !== undefined && (node.opacity < 0 || node.opacity > 100))
      throw new Error("Invalid opacity");
    if (node.strokeWidth !== undefined && node.strokeWidth < 0)
      throw new Error("Invalid node strokeWidth");
    if (node.shadow !== undefined && /url\s*\(/i.test(node.shadow))
      throw new Error("Invalid node shadow");
    // Shader settings: checked on shader layers, shader fills and wherever the keys are present.
    const preset =
      node.shaderPreset ??
      (node.type === "shader" || node.shaderFill === true ? "aurora" : undefined);
    if (preset !== undefined && !shader.presetIds.includes(preset))
      throw new Error("Invalid shader preset");
    for (const [key, max] of [
      ["shaderSpeed", 5],
      ["shaderIntensity", 2],
    ])
      if (
        node[key] !== undefined &&
        (!Number.isFinite(node[key]) || node[key] < 0 || node[key] > max)
      )
        throw new Error("Invalid shader uniform " + key);
    if (node.animated !== undefined && !ANIMATED.includes(node.animated))
      throw new Error("Invalid animated palette");
    if (node.layout !== undefined && !LAYOUTS.includes(node.layout))
      throw new Error("Invalid node layout");
    if (node.fontWeight !== undefined && !FONT_WEIGHT.test(String(node.fontWeight)))
      throw new Error("Invalid node fontWeight");
    for (const key of ["wMode", "hMode"])
      if (node[key] !== undefined && !S.SIZING_MODES.includes(node[key]))
        throw new Error("Invalid sizing mode");
    if (
      node.svgColor !== undefined &&
      (node.type !== "image" ||
        typeof node.src !== "string" ||
        !node.src.startsWith("data:image/svg+xml;base64,") ||
        typeof node.svgColor !== "string" ||
        !HEX.test(node.svgColor))
    )
      throw new Error("Invalid SVG color");
    if (
      node.svgColorToken !== undefined &&
      (typeof node.svgColorToken !== "string" ||
        !VARIABLE_NAME.test(node.svgColorToken) ||
        node.svgColor === undefined)
    )
      throw new Error("Invalid SVG color variable");
    validateBindings(node.bindings);
    {
      const sz = S.sizingError(node);
      if (sz) throw new Error(sz);
    } // wMode/hMode + wCalc/hCalc, grid tracks, autoPosition
    {
      const fx = S.validateEffects(node);
      if (fx) throw new Error(fx);
    } // structured effects
    {
      const se = shader.validate(node);
      if (se) throw new Error(se);
    } // shader preset/colours/sliders
    {
      const pe = S.paintError(node);
      if (pe) throw new Error(pe);
    } // paint stack + SVG paints
    {
      const ve = vectorError(node);
      if (ve) throw new Error(ve);
    } // vector paths, viewBox and stroke details
  }
  function validateViews(document) {
    if (document.views === undefined) return;
    if (!Array.isArray(document.views) || document.views.length > 100)
      throw new Error("Invalid saved views");
    const ids = new Set();
    for (const view of document.views) {
      if (!view || typeof view !== "object") throw new Error("Invalid saved view");
      requireString(view.id, "View id");
      requireString(view.name, "View name", 100);
      if (
        ids.has(view.id) ||
        !document.pages.some((p) => p.id === view.page) ||
        !Number.isFinite(view.zoom) ||
        view.zoom < 0.02 ||
        view.zoom > 32 ||
        !["scrollLeft", "scrollTop"].every(
          (k) => Number.isFinite(view[k]) && view[k] >= 0 && view[k] <= 1e7,
        ) ||
        !["x", "y"].every(
          (k) => view[k] === undefined || (Number.isFinite(view[k]) && Math.abs(view[k]) <= 1e7),
        )
      )
        throw new Error("Invalid saved view");
      ids.add(view.id);
    }
  }

  function validateDocument(document) {
    if (
      !document ||
      document.version !== 2 ||
      !Array.isArray(document.pages) ||
      !document.pages.length ||
      document.pages.length > 100
    )
      throw new Error("Expected version 2 document with 1–100 pages");
    requireString(document.name, "Document name");
    if (!plainObject(document.tokens)) throw new Error("tokens must be an object");
    for (const [key, value] of Object.entries(document.tokens)) {
      requireString(key, "Token name");
      requireString(value, "Token value", 1000);
      if (!HEX.test(value)) throw new Error("Token values must be six- or eight-digit hex colors");
      if (RESERVED_NAMES.includes(key)) throw new Error("Reserved token name");
    }
    validateVariables(document);
    validateAliases(document);
    validateIcons(document);
    validateFontFaces(document);
    const ids = new Set();
    const total = document.pages.reduce(
      (sum, page) => sum + (Array.isArray(page?.nodes) ? page.nodes.length : 0),
      0,
    );
    if (total > NODE_LIMITS.perDocument)
      throw new Error(nodeLimitMessage(total, NODE_LIMITS.perDocument));
    for (const page of document.pages) {
      if (!page || typeof page !== "object") throw new Error("Invalid page");
      requireString(page.id, "Page id");
      requireString(page.name, "Page name");
      if (
        page.background !== undefined &&
        (typeof page.background !== "string" || !HEX.test(page.background))
      )
        throw new Error("Page background must be a six- or eight-digit hex colour");
      // The Page row's eye (Wonder C8): hides the page background in the editor without forgetting the colour.
      if (page.backgroundHidden !== undefined && page.backgroundHidden !== true)
        throw new Error("Page backgroundHidden must be true when set");
      if (ids.has(page.id)) throw new Error("Duplicate id");
      ids.add(page.id);
      if (!Array.isArray(page.nodes)) throw new Error("Page nodes must be an array");
      if (page.nodes.length > NODE_LIMITS.perPage)
        throw new Error(
          nodeLimitMessage(page.nodes.length, NODE_LIMITS.perPage, page.name ?? page.id),
        );
      const nodes = new Map();
      for (const node of page.nodes) {
        if (!node || typeof node !== "object") throw new Error("Invalid node");
        requireString(node.id, "Node id");
        if (ids.has(node.id)) throw new Error("Duplicate id");
        ids.add(node.id);
        nodes.set(node.id, node);
        validateNode(node);
      }
      for (const node of page.nodes) {
        const chain = new Set([node.id]);
        let parent = node.parentId;
        while (parent) {
          if (chain.has(parent)) throw new Error("Parent cycle");
          chain.add(parent);
          const p = nodes.get(parent);
          if (!p || p.type !== "frame")
            throw new Error("Parent must reference a frame on the same page");
          parent = p.parentId;
        }
      }
    }
    validateViews(document);
    // "Set as file thumbnail" (Wonder P4): the layer the Files card draws. It may dangle after the layer is
    // deleted; the card then falls back to the active page.
    if (
      document.thumbnailNodeId !== undefined &&
      (typeof document.thumbnailNodeId !== "string" ||
        !document.thumbnailNodeId ||
        document.thumbnailNodeId.length > 200)
    )
      throw new Error("Invalid file thumbnail");
    if (document.activePage && !document.pages.some((p) => p.id === document.activePage))
      throw new Error("Invalid active page");
    return document;
  }

  // Load-time repairs (normalizeDocument with a `repairs` array): documents saved before the shared schema may
  // break limits the canvas did not enforce. These repairs keep everything else intact and are each recorded as
  // {path, before, after}; ids and token names are never rewritten (other files, rooms and chats refer to them).
  const MAX_NAME = 200,
    MAX_STRING = 4000;
  /** At most `max` UTF-16 units, without splitting a surrogate pair. */
  function truncate(value, max) {
    const cut = value.slice(0, max);
    return /[\uD800-\uDBFF]$/.test(cut) ? cut.slice(0, -1) : cut;
  }
  /** The value as a report shows it: long strings are shortened. */
  const shown = (value) =>
    typeof value === "string" && value.length > 120
      ? `${value.slice(0, 80)}… (${value.length} characters)`
      : value;
  function repairName(owner, path, fallback, record) {
    const before = owner.name;
    if (typeof before === "string" && before.length > MAX_NAME)
      owner.name = truncate(before, MAX_NAME);
    if (typeof owner.name !== "string" || !owner.name.trim()) owner.name = fallback;
    if (owner.name !== before) record(path + ".name", before, owner.name);
  }
  function repairNode(n, defaults, path, record, lossy) {
    if (lossy) {
      for (const key of ["x", "y", "w", "h"]) {
        const value = n[key];
        if (Number.isFinite(value) && Math.abs(value) > WORLD_COORDINATE_LIMIT) {
          n[key] = Math.sign(value) * WORLD_COORDINATE_LIMIT;
          record(`${path}.${key}`, value, n[key]);
        }
      }
      // Free-form CSS values cut mid-way would not parse, so an over-long value goes back to the editor default.
      for (const key of STRING_KEYS) {
        const value = n[key];
        if (value === undefined || key === "animated") continue;
        if (typeof value === "string" && value.length <= MAX_STRING) continue;
        if (typeof value !== "string" && !own(defaults, key)) continue;
        if (own(defaults, key)) n[key] = defaults[key];
        else delete n[key];
        record(`${path}.${key}`, value, n[key]);
      }
    }
    if (lossy || typeof n.name !== "string" || !n.name.trim())
      repairName(n, path, TYPE_NAMES[n.type] || "Layer", record);
    // The canvas renders a font weight it does not know, and an unknown animated palette, as the default (a
    // missing value is filled, not repaired).
    if (typeof n.fontWeight === "number" && FONT_WEIGHT.test(String(n.fontWeight)))
      n.fontWeight = String(n.fontWeight);
    else if (typeof n.fontWeight !== "string" || !FONT_WEIGHT.test(n.fontWeight)) {
      if (n.fontWeight !== undefined) record(path + ".fontWeight", n.fontWeight, "400");
      n.fontWeight = "400";
    }
    if (!ANIMATED.includes(n.animated)) {
      if (n.animated !== undefined) record(path + ".animated", n.animated, "");
      n.animated = "";
    }
    // Component link fields of the wrong type are dropped, so a stored document never fails on them.
    if (lossy && componentError(n))
      for (const key of ["component", "slot", "slotName", "instanceOf", "sourceId", "overrides"]) {
        if (n[key] === undefined) continue;
        const kept = { type: n.type, [key]: n[key] };
        if (!componentError(kept)) continue;
        record(`${path}.${key}`, n[key], undefined);
        delete n[key];
      }
  }

  /** Fills editor defaults and repairs what the canvas renders the same either way (blank names, unknown font
   * weights and palettes, a dangling active page). With a `repairs` array it also applies the load-time repairs
   * (coordinates clamped to ±1e6, names cut to 200 characters, over-long or mistyped style strings reset to the
   * default) and records every change in it as {path, before, after}. Mutates and returns the document. */
  function normalizeDocument(document, defaults, repairs) {
    if (!document || typeof document !== "object" || !Array.isArray(document.pages))
      return document;
    const lossy = Array.isArray(repairs),
      record = (path, before, after) => {
        if (lossy) repairs.push({ path, before: shown(before), after: shown(after) });
      };
    if (lossy || typeof document.name !== "string" || !document.name.trim())
      repairName(document, "document", "Untitled", record);
    if (!plainObject(document.tokens)) document.tokens = {};
    document.pages.forEach((page, i) => {
      if (!page || typeof page !== "object" || !Array.isArray(page.nodes)) return;
      if (lossy || typeof page.name !== "string" || !page.name.trim())
        repairName(page, `pages[${i}]`, "Page", record);
      page.nodes.forEach((n, j) => {
        if (!n || typeof n !== "object") return;
        Object.assign(n, { ...defaults, ...n });
        repairNode(n, defaults || {}, `pages[${i}].nodes[${j}]`, record, lossy);
      });
    });
    if (!document.pages.some((p) => p && p.id === document.activePage) && document.pages[0]) {
      if (document.activePage !== undefined)
        record("activePage", document.activePage, document.pages[0].id);
      document.activePage = document.pages[0].id;
    }
    return document;
  }

  /** normalize (+ load-time repairs when `repairs` is given) → validate → resolve aliases: what the canvas loads. */
  const prepareDocument = (document, defaults, repairs) =>
    resolveAliases(validateDocument(normalizeDocument(document, defaults, repairs)));

  /** Every problem validateDocument would report, not only the first: [{path, message}], at most `limit`. Document
   * and page rules are checked once, each layer on its own, so the count is what a user would have to fix. */
  function documentProblems(document, limit = 1000) {
    const problems = [],
      add = (path, error) => {
        if (problems.length < limit)
          problems.push({ path, message: String(error?.message || error) });
      };
    const pages = document && Array.isArray(document.pages) ? document.pages : null;
    try {
      validateDocument(
        pages
          ? {
              ...document,
              pages: pages.map((p) => (p && typeof p === "object" ? { ...p, nodes: [] } : p)),
            }
          : document,
      );
    } catch (error) {
      add("document", error);
    }
    if (!pages) return problems;
    const ids = new Set(pages.map((p) => p?.id));
    let total = 0;
    pages.forEach((page, i) => {
      if (!page || !Array.isArray(page.nodes)) return;
      total += page.nodes.length;
      if (page.nodes.length > NODE_LIMITS.perPage)
        add(
          `pages[${i}].nodes`,
          nodeLimitMessage(page.nodes.length, NODE_LIMITS.perPage, page.name ?? page.id),
        );
      const byId = new Map();
      page.nodes.forEach((node, j) => {
        const path = `pages[${i}].nodes[${j}]`;
        try {
          if (!node || typeof node !== "object") throw new Error("Invalid node");
          requireString(node.id, "Node id");
          if (ids.has(node.id)) throw new Error("Duplicate id");
          ids.add(node.id);
          byId.set(node.id, node);
          validateNode(node);
        } catch (error) {
          add(path, error);
        }
      });
      page.nodes.forEach((node, j) => {
        if (!node || typeof node !== "object") return;
        const chain = new Set([node.id]);
        for (let parent = node.parentId; parent; parent = byId.get(parent)?.parentId) {
          const p = byId.get(parent);
          if (chain.has(parent) || !p || p.type !== "frame") {
            add(
              `pages[${i}].nodes[${j}].parentId`,
              "Parent must reference a frame on the same page",
            );
            break;
          }
          chain.add(parent);
        }
      });
    });
    if (total > NODE_LIMITS.perDocument)
      add("pages", nodeLimitMessage(total, NODE_LIMITS.perDocument));
    return problems;
  }

  root.VerynizeDocument = {
    NODE_LIMITS,
    WORLD_COORDINATE_LIMIT,
    WORLD_ADVISORY_LIMIT,
    pageWorldBounds,
    validateWorldBounds,
    validateWorldBoundsChange,
    nodeLimitMessage,
    validateDocument,
    normalizeDocument,
    resolveAliases,
    prepareDocument,
    documentProblems,
    validateAliases,
    isRoomAssetUrl,
    isAssetRef,
    checkVariableValue,
    variableKind,
    IMAGE_FILL_TYPES,
    NODE_TYPES,
    LAYOUTS,
    VARIABLE_TYPES,
    VARIABLE_NAME,
    BINDABLE,
    RESERVED_NAMES,
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
