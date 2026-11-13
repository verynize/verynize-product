#!/usr/bin/env node
// Verynize MCP server over stdio.
//
//   node integrations/mcp-server.mjs [--root DIR] [--bridge-file FILE] [--no-bridge]
//
// When the desktop app is running it publishes a loopback bridge ({url, token} in
// "<user data>/Verynize/mcp.json", or $VERYNIZE_MCP_FILE). This server then proxies every
// tool call to that bridge so edits appear live in the open editor. Without the app it edits
// NAME.verynize.json files under --root directly. The tool set is identical in both modes
// (see integrations/design-tools.mjs).
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { DesignStore } from "./design-store.mjs";
import {
  INSTRUCTIONS,
  SERVER_NAME,
  SERVER_VERSION,
  TOOLS_VERSION,
  createStoreBackend,
  registerDesignTools,
  runTool,
} from "./design-tools.mjs";
import { connectBridge, defaultBridgeFile, readBridgeFile } from "./mcp-http.mjs";

const argv = process.argv.slice(2);
const option = (flag) => {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
};
const usage =
  "Usage: node integrations/mcp-server.mjs [--root /absolute/existing/design-directory] [--bridge-file FILE] [--no-bridge]\nStart the Verynize desktop app for live editing, or pass --root to edit files on disk.";
if (argv.includes("--help")) {
  console.error(usage);
  process.exit(0);
}
if (argv.includes("--root") && !option("--root")) {
  console.error(usage);
  process.exit(1);
}

const root = option("--root");
const store = root
  ? await DesignStore.open(root).catch((error) => {
      console.error(error.message);
      process.exit(1);
    })
  : null;
const storeBackend = store ? createStoreBackend(store) : null;

let bridge = null;
if (!argv.includes("--no-bridge")) {
  const info = await readBridgeFile(option("--bridge-file") || defaultBridgeFile());
  if (info) bridge = await connectBridge(info).catch(() => null);
}
if (!bridge && !storeBackend) {
  console.error("Verynize desktop app is not running and no --root was given.\n" + usage);
  process.exit(1);
}

const mode = bridge
  ? "Connected to the running Verynize desktop app: edits to the open document are live and undoable."
  : `Headless mode: editing documents stored in ${store.root}. Edits are written to disk; an open editor picks them up when it reloads the file.`;
const server = new McpServer(
  { name: SERVER_NAME, version: SERVER_VERSION },
  {
    instructions: `${INSTRUCTIONS}\n\n${mode}${bridge ? "" : " ask_agent and the running-app, terminal and execute_action tools are unavailable here (they need the desktop app)."} Tools version ${TOOLS_VERSION}.`,
  },
);

const forward = async (name, args) => {
  if (bridge) {
    try {
      return await bridge.callTool({ name, arguments: args });
    } catch (error) {
      // A protocol-level error (bad args) is a real answer; only connection failures fall back.
      const lost =
        /fetch failed|ECONNREFUSED|ECONNRESET|socket hang up|other side closed|terminated|network/i.test(
          `${error?.message} ${error?.cause?.code || ""} ${error?.cause?.message || ""}`,
        );
      if (!lost) throw error;
      await bridge.close().catch(() => {});
      bridge = null;
      if (!storeBackend)
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: "The Verynize desktop app stopped responding. Restart it, or run this server with --root to edit files on disk.",
            },
          ],
        };
    }
  }
  return runTool(storeBackend, name, args);
};
registerDesignTools(server, { forward });
await server.connect(new StdioServerTransport());
