// The passkey ceremony page, served on the Worker's own origin so the WebAuthn relying party is
// the server's host. Desktop clients open it in a small window: #mode=register&ticket=… adds a
// passkey to the signed-in account, #mode=signin&handoff=… completes a sign-in the desktop claims.

const headers = {
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
};

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Verynize passkey</title><link rel="icon" href="/favicon.ico" sizes="16x16 32x32"><link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="apple-touch-icon" href="/apple-touch-icon.png" sizes="180x180"><style>
body{margin:0;font:14px/1.55 Inter,system-ui,-apple-system,sans-serif;background:#141416;color:#e6e3ec;display:flex;min-height:100vh;align-items:center;justify-content:center}
main{width:min(360px,90vw);padding:28px;border:1px solid #2f2b37;border-radius:14px;background:#1b1a20}
h1{font-size:18px;margin:0 0 8px}p{color:#aaa3b5;margin:0 0 18px}
button{width:100%;padding:10px 14px;border-radius:8px;border:0;background:#b93cdb;color:#fff;font:inherit;cursor:pointer}button:disabled{opacity:.5}
#passkey-status{margin-top:16px;min-height:22px;color:#d9cfe6}
</style></head><body><main><h1 id="passkey-title">Passkey</h1><p id="passkey-help"></p><button id="passkey-go" type="button">Continue</button><div id="passkey-status" role="status"></div></main><script src="/passkey.js"></script></body></html>`;

const script = `(() => {
  const params = new URLSearchParams(location.hash.slice(1));
  const mode = params.get('mode') === 'register' ? 'register' : 'signin';
  const $ = (id) => document.getElementById(id);
  const status = (text) => { $('passkey-status').textContent = text; };
  const b64 = (buffer) => { let s = ''; for (const b of new Uint8Array(buffer)) s += String.fromCharCode(b); return btoa(s).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, ''); };
  const bytes = (value) => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((value.length + 3) % 4)), (c) => c.charCodeAt(0));
  const post = async (path, body) => {
    const response = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw Error(data.error || 'Request failed (' + response.status + ')');
    return data;
  };
  $('passkey-title').textContent = mode === 'register' ? 'Add a passkey' : 'Sign in with a passkey';
  $('passkey-help').textContent = mode === 'register' ? 'Create a passkey for your Verynize account on this device or security key.' : 'Use a passkey saved for this Verynize server. You will return to Verynize when it is done.';
  if (!window.PublicKeyCredential) { status('This browser does not support passkeys.'); $('passkey-go').disabled = true; return; }
  $('passkey-go').onclick = async () => {
    $('passkey-go').disabled = true;
    status('Waiting for your passkey…');
    try {
      if (mode === 'register') {
        const ticket = params.get('ticket');
        const options = await post('/api/auth/passkeys/register/options', { ticket });
        const credential = await navigator.credentials.create({ publicKey: { ...options, challenge: bytes(options.challenge), user: { ...options.user, id: bytes(options.user.id) }, excludeCredentials: options.excludeCredentials.map((c) => ({ ...c, id: bytes(c.id) })) } });
        await post('/api/auth/passkeys/register/verify', { ticket, challenge: options.challenge, label: navigator.platform ? 'Passkey · ' + navigator.platform : 'Passkey', credential: { id: credential.id, type: credential.type, response: { clientDataJSON: b64(credential.response.clientDataJSON), attestationObject: b64(credential.response.attestationObject) } } });
        status('Passkey saved. You can close this window.');
      } else {
        const handoff = params.get('handoff');
        const options = await post('/api/auth/passkeys/login/options', { handoff, email: params.get('email') || undefined });
        const credential = await navigator.credentials.get({ publicKey: { ...options, challenge: bytes(options.challenge), allowCredentials: options.allowCredentials.map((c) => ({ ...c, id: bytes(c.id) })) } });
        const r = credential.response;
        await post('/api/auth/passkeys/login/verify', { challenge: options.challenge, credential: { id: credential.id, type: credential.type, response: { clientDataJSON: b64(r.clientDataJSON), authenticatorData: b64(r.authenticatorData), signature: b64(r.signature), userHandle: r.userHandle ? b64(r.userHandle) : null } } });
        status('Signed in. Return to Verynize.');
      }
      document.body.dataset.done = 'true';
    } catch (error) {
      status(error.name === 'NotAllowedError' ? 'The passkey request was cancelled or timed out.' : error.message);
      $('passkey-go').disabled = false;
    }
  };
})();`;

export function passkeyPage() {
  return new Response(html, {
    headers: {
      ...headers,
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store, no-transform",
      "content-security-policy":
        "default-src 'none'; img-src 'self'; script-src 'self'; connect-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    },
  });
}
export function passkeyScript() {
  return new Response(script, {
    headers: { ...headers, "content-type": "text/javascript; charset=utf-8" },
  });
}
