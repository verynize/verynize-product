// Server-rendered public pages (creator profiles and app placeholders). All values are escaped
// and the pages run no script.
import { escapeHtml } from "./http.js";

const pageHeaders = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "no-store, no-transform",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "content-security-policy":
    "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' https: data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
};

const shell = (
  title,
  body,
) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><link rel="icon" href="/favicon.ico" sizes="16x16 32x32"><link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="apple-touch-icon" href="/apple-touch-icon.png" sizes="180x180"><style>
body{margin:0;font:15px/1.55 Inter,system-ui,-apple-system,sans-serif;background:#141416;color:#e6e3ec}
main{max-width:720px;margin:0 auto;padding:56px 24px}
.head{display:flex;gap:18px;align-items:center;margin-bottom:36px}
.avatar{width:72px;height:72px;border-radius:50%;background:#3a3145;object-fit:cover;display:flex;align-items:center;justify-content:center;font-size:28px;color:#e2c4ef}
h1{font-size:24px;margin:0}.handle{color:#9d97a8}
ul{list-style:none;padding:0;margin:0;display:grid;gap:10px}
li a{display:flex;justify-content:space-between;gap:16px;padding:14px 16px;border:1px solid #2f2b37;border-radius:10px;color:inherit;text-decoration:none;background:#1b1a20}
li a:hover{border-color:#6c4e86}.kind{font-size:12px;color:#b6a4c9;text-transform:uppercase;letter-spacing:.06em}
.empty{color:#8d8797}footer{margin-top:48px;font-size:12px;color:#77717f}
</style></head><body><main>${body}</main></body></html>`;

export function profilePage(profile, status = 200) {
  if (!profile)
    return new Response(
      shell(
        "Profile not found",
        '<h1>Profile not found</h1><p class="empty">No creator uses this handle.</p>',
      ),
      { status: 404, headers: pageHeaders },
    );
  const initial = escapeHtml((profile.displayName || profile.handle).slice(0, 1).toUpperCase());
  const avatar = profile.avatarUrl
    ? `<img class="avatar" src="${escapeHtml(profile.avatarUrl)}" alt="">`
    : `<div class="avatar" aria-hidden="true">${initial}</div>`;
  const items = profile.publications
    .map(
      (item) =>
        `<li><a href="${escapeHtml(item.path)}"><span>${escapeHtml(item.title)}</span><span class="kind">${item.kind === "app" ? "App" : "Design"} · ${escapeHtml(new Date(item.publishedAt).toISOString().slice(0, 10))}</span></a></li>`,
    )
    .join("");
  const body = `<section class="head">${avatar}<div><h1>${escapeHtml(profile.displayName)}</h1><div class="handle">@${escapeHtml(profile.handle)}</div></div></section>
<h2>Published work</h2>${items ? `<ul>${items}</ul>` : '<p class="empty">Nothing published yet.</p>'}<footer>Shared with Verynize</footer>`;
  return new Response(shell(`${profile.displayName} (@${profile.handle})`, body), {
    status,
    headers: pageHeaders,
  });
}

export function missingApp(message = "This app is not published.") {
  return new Response(
    shell("App not found", `<h1>App not found</h1><p class="empty">${escapeHtml(message)}</p>`),
    { status: 404, headers: pageHeaders },
  );
}
