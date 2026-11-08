/**
 * Passkey window for cloud accounts (desktop main process).
 * The renderer runs from app://verynize, which is not the server's origin (WebAuthn relying party), so the ceremony runs
 * in a small window on the cloud server's own /passkey page. That window has no preload, an
 * in-memory session, sandboxing, and cannot navigate away from the server origin or open popups.
 *
 *   cloudPasskeyOpen({url})  -> {opened:true}   url must be <http(s) origin>/passkey#…
 *   cloudPasskeyClose()      -> {closed}
 */
const { BrowserWindow } = require("electron");

function registerCloudPasskey(handle, parent) {
  let child = null;
  const close = () => {
    const open = child && !child.isDestroyed();
    if (open) child.close();
    child = null;
    return { closed: !!open };
  };
  handle("cloudPasskeyOpen", (options = {}) => {
    const url = new URL(String(options.url || ""));
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.pathname !== "/passkey"
    )
      throw Error("Invalid passkey page");
    close();
    child = new BrowserWindow({
      parent,
      modal: false,
      width: 440,
      height: 520,
      resizable: false,
      minimizable: false,
      title: "Verynize passkey",
      backgroundColor: "#141416",
      webPreferences: {
        partition: "verynize-passkey",
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    const origin = url.origin;
    child.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    child.webContents.on("will-navigate", (event, target) => {
      try {
        if (new URL(target).origin !== origin) event.preventDefault();
      } catch {
        event.preventDefault();
      }
    });
    child.on("closed", () => {
      child = null;
    });
    void child.loadURL(url.href);
    return { opened: true };
  });
  handle("cloudPasskeyClose", close);
  parent.on("closed", close);
}

module.exports = { registerCloudPasskey };
