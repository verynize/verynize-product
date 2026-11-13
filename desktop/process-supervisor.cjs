// Keep preview/terminal process groups tied to the editor, including abrupt editor exits.
const { spawn } = require("node:child_process");
const [parentId, program, ...args] = process.argv.slice(2);
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  try {
    if (process.platform === "win32") child.kill("SIGTERM");
    else process.kill(-process.pid, "SIGTERM");
  } catch {}
  setTimeout(() => {
    try {
      if (process.platform === "win32") child.kill("SIGKILL");
      else process.kill(-process.pid, "SIGKILL");
    } catch {}
    process.exit(1);
  }, 1000);
}
const child = spawn(program, args, {
  env,
  stdio: ["ignore", "inherit", "inherit"],
  windowsHide: true,
});
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
const monitor = setInterval(() => {
  if (process.ppid !== Number(parentId)) stop();
}, 500);
child.on("error", (error) => {
  console.error(error.message);
  clearInterval(monitor);
  process.exit(1);
});
child.on("exit", (code, signal) => {
  clearInterval(monitor);
  process.exit(code ?? (signal ? 1 : 0));
});
