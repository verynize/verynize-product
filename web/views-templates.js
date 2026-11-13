(() => {
  const $ = (id) => document.getElementById(id),
    uid = () => crypto.randomUUID();
  function node(type, name, x, y, w, h, extra = {}) {
    return {
      id: uid(),
      type,
      name,
      x,
      y,
      w,
      h,
      parentId: null,
      color: "#ffffff",
      text: "",
      fontSize: 24,
      radius: 0,
      ...extra,
    };
  }
  function makePage(name) {
    return { id: uid(), name, nodes: [] };
  }
  function add(page, parent, type, name, x, y, w, h, extra) {
    const n = node(type, name, x, y, w, h, { parentId: parent?.id || null, ...extra });
    page.nodes.push(n);
    return n;
  }
  function template(kind) {
    const page = makePage(
      kind === "landing" ? "Landing" : kind === "dashboard" ? "Overview" : "Introduction",
    );
    const doc = {
      version: 2,
      name: {
        landing: "Studio landing page",
        dashboard: "Analytics dashboard",
        presentation: "Project presentation",
      }[kind],
      activePage: page.id,
      pages: [page],
      tokens: { brand: "#7555c8", ink: "#24232b", muted: "#797581", surface: "#f5f2ed" },
      views: [],
    };
    const frame = add(page, null, "frame", "Desktop", 0, 0, 1000, 700, {
      color: "#f5f2ed",
      radius: 0,
    });
    if (kind === "landing") {
      add(page, frame, "text", "Studio identity", 48, 32, 250, 40, {
        text: "STUDIO / FORM",
        fontSize: 20,
        fontWeight: "700",
        color: "#24232b",
      });
      add(page, frame, "text", "Navigation", 640, 38, 300, 30, {
        text: "Work     About     Get in touch ↗",
        fontSize: 15,
        color: "#797581",
      });
      add(page, frame, "text", "Eyebrow", 48, 148, 600, 25, {
        text: "INDEPENDENT DESIGN STUDIO",
        fontSize: 12,
        color: "#7555c8",
        letterSpacing: 2,
      });
      add(page, frame, "text", "Hero heading", 48, 191, 620, 185, {
        text: "Thoughtful design.\nLasting impressions.",
        fontSize: 57,
        fontWeight: "600",
        color: "#24232b",
      });
      add(page, frame, "text", "Hero description", 48, 407, 470, 70, {
        text: "We turn ambitious ideas into clear, useful digital experiences. Built with care, made for people.",
        fontSize: 19,
        color: "#797581",
        lineHeight: 1.5,
      });
      add(page, frame, "rectangle", "Primary button", 48, 520, 195, 48, {
        color: "#7555c8",
        radius: 24,
      });
      add(page, frame, "text", "Button label", 70, 534, 160, 24, {
        text: "Explore our work ↗",
        fontSize: 15,
        fontWeight: "600",
        color: "#ffffff",
      });
      add(page, frame, "rectangle", "Hero artwork", 700, 170, 245, 365, {
        color: "#cdb8e7",
        radius: 100,
        gradient: "linear-gradient(145deg,#ddd0ef,#a68acb)",
      });
      add(page, frame, "rectangle", "Artwork circle", 736, 250, 180, 180, {
        color: "#f0d2ad",
        radius: 90,
      });
      add(page, frame, "text", "Footer", 48, 645, 800, 25, {
        text: "Strategy  /  Identity  /  Digital products",
        fontSize: 14,
        color: "#797581",
      });
    } else if (kind === "dashboard") {
      frame.color = "#f5f6fa";
      add(page, frame, "rectangle", "Navigation rail", 0, 0, 190, 700, { color: "#252332" });
      add(page, frame, "text", "Product name", 25, 30, 150, 40, {
        text: "Metric",
        fontSize: 27,
        fontWeight: "700",
        color: "#ffffff",
      });
      add(page, frame, "text", "Navigation items", 25, 125, 150, 350, {
        text: "Overview\n\nReports\n\nAudience\n\nCampaigns\n\nSettings",
        fontSize: 16,
        color: "#c6bedc",
      });
      add(page, frame, "text", "Page heading", 225, 40, 500, 50, {
        text: "Business overview",
        fontSize: 30,
        fontWeight: "600",
        color: "#24232b",
      });
      add(page, frame, "text", "Date range", 770, 50, 210, 30, {
        text: "Last 30 days  ▾",
        fontSize: 14,
        color: "#797581",
      });
      for (const [i, label, value] of [
        [0, "Revenue", "$42,890"],
        [1, "Active customers", "1,284"],
        [2, "Conversion", "4.8%"],
      ]) {
        const x = 225 + i * 245;
        add(page, frame, "rectangle", label + " card", x, 120, 225, 125, {
          color: "#ffffff",
          radius: 12,
        });
        add(page, frame, "text", label, x + 18, 140, 190, 25, {
          text: label,
          fontSize: 14,
          color: "#797581",
        });
        add(page, frame, "text", label + " value", x + 18, 180, 190, 40, {
          text: value,
          fontSize: 29,
          fontWeight: "600",
          color: "#24232b",
        });
      }
      add(page, frame, "rectangle", "Revenue chart card", 225, 275, 715, 340, {
        color: "#ffffff",
        radius: 12,
      });
      add(page, frame, "text", "Chart heading", 250, 297, 400, 40, {
        text: "Revenue performance",
        fontSize: 19,
        fontWeight: "600",
        color: "#24232b",
      });
      [95, 145, 120, 175, 140, 205, 170, 220, 185, 240, 210, 255].forEach((height, i) =>
        add(page, frame, "rectangle", "Month " + (i + 1), 260 + i * 54, 585 - height, 30, height, {
          color: i === 11 ? "#7555c8" : "#d6cbea",
          radius: 5,
        }),
      );
      add(page, frame, "text", "Chart caption", 250, 640, 680, 25, {
        text: "Example data · Replace these values with your own metrics",
        fontSize: 12,
        color: "#797581",
      });
    } else {
      frame.color = "#24232b";
      add(page, frame, "text", "Slide label", 55, 45, 400, 25, {
        text: "PROJECT PROPOSAL / 2026",
        fontSize: 13,
        color: "#c4b7e1",
        letterSpacing: 2,
      });
      add(page, frame, "text", "Presentation title", 55, 175, 800, 200, {
        text: "A clearer vision\nfor what comes next.",
        fontSize: 64,
        fontWeight: "600",
        color: "#ffffff",
      });
      add(page, frame, "rectangle", "Accent rule", 55, 440, 120, 6, {
        color: "#b39bdc",
        radius: 3,
      });
      add(page, frame, "text", "Presentation subtitle", 55, 490, 700, 80, {
        text: "A practical plan to turn shared ambition into a focused experience.",
        fontSize: 24,
        color: "#c7c1d2",
      });
      add(page, frame, "text", "Presenter", 55, 635, 700, 25, {
        text: "Presented by your team                                     01",
        fontSize: 14,
        color: "#c4b7e1",
      });
      const second = makePage("The approach");
      doc.pages.push(second);
      const secondFrame = add(second, null, "frame", "Slide 2", 0, 0, 1000, 700, {
        color: "#f5f2ed",
      });
      add(second, secondFrame, "text", "Approach heading", 55, 55, 800, 70, {
        text: "Three steps toward a better outcome.",
        fontSize: 37,
        fontWeight: "600",
        color: "#24232b",
      });
      ["Understand", "Explore", "Deliver"].forEach((title, i) => {
        const x = 55 + i * 300;
        add(second, secondFrame, "rectangle", title + " card", x, 200, 270, 320, {
          color: i === 1 ? "#e5dbef" : "#eae5de",
          radius: 18,
        });
        add(second, secondFrame, "text", title + " number", x + 24, 230, 200, 40, {
          text: "0" + (i + 1),
          fontSize: 22,
          color: "#7555c8",
        });
        add(second, secondFrame, "text", title + " title", x + 24, 320, 220, 45, {
          text: title,
          fontSize: 28,
          fontWeight: "600",
          color: "#24232b",
        });
        add(second, secondFrame, "text", title + " body", x + 24, 390, 220, 95, {
          text: [
            "Listen closely.\nDefine the real problem.",
            "Make possibilities visible.\nTest the strongest ideas.",
            "Build with care.\nLearn from real use.",
          ][i],
          fontSize: 18,
          color: "#797581",
        });
      });
    }
    return doc;
  }
  // --- Template gallery and shared component library -------------------------------------------
  // Built-in templates (above) plus the user's own, saved from the current document or selection, grouped by
  // category, searchable, previewed as SVG thumbnails, and portable as JSON template packs
  // ({format:'verynize-template-pack',version:1,templates,components}). The component library is shared by every
  // file in this app (localStorage): insert a component as an instance (root node `libraryComponent:{id,version}`),
  // publish an edited instance back to the library, and update outdated instances in the open document.
  const USER_KEY = "verynize-user-templates",
    LIB_KEY = "verynize-component-library",
    MAX_USER = 60,
    MAX_COMPONENTS = 200,
    MAX_BYTES = 2 * 1024 * 1024;
  const BUILT_IN = [
    [
      "landing",
      "Studio landing page",
      "A warm editorial layout for an independent studio.",
      "website",
    ],
    [
      "dashboard",
      "Analytics dashboard",
      "A focused overview with cards and editable charts.",
      "app",
    ],
    [
      "presentation",
      "Project presentation",
      "Two slides to introduce your idea and its approach.",
      "presentation",
    ],
  ];
  const CATEGORIES = [
    ["all", "All"],
    ["website", "Websites"],
    ["app", "Apps"],
    ["presentation", "Presentations"],
    ["mine", "My templates"],
    ["components", "Components"],
  ];
  const readList = (key) => {
    try {
      const v = JSON.parse(localStorage.getItem(key) || "[]");
      return Array.isArray(v) ? v : [];
    } catch {
      return [];
    }
  };
  const writeList = (key, list) => {
    const text = JSON.stringify(list);
    try {
      localStorage.setItem(key, text);
    } catch {
      throw Error(
        "There is not enough local storage left; remove some templates or components first.",
      );
    }
  };
  const cleanName = (v, fallback) =>
    String(v ?? "")
      // oxlint-disable-next-line no-control-regex -- stripping control characters is the point
      .replace(/[\u0000-\u001f]/g, " ")
      .trim()
      .slice(0, 80) || fallback;
  const esc = (v) =>
    String(v).replace(
      /[&<>"']/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
    );
  function validDocument(doc) {
    if (!doc || doc.version !== 2 || !Array.isArray(doc.pages) || !doc.pages.length)
      throw Error("That is not a Verynize document.");
    if (JSON.stringify(doc).length > MAX_BYTES) throw Error("Templates must be under 2 MB.");
    return doc;
  }
  /** Fresh ids for a whole document, so two files made from one template never share node ids. */
  function reidDocument(doc) {
    const copy = structuredClone(doc),
      map = new Map();
    for (const page of copy.pages) {
      map.set(page.id, uid());
      for (const n of page.nodes) map.set(n.id, uid());
    }
    for (const page of copy.pages) {
      page.id = map.get(page.id);
      for (const n of page.nodes) {
        n.id = map.get(n.id);
        if (n.parentId) n.parentId = map.get(n.parentId) || null;
      }
    }
    if (copy.activePage) copy.activePage = map.get(copy.activePage) || copy.pages[0].id;
    copy.views = (copy.views || [])
      .filter((v) => map.has(v.page))
      .map((v) => ({ ...v, id: uid(), page: map.get(v.page) }));
    return copy;
  }
  /** Nodes of the selection plus their descendants; roots are selected nodes whose parent is not selected. */
  function subtree(page, ids) {
    const wanted = new Set(ids),
      all = [],
      roots = page.nodes.filter((n) => wanted.has(n.id) && !(n.parentId && wanted.has(n.parentId)));
    const add = (n) => {
      all.push(n);
      for (const c of page.nodes.filter((c) => c.parentId === n.id)) add(c);
    };
    roots.forEach(add);
    return { roots, all };
  }
  /** Copy of a node tree with new ids; `roots` are re-parented to `parentId` and offset by (dx, dy). */
  function cloneTree(nodes, { parentId = null, dx = 0, dy = 0 } = {}) {
    const map = new Map(nodes.map((n) => [n.id, uid()]));
    return nodes.map((n) => {
      const c = structuredClone(n);
      c.id = map.get(n.id);
      if (map.has(n.parentId)) c.parentId = map.get(n.parentId);
      else {
        c.parentId = parentId;
        c.x = Math.round(c.x + dx);
        c.y = Math.round(c.y + dy);
      }
      delete c.libraryComponent;
      return c;
    });
  }
  function svgPreview(doc, { width = 240, height = 148 } = {}) {
    const page = doc.pages.find((p) => p.id === doc.activePage) || doc.pages[0];
    const pos = new Map();
    const abs = (n) => {
      if (pos.has(n.id)) return pos.get(n.id);
      const parent = n.parentId && page.nodes.find((p) => p.id === n.parentId);
      const base = parent ? abs(parent) : { x: 0, y: 0 };
      const v = { x: base.x + (+n.x || 0), y: base.y + (+n.y || 0) };
      pos.set(n.id, v);
      return v;
    };
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const n of page.nodes) {
      const p = abs(n);
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x + n.w);
      maxY = Math.max(maxY, p.y + n.h);
    }
    if (!page.nodes.length) {
      minX = minY = 0;
      maxX = maxY = 1;
    }
    const scale = Math.min(width / (maxX - minX || 1), height / (maxY - minY || 1));
    const ox = (width - (maxX - minX) * scale) / 2,
      oy = (height - (maxY - minY) * scale) / 2;
    const color = (c) => (/^#[0-9a-f]{3,8}$/i.test(c || "") ? c : doc.tokens?.[c] || "#888888");
    const parts = page.nodes.slice(0, 600).map((n) => {
      const p = abs(n),
        x = ox + (p.x - minX) * scale,
        y = oy + (p.y - minY) * scale,
        w = Math.max(1, n.w * scale),
        h = Math.max(1, n.h * scale);
      if (n.type === "text")
        return `<rect x="${x.toFixed(1)}" y="${(y + h * 0.3).toFixed(1)}" width="${(w * 0.8).toFixed(1)}" height="${Math.max(1, h * 0.35).toFixed(1)}" rx="1" fill="${esc(color(n.color))}" opacity=".7"/>`;
      return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="${Math.min(+n.radius || 0, h / 2) * scale}" fill="${esc(color(n.color))}"/>`;
    });
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="Preview">${parts.join("")}</svg>`;
  }
  const userTemplates = () =>
    readList(USER_KEY).filter((t) => t && typeof t.id === "string" && t.document);
  const components = () =>
    readList(LIB_KEY).filter(
      (c) => c && typeof c.id === "string" && Array.isArray(c.nodes) && c.nodes.length,
    );
  function saveTemplate({ name, category = "mine", description = "", document }) {
    const list = userTemplates();
    if (list.length >= MAX_USER) throw Error("You have 60 templates; remove one first.");
    const entry = {
      id: uid(),
      name: cleanName(name, "Untitled template"),
      category: ["website", "app", "presentation", "mine"].includes(category) ? category : "mine",
      description: cleanName(description, ""),
      createdAt: Date.now(),
      document: validDocument(structuredClone(document)),
    };
    writeList(USER_KEY, [...list, entry]);
    return entry;
  }
  function templateFromSelection(name) {
    const doc = window.design.getDocument(),
      page = doc.pages.find((p) => p.id === doc.activePage);
    const ids = window.design.getSelection();
    if (!ids.length) throw Error("Select layers to save as a template.");
    const { roots, all } = subtree(page, ids);
    const minX = Math.min(...roots.map((r) => r.x)),
      minY = Math.min(...roots.map((r) => r.y));
    const p = { id: uid(), name: page.name, nodes: cloneTree(all, { dx: -minX, dy: -minY }) };
    return {
      version: 2,
      name: cleanName(name, "Selection"),
      activePage: p.id,
      pages: [p],
      tokens: structuredClone(doc.tokens || {}),
      views: [],
    };
  }
  function addComponent(name) {
    const doc = window.design.getDocument(),
      page = doc.pages.find((p) => p.id === doc.activePage);
    const ids = window.design.getSelection();
    const { roots, all } = subtree(page, ids);
    if (roots.length !== 1)
      throw Error("Select one layer (a frame groups several) to make a component.");
    const list = components();
    if (list.length >= MAX_COMPONENTS) throw Error("The library is full.");
    const root = roots[0];
    const entry = {
      id: uid(),
      name: cleanName(name, root.name || "Component"),
      version: 1,
      updatedAt: Date.now(),
      nodes: cloneTree(all, { dx: -root.x, dy: -root.y }),
    };
    writeList(LIB_KEY, [...list, entry]);
    // The selected layer becomes the first instance.
    page.nodes = page.nodes.map((n) =>
      n.id === root.id ? { ...n, libraryComponent: { id: entry.id, version: 1 } } : n,
    );
    window.design.setDocument(doc);
    return entry;
  }
  function insertComponent(id) {
    const comp = components().find((c) => c.id === id);
    if (!comp) throw Error("That component is no longer in the library.");
    const doc = window.design.getDocument(),
      page = doc.pages.find((p) => p.id === doc.activePage);
    const camera = window.design.getCamera?.();
    const at =
      camera && Number.isFinite(camera.x)
        ? { x: Math.round(camera.x), y: Math.round(camera.y) }
        : { x: 40, y: 40 };
    const nodes = cloneTree(comp.nodes, { dx: at.x, dy: at.y });
    nodes[0].libraryComponent = { id: comp.id, version: comp.version };
    page.nodes.push(...nodes);
    window.design.setDocument(doc);
    window.design.setSelection([nodes[0].id]);
    return nodes[0].id;
  }
  /** Publish the selected instance's current content as the component's next version. */
  function publishComponent() {
    const doc = window.design.getDocument(),
      page = doc.pages.find((p) => p.id === doc.activePage);
    const ids = window.design.getSelection();
    const root = page.nodes.find((n) => ids.includes(n.id) && n.libraryComponent);
    if (!root) throw Error("Select an instance of a library component.");
    const list = components(),
      comp = list.find((c) => c.id === root.libraryComponent.id);
    if (!comp) throw Error("That component is no longer in the library.");
    const { all } = subtree(page, [root.id]);
    comp.nodes = cloneTree(all, { dx: -root.x, dy: -root.y });
    comp.version++;
    comp.updatedAt = Date.now();
    writeList(LIB_KEY, list);
    page.nodes = page.nodes.map((n) =>
      n.id === root.id ? { ...n, libraryComponent: { id: comp.id, version: comp.version } } : n,
    );
    window.design.setDocument(doc);
    return comp;
  }
  /** Replace every outdated instance in the open document with the library version (position, parent and root id kept). */
  function updateInstances() {
    const doc = window.design.getDocument(),
      lib = new Map(components().map((c) => [c.id, c]));
    let updated = 0;
    for (const page of doc.pages) {
      for (const root of page.nodes.filter(
        (n) =>
          n.libraryComponent &&
          lib.has(n.libraryComponent.id) &&
          n.libraryComponent.version < lib.get(n.libraryComponent.id).version,
      )) {
        const comp = lib.get(root.libraryComponent.id);
        const { all } = subtree(page, [root.id]);
        const gone = new Set(all.map((n) => n.id));
        const fresh = cloneTree(comp.nodes, { parentId: root.parentId, dx: root.x, dy: root.y });
        const oldRoot = fresh[0].id;
        fresh[0].id = root.id;
        for (const n of fresh) if (n.parentId === oldRoot) n.parentId = root.id;
        fresh[0].libraryComponent = { id: comp.id, version: comp.version };
        const index = page.nodes.findIndex((n) => n.id === root.id);
        page.nodes = page.nodes.filter((n) => !gone.has(n.id));
        page.nodes.splice(Math.min(index, page.nodes.length), 0, ...fresh);
        updated++;
      }
    }
    if (updated) window.design.setDocument(doc);
    return updated;
  }
  function exportPack({ templates = true, library = true } = {}) {
    return {
      format: "verynize-template-pack",
      version: 1,
      exportedAt: new Date().toISOString(),
      templates: templates ? userTemplates() : [],
      components: library ? components() : [],
    };
  }
  function importPack(pack) {
    if (!pack || pack.format !== "verynize-template-pack" || pack.version !== 1)
      throw Error("That file is not a Verynize template pack.");
    let templates = 0,
      comps = 0;
    const list = userTemplates();
    for (const t of Array.isArray(pack.templates) ? pack.templates : []) {
      if (list.length >= MAX_USER) break;
      try {
        list.push({
          id: uid(),
          name: cleanName(t.name, "Imported template"),
          category: ["website", "app", "presentation", "mine"].includes(t.category)
            ? t.category
            : "mine",
          description: cleanName(t.description, ""),
          createdAt: Date.now(),
          document: validDocument(structuredClone(t.document)),
        });
        templates++;
      } catch {}
    }
    writeList(USER_KEY, list);
    const lib = components();
    for (const c of Array.isArray(pack.components) ? pack.components : []) {
      if (lib.length >= MAX_COMPONENTS || !Array.isArray(c?.nodes) || !c.nodes.length) continue;
      const existing = lib.find((x) => x.id === c.id);
      if (existing) {
        if ((+c.version || 1) > existing.version) {
          existing.nodes = structuredClone(c.nodes);
          existing.version = +c.version;
          existing.name = cleanName(c.name, existing.name);
          existing.updatedAt = Date.now();
          comps++;
        }
        continue;
      }
      lib.push({
        id: typeof c.id === "string" && c.id.length < 80 ? c.id : uid(),
        name: cleanName(c.name, "Component"),
        version: Math.max(1, Math.floor(+c.version || 1)),
        updatedAt: Date.now(),
        nodes: structuredClone(c.nodes),
      });
      comps++;
    }
    writeList(LIB_KEY, lib);
    return { templates, components: comps };
  }

  // The Templates and Saved views dialogs are the settings island's (web/src/islands/settings/templates-dialog.tsx and
  // views-dialog.tsx); this script keeps the data, the component library, packs and the two commands the chrome island
  // takes over (#templates-open, #saved-views-open), which dispatch bd:open-templates / bd:open-views.
  const templatesButton = document.createElement("button");
  templatesButton.id = "templates-open";
  templatesButton.textContent = "Templates";
  $("library-new-folder")?.before(templatesButton);
  const viewsButton = document.createElement("button");
  viewsButton.id = "saved-views-open";
  viewsButton.textContent = "Views";
  viewsButton.title = "Saved views";
  document.querySelector(".canvas-title")?.append(viewsButton);
  const changed = () => window.dispatchEvent(new CustomEvent("design-templates-changed"));
  // Packs: .zip in the desktop app (manifest + documents + embedded image assets, desktop/template-packs.cjs), JSON otherwise.
  const zipApi = () =>
    window.verynizePlatform.can("templatePacks") ? window.desktop.templatePacks : null;
  async function exportZip(pack = exportPack()) {
    const api = zipApi();
    if (!api) throw Error("Zip packs need the desktop app.");
    return new Uint8Array(await api.encode(pack));
  }
  async function importFile(file) {
    if (file.size > 50 * 1024 * 1024) throw Error("Template packs must be under 50 MB.");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const zip = bytes[0] === 0x50 && bytes[1] === 0x4b;
    let result;
    if (zip) {
      const api = zipApi();
      if (!api) throw Error("Zip packs need the desktop app.");
      result = importPack(await api.decode(bytes));
    } else result = importPack(JSON.parse(new TextDecoder().decode(bytes)));
    changed();
    return result;
  }
  /** Downloads the template pack (.zip on the desktop, JSON otherwise) and says what it held. */
  async function downloadPack() {
    const pack = exportPack();
    const save = (blob, name) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
    if (zipApi())
      save(
        new Blob([await exportZip(pack)], { type: "application/zip" }),
        "verynize-templates.zip",
      );
    else
      save(
        new Blob([JSON.stringify(pack, null, 2)], { type: "application/json" }),
        "verynize-templates.json",
      );
    return `Exported ${pack.templates.length} templates and ${pack.components.length} components`;
  }
  const withChange =
    (fn) =>
    (...args) => {
      const result = fn(...args);
      changed();
      return result;
    };
  const openTemplates = () => window.dispatchEvent(new CustomEvent("bd:open-templates"));
  templatesButton.onclick = openTemplates;
  window.designTemplates = {
    open: openTemplates,
    create: template,
    builtIn: BUILT_IN.map(([id, name, description, category]) => ({
      id,
      name,
      description,
      category,
    })),
    categories: CATEGORIES.map(([id, label]) => ({ id, label })),
    saveTemplate: withChange(saveTemplate),
    deleteTemplate: (id) => {
      writeList(
        USER_KEY,
        userTemplates().filter((t) => t.id !== id),
      );
      changed();
    },
    templateFromSelection,
    userTemplates,
    svgPreview,
    reidDocument,
    library: {
      list: components,
      add: withChange(addComponent),
      insert: insertComponent,
      publish: withChange(publishComponent),
      updateInstances,
      remove: (id) => {
        writeList(
          LIB_KEY,
          components().filter((c) => c.id !== id),
        );
        changed();
      },
    },
    exportPack,
    importPack: withChange(importPack),
    exportZip,
    importFile,
    downloadPack,
    render: changed,
  };
  function validViews(doc) {
    return (Array.isArray(doc.views) ? doc.views : [])
      .filter(
        (v) =>
          v &&
          typeof v.id === "string" &&
          typeof v.name === "string" &&
          doc.pages.some((p) => p.id === v.page) &&
          Number.isFinite(v.zoom) &&
          v.zoom >= 0.02 &&
          v.zoom <= 32 &&
          ["scrollLeft", "scrollTop"].every(
            (k) => Number.isFinite(v[k]) && v[k] >= 0 && v[k] <= 1e7,
          ) &&
          ["x", "y"].every(
            (k) => v[k] === undefined || (Number.isFinite(v[k]) && Math.abs(v[k]) <= 1e7),
          ),
      )
      .slice(0, 100);
  }
  function updateViews(change) {
    const doc = window.design.getDocument(),
      view = window.design.getView();
    doc.views = change(validViews(doc));
    window.design.setDocument(doc);
    window.design.setView(view);
  }
  viewsButton.onclick = () => window.dispatchEvent(new CustomEvent("bd:open-views"));
  /** Saved views of the open document (page, zoom and scroll), at most 100. */
  window.savedViews = {
    list: () => validViews(window.design.getDocument()),
    save(name) {
      const doc = window.design.getDocument();
      if (validViews(doc).length >= 100) throw Error("This document already has 100 saved views.");
      updateViews((views) => [
        ...views,
        { id: uid(), name: String(name).trim().slice(0, 100), ...window.design.getView() },
      ]);
    },
    rename: (id, name) =>
      updateViews((views) =>
        views.map((v) => (v.id === id ? { ...v, name: String(name).trim().slice(0, 100) } : v)),
      ),
    remove: (id) => updateViews((views) => views.filter((v) => v.id !== id)),
    apply: (view) => window.design.setView(view),
  };
})();
