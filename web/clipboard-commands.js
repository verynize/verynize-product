"use strict";
// Clipboard placement and duplicate commands (Wonder K2 / TR6), registered on the canvas command registry of
// web/canvas-interactions.js through BetterCanvas.extend, so window.design.runCommand(id, arg), the shortcuts and
// the context menu all reach them.
//
//   clipboard.pasteHere          arg {x, y} (document coords): the pasted bounds' top-left lands on that point, at the
//                                top level (Wonder P3-empty-result, P3-paste-over-parent-result).
//   edit.paste                   arg {menu: true} (the layer context menu's Paste): with one frame selected, the clipboard
//                                becomes its child, centred in it (Wonder P3-context-paste-result). ⌘V is unchanged.
//   clipboard.pasteToReplace     ⌘⇧R: each selected layer is replaced by the clipboard, same parent, position and stack slot.
//   clipboard.pasteOverSelection ⌘⇧V: same parent as the selection, stacked above it and centred on its bounds.
//   clipboard.copyLink           verynize://node/<document>/<pageId>/<shortId> per selected layer (the finish_artboard
//                                designLink format that web/desktop-panel.js openLink resolves), one per line.
//   edit.copyCode                ⌘⇧C: Tailwind TSX with a "Made with Verynize" comment (Wonder P1-copy-code.txt).
//   clipboard.copyPrompt         ⌘⇧⌥C: Wonder's prompt structure (P1-copy-prompt*.txt) with Verynize links, MCP tools and
//                                one TSX snapshot per layer (the integrations codec through window.desktop.exportCode; the
//                                export HTML outside the desktop app).
//   edit.duplicate               ⌘D: the copy lands to the right of the original with a 40 px gap (Wonder: 120 wide at
//                                X515 → X675), stacked just above it.
// Duplicates (⌘D and Alt-drag) are renamed to the next free "<base> <n>" name on the page (Frame, Frame 2 → Frame 3).
//
// Assumptions where Wonder is unproven (design/wonder/canvas-audit/wonder/notes.md K2): the paste modes read the in-app
// clipboard (last copy or last pasted layers); Paste over selection with nothing selected pastes in place; Paste to
// replace skips locked layers; numbering applies to every duplicated name.
(() => {
  const DUPLICATE_GAP = 40;
  const r2 = (v) => Math.round(v * 100) / 100;
  const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  /** Next free "<base> <n>" for a copy of `name`, given the names already in use ("Frame", "Frame 2" → "Frame 3"). */
  function nextName(name, used) {
    const base =
      String(name || "")
        .replace(/\s+\d+$/, "")
        .trim() || "Layer";
    const pattern = new RegExp("^" + escape(base) + "(?:\\s+(\\d+))?$");
    let max = 0;
    for (const n of used) {
      const m = pattern.exec(String(n ?? "").trim());
      if (m) max = Math.max(max, m[1] ? Number(m[1]) : 1);
    }
    return `${base} ${max + 1}`;
  }

  function extend(c) {
    const { ed } = c;
    const hasClipboard = () => !!c.getClipboard()?.nodes?.length;
    const needsSelection = () => c.sel().size > 0;

    function renameCopies(ids) {
      const used = ed.nodes().map((n) => n.name);
      for (const id of ids) {
        const n = c.find(id);
        if (!n) continue;
        n.name = nextName(n.name, used);
        used.push(n.name);
      }
    }
    c.hooks.duplicated = renameCopies; // Alt-drag copies (canvas-interactions duplicateNodes)

    // The visible bounds of layers, in their parent's coordinates (rendered size covers hug/fill and rotation).
    function localBounds(list) {
      return c.union(
        list.map((n) => {
          const r = c.worldRect(n.id),
            w = r ? r.w : Number(n.w) || 0,
            h = r ? r.h : Number(n.h) || 0;
          return {
            x: r && !n.parentId ? r.x : Number(n.x) || 0,
            y: r && !n.parentId ? r.y : Number(n.y) || 0,
            w,
            h,
          };
        }),
      );
    }
    // Index just past a layer's subtree in the flat node list (its copies stack directly above it).
    const subtreeEnd = (list, id) => {
      const ids = ed.descendants(id);
      let end = -1;
      list.forEach((n, i) => {
        if (ids.has(n.id)) end = i;
      });
      return end + 1;
    };

    // ---------- ⌘D ----------
    function duplicate() {
      const tops = c.topSelected();
      if (!tops.length) return false;
      ed.checkpoint();
      const list = ed.nodes(),
        offsets = new Map();
      for (const parentId of new Set(tops.map((n) => n.parentId || null))) {
        const group = tops.filter((n) => (n.parentId || null) === parentId && !c.inStack(n));
        const b = localBounds(group);
        if (b) offsets.set(parentId, r2(b.w + DUPLICATE_GAP));
      }
      const result = [];
      for (const top of tops) {
        const subtree = ed.descendants(top.id),
          mapping = new Map([...subtree].map((id) => [id, ed.uid()]));
        const dx = c.inStack(top) ? 0 : offsets.get(top.parentId || null) || 0;
        const copies = list
          .filter((n) => subtree.has(n.id))
          .map((n) => ({
            ...structuredClone(n),
            id: mapping.get(n.id),
            parentId: mapping.get(n.parentId) || n.parentId || null,
          }));
        window.VerynizeComponents?.adoptCopies(ed.design, copies, mapping); // a copy of a main is an instance of it
        const root = copies.find((n) => n.id === mapping.get(top.id));
        root.x = r2((Number(top.x) || 0) + dx);
        list.splice(subtreeEnd(list, top.id), 0, ...copies);
        result.push(root.id);
      }
      renameCopies(result);
      ed.setSelection(new Set(result));
      ed.render();
      return true;
    }
    const legacyDuplicate = document.getElementById("duplicate"); // inspector proxies and older callers click it
    if (legacyDuplicate) legacyDuplicate.onclick = () => duplicate();

    // ---------- Paste modes ----------
    // Fresh copies of the clipboard: roots detached (parentId null), with their offsets from the clipboard bounds.
    function materialize(data) {
      const ids = new Map(data.nodes.map((n) => [n.id, ed.uid()])),
        roots = data.roots.filter((id) => ids.has(id)),
        rootSet = new Set(roots);
      const copies = data.nodes.map((n) => ({
        ...structuredClone(n),
        id: ids.get(n.id),
        parentId: rootSet.has(n.id) ? null : ids.get(n.parentId) || null,
      }));
      window.VerynizeComponents?.adoptCopies(ed.design, copies, ids);
      const source = new Map(data.nodes.map((n) => [n.id, n]));
      const boxes = roots.map((id) => {
        const n = source.get(id),
          w = data.world?.[id];
        return {
          x: w ? w.x : Number(n.x) || 0,
          y: w ? w.y : Number(n.y) || 0,
          w: Number(n.w) || 0,
          h: Number(n.h) || 0,
        };
      });
      const bounds = c.union(boxes) || { x: 0, y: 0, w: 0, h: 0 };
      const placed = roots.map((id, i) => ({
        node: copies.find((n) => n.id === ids.get(id)),
        dx: boxes[i].x - bounds.x,
        dy: boxes[i].y - bounds.y,
      }));
      return { copies, placed, bounds };
    }
    // Validates the edit on a copy of the document, then applies it as one undo step. `edit(list, wrap)` mutates a
    // page's node list; it must only locate nodes by id so both runs agree.
    function commit(data, edit, selection) {
      const candidate = structuredClone(ed.design),
        page = candidate.pages.find((p) => p.id === ed.page().id);
      for (const [k, v] of Object.entries(data.tokens || {}))
        if (!candidate.tokens[k]) candidate.tokens[k] = v;
      edit(page.nodes, (n) => structuredClone(n));
      try {
        ed.validate(candidate);
      } catch (error) {
        c.footer("Unable to paste: " + error.message);
        return false;
      }
      // A paste never makes a main contain an instance of itself (design/component-audit/README.md "Nested instances").
      const cycles = (d) => window.VerynizeComponents?.componentProblems(d).length || 0;
      if (cycles(candidate) > cycles(ed.design)) {
        const message = "A main component cannot contain an instance of itself";
        c.footer(message);
        window.dispatchEvent(new CustomEvent("bd:notice", { detail: { message } }));
        return false;
      }
      ed.checkpoint();
      for (const [k, v] of Object.entries(data.tokens || {}))
        if (!ed.design.tokens[k]) ed.design.tokens[k] = v;
      edit(ed.nodes(), (n) => ({ ...ed.defaults, ...structuredClone(n) }));
      ed.setSelection(new Set(selection));
      ed.render();
      return true;
    }
    const placeAt = (placed, parentId, x, y) => {
      for (const { node, dx, dy } of placed) {
        node.parentId = parentId;
        node.x = r2(x + dx);
        node.y = r2(y + dy);
      }
    };

    function pasteHere(point) {
      const data = c.getClipboard();
      if (!data) return false;
      const { copies, placed, bounds } = materialize(data);
      const p =
        point && Number.isFinite(Number(point.x)) && Number.isFinite(Number(point.y))
          ? { x: Number(point.x), y: Number(point.y) }
          : c.placeInView(bounds.w, bounds.h);
      placeAt(placed, null, p.x, p.y);
      return commit(
        data,
        (list, wrap) => list.push(...copies.map(wrap)),
        placed.map((p) => p.node.id),
      );
    }

    // Paste from the layer context menu (Wonder P3-context-paste-result): with one frame selected (the menu's target)
    // the clipboard becomes its last child, centred in it. Otherwise, and for ⌘V, the canvas paste.
    function menuPaste() {
      const data = c.getClipboard();
      if (!data) return false;
      const tops = c.topSelected(),
        target =
          tops.length === 1 &&
          tops[0].type === "frame" &&
          !tops[0].locked &&
          !data.roots.includes(tops[0].id)
            ? tops[0]
            : null;
      if (!target) return c.paste(data);
      const { copies, placed, bounds } = materialize(data),
        box = localBounds([target]);
      placeAt(placed, target.id, (box.w - bounds.w) / 2, (box.h - bounds.h) / 2);
      return commit(
        data,
        (list, wrap) => list.splice(subtreeEnd(list, target.id), 0, ...copies.map(wrap)),
        placed.map((p) => p.node.id),
      );
    }

    function pasteOverSelection() {
      const data = c.getClipboard();
      if (!data) return false;
      const tops = c.topSelected();
      if (!tops.length) return c.paste(data, { inPlace: true });
      const parentId = tops[0].parentId || null,
        group = tops.filter((n) => (n.parentId || null) === parentId);
      const { copies, placed, bounds } = materialize(data),
        target = localBounds(group);
      placeAt(
        placed,
        parentId,
        target.x + (target.w - bounds.w) / 2,
        target.y + (target.h - bounds.h) / 2,
      );
      const above = group.map((n) => n.id);
      return commit(
        data,
        (list, wrap) => {
          const at = Math.max(...above.map((id) => subtreeEnd(list, id)));
          list.splice(at, 0, ...copies.map(wrap));
        },
        placed.map((p) => p.node.id),
      );
    }

    function pasteToReplace() {
      const data = c.getClipboard();
      if (!data) return false;
      const targets = c.topSelected().filter((n) => !n.locked);
      if (!targets.length) return false;
      const plans = targets.map((t) => {
        const { copies, placed } = materialize(data);
        placeAt(placed, t.parentId || null, Number(t.x) || 0, Number(t.y) || 0);
        return { id: t.id, copies, roots: placed.map((p) => p.node.id) };
      });
      return commit(
        data,
        (list, wrap) => {
          for (const plan of plans) {
            const removed = ed.descendants(plan.id),
              at = list.findIndex((n) => n.id === plan.id);
            list.splice(at, 0, ...plan.copies.map(wrap));
            for (let i = list.length - 1; i >= 0; i--)
              if (removed.has(list[i].id)) list.splice(i, 1);
          }
        },
        plans.flatMap((p) => p.roots),
      );
    }

    // ---------- Copy link / prompt ----------
    function documentName() {
      const library = window.fileLibrary,
        file = library?.list?.().find((f) => f.id === library.currentId);
      return ed.design.name || file?.name || "editor";
    }
    function linkTo(node) {
      let ref = node.id;
      try {
        ref =
          window.agentWorkspace?.searchElements?.(node.id)?.find((m) => m.id === node.id)
            ?.shortId || ref;
      } catch {}
      return `verynize://node/${encodeURIComponent(documentName())}/${encodeURIComponent(ed.page().id)}/${encodeURIComponent(ref)}`;
    }
    // Top-level selected layers in the order they were selected (Wonder lists a Shift-click selection that way).
    function inSelectionOrder() {
      const order = [...c.sel()];
      return c.topSelected().sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
    }
    function copyLink() {
      const tops = inSelectionOrder();
      if (!tops.length) return false;
      c.writeSystemClipboard(tops.map(linkTo).join("\n"));
      c.footer(
        tops.length === 1
          ? "Copied link to " + tops[0].name
          : `Copied links to ${tops.length} layers`,
      );
      return true;
    }
    // ---------- Copy as code / Copy prompt ----------
    // The clipboard form of the Code export: Tailwind TSX from the integrations codec with a "Made with Verynize"
    // comment (the layer links and the date), Google Fonts links and a box-sizing reset (Wonder P1-copy-code.txt).
    const today = () =>
      new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    async function snippet(nodes) {
      if (!window.verynizePlatform.can("codeExport")) return "";
      try {
        const result = await window.desktop.exportCode({
          flavor: "tailwind",
          document: structuredClone(ed.design),
          pageId: ed.page().id,
          nodeIds: nodes.map((n) => n.id),
          name: nodes[0].name,
          snippet: { links: nodes.map(linkTo), date: today() },
        });
        return String(result?.content || "").trim();
      } catch {
        return "";
      }
    }
    async function copyCode() {
      const tops = inSelectionOrder();
      if (!tops.length) return false;
      let code = await snippet(tops);
      if (!code) {
        // outside the desktop app: the HTML export of the selection
        try {
          code = (await ed.exportArtwork({ format: "HTML", selectionOnly: true })).content;
        } catch (error) {
          c.footer("Unable to copy as code: " + (error?.message || error));
          return false;
        }
      }
      c.writeSystemClipboard(code);
      c.footer("Copied selection as code");
      return true;
    }
    // A text prompt for a coding agent (Wonder P1-copy-prompt*.txt): the links and how to read them through the
    // Verynize MCP server, one inline snapshot block per selected layer, then how to turn the design into repo code.
    async function copyPrompt() {
      const tops = inSelectionOrder();
      if (!tops.length) return false;
      const captured = new Date().toISOString();
      const blocks = [];
      for (const n of tops) {
        const code = await snippet([n]);
        if (code) blocks.push("```tsx\n" + code + "\n```");
      }
      if (!blocks.length) {
        try {
          const html = (await ed.exportArtwork({ format: "HTML", selectionOnly: true })).content;
          if (html) blocks.push("```html\n" + html.trim() + "\n```");
        } catch {}
      }
      const prompt = [
        "Implement this Verynize design.",
        "",
        "Design to implement (each link ends in the Verynize page id and the element id: verynize://node/<document>/<pageId>/<elementId>):",
        ...tops.map((n) => "  " + linkTo(n)),
        "  Read each element through the Verynize MCP server: get_element_code with that pageId and element id (omit document to read the design open in Verynize), and get_design_context for its tokens and fonts.",
        '  (If you don\'t have the Verynize MCP installed yet, see "Run and configure" in docs/figcraft-reference.md of the Verynize repository: with the app open, connect to the url and token in ~/Library/Application Support/Verynize/mcp.json.)',
        ...(blocks.length
          ? ["", `Inline snapshot (fallback, captured at ${captured}):`, ...blocks]
          : []),
        "",
        "How to implement it:",
        "Treat the design as a picture of the result, not as source to paste in. Build each part from the component this repo already has for it; when the design needs something that component lacks, add a prop or variant to it (or wrap it) rather than making a copy, and only write a new component when nothing in the repo fits, saying that you did. Swap the snapshot's hex colours, pixel sizes and arbitrary values for the repo's own tokens, utilities and icons wherever one exists. Keep to the repo's conventions for files, props, state and data. When you are done, compare what you built with the design.",
      ].join("\n");
      c.writeSystemClipboard(prompt);
      c.footer("Prompt copied to clipboard");
      return true;
    }

    // ---------- Registry ----------
    const canPaste = () => hasClipboard();
    for (const command of [
      { id: "edit.duplicate", run: duplicate },
      { id: "edit.pasteInPlace", keys: [] }, // ⌘⇧V is Paste over selection (Wonder)
      { id: "edit.copyStyle", label: "Copy styles", keys: ["mod+alt+c"] },
      { id: "edit.pasteStyle", label: "Paste styles", keys: ["mod+alt+v"] },
      { id: "edit.copyCode", label: "Copy as code", keys: ["mod+shift+c"], run: copyCode },
      // ⌘V stays the native paste event (canvas-interactions); runCommand('edit.paste', {menu: true}) is menu Paste.
      { id: "edit.paste", run: (arg) => (arg?.menu ? menuPaste() : c.paste(c.getClipboard())) },
      {
        id: "clipboard.pasteHere",
        label: "Paste here",
        section: "Edit",
        keys: [],
        when: canPaste,
        run: pasteHere,
      },
      {
        id: "clipboard.pasteToReplace",
        label: "Paste to replace",
        section: "Edit",
        keys: ["mod+shift+r"],
        when: () => canPaste() && needsSelection(),
        run: pasteToReplace,
      },
      {
        id: "clipboard.pasteOverSelection",
        label: "Paste over selection",
        section: "Edit",
        keys: ["mod+shift+v"],
        when: canPaste,
        run: pasteOverSelection,
      },
      {
        id: "clipboard.copyLink",
        label: "Copy link to selection",
        section: "Edit",
        keys: [],
        when: needsSelection,
        run: copyLink,
      },
      {
        id: "clipboard.copyPrompt",
        label: "Copy prompt",
        section: "Edit",
        keys: ["mod+alt+shift+c"],
        when: needsSelection,
        run: copyPrompt,
      },
    ])
      c.register(command);
  }

  window.BetterCanvas?.extend(extend);
  window.VerynizeClipboard = { nextName };
})();
