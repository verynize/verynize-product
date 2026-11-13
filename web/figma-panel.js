// Figma import (Insert › Import Figma, Settings › Connections › Figma). The dialog (file, link, account) is rendered by
// the settings island (web/src/islands/settings/figma-dialog.tsx); this script keeps the command and the canvas paths:
//   - Paste: copying layers in Figma puts a binary scene into text/html; the canvas paste handler asks
//     window.figmaPaste to convert it (main process) and pastes the result like in-app layers.
//   - Drop: a .fig file dropped on the canvas imports as a new document.
//     .pen accepts the documented unencrypted JSON subset; encrypted/binary formats are refused.
(() => {
  const desktop = () => window.desktop;
  // The command behind Insert › Import Figma and Settings › Connections › Figma (the chrome island takes it over);
  // the dialog itself is the settings island's (web/src/islands/settings/figma-dialog.tsx).
  const button = document.createElement("button");
  button.id = "figma-import";
  button.textContent = "Import Figma";
  document.querySelector("#image").parentElement.after(button);
  button.onclick = () => window.dispatchEvent(new CustomEvent("bd:open-figma"));
  const footer = (message) => {
    const f = document.querySelector("#workspace footer") || document.querySelector("footer");
    if (f) f.textContent = message;
  };

  async function openDocument(document) {
    if (window.fileLibrary?.createFromDocument) {
      await window.fileLibrary.createFromDocument(document);
      return true;
    }
    if (
      !window.confirm(
        "Replace the current design with the Figma import? Save current work first if needed.",
      )
    )
      return false;
    await window.documentLifecycle?.prepareSwitch();
    window.design.setDocument(document);
    return true;
  }

  // ---------- drop a .fig / .pen file on the canvas ----------
  const FILE = /\.(fig|pen)$/i,
    MAX = 200 * 1024 * 1024;
  const overCanvas = (e) => !!e.target?.closest?.("#workspace");
  window.addEventListener("dragover", (e) => {
    if (
      e.defaultPrevented ||
      !overCanvas(e) ||
      ![...(e.dataTransfer?.types || [])].includes("Files")
    )
      return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  });
  window.addEventListener("drop", async (e) => {
    if (e.defaultPrevented || !overCanvas(e)) return;
    const file = [...(e.dataTransfer?.files || [])].find((f) => FILE.test(f.name));
    if (![...(e.dataTransfer?.types || [])].includes("Files")) return;
    e.preventDefault(); // never let the window navigate to a dropped file
    if (!file) return;
    if (!window.verynizePlatform.can("figma")) {
      footer("Open the desktop app to import Figma files.");
      return;
    }
    const limit = /\.pen$/i.test(file.name) ? 5_000_000 : MAX;
    if (file.size > limit) {
      footer(`File exceeds limit ${limit} bytes.`);
      return;
    }
    footer(`Importing ${file.name}…`);
    try {
      const result = await desktop().figmaFile({
        name: file.name,
        bytes: new Uint8Array(await file.arrayBuffer()),
      });
      if (await openDocument(result.document)) {
        footer(
          `Imported ${file.name}${result.warnings.length ? ` · ${result.warnings.length} note${result.warnings.length === 1 ? "" : "s"}` : ""}`,
        );
        window.figmaPaste.lastWarnings = result.warnings;
      }
    } catch (error) {
      footer(error.message);
      window.figmaPaste.lastError = error.message;
    }
  });

  // ---------- clipboard (called by the canvas paste handler) ----------
  window.figmaPaste = {
    lastWarnings: [],
    lastError: "",
    accepts: (html) =>
      typeof html === "string" && html.includes("(figma)") && html.includes("(/figma)"),
    async convert(html) {
      this.lastError = "";
      if (!window.verynizePlatform.can("figma")) {
        footer("Open the desktop app to paste Figma layers.");
        return null;
      }
      footer("Converting Figma layers…");
      try {
        const { warnings, ...data } = await desktop().figmaClipboard(html);
        this.lastWarnings = warnings;
        footer(
          `Pasted ${data.nodes.length} Figma layer${data.nodes.length === 1 ? "" : "s"}${warnings.length ? ` · ${warnings.length} note${warnings.length === 1 ? "" : "s"}: ${warnings[0]}` : ""}`,
        );
        return data;
      } catch (error) {
        this.lastError = error.message;
        footer(error.message);
        return null;
      }
    },
  };
})();
