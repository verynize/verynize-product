const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
const directory = path.join(os.homedir(), "Library/Logs/DiagnosticReports");
function reports() {
  if (process.platform !== "darwin" || !fs.existsSync(directory)) return [];
  return fs.readdirSync(directory).filter((name) => /^Electron-.*\.ips$/.test(name));
}
exports.crashGuard = () => {
  const before = new Set(reports());
  return () =>
    assert.deepEqual(
      reports().filter((name) => !before.has(name)),
      [],
      "no new Electron crash reports",
    );
};
