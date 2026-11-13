// System Codex login only: never use the SIWC profile or transport credentials.
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { spawn } = require("node:child_process");
const { JsonRpcChild } = require("./agent-runtime.cjs");
const agents = require("./agents.cjs");
const SIGN_IN = "Sign in to Codex on this computer with ChatGPT to generate images";
const config = ["-c", "features.image_generation=true", "-c", "features.shell_tool=false"];
function environment() {
  const env = agents.childEnv();
  delete env.CODEX_API_KEY;
  delete env.OPENAI_API_KEY;
  return env;
}
async function connect(executable) {
  const rpc = new JsonRpcChild(
    spawn(executable, ["app-server", ...config], {
      env: environment(),
      stdio: ["pipe", "pipe", "pipe"],
      detached: process.platform !== "win32",
    }),
  );
  try {
    await rpc.request(
      "initialize",
      {
        clientInfo: { name: "verynize_images", version: "1" },
        capabilities: { experimentalApi: true },
      },
      10000,
    );
    rpc.notify("initialized");
    return rpc;
  } catch (error) {
    rpc.close();
    throw error;
  }
}
async function executablePath() {
  return (await agents.discover()).find((a) => a.id === "codex" && a.available)?.path;
}
async function signedIn(rpc) {
  const result = await rpc.request("account/read", { refreshToken: false }, 10000);
  return result.account?.type === "chatgpt";
}
// Each check spawns an app-server, so settings reads share one answer until it expires or the
// Codex login changes.
const STATUS_TTL = 60000;
let cached = null;
require("./agent-auth.cjs").onAccountChange(({ agent }) => {
  if (agent === "codex") cached = null;
});
function status() {
  if (cached && Date.now() - cached.at < STATUS_TTL) return cached.promise;
  const promise = checkStatus();
  cached = { at: Date.now(), promise };
  promise.then(
    (result) => {
      if (!result.available && cached?.promise === promise)
        cached.at = Date.now() - STATUS_TTL + 5000;
    },
    () => {
      if (cached?.promise === promise) cached = null;
    },
  );
  return promise;
}
async function checkStatus() {
  const executable = await executablePath();
  if (!executable) return { available: false, status: "Codex not installed" };
  let rpc;
  try {
    rpc = await connect(executable);
    const available = await signedIn(rpc);
    return { available, status: available ? "Connected" : "Sign in needed" };
  } catch {
    return { available: false, status: "Sign in needed" };
  } finally {
    rpc?.close();
  }
}
async function readImage(file) {
  const stat = await fs.stat(file);
  if (!stat.isFile() || stat.size > 8000000)
    throw Error("Generated image exceeds 8 MB or is not a file");
  return fs.readFile(file);
}
async function scan(threadId) {
  if (!threadId || !/^[\w-]+$/.test(threadId)) throw Error("Codex did not return an image thread");
  const dir = path.join(
    process.env.CODEX_HOME || path.join(os.homedir(), ".codex"),
    "generated_images",
    threadId,
  );
  const names = (await fs.readdir(dir).catch(() => []))
    .filter((n) => /\.(png|jpe?g|webp)$/i.test(n))
    .sort();
  if (!names.length)
    throw Error(
      "Codex did not return an image. Check that your ChatGPT plan supports image generation.",
    );
  return readImage(path.join(dir, names[0]));
}
async function execFallback(executable, cwd, prompt, signal) {
  // Older CLIs cannot answer account/read; login status must positively identify ChatGPT.
  const { bounded, COMMANDS } = require("./agent-auth.cjs");
  const login = await bounded(executable, COMMANDS.codex.status, spawn, environment());
  if (login.code !== 0 || !/ChatGPT/i.test(login.output)) throw Error(SIGN_IN);
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(
      executable,
      [
        "exec",
        "--json",
        "--skip-git-repo-check",
        "--sandbox",
        "read-only",
        ...config,
        "-c",
        'approval_policy="never"',
        "-",
      ],
      {
        cwd,
        env: environment(),
        stdio: ["pipe", "pipe", "pipe"],
        detached: process.platform !== "win32",
      },
    );
    let buffer = "",
      threadId;
    const cancel = () => {
      agents.killTree(child);
      reject(Error("Image generation canceled"));
    };
    signal.addEventListener("abort", cancel, { once: true });
    child.stdout.on("data", (data) => {
      buffer += data;
      let end;
      while ((end = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 1);
        try {
          const event = JSON.parse(line);
          if (event.type === "thread.started") threadId = event.thread_id;
        } catch {}
      }
      if (buffer.length > 16000000) buffer = "";
    });
    child.stderr.resume();
    child.stdin.on("error", () => {});
    child.on("error", reject);
    child.on("close", (code) => {
      signal.removeEventListener("abort", cancel);
      if (signal.aborted) return;
      if (code !== 0)
        reject(Error("Codex image generation failed. Check your Codex login and plan."));
      else scan(threadId).then(resolve, reject);
    });
    child.stdin.end(prompt);
  });
}
async function generate({ prompt, size = "1024x1024", signal, executable, tempRoot }) {
  executable ||= await executablePath();
  if (!executable)
    throw Error("Install Codex and sign in with ChatGPT on this computer to generate images");
  const timeout = AbortSignal.timeout(120000);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const root = tempRoot || path.join(os.homedir(), ".cache", "verynize", "image-workdirs");
  await fs.mkdir(root, { recursive: true });
  const cwd = await fs.mkdtemp(path.join(root, "image-"));
  let rpc, threadId, turnId;
  const instructions =
    "Generate exactly one image with the built-in image generation tool. No shell commands, no file writes. ";
  const text = `${instructions}Target aspect ratio ${size.replace("x", ":")}. Request: ${prompt}`;
  try {
    combined.throwIfAborted();
    try {
      rpc = await connect(executable);
    } catch (error) {
      // Fall back only for CLIs that explicitly lack app-server, never retry a submitted turn.
      if (!/unrecognized subcommand|unknown.*app-server|unexpected argument/i.test(error.message))
        throw Error("Update Codex to use image generation");
      return await execFallback(executable, cwd, text, combined);
    }
    if (!(await signedIn(rpc))) {
      cached = null;
      throw Error(SIGN_IN);
    }
    combined.throwIfAborted();
    const started = await rpc.request("thread/start", {
      cwd,
      sandbox: "read-only",
      approvalPolicy: "never",
      ephemeral: true,
      config: { "features.image_generation": true, "features.shell_tool": false },
      developerInstructions: instructions,
    });
    threadId = started.thread.id;
    return await new Promise((resolve, reject) => {
      let item,
        finished = false;
      const finish = async (error) => {
        if (finished) return;
        if (combined.aborted)
          error = Error(
            timeout.aborted ? "Image generation timed out" : "Image generation canceled",
          );
        finished = true;
        off();
        combined.removeEventListener("abort", cancel);
        if (error) {
          reject(error);
          return;
        }
        try {
          if (item?.failure || (item && item.status !== "completed"))
            throw Error("Codex could not generate this image");
          if (item?.result) {
            if (item.result.length > 11000000) throw Error("Generated image exceeds 8 MB");
            resolve(Buffer.from(item.result, "base64"));
          } else if (item?.savedPath) resolve(await readImage(item.savedPath));
          else {
            try {
              resolve(await scan(threadId));
            } catch (error) {
              if (item?.fileId)
                throw Error(
                  "Codex returned a stored image attachment that this CLI cannot download. Update Codex and retry.",
                );
              throw error;
            }
          }
        } catch (error) {
          reject(error);
        }
      };
      const cancel = async () => {
        if (turnId) await rpc.request("turn/interrupt", { threadId, turnId }, 1000).catch(() => {});
        void finish(
          Error(timeout.aborted ? "Image generation timed out" : "Image generation canceled"),
        );
      };
      const off = rpc.on(({ method, params }) => {
        if (method === "$exit") {
          void finish(Error("Codex image session closed"));
          return;
        }
        if (params?.threadId !== threadId) return;
        if (method === "turn/started") {
          turnId = params.turn.id;
          if (combined.aborted) void cancel();
        }
        if (method === "item/completed" && params.item?.type === "imageGeneration")
          item = params.item;
        if (method === "turn/completed")
          void finish(
            params.turn.status === "completed" ? null : Error("Codex image generation failed"),
          );
      });
      combined.addEventListener("abort", cancel, { once: true });
      if (combined.aborted) {
        void cancel();
        return;
      }
      rpc
        .request("turn/start", { threadId, input: [{ type: "text", text, text_elements: [] }] })
        .then(
          (result) => {
            turnId = result.turn.id;
            if (combined.aborted) void cancel();
          },
          (error) => void finish(error),
        );
    });
  } catch (error) {
    if (combined.aborted)
      throw Error(timeout.aborted ? "Image generation timed out" : "Image generation canceled");
    throw error;
  } finally {
    rpc?.close();
    await fs.rm(cwd, { recursive: true, force: true });
  }
}
module.exports = { generate, status };
