// Minimal Electron entry for the renderer prototypes: one 1440×900 window on BENCH_URL.
// Vsync and the frame-rate cap are off so rAF deltas measure real frame cost; occluded/background throttling is off
// because other windows may cover the benchmark window.
const { app, BrowserWindow } = require("electron");
// BENCH_VSYNC=1 keeps vsync (frame deltas then saturate at the display refresh).
const uncapped =
  process.env.BENCH_VSYNC === "1" ? [] : ["disable-gpu-vsync", "disable-frame-rate-limit"];
for (const s of [
  ...uncapped,
  "enable-precise-memory-info",
  "disable-renderer-backgrounding",
  "disable-backgrounding-occluded-windows",
  "disable-background-timer-throttling",
])
  app.commandLine.appendSwitch(s);
app.commandLine.appendSwitch("js-flags", "--expose-gc");
void app.whenReady().then(() => {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    useContentSize: true,
    show: true,
    x: 0,
    y: 0,
    webPreferences: { backgroundThrottling: false, contextIsolation: true, sandbox: true },
  });
  void win.loadURL(process.env.BENCH_URL);
});
app.on("window-all-closed", () => app.quit());
