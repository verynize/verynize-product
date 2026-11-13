// Electron main for tests/web-platform.cjs when no standalone Chromium is installed: one window with no preload
// (contextIsolation, no node integration), so the page sees a plain browser without window.desktop.
const { app, BrowserWindow } = require("electron");

void app.whenReady().then(() => {
  const win = new BrowserWindow({
    width: 1440,
    height: 870,
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  void win.loadURL(process.env.VERYNIZE_PLAIN_URL);
});
app.on("window-all-closed", () => app.quit());
