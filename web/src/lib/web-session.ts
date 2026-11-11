// The web app's own sign-in (cloud/README.md "Web sign-in"). The browser app (web-start) shows its sign-in screen
// before the legacy editor boots, so window.cloudAccount (web/cloud-panel.js) does not exist yet. This module talks to
// the same server endpoints and writes the same session record (`verynize.cloud.account`: {server, session, account,
// personalOrganizationId}) that cloud-panel.js reads at startup, so once the editor boots it is simply signed in:
//
// - email + password (Better Auth: sign-in/email, sign-up/email, request-password-reset), as the Share panel;
// - a passkey, through the server's /passkey page and a handoff, as the Share panel.
//
// The legacy emailed sign-in links (/api/auth/start, `#signin=`) are not offered: no current client sends them.
//
// Only a session for this page's own origin counts: the web app is served by the server it signs in to.
const ACCOUNT_KEY = "verynize.cloud.account";
const SESSION_TOKEN = /^(vs_[0-9a-f]{64}|[A-Za-z0-9]{16,64}\.[A-Za-z0-9+/=_%-]{16,128})$/;

type Profile = {
  id: string;
  email: string;
  handle: string;
  displayName: string;
  avatarUrl: string;
};
type StoredSession = {
  server: string;
  session: string;
  account: Profile;
  personalOrganizationId?: string | null;
};

const origin = () => globalThis.location.origin;
const message = async (response: Response) => {
  const data = await response.json().catch(() => null);
  return data?.message || data?.error || `Server returned ${response.status}`;
};

/** The stored session when it belongs to this server, else null. */
export function storedWebSession(): StoredSession | null {
  try {
    const value = JSON.parse(localStorage.getItem(ACCOUNT_KEY) || "null") as StoredSession | null;
    return value && SESSION_TOKEN.test(value.session) && value.server === origin() ? value : null;
  } catch {
    return null;
  }
}

function store(next: StoredSession | null) {
  try {
    if (next) localStorage.setItem(ACCOUNT_KEY, JSON.stringify(next));
    else localStorage.removeItem(ACCOUNT_KEY);
  } catch {}
}

// Auth runs before the editor and onboarding. Keep their full response together, keyed by
// origin + session (never just account id), and give every caller its own readable body.
let meCache: {
  key: string;
  response: Promise<Response>;
  expires: number;
} | null = null;

export function invalidateWebMe() {
  meCache = null;
}

async function me(session: string, signal?: AbortSignal) {
  const key = `${origin()}|${session}`;
  if (!meCache || meCache.key !== key || meCache.expires <= Date.now()) {
    const entry = {
      key,
      expires: Infinity,
      response: fetch(`${origin()}/api/me`, {
        headers: { "X-Verynize-Session": session },
        signal,
      }),
    };
    meCache = entry;
    entry.response = entry.response.then(
      (response) => {
        entry.expires = response.ok ? Date.now() + 30_000 : 0;
        return response;
      },
      (error: unknown) => {
        if (meCache === entry) invalidateWebMe();
        throw error;
      },
    );
  }
  return (await meCache.response).clone();
}

/** The same full account response checked by the web sign-in gate. */
export async function getWebMe(): Promise<{ aiSetupAt?: number | null }> {
  const stored = storedWebSession();
  if (!stored) throw Error("Sign in first");
  const response = await me(stored.session, AbortSignal.timeout(8000));
  if (!response.ok) throw Error(await message(response));
  return response.json();
}

// These listeners also cover profile updates and sign-out performed by the legacy shell.
if (typeof window !== "undefined") {
  window.addEventListener("cloud-account-changed", invalidateWebMe);
  window.addEventListener("cloud-profile-updated", invalidateWebMe);
  window.addEventListener("storage", (event) => {
    if (event.key === ACCOUNT_KEY || event.key === null) invalidateWebMe();
  });
}

/** Store a fresh session with its profile (GET /api/me), as cloud-panel.js does after signing in. */
async function adopt(session: string) {
  if (!SESSION_TOKEN.test(session)) throw Error("The server did not return a session");
  invalidateWebMe();
  const response = await me(session, AbortSignal.timeout(8000));
  if (!response.ok) throw Error(await message(response));
  const data = await response.json();
  store({
    server: origin(),
    session,
    account: data.account,
    personalOrganizationId: data.personalOrganizationId || null,
  });
  return data.account as Profile;
}

/**
 * True when this browser is signed in to this server. The stored session is checked with the server: a session it
 * rejects (expired, signed out elsewhere) is dropped. When the server cannot be reached the stored session is kept,
 * so a signed-in user can still open the editor offline.
 */
export async function checkWebSession(timeout = 8000): Promise<boolean> {
  const stored = storedWebSession();
  if (!stored) return false;
  try {
    const response = await me(stored.session, AbortSignal.timeout(timeout));
    if (response.status === 401 || response.status === 403) {
      invalidateWebMe();
      store(null);
      return false;
    }
    const data = response.ok ? await response.json().catch(() => null) : null;
    if (data?.account?.email)
      store({
        ...stored,
        account: data.account,
        personalOrganizationId:
          data.personalOrganizationId ?? stored.personalOrganizationId ?? null,
      });
  } catch {}
  return true;
}

/** Email + password sign-in (Better Auth). An unverified address gets a fresh verification email. */
export async function signInWithPassword(email: string, password: string) {
  if (!email) throw Error("Enter your email address");
  if (!password) throw Error("Enter your password");
  const response = await fetch(`${origin()}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, callbackURL: "/account/verified" }),
  });
  if (response.status === 403) {
    const data = await response
      .clone()
      .json()
      .catch(() => null);
    if (data?.code === "EMAIL_NOT_VERIFIED")
      throw Error(`Verify your email first. A new link was sent to ${email}.`);
  }
  if (response.status === 401) throw Error("Email or password is incorrect");
  if (!response.ok) throw Error(await message(response));
  return adopt(response.headers.get("set-auth-token") || "");
}

async function post(path: string, body: unknown) {
  const response = await fetch(origin() + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw Error(await message(response));
  return response.json().catch(() => null);
}

/** The account API the sign-in form (onboarding/account-step.tsx) uses, bound to this server. */
export const webAccountApi = {
  defaultServer: () => origin(),
  signIn: ({ email, password }: { server: string; email: string; password: string }) =>
    signInWithPassword(email, password),
  signUp: async ({
    email,
    password,
    name,
  }: {
    server: string;
    email: string;
    password: string;
    name?: string;
  }) => {
    if (!email) throw Error("Enter your email address");
    if (password.length < 10) throw Error("Choose a password of at least 10 characters");
    await post("/api/auth/sign-up/email", {
      email,
      password,
      name: name || email.split("@")[0],
      callbackURL: "/account/verified",
    });
  },
  forgotPassword: async ({ email }: { server: string; email: string }) => {
    if (!email) throw Error("Enter your email address");
    await post("/api/auth/request-password-reset", {
      email,
      redirectTo: "/account/reset-password",
    });
  },
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Passkey sign-in: the ceremony runs on the server's /passkey page in a popup (signed in for a handoff id), and this
 * page claims the session with the handoff secret. `signal` stops waiting.
 */
export async function signInWithPasskey(signal?: AbortSignal) {
  const handoff = (await post("/api/auth/handoff", {})) as { id: string; secret: string };
  const popup = window.open(
    `${origin()}/passkey#mode=signin&handoff=${handoff.id}`,
    "verynize-passkey",
    "popup,width=440,height=520",
  );
  if (!popup) throw Error("Allow pop-ups for this site to sign in with a passkey");
  const until = Date.now() + 5 * 60 * 1000;
  try {
    while (Date.now() < until) {
      if (signal?.aborted) return null;
      const response = await fetch(`${origin()}/api/auth/handoff/claim`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...handoff, label: "Verynize web (passkey)" }),
      });
      if (response.status === 200) {
        const result = await response.json();
        invalidateWebMe();
        store({ server: origin(), session: result.session, account: result.account });
        return result.account as Profile;
      }
      if (response.status !== 202) throw Error(await message(response));
      await sleep(800);
    }
    throw Error("The passkey request timed out");
  } finally {
    popup.close();
  }
}

/** A published snapshot (`#public=…`) opens without an account, like /u/* profiles and /apps/*. */
export const isPublicLink = () =>
  new URLSearchParams(globalThis.location.hash.slice(1)).has("public");
