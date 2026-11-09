# Validasi temuan production web (README temuan 3 bagian production dan 5)

2026-11-09. Read-only: tidak ada edit kode aplikasi, commit, deploy, atau aksi di app production. Kode dicek di `staging` (2630c30). Runtime dicek dengan `curl` dan satu sesi headless agent-browser yang terisolasi (tanpa login), lalu ditutup.

**Runtime yang butuh login tidak bisa diverifikasi.** Saat validasi tidak ada Chrome yang berjalan (`--auto-connect` gagal: "No running Chrome instance found", tidak ada `DevToolsActivePort`). Hitungan `/api/me/state` selama 30 detik idle di Files, header respons yang sudah login, dan dua `/access` per buka room tidak diukur ulang. Untuk poin itu laporan ini memakai kode dan data mentah astra tanggal 2026-11-08 (`../astra-prod/`), yang diringkas ulang di `production-web/me-state-polling-from-astra.json`.

## Verdict

| #   | Klaim                                                                                                            | Verdict                                                     | Bukti utama                                                                                                                                                                                                                                                                                                                                                                                                                             |
| --- | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Tidak ada `_headers`; bundle ber-hash disajikan `max-age=0, must-revalidate`                                     | **CONFIRMED**                                               | Tidak ada `_headers` di repo atau di output build; `cloudflare.config.ts:17-22` tidak punya aturan header. `curl -I` ke 5 bundle ber-hash, `/app.js`, `/style.css`: semuanya `public, max-age=0, must-revalidate` + ETag weak, `cf-cache-status: HIT`. `/_headers` → 404. Ini default Cloudflare Static Assets (Context7).                                                                                                              |
| 2   | `/api/me/state` ~4 MB decoded, seluruh data akun termasuk chat, polling 3 detik + setelah sync/focus, tanpa ETag | **CONFIRMED (kode + data astra), UNVERIFIED-runtime ulang** | `cloud/account-state.js:11-31` membaca semua baris akun (key `chat:` diizinkan di `:35`). `web/account-store.js:387-389` `setInterval(sync, 3000)`, `:380-381` focus/online, `:67` setiap `put` → sync 150 ms, dan setiap `sync()` diakhiri GET penuh (`:298`). Respons lewat `json()` dengan `cache-control: no-store`, tanpa ETag (`cloud/http.js:12-17`). Data astra: 4.083.883 B decoded / ~556 KB encoded per call, jeda 3.000 ms. |
| 3   | Dua panggilan `/access` per buka room                                                                            | **CONFIRMED (kode + data astra), UNVERIFIED-runtime ulang** | Dua pemanggil independen yang sama-sama dipicu perubahan room: `web/cloud-share.js:220-226` (`roomChanged` → `access()` → `:122`) dan `web/src/islands/collab/presence-engine.ts:270-277` (`loadVisibility`, dipanggil dari `sync()` `:454`). Keduanya hanya butuh `visibility`. Data astra: 2 `/access` di AUDIT cold, AUDIT warm dan Spaces cold.                                                                                     |
| 4a  | `legacy-ui.js` ~1,58 MB decoded                                                                                  | **CONFIRMED**                                               | `curl` ke `/assets/legacy-ui-CXHsJAu3.js`: 1.577.689 B identity, ~446 KB zstd/br. Sama persis dengan angka astra.                                                                                                                                                                                                                                                                                                                       |
| 4b  | Snapshot room Spaces ~6,7 MB                                                                                     | **CONFIRMED (data astra), UNVERIFIED-runtime ulang**        | `astra-prod/spaces-cache-disabled.json`: `/api/rooms/[id]` 430.267 B encoded / 6.692.835 B decoded. Tidak diukur ulang (butuh login; Spaces tidak dibuka).                                                                                                                                                                                                                                                                              |

## 1. `_headers` dan cache bundle ber-hash

Kode:

- `git ls-files` dan `find` tidak menemukan `_headers` di mana pun (juga tidak di `dist/`). Tidak ada `wrangler.*`; konfigurasi Worker ada di `cloudflare.config.ts`, dan blok `assets` (`:17-22`) hanya berisi `notFoundHandling: "none"` dan `runWorkerFirst` untuk `/api/*`, `/u/*`, `/apps/*`, `/passkey`, `/passkey.js`, `/account/*`. Jadi `/assets/*` dilayani langsung oleh lapisan Static Assets, dan `_headers` akan berlaku untuk path itu.
- `vite.config.ts:15` `publicDir: false`; file statis dikirim lewat allowlist `web-start/build/legacy-web.mjs` (`emitFile`, `:197-201`), yang tidak menulis `_headers`.
- Pembanding: build Node sudah memberi `public, max-age=31536000, immutable` untuk `assets/*-<hash>.(js|css)` (`web-start/node/server.mjs:154-155`, `web-start/README.md:223`), dan Nitro menandai `/assets/**` immutable. Hanya build Cloudflare yang tidak.

Runtime (`production-web/curl-headers.txt`):

| Path                            | cache-control                      | ETag | cf-cache-status |
| ------------------------------- | ---------------------------------- | ---- | --------------- |
| `/assets/index-Dpo3UJ4v.js`     | public, max-age=0, must-revalidate | weak | HIT             |
| `/assets/_editor-TYko6RO7.js`   | public, max-age=0, must-revalidate | weak | HIT             |
| `/assets/react-BzYqJA6g.js`     | public, max-age=0, must-revalidate | weak | HIT             |
| `/assets/ui-CFIVG3HJ.js`        | public, max-age=0, must-revalidate | weak | HIT             |
| `/assets/legacy-ui-CXHsJAu3.js` | public, max-age=0, must-revalidate | weak | HIT             |
| `/app.js`, `/style.css`         | public, max-age=0, must-revalidate | weak | HIT             |
| `/_headers`                     | 404                                | –    | –               |

Conditional GET dengan `If-None-Match` ke legacy-ui → **304**. Di browser headless (halaman sign-in, tanpa login), navigasi kedua ke `/` me-revalidasi **semua 11** aset `/assets/*` (transferSize 300 B, body 0) alih-alih memakai cache tanpa request (`production-web/browser-signin-*-resources.json`). Jadi byte tidak diunduh ulang, tapi setiap aset ber-hash tetap butuh satu round trip per load. Di Files yang sudah login astra mencatat 56 JS + 12 CSS, jadi ada sekitar 68 revalidasi per buka.

Dokumentasi Cloudflare (Context7, `/llmstxt/developers_cloudflare_workers_llms-full_txt`, kutipan lengkap di `production-web/context7-cloudflare-static-assets.md`):

> **`Cache-Control: public, max-age=0, must-revalidate`** Sent when the request does not have an `Authorization` or `Range` header, this response header tells the browser that the asset can be cached, but that the browser should revalidate the freshness of the content every time before using it.

> The default response headers served on static asset responses can be overridden, removed, or added to, by creating a plain text file called `_headers` without a file extension, in the static asset directory of your project. [...] Custom headers defined in the `_headers` file are not applied to responses generated by your Worker code [...]

Catatan untuk perbaikan (Fase 0 #8): `_headers` harus masuk ke direktori aset output Cloudflare (lewat `legacy-web.mjs` atau Start/Vite), dan pola `immutable` hanya untuk nama ber-hash. `/assets/fonts/*` memakai nama stabil, jadi jangan disamakan (Nitro juga mengecualikannya). `/app.js` dan `/style.css` tidak ber-hash dan memang harus tetap revalidate.

## 2. `/api/me/state`

Kode:

- Server: `cloud/worker.js:302-304` → `readAccountState` (`cloud/account-state.js:11-31`): `SELECT key, value, revision FROM account_state WHERE accountId = ?` tanpa filter, chunk digabung, semua item dikembalikan. Key yang diizinkan (`:35`): `preference|agent-default|chat|draft|folder|file`, jadi transkrip chat (`chat:`) ikut terkirim. Header dari `json()` (`cloud/http.js:12-17`): `cache-control: no-store`, tanpa ETag. Server tidak membaca `If-None-Match` (satu-satunya ETag di `cloud/` ada di file app dan aset, `cloud/worker.js:904-907`, `cloud/assets.js:357-374`).
- Client (`web/account-store.js`): `setInterval(() => { if (!document.hidden && !networkAttempts) void sync(); }, 3000)` di `:387-389`; `focus` dan `online` → `reconnect` → `sync()` di `:375-381`; setiap `put()` menjadwalkan `sync()` 150 ms kemudian (`:67`); `cloud-account-changed` juga memicu sync. Setiap `sync()`, juga yang tidak punya perubahan pending, diakhiri dengan `request("/api/me/state")` penuh (`:298`); konflik 409 menambah satu GET penuh lagi (`:253`). Fetch (`:177-180`) tidak mengirim `If-None-Match`. Polling berhenti hanya saat tab tersembunyi.

Data mentah astra (login, 2026-11-08; diringkas di `production-web/me-state-polling-from-astra.json`):

| Capture              | Call `/api/me/state` | Rentang |                             Jeda 2,9-3,1 s | Encoded / decoded per call      |
| -------------------- | -------------------: | ------: | -----------------------------------------: | ------------------------------- |
| Files cache-disabled |                    9 |  20,5 s | 6 dari 8 (2 jeda awal 1,4/1,2 s = startup) | 555.967-556.739 B / 4.083.883 B |
| Spaces verified      |                   34 | 113,7 s |                                 29 dari 33 | 555.716-556.753 B / 4.083.883 B |
| AUDIT selection      |                  132 |   396 s |                               124 dari 131 | 555.658-556.983 B / 4.083.883 B |

Kalau diproyeksikan dari jeda 3 s, 30 s idle di Files ≈ 10 call ≈ 5,6 MB transfer dan ≈ 41 MB JSON yang di-parse. Angka ini proyeksi dari kode dan data astra, bukan hitungan ulang. Ukuran decoded identik di semua call, jadi isi akun tidak berubah selama capture: setiap poll mengunduh ulang data yang sama.

Runtime ulang: **UNVERIFIED** (tidak ada Chrome yang sudah login). Satu-satunya cek runtime: `GET /api/me/state` tanpa sesi → 401, `cache-control: no-store`, tanpa ETag. Ini lewat jalur `json()` yang sama, tapi header respons 200 yang sudah login tidak ditangkap. Di sesi headless tanpa login, 30 s idle menghasilkan 0 request `/api/*` (polling hanya jalan kalau ada identitas akun, `:197`). Klaim "9.648 GET vs 154 PUT dalam 7 hari" tidak divalidasi (di luar cakupan, butuh analytics).

Komposisi isi 4 MB (berapa yang berasal dari chat) tidak diperiksa demi privasi. Klaim "termasuk transkrip chat" berasal dari kode (key `chat:` disimpan dan dikembalikan), bukan dari isi respons.

## 3. Dua `/access` per buka room

Pemanggil `/api/rooms/:id/access` di renderer web:

| Lokasi                                                                                               | Pemicu                                                                                     | Saat buka room?           |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------- |
| `web/cloud-share.js:220-226` `roomChanged()` → `access()` (`:118-142`, request `:122`)               | key room berubah                                                                           | **ya**                    |
| `web/src/islands/collab/presence-engine.ts:270-283` `loadVisibility()`, dari `sync(next)` `:450-454` | `room.roomId` berubah                                                                      | **ya**                    |
| `web/src/islands/share/share-popover.tsx:96-107` → `access()`                                        | Share popover dibuka (Radix `Popover` hanya me-mount `ShareBody` saat terbuka, `:315-369`) | tidak                     |
| `web/cloud-panel.js:1876-1884` `refreshAccess()`                                                     | tombol/aksi panel, toggle `#cloud-access-section`                                          | tidak                     |
| `web-start/src/legacy/web-auth.ts:36` `openRoomLink()`                                               | hanya kalau belum login dan URL `#room=`                                                   | tidak (kalau sudah login) |
| `web/cloud-invite.js:53`                                                                             | alur undangan                                                                              | tidak                     |

Dua call pertama terpisah dan masing-masing punya cache `visibilityRoom` sendiri, jadi keduanya selalu jalan. Data astra cocok: tepat 2 `/access` di AUDIT cold (290 ms dan 800 ms), AUDIT warm (458/963 ms) dan Spaces cold (200/591 ms). Runtime ulang: UNVERIFIED (butuh login).

## 4. Ukuran payload

- `legacy-ui-CXHsJAu3.js`: 1.577.689 B decoded (curl identity), 446.068-446.412 B zstd/br. Hash file sama dengan capture astra, jadi bundle belum berubah sejak audit.
- Snapshot Spaces: 6.692.835 B decoded / 430.267 B encoded (`astra-prod/spaces-cache-disabled.json`). Snapshot AUDIT 3.048.940 B (cold) dan 5.629.184 B (warm). Tidak diukur ulang.

## Cara dan privasi

- Kode: `grep`/`sed` di repo; nomor baris dari `staging` 2630c30.
- `curl` tanpa kredensial. agent-browser: sesi bernama baru, headless, tanpa profil, hanya membuka halaman sign-in, lalu `close`; `session list` → "No active sessions". Tidak ada tab user yang disentuh karena Chrome user tidak berjalan.
- File di `production-web/` hanya berisi path aset, header non-sensitif, ukuran, jumlah, dan jeda waktu. Tidak ada token, cookie, email, ID room, atau isi respons akun.

## File

- `production-web/curl-headers.txt`: header aset, 304 conditional, ukuran legacy-ui, header `/api/me/state` tanpa sesi.
- `production-web/browser-signin-cold-resources.json`, `production-web/browser-signin-warm-navigation-resources.json`: Resource Timing halaman sign-in, cold dan navigasi kedua.
- `production-web/me-state-polling-from-astra.json`: jumlah dan jeda `/api/me/state`, jumlah `/access`, ukuran snapshot, diturunkan dari `../astra-prod/*.json`.
- `production-web/context7-cloudflare-static-assets.md`: kutipan dokumentasi Cloudflare.
