// Pages for the links Better Auth emails (cloud/auth.js), served on the Worker's own origin:
// /account/verified after an email verification, and /account/reset-password to choose a new
// password. Better Auth redirects there with ?error=… or ?token=…. The verified page runs no
// script; the reset page loads only /account/reset-password.js (CSP script-src 'self').
import { escapeHtml } from "./http.js";

const baseHeaders = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "no-store, no-transform",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
};

const shell = (
  title,
  body,
  script = "",
) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><link rel="icon" href="/favicon.ico" sizes="16x16 32x32"><link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="apple-touch-icon" href="/apple-touch-icon.png" sizes="180x180"><style>
body{margin:0;font:14px/1.55 Inter,system-ui,-apple-system,sans-serif;background:#141416;color:#e6e3ec;display:flex;min-height:100vh;align-items:center;justify-content:center}
main{width:min(360px,90vw);padding:28px;border:1px solid #2f2b37;border-radius:14px;background:#1b1a20}
h1{font-size:18px;margin:0 0 8px}p{color:#aaa3b5;margin:0 0 18px}
label{display:block;margin:0 0 12px;color:#cfc8da}input{box-sizing:border-box;width:100%;margin-top:4px;padding:9px 10px;border-radius:8px;border:1px solid #3a3445;background:#141416;color:inherit;font:inherit}
button{width:100%;padding:10px 14px;border-radius:8px;border:0;background:#b93cdb;color:#fff;font:inherit;cursor:pointer}button:disabled{opacity:.5}
#reset-status{margin-top:16px;min-height:22px;color:#d9cfe6}
</style></head><body><main>${body}</main>${script}</body></html>`;

const ERRORS = {
  INVALID_TOKEN: "This link is invalid or has already been used.",
  TOKEN_EXPIRED: "This link has expired.",
  USER_NOT_FOUND: "This account no longer exists.",
};
const errorText = (code) => ERRORS[code] || "This link could not be used.";

export function verifiedPage(url) {
  const error = url.searchParams.get("error");
  const body = error
    ? `<h1>Email not verified</h1><p>${escapeHtml(errorText(error))} Sign in from Verynize to receive a new verification email.</p>`
    : `<h1>Email verified</h1><p>Your Verynize account is ready. Return to Verynize and sign in with your email and password.</p>`;
  return new Response(shell(error ? "Email not verified" : "Email verified", body), {
    status: error ? 400 : 200,
    headers: {
      ...baseHeaders,
      "content-security-policy":
        "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    },
  });
}

export function resetPasswordPage(url) {
  const error = url.searchParams.get("error");
  const body = error
    ? `<h1>Reset link not valid</h1><p>${escapeHtml(errorText(error))} Ask for a new one from Verynize › Share › Account › Forgot password.</p>`
    : `<h1>Choose a new password</h1><p>Use at least 10 characters. Every device signed in to this account will be signed out.</p>
<form id="reset-form"><label>New password<input id="reset-password" type="password" autocomplete="new-password" minlength="10" maxlength="128" required></label>
<label>Repeat password<input id="reset-confirm" type="password" autocomplete="new-password" minlength="10" maxlength="128" required></label>
<button id="reset-submit" type="submit">Save password</button></form><div id="reset-status" role="status"></div>`;
  return new Response(
    shell(
      "Reset your Verynize password",
      body,
      error ? "" : '<script src="/account/reset-password.js"></script>',
    ),
    {
      status: error ? 400 : 200,
      headers: {
        ...baseHeaders,
        "content-security-policy":
          "default-src 'none'; img-src 'self'; script-src 'self'; connect-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      },
    },
  );
}

const resetScript = `(() => {
  const $ = (id) => document.getElementById(id);
  const token = new URLSearchParams(location.search).get('token') || '';
  // Keep the single-use token out of history and screenshots once read.
  history.replaceState(null, '', location.pathname);
  const status = (text) => { $('reset-status').textContent = text; };
  if (!token) { status('This link is missing its reset code. Ask for a new one from Verynize.'); $('reset-submit').disabled = true; return; }
  $('reset-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const newPassword = $('reset-password').value;
    if (newPassword !== $('reset-confirm').value) return status('The passwords do not match.');
    $('reset-submit').disabled = true;
    status('Saving…');
    try {
      const response = await fetch('/api/auth/reset-password', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token, newPassword }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw Error(data.message || data.error || 'The password could not be changed (' + response.status + ')');
      $('reset-form').hidden = true;
      status('Password changed. Return to Verynize and sign in with your new password.');
      document.body.dataset.done = 'true';
    } catch (error) {
      status(error.message);
      $('reset-submit').disabled = false;
    }
  });
})();`;

export function resetPasswordScript() {
  return new Response(resetScript, {
    headers: {
      "content-type": "text/javascript; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
