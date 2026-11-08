const {onWindowClosed}=require('./window-cleanup.cjs');
/**
 * Native side of Settings › Preferences (desktop main process)
 * ============================================================
 * - Custom notification sound: the user picks an MP3; it is copied to `userData/sounds/custom.mp3` and read back
 *   by the renderer to play when a chat finishes.
 * - Design links: `verynize://` URLs (`open-url` on macOS, argv on other platforms) are queued until the renderer
 *   is ready, then sent as `desktop:open-link`. The renderer turns the OS registration on or off
 *   (`app.setAsDefaultProtocolClient`) from the "Open Verynize links in the desktop app" preference. Unpackaged
 *   development builds only register when VERYNIZE_REGISTER_PROTOCOL=1, so test runs never claim the scheme.
 * - Line counts per worktree for the Code sidebar: uncommitted +/− totals (git-changes.cjs summary) for registered
 *   repository roots and chat worktrees only.
 *
 *   attachDeepLinks(app)                                  before app ready (cold-start open-url)
 *   registerAppPreferences(handle, win, {app, dialog, registry, userData})
 *     soundChoose()            -> {name, size} | null      native picker, MP3 only, up to 8 MB
 *     soundRead()              -> Uint8Array | null
 *     soundClear()             -> true
 *     linksReady({enabled})    -> {enabled, registered, reason?, pending:[url]}   (pending links drained)
 *     linksSetEnabled(enabled) -> {enabled, registered, reason?}
 *     worktreeLineStats(roots) -> {[root]: {added, removed, files} | {error}}
 */
const fs = require('node:fs/promises');
const path = require('node:path');

const SCHEME = 'verynize';
const MAX_SOUND = 8 * 1024 * 1024;
const MAX_LINK = 4096;
const MAX_PENDING = 20;

const pending = [];
const ready = new Set(); // windows whose renderer asked for links
let linksEnabled = true;
let appRef = null;

const isLink = value => typeof value === 'string' && value.length <= MAX_LINK && value.toLowerCase().startsWith(SCHEME + '://');
const linkFromArgv = argv => (Array.isArray(argv) ? argv.find(isLink) : null) || null;

function deliver(url) {
  if (!isLink(url)) return false;
  const win = [...ready].find(w => !w.isDestroyed());
  if (!win) {
    if (pending.length < MAX_PENDING) pending.push(url);
    return false;
  }
  if (!linksEnabled) return false;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  win.webContents.send('desktop:open-link', url);
  return true;
}

/** Call once, before `app.whenReady()`: macOS delivers a cold-start link through `open-url` before ready. */
function attachDeepLinks(app) {
  appRef = app;
  app.on('open-url', (event, url) => { event.preventDefault(); deliver(url); });
  const initial = linkFromArgv(process.argv.slice(1));
  if (initial) pending.push(initial);
}

// Unpackaged runs (`electron .`) must pass the app path so the OS relaunches this checkout.
const clientArgs = () => (process.defaultApp && process.argv[1] ? [process.execPath, [path.resolve(process.argv[1])]] : []);

function setProtocol(enabled) {
  linksEnabled = enabled !== false;
  const app = appRef;
  if (!app) return { enabled: linksEnabled, registered: false, reason: 'unavailable' };
  if (!app.isPackaged && process.env.VERYNIZE_REGISTER_PROTOCOL !== '1') return { enabled: linksEnabled, registered: false, reason: 'development' };
  try {
    if (linksEnabled) app.setAsDefaultProtocolClient(SCHEME, ...clientArgs());
    else if (app.isDefaultProtocolClient(SCHEME, ...clientArgs())) app.removeAsDefaultProtocolClient(SCHEME, ...clientArgs());
    return { enabled: linksEnabled, registered: app.isDefaultProtocolClient(SCHEME, ...clientArgs()) };
  } catch (error) {
    return { enabled: linksEnabled, registered: false, reason: String(error.message || error) };
  }
}

/** MP3 = an ID3v2 tag or an MPEG audio frame sync. */
const looksLikeMp3 = bytes => bytes.length >= 3 && ((bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0));

function registerAppPreferences(handle, win, { app, dialog, registry, userData }) {
  if (!appRef) appRef = app;
  const soundFile = path.join(userData, 'sounds', 'custom.mp3');
  onWindowClosed(win, () => ready.delete(win));

  handle('soundChoose', async () => {
    const result = await dialog.showOpenDialog(win, { title: 'Choose an MP3 file', properties: ['openFile'], filters: [{ name: 'MP3 audio', extensions: ['mp3'] }] });
    if (result.canceled || !result.filePaths?.[0]) return null;
    const source = result.filePaths[0];
    const stat = await fs.stat(source);
    if (!stat.isFile()) throw Error('Choose an MP3 file');
    if (stat.size > MAX_SOUND) throw Error('Choose an MP3 under 8 MB');
    const data = await fs.readFile(source);
    if (!looksLikeMp3(data)) throw Error('That file is not an MP3');
    await fs.mkdir(path.dirname(soundFile), { recursive: true });
    await fs.writeFile(soundFile, data);
    return { name: path.basename(source).slice(0, 120), size: data.length };
  });
  handle('soundRead', async () => {
    try { return new Uint8Array(await fs.readFile(soundFile)); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  });
  handle('soundClear', async () => { await fs.rm(soundFile, { force: true }); return true; });

  handle('linksReady', options => {
    const status = setProtocol(options?.enabled !== false);
    ready.add(win);
    const drained = pending.splice(0);
    return { ...status, pending: status.enabled ? drained : [] };
  });
  handle('linksSetEnabled', enabled => setProtocol(enabled !== false));

  handle('worktreeLineStats', async roots => {
    if (!Array.isArray(roots)) throw Error('Invalid worktree list');
    const { GitChanges } = require('./git-changes.cjs');
    const out = {};
    for (const root of [...new Set(roots)].slice(0, 100)) {
      if (typeof root !== 'string') continue;
      try {
        const resolved = await registry.resolveRoot(root);
        const { totals } = await new GitChanges(resolved.root).summary();
        out[root] = { added: totals.added, removed: totals.removed, files: totals.files };
      } catch (error) {
        out[root] = { error: String(error.message || error).slice(0, 200) };
      }
    }
    return out;
  });
}

// Read without draining: a queued OS link is an explicit editor launch.
const hasPendingLinks = () => pending.length > 0;

module.exports = {
  hasPendingLinks,
  attachDeepLinks,
  registerAppPreferences,
  looksLikeMp3,
  linkFromArgv,
  SCHEME,
};
