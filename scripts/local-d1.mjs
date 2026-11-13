// Use exactly the dev server's state directory: cf's default is a different, shared directory.
// This hook also covers verification scripts that launch `vp dev` directly.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";

export const localStatePath = resolve(process.env.VERYNIZE_CF_STATE || ".cloudflare/state");
/** @returns {import("vite").Plugin} */
export function localD1Migrations() {
  return {
    name: "verynize-local-d1-migrations",
    apply: "serve",
    async config() {
      const { stdout } = await promisify(execFile)(process.execPath, [
        new URL("./db-migrate.mjs", import.meta.url).pathname,
        "--local",
        "--persist-to",
        localStatePath,
      ]);
      if (stdout.trim()) console.info(stdout.trim());
    },
  };
}
