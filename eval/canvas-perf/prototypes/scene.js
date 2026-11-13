// Deterministic synthetic scenes shaped like Verynize version-2 documents (web/document-core.js):
// a flat `nodes[]` list with `parentId`, types frame/rectangle/text/image, CSS-like style keys
// (color, fills[] gradients, radius, strokeWidth/strokeColor, shadows[], filters[] incl. backdrop blur,
// textRuns[], clipContent, layout/gap/padding). Every artboard is exactly 100 nodes, so N = 1000 → 10 artboards.
// Perf scenes use absolute x/y (relative to the parent). The fidelity scene uses flex layout.
(function () {
  const AB_W = 1440,
    AB_H = 1200,
    AB_GAP = 160;
  const FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif';
  const WORDS = (
    "design system canvas layer agent export preview token gradient shadow motion layout grid flex frame " +
    "component variant prototype review publish share team cloud render vector image text spacing color theme brand"
  ).split(" ");
  const PALETTE = [
    "#6366f1",
    "#ec4899",
    "#14b8a6",
    "#f59e0b",
    "#ef4444",
    "#8b5cf6",
    "#0ea5e9",
    "#22c55e",
  ];

  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const pick = (r, list) => list[Math.floor(r() * list.length)];
  const words = (r, n) => Array.from({ length: n }, () => pick(r, WORDS)).join(" ");
  const cap = (s) => s[0].toUpperCase() + s.slice(1);
  const linear = (angle, a, b) => [
    {
      type: "linear",
      angle,
      stops: [
        { position: 0, color: a },
        { position: 100, color: b },
      ],
    },
  ];

  function artboard(r, ab, ox, oy, push) {
    const accent = pick(r, PALETTE),
      accent2 = pick(r, PALETTE);
    const root = push({
      type: "frame",
      name: `Screen ${ab + 1}`,
      x: ox,
      y: oy,
      w: AB_W,
      h: AB_H,
      color: "#ffffff",
      clipContent: true,
    });
    // Nav: 10 nodes.
    const nav = push({
      type: "frame",
      parentId: root,
      name: "Nav",
      x: 0,
      y: 0,
      w: AB_W,
      h: 72,
      color: "#ffffff",
      strokeWidth: 1,
      strokeColor: "#e5e7eb",
    });
    push({
      type: "rectangle",
      parentId: nav,
      name: "Logo",
      x: 32,
      y: 20,
      w: 32,
      h: 32,
      radius: 8,
      fills: linear(135, accent, accent2),
    });
    push({
      type: "text",
      parentId: nav,
      name: "Brand",
      x: 76,
      y: 24,
      w: 160,
      h: 24,
      text: "Verynize",
      fontSize: 18,
      fontWeight: 700,
      color: "#0f172a",
    });
    for (let i = 0; i < 5; i++)
      push({
        type: "text",
        parentId: nav,
        name: "Link",
        x: 520 + i * 110,
        y: 26,
        w: 96,
        h: 20,
        text: cap(pick(r, WORDS)),
        fontSize: 15,
        fontWeight: 500,
        color: "#334155",
      });
    const cta = push({
      type: "frame",
      parentId: nav,
      name: "CTA",
      x: 1250,
      y: 16,
      w: 150,
      h: 40,
      radius: 20,
      color: "#111827",
      shadows: [{ type: "box", x: 0, y: 4, blur: 12, spread: 0, color: "#11182733" }],
    });
    push({
      type: "text",
      parentId: cta,
      name: "CTA label",
      x: 0,
      y: 11,
      w: 150,
      h: 18,
      text: "Get started",
      fontSize: 14,
      fontWeight: 600,
      color: "#ffffff",
      textAlign: "center",
    });
    // Hero: 13 nodes.
    const hero = push({
      type: "frame",
      parentId: root,
      name: "Hero",
      x: 0,
      y: 72,
      w: AB_W,
      h: 420,
      fills: linear(135, "#eef2ff", "#fdf2f8"),
    });
    const pill = push({
      type: "frame",
      parentId: hero,
      name: "Eyebrow",
      x: 120,
      y: 60,
      w: 180,
      h: 28,
      radius: 14,
      color: "#e0e7ff",
    });
    push({
      type: "text",
      parentId: pill,
      name: "Eyebrow text",
      x: 0,
      y: 6,
      w: 180,
      h: 16,
      text: "New: " + pick(r, WORDS),
      fontSize: 13,
      fontWeight: 600,
      color: "#4338ca",
      textAlign: "center",
    });
    const title = `${cap(pick(r, WORDS))} faster with ${pick(r, WORDS)} agents`;
    const hl = title.lastIndexOf(" agents");
    push({
      type: "text",
      parentId: hero,
      name: "Title",
      x: 120,
      y: 104,
      w: 640,
      h: 132,
      text: title,
      fontSize: 52,
      fontWeight: 700,
      color: "#0f172a",
      textRuns: [{ start: hl + 1, end: title.length, bold: true, italic: false, color: accent }],
    });
    push({
      type: "text",
      parentId: hero,
      name: "Subtitle",
      x: 120,
      y: 248,
      w: 560,
      h: 60,
      text: cap(words(r, 16)) + ".",
      fontSize: 18,
      fontWeight: 400,
      color: "#475569",
    });
    const b1 = push({
      type: "frame",
      parentId: hero,
      name: "Primary",
      x: 120,
      y: 330,
      w: 170,
      h: 48,
      radius: 12,
      color: accent,
      shadows: [{ type: "box", x: 0, y: 8, blur: 24, spread: -4, color: "#4f46e566" }],
    });
    push({
      type: "text",
      parentId: b1,
      name: "Primary label",
      x: 0,
      y: 14,
      w: 170,
      h: 20,
      text: "Start designing",
      fontSize: 16,
      fontWeight: 600,
      color: "#ffffff",
      textAlign: "center",
    });
    const b2 = push({
      type: "frame",
      parentId: hero,
      name: "Secondary",
      x: 306,
      y: 330,
      w: 150,
      h: 48,
      radius: 12,
      color: "#ffffff",
      strokeWidth: 1,
      strokeColor: "#cbd5e1",
    });
    push({
      type: "text",
      parentId: b2,
      name: "Secondary label",
      x: 0,
      y: 14,
      w: 150,
      h: 20,
      text: "Watch demo",
      fontSize: 16,
      fontWeight: 600,
      color: "#0f172a",
      textAlign: "center",
    });
    push({
      type: "image",
      parentId: hero,
      name: "Hero image",
      x: 800,
      y: 48,
      w: 520,
      h: 324,
      radius: 16,
      src: `img:${Math.floor(r() * 6)}`,
      shadows: [{ type: "box", x: 0, y: 20, blur: 40, spread: -8, color: "#0f172a40" }],
    });
    const glass = push({
      type: "frame",
      parentId: hero,
      name: "Glass stat",
      x: 760,
      y: 280,
      w: 260,
      h: 110,
      radius: 16,
      color: "#ffffff99",
      strokeWidth: 1,
      strokeColor: "#ffffffcc",
      ...(ab % 4 === 0 ? { filters: [{ type: "blur", value: 12, backdrop: true }] } : {}),
    });
    push({
      type: "text",
      parentId: glass,
      name: "Stat",
      x: 20,
      y: 18,
      w: 220,
      h: 44,
      text: `${Math.floor(r() * 90 + 10)}k`,
      fontSize: 36,
      fontWeight: 700,
      color: "#0f172a",
    });
    push({
      type: "text",
      parentId: glass,
      name: "Stat label",
      x: 20,
      y: 66,
      w: 220,
      h: 20,
      text: cap(words(r, 3)),
      fontSize: 14,
      fontWeight: 400,
      color: "#475569",
    });
    // Cards: 1 + 8 × 7 = 57 nodes.
    push({
      type: "text",
      parentId: root,
      name: "Section title",
      x: 120,
      y: 532,
      w: 800,
      h: 40,
      text: cap(words(r, 4)),
      fontSize: 32,
      fontWeight: 700,
      color: "#0f172a",
    });
    for (let c = 0; c < 8; c++) {
      const cx = 120 + (c % 4) * 310,
        cy = 592 + Math.floor(c / 4) * 212;
      const card = push({
        type: "frame",
        parentId: root,
        name: "Card",
        x: cx,
        y: cy,
        w: 290,
        h: 196,
        radius: 14,
        color: "#ffffff",
        strokeWidth: 1,
        strokeColor: "#e2e8f0",
        clipContent: true,
        shadows: [{ type: "box", x: 0, y: 6, blur: 18, spread: -6, color: "#0f172a26" }],
      });
      push({
        type: "image",
        parentId: card,
        name: "Thumb",
        x: 0,
        y: 0,
        w: 290,
        h: 92,
        src: `img:${Math.floor(r() * 6)}`,
        ...(ab % 10 === 0 && c === 0 ? { filters: [{ type: "blur", value: 4 }] } : {}),
      });
      push({
        type: "text",
        parentId: card,
        name: "Card title",
        x: 16,
        y: 104,
        w: 258,
        h: 22,
        text: cap(words(r, 3)),
        fontSize: 17,
        fontWeight: 600,
        color: "#0f172a",
      });
      push({
        type: "text",
        parentId: card,
        name: "Card body",
        x: 16,
        y: 130,
        w: 258,
        h: 36,
        text: cap(words(r, 9)) + ".",
        fontSize: 13,
        fontWeight: 400,
        color: "#64748b",
      });
      const tag = pick(r, PALETTE);
      push({
        type: "rectangle",
        parentId: card,
        name: "Tag",
        x: 16,
        y: 170,
        w: 72,
        h: 18,
        radius: 9,
        color: tag + "22",
      });
      push({
        type: "text",
        parentId: card,
        name: "Tag text",
        x: 16,
        y: 172,
        w: 72,
        h: 14,
        text: pick(r, WORDS),
        fontSize: 11,
        fontWeight: 600,
        color: tag,
        textAlign: "center",
      });
      push({
        type: "rectangle",
        parentId: card,
        name: "Avatar",
        x: 250,
        y: 166,
        w: 24,
        h: 24,
        ellipse: true,
        fills: linear(45, tag, "#ffffff"),
      });
    }
    // Footer: 20 nodes.
    const foot = push({
      type: "frame",
      parentId: root,
      name: "Footer",
      x: 0,
      y: 1020,
      w: AB_W,
      h: 180,
      color: "#0f172a",
    });
    for (let col = 0; col < 3; col++) {
      push({
        type: "text",
        parentId: foot,
        name: "Footer heading",
        x: 120 + col * 240,
        y: 32,
        w: 200,
        h: 20,
        text: cap(pick(r, WORDS)),
        fontSize: 14,
        fontWeight: 700,
        color: "#f8fafc",
      });
      for (let j = 0; j < 4; j++)
        push({
          type: "text",
          parentId: foot,
          name: "Footer link",
          x: 120 + col * 240,
          y: 64 + j * 24,
          w: 200,
          h: 18,
          text: cap(words(r, 2)),
          fontSize: 13,
          fontWeight: 400,
          color: "#94a3b8",
        });
    }
    push({
      type: "text",
      parentId: foot,
      name: "Copyright",
      x: 920,
      y: 32,
      w: 300,
      h: 18,
      text: "© 2026 Verynize Inc.",
      fontSize: 13,
      fontWeight: 400,
      color: "#94a3b8",
    });
    push({
      type: "rectangle",
      parentId: foot,
      name: "Social",
      x: 1300,
      y: 28,
      w: 24,
      h: 24,
      ellipse: true,
      color: "#334155",
    });
    push({
      type: "rectangle",
      parentId: foot,
      name: "Social",
      x: 1340,
      y: 28,
      w: 24,
      h: 24,
      ellipse: true,
      color: "#334155",
    });
  }

  /** Builds parent/child links and world rects (absolute x/y) for a list of nodes. */
  function index(nodes) {
    const byId = new Map(nodes.map((n, i) => [n.id, i]));
    const children = nodes.map(() => []),
      roots = [],
      abs = Array.from({ length: nodes.length }),
      parent = new Int32Array(nodes.length).fill(-1);
    nodes.forEach((n, i) => {
      if (n.parentId) {
        const p = byId.get(n.parentId);
        parent[i] = p;
        children[p].push(i);
        const bw = nodes[p].strokeWidth || 0; // CSS: absolute children are placed from the padding box
        abs[i] = { x: abs[p].x + bw + n.x, y: abs[p].y + bw + n.y, w: n.w, h: n.h };
      } else {
        roots.push(i);
        abs[i] = { x: n.x, y: n.y, w: n.w, h: n.h };
      }
    });
    // Artboard (root) of every node, for culling and dirty-region work.
    const rootOf = new Int32Array(nodes.length);
    nodes.forEach((n, i) => {
      rootOf[i] = parent[i] < 0 ? i : rootOf[parent[i]];
    });
    let x0 = Infinity,
      y0 = Infinity,
      x1 = -Infinity,
      y1 = -Infinity;
    for (const i of roots) {
      const a = abs[i];
      x0 = Math.min(x0, a.x);
      y0 = Math.min(y0, a.y);
      x1 = Math.max(x1, a.x + a.w);
      y1 = Math.max(y1, a.y + a.h);
    }
    return {
      nodes,
      byId,
      children,
      roots,
      abs,
      parent,
      rootOf,
      bounds: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 },
    };
  }

  function generate(n, seed = 1) {
    const r = rng(seed),
      nodes = [];
    const boards = Math.ceil(n / 100),
      cols = Math.max(1, Math.ceil(Math.sqrt(boards * 1.25)));
    const push = (node) => {
      const id = "n" + nodes.length.toString(36);
      nodes.push({ id, fontFamily: node.type === "text" ? FONT : undefined, ...node });
      return id;
    };
    for (let ab = 0; ab < boards; ab++)
      artboard(r, ab, (ab % cols) * (AB_W + AB_GAP), Math.floor(ab / cols) * (AB_H + AB_GAP), push);
    nodes.length = n; // every artboard lists parents before children, so truncation never orphans a node
    return { version: 2, kind: "perf", ...index(nodes) };
  }

  /** One realistic Verynize-style screen with flex layout (positions come from CSS layout, not x/y). */
  function fidelity() {
    const nodes = [];
    const push = (node) => {
      const id = "f" + nodes.length;
      nodes.push({ id, x: 0, y: 0, fontFamily: node.type === "text" ? FONT : undefined, ...node });
      return id;
    };
    const root = push({
      type: "frame",
      name: "Dashboard",
      x: 40,
      y: 40,
      w: 1200,
      h: 780,
      color: "#f8fafc",
      radius: 20,
      clipContent: true,
      layout: "column",
      gap: 24,
      padding: 32,
      shadows: [{ type: "box", x: 0, y: 24, blur: 48, spread: -12, color: "#0f172a40" }],
    });
    const nav = push({
      type: "frame",
      parentId: root,
      name: "Nav",
      w: 1136,
      h: 48,
      layout: "row",
      justifyContent: "space-between",
      alignItems: "center",
    });
    push({
      type: "text",
      parentId: nav,
      name: "Brand",
      w: 240,
      hAuto: true,
      text: "Verynize Studio",
      fontSize: 22,
      fontWeight: 700,
      color: "#0f172a",
      textRuns: [{ start: 9, end: 15, bold: false, italic: true, color: "#6366f1" }],
    });
    const navLinks = push({
      type: "frame",
      parentId: nav,
      name: "Links",
      w: 420,
      h: 40,
      layout: "row",
      gap: 8,
      alignItems: "center",
    });
    for (const label of ["Overview", "Projects", "Assets", "Settings"]) {
      const tab = push({
        type: "frame",
        parentId: navLinks,
        name: "Tab",
        w: 96,
        h: 36,
        radius: 10,
        color: label === "Overview" ? "#e0e7ff" : "#ffffff00",
        layout: "row",
        justifyContent: "center",
        alignItems: "center",
      });
      push({
        type: "text",
        parentId: tab,
        name: "Tab label",
        w: 96,
        hAuto: true,
        text: label,
        fontSize: 14,
        fontWeight: 600,
        color: label === "Overview" ? "#4338ca" : "#475569",
        textAlign: "center",
      });
    }
    const hero = push({
      type: "frame",
      parentId: root,
      name: "Hero",
      w: 1136,
      h: 330,
      radius: 18,
      layout: "row",
      gap: 32,
      padding: 32,
      alignItems: "center",
      fills: [
        {
          type: "linear",
          angle: 120,
          stops: [
            { position: 0, color: "#4f46e5" },
            { position: 55, color: "#9333ea" },
            { position: 100, color: "#ec4899" },
          ],
        },
      ],
    });
    const col = push({
      type: "frame",
      parentId: hero,
      name: "Copy",
      w: 520,
      h: 266,
      layout: "column",
      gap: 16,
    });
    const title = "Ship polished screens with agents that write real HTML and Tailwind";
    push({
      type: "text",
      parentId: col,
      name: "Title",
      w: 520,
      hAuto: true,
      text: title,
      fontSize: 38,
      fontWeight: 700,
      color: "#ffffff",
      textRuns: [
        { start: 5, end: 13, bold: true, italic: true, color: "#fde68a" },
        {
          start: title.indexOf("real"),
          end: title.indexOf("real") + 9,
          bold: true,
          italic: false,
          color: "#a5f3fc",
          fontSize: 42,
        },
      ],
    });
    push({
      type: "text",
      parentId: col,
      name: "Body",
      w: 500,
      hAuto: true,
      text: "Mixed runs, kerning and wrapping are the hardest part to keep identical between the DOM and a custom painter. Ligatures: office, affine, ffl.",
      fontSize: 16,
      fontWeight: 400,
      color: "#e0e7ff",
    });
    const btn = push({
      type: "frame",
      parentId: col,
      name: "Button",
      w: 180,
      h: 46,
      radius: 12,
      color: "#ffffff",
      layout: "row",
      justifyContent: "center",
      alignItems: "center",
      shadows: [{ type: "box", x: 0, y: 10, blur: 24, spread: -6, color: "#1e1b4b80" }],
    });
    push({
      type: "text",
      parentId: btn,
      name: "Button label",
      w: 180,
      hAuto: true,
      text: "Open canvas →",
      fontSize: 15,
      fontWeight: 600,
      color: "#312e81",
      textAlign: "center",
    });
    const media = push({
      type: "frame",
      parentId: hero,
      name: "Media",
      w: 520,
      h: 266,
      radius: 16,
      clipContent: true,
    });
    push({
      type: "image",
      parentId: media,
      name: "Shot",
      x: 0,
      y: 0,
      w: 520,
      h: 266,
      src: "img:2",
    });
    const glass = push({
      type: "frame",
      parentId: media,
      name: "Glass",
      x: 24,
      y: 150,
      w: 300,
      h: 92,
      radius: 14,
      color: "#ffffff40",
      strokeWidth: 1,
      strokeColor: "#ffffff80",
      filters: [{ type: "blur", value: 14, backdrop: true }],
      layout: "column",
      gap: 4,
      padding: 16,
    });
    push({
      type: "text",
      parentId: glass,
      name: "Glass title",
      w: 268,
      hAuto: true,
      text: "98.6% visual parity",
      fontSize: 22,
      fontWeight: 700,
      color: "#ffffff",
    });
    push({
      type: "text",
      parentId: glass,
      name: "Glass body",
      w: 268,
      hAuto: true,
      text: "Backdrop blur over an image",
      fontSize: 13,
      fontWeight: 400,
      color: "#f1f5f9",
    });
    const cards = push({
      type: "frame",
      parentId: root,
      name: "Cards",
      w: 1136,
      h: 250,
      layout: "row",
      gap: 20,
    });
    const tones = [
      ["#ecfeff", "#06b6d4"],
      ["#fef3c7", "#d97706"],
      ["#fce7f3", "#db2777"],
    ];
    tones.forEach(([bg, fg], i) => {
      const card = push({
        type: "frame",
        parentId: cards,
        name: "Card",
        w: 365,
        h: 250,
        radius: 16,
        color: "#ffffff",
        strokeWidth: 1,
        strokeColor: "#e2e8f0",
        layout: "column",
        gap: 12,
        padding: 20,
        shadows: [
          { type: "box", x: 0, y: 8, blur: 20, spread: -8, color: "#0f172a33" },
          { type: "box", x: 0, y: 1, blur: 2, spread: 0, color: "#0f172a1a" },
        ],
      });
      const badge = push({
        type: "frame",
        parentId: card,
        name: "Badge",
        w: 44,
        h: 44,
        radius: 12,
        fills: [
          {
            type: "linear",
            angle: 135,
            stops: [
              { position: 0, color: bg },
              { position: 100, color: fg },
            ],
          },
        ],
      });
      void badge;
      push({
        type: "text",
        parentId: card,
        name: "Card title",
        w: 325,
        hAuto: true,
        text: ["Typography", "Effects", "Layout"][i] + " fidelity",
        fontSize: 20,
        fontWeight: 700,
        color: "#0f172a",
      });
      push({
        type: "text",
        parentId: card,
        name: "Card body",
        w: 325,
        hAuto: true,
        text: [
          "Kerning, ligatures (fi fl), emoji 🎨 and mixed weights must match the exported HTML.",
          "Shadows, gradients, blur and translucent borders composite exactly like CSS.",
          "Flex gaps, padding and auto-height text come from the browser layout engine.",
        ][i],
        fontSize: 14,
        fontWeight: 400,
        color: "#475569",
        ...(i === 0
          ? { textRuns: [{ start: 0, end: 7, bold: true, italic: false, color: fg }] }
          : {}),
      });
      const bar = push({
        type: "frame",
        parentId: card,
        name: "Meter",
        w: 325,
        h: 10,
        radius: 5,
        color: "#f1f5f9",
      });
      push({
        type: "rectangle",
        parentId: bar,
        name: "Meter fill",
        x: 0,
        y: 0,
        w: [260, 180, 300][i],
        h: 10,
        radius: 5,
        fills: [
          {
            type: "linear",
            angle: 90,
            stops: [
              { position: 0, color: bg },
              { position: 100, color: fg },
            ],
          },
        ],
      });
    });
    return { version: 2, kind: "fidelity", ...index(nodes) };
  }

  window.PerfScene = { generate, fidelity, AB_W, AB_H, FONT };
})();
