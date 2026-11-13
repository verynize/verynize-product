// Emit the strictly checked integration subset for runtimes that do not strip TypeScript (Electron).
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
execFileSync(
  process.execPath,
  ["node_modules/typescript/bin/tsc", "-p", "tsconfig.integrations-build.json"],
  { cwd: root, stdio: "inherit" },
);
