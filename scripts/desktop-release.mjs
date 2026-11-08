import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

export function releaseName(version, arch) {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version))
    throw new Error("Invalid package version");
  if (!["arm64", "x64"].includes(arch)) throw new Error("Unsupported macOS architecture");
  return `Verynize-${version}-macos-${arch}.zip`;
}

export function validateReleaseTag(tag, version) {
  releaseName(version, "arm64");
  const prefix = `desktop-v${version}-alpha.`;
  if (!tag.startsWith(prefix) || !/^[1-9]\d*$/.test(tag.slice(prefix.length)))
    throw new Error(`Release tag must be ${prefix}<positive integer>`);
  return tag;
}

export async function checksum(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

async function main() {
  const { version } = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"));
  if (process.argv[2] === "--validate-tag") {
    console.log(validateReleaseTag(process.argv[3] || "", version));
    return;
  }
  if (process.platform !== "darwin") throw new Error("Archive desktop releases on macOS");
  const name = releaseName(version, process.arch);
  const app = path.join(root, "dist/Verynize.app");
  const bundled = JSON.parse(
    await fs.readFile(path.join(app, "Contents/Resources/app/package.json"), "utf8"),
  );
  if (bundled.version !== version)
    throw new Error("Packaged version is stale; run npm run package:mac -- --replace");
  for (const asset of ["ui.js", "ui.css", "telemetry.js"])
    await fs.access(path.join(app, "Contents/Resources/app/web/dist", asset));
  execFileSync("/usr/bin/codesign", ["--verify", "--deep", "--strict", app], { stdio: "inherit" });
  execFileSync("/usr/bin/lipo", [
    "-verify_arch",
    process.arch === "x64" ? "x86_64" : "arm64",
    path.join(app, "Contents/MacOS/Electron"),
  ]);
  const out = path.join(root, "dist/releases");
  await fs.mkdir(out, { recursive: true });
  const archive = path.join(out, name);
  // ditto preserves framework symlinks and executable modes inside the .app bundle.
  await fs.rm(archive, { force: true });
  execFileSync("/usr/bin/ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", app, archive]);
  const sha256 = await checksum(archive);
  const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  const metadata = {
    version,
    channel: "alpha",
    platform: "darwin",
    arch: process.arch,
    file: name,
    sha256,
    bytes: (await fs.stat(archive)).size,
    commit,
    sourceDirty:
      execFileSync("git", ["status", "--porcelain", "--untracked-files=normal"], {
        cwd: root,
        encoding: "utf8",
      }).trim().length > 0,
    signing: "ad-hoc",
    notarized: false,
  };
  await fs.writeFile(`${archive}.sha256`, `${sha256}  ${name}\n`);
  await fs.writeFile(`${archive}.json`, `${JSON.stringify(metadata, null, 2)}\n`);
  console.log(archive);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
