// Resources the shared design engine (integrations/*.mjs) reads from node_modules on a file system.
// The Worker has none, so they are bundled here and handed over before the engine loads: the Worker
// entry (cloud/worker.js) imports this module first. Icon sets are large and load on first use (loadIconSets).
import theme from "tailwindcss/theme.css?raw";

globalThis.__verynizeTailwindTheme = theme;

let icons;
/** The Iconify sets of integrations/assets.mjs ({lucide, ph, tabler}), parsed once per isolate. */
export function loadIconSets() {
  icons ||= Promise.all([
    import("@iconify-json/lucide/icons.json"),
    import("@iconify-json/ph/icons.json"),
    import("@iconify-json/tabler/icons.json"),
  ]).then(([lucide, ph, tabler]) => ({
    lucide: lucide.default,
    ph: ph.default,
    tabler: tabler.default,
  }));
  return icons;
}
