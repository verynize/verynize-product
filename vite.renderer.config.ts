// Builds one React "island" per run into web/dist/<island>.{js,css} as a classic IIFE script,
// so the Electron renderer can load it over file:// next to the legacy scripts.
// Usage: ISLAND=ui vp build -c vite.renderer.config.ts builds the combined bundle (`npm run build:ui`);
// ISLAND=<area> builds one island alone for development. ISLAND=telemetry builds web/src/telemetry.ts, the crash-report
// bootstrap web/index.html loads before every legacy script (`npm run build:ui` builds it with ui).
// Source maps: none, unless a release build (VERYNIZE_RELEASE_BUILD=1 from scripts/env.mjs) has SENTRY_AUTH_TOKEN; then hidden maps are uploaded to verynize-desktop and deleted,
// so web/dist (served by app://verynize and copied into the packaged app) never contains a .map file.
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite-plus";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { readFileSync } from "node:fs";
import { releaseBuild, sourceMapUpload } from "./web-start/build/telemetry.mjs";

const island = process.env.ISLAND;
if (!island) throw new Error("Set ISLAND=<name> (see web/src/islands)");
const entries: Record<string, string> = {
  ui: "./web/src/ui.tsx",
  telemetry: "./web/src/telemetry.ts",
};
const { version } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));
const upload = releaseBuild() && !!process.env.SENTRY_AUTH_TOKEN;

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    ...sourceMapUpload({
      projects: ["verynize-desktop"],
      release: `verynize-desktop@${version}`,
      deleteGlobs: ["web/dist/**/*.map"],
    }),
  ],
  publicDir: false,
  resolve: { alias: { "@": fileURLToPath(new URL("./web/src", import.meta.url)) } },
  define: { "process.env.NODE_ENV": JSON.stringify(process.env.NODE_ENV || "production") },
  build: {
    outDir: "web/dist",
    emptyOutDir: false,
    sourcemap: upload ? "hidden" : false,
    minify: process.env.NODE_ENV !== "development",
    lib: {
      entry: fileURLToPath(
        new URL(entries[island] ?? `./web/src/islands/${island}.tsx`, import.meta.url),
      ),
      formats: ["iife"],
      name: `BdIsland_${island.replace(/\W/g, "_")}`,
      fileName: () => `${island}.js`,
      cssFileName: island,
    },
  },
});
