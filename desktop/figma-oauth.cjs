// Figma account connection (OAuth 2 authorization code + PKCE, desktop main process).
//
//   connect()     opens the browser at the authorization page with an S256 code challenge and a random state,
//                 receives the code on a loopback redirect (http://127.0.0.1:<port>/figma/callback), exchanges
//                 it with the code verifier, and stores the tokens encrypted with Electron safeStorage.
//   accessToken() returns a valid access token, refreshing it first when it expires within a minute.
//   disconnect()  forgets tokens (and any pending authorization); the client ID setting is kept.
//
// The client ID (and an optional client secret, needed by apps that are not registered as public clients)
// come from the user's own Figma OAuth app; Figma requires the exact redirect URI to be registered, so the
// loopback port is a setting. Secrets never leave the main process: the renderer only sees status.
// Endpoints default to Figma's; VERYNIZE_FIGMA_OAUTH_ORIGIN (loopback http only) points them at a local
// fixture server for tests.
const { isEncryptionAvailable } = require("./secure-storage.cjs");
const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");

const DEFAULT_PORT = 47615;
const CALLBACK = "/figma/callback";
const SCOPE = "file_content:read";
const FIGMA = {
  authorize: "https://www.figma.com/oauth",
  token: "https://api.figma.com/v1/oauth/token",
  refresh: "https://api.figma.com/v1/oauth/refresh",
};
const base64url = (buf) =>
  Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

function endpoints(origin = process.env.VERYNIZE_FIGMA_OAUTH_ORIGIN) {
  if (!origin) return FIGMA;
  const url = new URL(origin);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))
    throw new Error("Figma OAuth override must be a loopback http origin");
  return {
    authorize: new URL("/oauth", url).href,
    token: new URL("/v1/oauth/token", url).href,
    refresh: new URL("/v1/oauth/refresh", url).href,
  };
}
const validClientId = (v) => typeof v === "string" && /^[A-Za-z0-9_-]{4,200}$/.test(v);
const validPort = (v) => Number.isInteger(v) && v >= 1024 && v <= 65535;

/**
 * @param {{file:string, safeStorage:{isEncryptionAvailable():boolean, encryptString(s:string):Buffer, decryptString(b:Buffer):string},
 *          openExternal:(url:string)=>Promise<unknown>, fetcher?:typeof fetch, origin?:string, timeoutMs?:number, now?:()=>number}} options
 */
function createFigmaOAuth({
  file,
  safeStorage,
  openExternal,
  fetcher = fetch,
  origin,
  timeoutMs = 5 * 60 * 1000,
  now = Date.now,
}) {
  let pending = null; // {server, reject}
  const urls = () => endpoints(origin);

  async function load() {
    let raw;
    try {
      raw = JSON.parse(await fs.readFile(file, "utf8"));
    } catch {
      return { config: {}, secrets: {} };
    }
    const config = {
      clientId: validClientId(raw.clientId) ? raw.clientId : "",
      port: validPort(raw.port) ? raw.port : DEFAULT_PORT,
    };
    let secrets = {};
    if (typeof raw.sealed === "string" && raw.sealed && isEncryptionAvailable(safeStorage)) {
      try {
        secrets = JSON.parse(safeStorage.decryptString(Buffer.from(raw.sealed, "base64")));
      } catch {
        secrets = {};
      }
    }
    return { config, secrets, sealed: typeof raw.sealed === "string" && !!raw.sealed };
  }
  async function save(config, secrets) {
    const hasSecrets = Object.values(secrets).some(
      (v) => v !== undefined && v !== null && v !== "",
    );
    if (hasSecrets && !isEncryptionAvailable(safeStorage))
      throw new Error("Secure storage is unavailable; the Figma account cannot be saved");
    const body = { clientId: config.clientId || "", port: config.port || DEFAULT_PORT };
    if (hasSecrets)
      body.sealed = safeStorage.encryptString(JSON.stringify(secrets)).toString("base64");
    await fs.mkdir(path.dirname(file), { recursive: true });
    const temp = `${file}.${crypto.randomUUID()}.tmp`;
    await fs.writeFile(temp, JSON.stringify(body), { mode: 0o600 });
    await fs.rename(temp, file);
  }

  async function status() {
    const { config, secrets, sealed } = await load();
    return {
      clientId: config.clientId || "",
      port: config.port || DEFAULT_PORT,
      hasClientSecret: !!secrets.clientSecret,
      connected: !!secrets.refreshToken || !!secrets.accessToken,
      userId: secrets.userId || null,
      expiresAt: secrets.expiresAt || null,
      pending: !!pending,
      redirectUri: `http://127.0.0.1:${config.port || DEFAULT_PORT}${CALLBACK}`,
      secureStorage: sealed ? isEncryptionAvailable(safeStorage) : null,
    };
  }

  async function configure({ clientId, clientSecret, port } = {}) {
    const { config, secrets } = await load();
    if (clientId !== undefined) {
      if (clientId !== "" && !validClientId(clientId))
        throw new Error("Enter the client ID of your Figma OAuth app");
      if (clientId !== config.clientId) {
        for (const k of ["accessToken", "refreshToken", "expiresAt", "userId"]) delete secrets[k];
      }
      config.clientId = clientId;
    }
    if (clientSecret !== undefined) {
      if (
        typeof clientSecret !== "string" ||
        clientSecret.length > 500 ||
        /[\r\n]/.test(clientSecret)
      )
        throw new Error("Invalid client secret");
      if (clientSecret) secrets.clientSecret = clientSecret;
      else delete secrets.clientSecret;
    }
    if (port !== undefined) {
      if (!validPort(port)) throw new Error("Redirect port must be between 1024 and 65535");
      config.port = port;
    }
    await save(config, secrets);
    return status();
  }

  async function tokenRequest(url, form, clientSecret, clientId) {
    const headers = {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
    };
    if (clientSecret)
      headers.authorization =
        "Basic " + Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
    const controller = new AbortController(),
      timer = setTimeout(() => controller.abort(), 30000);
    let response;
    try {
      response = await fetcher(url, {
        method: "POST",
        headers,
        body: new URLSearchParams(form).toString(),
        redirect: "error",
        signal: controller.signal,
      });
    } catch {
      throw new Error("Unable to reach Figma to complete sign-in");
    } finally {
      clearTimeout(timer);
    }
    let data = null;
    try {
      data = await response.json();
    } catch {}
    if (!response.ok || !data || typeof data.access_token !== "string") {
      const reason =
        typeof data?.error === "string" ? data.error.slice(0, 80) : `HTTP ${response.status}`;
      throw new Error(`Figma sign-in failed (${reason})`);
    }
    return data;
  }
  const record = (data, previous = {}) => ({
    ...previous,
    accessToken: data.access_token,
    refreshToken:
      typeof data.refresh_token === "string" ? data.refresh_token : previous.refreshToken,
    expiresAt: now() + Math.max(60, Number(data.expires_in) || 3600) * 1000,
    userId: data.user_id !== undefined ? String(data.user_id).slice(0, 100) : previous.userId,
  });

  async function connect() {
    if (pending) throw new Error("A Figma sign-in is already in progress");
    const { config, secrets } = await load();
    if (!config.clientId) throw new Error("Add your Figma OAuth client ID first");
    if (!isEncryptionAvailable(safeStorage))
      throw new Error("Secure storage is unavailable; the Figma account cannot be saved");
    const verifier = base64url(crypto.randomBytes(32)),
      challenge = base64url(crypto.createHash("sha256").update(verifier).digest()),
      state = base64url(crypto.randomBytes(16));
    const port = config.port || DEFAULT_PORT,
      redirectUri = `http://127.0.0.1:${port}${CALLBACK}`;
    const code = await new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => {
        const url = new URL(req.url, redirectUri);
        if (url.pathname !== CALLBACK) {
          res.writeHead(404).end();
          return;
        }
        const done = (ok, message) => {
          res
            .writeHead(ok ? 200 : 400, {
              "content-type": "text/html; charset=utf-8",
              "cache-control": "no-store",
              connection: "close",
            })
            .end(`<!doctype html><meta charset="utf-8"><title>Verynize</title><p>${message}</p>`);
        };
        if (url.searchParams.get("state") !== state) {
          done(false, "This sign-in link is not valid. Start again from Verynize.");
          return;
        }
        const error = url.searchParams.get("error"),
          value = url.searchParams.get("code");
        if (error || !value) {
          done(false, "Figma did not authorize Verynize. You can close this tab.");
          finish();
          reject(
            new Error(
              error === "access_denied"
                ? "Figma access was denied"
                : "Figma sign-in did not return a code",
            ),
          );
          return;
        }
        done(true, "Figma is connected. You can close this tab and return to Verynize.");
        finish();
        resolve(value);
      });
      const timer = setTimeout(() => {
        finish(true);
        reject(new Error("Figma sign-in timed out"));
      }, timeoutMs);
      // Stop listening; connections close once their response is sent (connection: close), or now when aborting.
      const finish = (abort = false) => {
        clearTimeout(timer);
        server.close();
        if (abort) server.closeAllConnections?.();
        else server.closeIdleConnections?.();
        pending = null;
      };
      pending = {
        server,
        reject: (error) => {
          finish(true);
          reject(error);
        },
      };
      server.on("error", (error) => {
        finish(true);
        reject(
          new Error(
            error.code === "EADDRINUSE"
              ? `Redirect port ${port} is in use; choose another in the Figma settings`
              : "Unable to start the sign-in listener",
          ),
        );
      });
      server.listen(port, "127.0.0.1", async () => {
        const auth = new URL(urls().authorize);
        for (const [k, v] of Object.entries({
          client_id: config.clientId,
          redirect_uri: redirectUri,
          scope: SCOPE,
          state,
          response_type: "code",
          code_challenge: challenge,
          code_challenge_method: "S256",
        }))
          auth.searchParams.set(k, v);
        try {
          await openExternal(auth.href);
        } catch {
          pending?.reject(new Error("Unable to open the browser for Figma sign-in"));
        }
      });
    });
    const data = await tokenRequest(
      urls().token,
      {
        client_id: config.clientId,
        redirect_uri: redirectUri,
        code,
        grant_type: "authorization_code",
        code_verifier: verifier,
      },
      secrets.clientSecret,
      config.clientId,
    );
    await save(config, record(data, { clientSecret: secrets.clientSecret }));
    return status();
  }

  function cancel() {
    if (pending) pending.reject(new Error("Figma sign-in cancelled"));
    return true;
  }

  let refreshing = null;
  async function accessToken() {
    const { config, secrets } = await load();
    if (!secrets.accessToken) return null;
    if (secrets.expiresAt && secrets.expiresAt - now() > 60000) return secrets.accessToken;
    if (!secrets.refreshToken) return null;
    refreshing ||= (async () => {
      try {
        const data = await tokenRequest(
          urls().refresh,
          {
            client_id: config.clientId,
            refresh_token: secrets.refreshToken,
            grant_type: "refresh_token",
          },
          secrets.clientSecret,
          config.clientId,
        );
        const next = record(data, secrets);
        await save(config, next);
        return next.accessToken;
      } finally {
        refreshing = null;
      }
    })();
    return refreshing;
  }

  async function disconnect() {
    cancel();
    const { config, secrets } = await load();
    await save(config, secrets.clientSecret ? { clientSecret: secrets.clientSecret } : {});
    return status();
  }
  return { status, configure, connect, cancel, accessToken, disconnect, endpoints: urls };
}

let instance = null;
/** The connected account's access token for importFigma (null when not connected). */
async function accessToken() {
  return instance ? instance.accessToken() : null;
}

function registerFigmaOAuth(handle, _win, { app, safeStorage, shell } = {}) {
  const electron = app && safeStorage && shell ? { app, safeStorage, shell } : require("electron");
  instance ||= createFigmaOAuth({
    file: path.join(electron.app.getPath("userData"), "figma-oauth.json"),
    safeStorage: electron.safeStorage,
    openExternal: (url) => electron.shell.openExternal(url),
  });
  handle("figmaOAuthStatus", () => instance.status());
  handle("figmaOAuthConfigure", (options) =>
    instance.configure({
      clientId: options?.clientId,
      clientSecret: options?.clientSecret,
      port: options?.port,
    }),
  );
  handle("figmaOAuthConnect", () => instance.connect());
  handle("figmaOAuthCancel", () => instance.cancel());
  handle("figmaOAuthDisconnect", () => instance.disconnect());
}

module.exports = {
  createFigmaOAuth,
  registerFigmaOAuth,
  accessToken,
  endpoints,
  DEFAULT_PORT,
  CALLBACK,
};
