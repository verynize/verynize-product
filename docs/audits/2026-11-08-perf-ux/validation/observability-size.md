# Validasi: observability, screenshot gagal, ukuran file (temuan 4, 6, 7)

Tanggal: 2026-11-09. Checkout `staging` HEAD `2630c30`. Validasi read-only: tidak ada perubahan kode aplikasi, tidak ada commit/deploy, tidak ada build (tidak ada `vp build`, tidak ada upload source map), Electron tidak dijalankan. Sentry hanya dibaca (`search_issues`, `get_issue_details`; tidak ada update/resolve). Isi `.env` / `.dev.vars` tidak dibaca ke laporan; hanya nama variabel dan status set/kosong.

Sumber yang divalidasi: `README.md` (temuan 4, 6, 7), `sonnet-sentry.md`, `sol-errors-limits.md`.

## Ringkasan verdict

| #   | Klaim                                                                               | Verdict                                        | Inti koreksi                                                                                                                                                                                                           |
| --- | ----------------------------------------------------------------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1a  | Importer HTML menyisipkan base64 per node (`codec-html.mjs` ~1367)                  | **CONFIRMED**                                  | Cache per URL, tapi data URL ditulis ke setiap node                                                                                                                                                                    |
| 1b  | Dedupe SHA-256 + R2 hanya untuk room, tidak dipakai impor lokal/MCP                 | **CONFIRMED** (dengan catatan)                 | Ada dedupe SHA-256 kedua: template pack zip (`desktop/template-packs.cjs`), juga tidak dipakai importer                                                                                                                |
| 1c  | Batas 5 MiB impor, 5 juta karakter parser, 20 MiB dokumen, 10K node/halaman         | **CONFIRMED** (dengan presisi)                 | Satuan berbeda per jalur: desktop 5 MiB byte, MCP file 5.000.000 byte, MCP inline & parser 5.000.000 code unit; plus 50K node/dokumen                                                                                  |
| 1d  | Banner "File is too large" dipicu pencocokan teks                                   | **PARTIAL**                                    | Benar untuk jalur sync (status text → regex). Tapi `isSizeError` juga mengecek `code === "storage_limit"` dan `status === 413`, dan pre-check `assertShareable` memakai error terstruktur. UI-nya Dialog, bukan banner |
| 2a  | 15 dari 17 issue server unresolved berasal dari test lokal; nyata hanya SERVER-4/-5 | **CONFIRMED**                                  | Diverifikasi ulang langsung di Sentry                                                                                                                                                                                  |
| 2b  | SERVER-6 dari `tests/cloud-apps.mjs` ~222-231                                       | **CONFIRMED** (baris sedikit bergeser)         | Baris aktual 220-228; `cloud/apps.js:210`                                                                                                                                                                              |
| 3a  | Build biasa memasukkan DSN production                                               | **CONFIRMED** (mekanisme dikoreksi)            | Pemuatnya bukan front-end `vp`, melainkan plugin TanStack Start `tanstack-start-core:load-env` yang memanggil `loadEnv(mode, root, "")` dan `Object.assign(process.env, …)`                                            |
| 3b  | Build biasa mengaktifkan upload source map                                          | **CONFIRMED secara statis** (tidak dijalankan) | Mekanisme yang sama mengisi `SENTRY_AUTH_TOKEN`; `sourceMapUpload` membaca `process.env` saat config dievaluasi                                                                                                        |
| 4a  | 4xx masuk lewat `instrumentDurableObjectWithSentry`                                 | **CONFIRMED**                                  | Event SERVER-6: mechanism `auto.faas.cloudflare.durable_object`, `handled: no`                                                                                                                                         |
| 4b  | `rpcFail` di `cloud/http.js` ~123                                                   | **CONFIRMED**                                  | `cloud/http.js:122-124`                                                                                                                                                                                                |
| 4c  | `scrubEvent` di `web/telemetry-scrub.js` (tidak memfilter 4xx)                      | **CONFIRMED**                                  | `web/telemetry-scrub.js:433`, tidak ada filter status                                                                                                                                                                  |
| 5a  | Jendela render/preview/capture ditandai untrusted dan event-nya dibuang             | **PARTIAL**                                    | Hanya event yang membawa tag `event.process=untrusted` (minidump native renderer, ANR) yang dibuang. Pesan `render-process-gone` dari integrasi ChildProcess tidak memakai tag itu, jadi tidak dibuang oleh `keep()`   |
| 5b  | process-gone hanya breadcrumb                                                       | **PARTIAL**                                    | `crashed`/`oom`/`killed` hanya breadcrumb; `abnormal-exit`/`launch-failed`/`integrity-failure` menjadi event                                                                                                           |
| 5c  | Telemetri desktop opt-in                                                            | **CONFIRMED**                                  | `desktop/main.cjs:76-78`, `desktop/telemetry.cjs:105-111`, `:206-213`                                                                                                                                                  |
| 6a  | Tidak ada handler `render-process-gone`/`child-process-gone` di kode desktop        | **CONFIRMED**                                  | Hanya ada `did-fail-load` di `desktop/preview.cjs:971` (bukan render)                                                                                                                                                  |
| 6b  | Tes render lulus di Electron 45; dugaan app yang jalan memakai runtime lama         | **UNVERIFIED** (konsisten secara statis)       | Tidak bisa dibuktikan tanpa menjalankan Electron. Bukti pendukung: Electron 45.2.3 dipasang di `node_modules` pada 2026-11-08 17:30 lokal; kode handler tidak bisa menghasilkan `ERR_FAILED`                           |

## 1. Ukuran file, aset dan batas

### 1a. Base64 per node: CONFIRMED

- `integrations/codec-html.mjs:1367-1390`: `embedImage` menyimpan hasil di `imageCache` dengan kunci `url.href` dan mengembalikan `src: "data:${type};base64,…"`.
- Hasil yang sama ditulis ke setiap node: gambar `<img>` di `:1861-1864` (`src = image.src`) dan background image di `:1449-1453` (`fills.push({ type: "image", src: image.src, … })`).
- Koreksi sol tetap berlaku: tidak di-download ulang per node, tapi string base64 diulang di setiap node. Konten identik dengan URL berbeda tidak di-dedupe.
- Celah tambahan dari sol, terkonfirmasi: `Loader.load` langsung mengembalikan buffer untuk `data:` (`:405-410`) sebelum menghitung `count`/`total`, jadi data URI inline tidak masuk anggaran 4 MiB/gambar dan 12 MiB total. Koreksi kecil terhadap sol: `<img src="data:…">` tidak "diterima apa adanya". Gambar itu tetap lewat `embedImage` (`:1855-1861`), hanya akuntansinya yang terlewat.

### 1b. Dedupe SHA-256 + R2 hanya untuk room: CONFIRMED, dengan catatan

- `cloud/assets.js:177` (`rooms/${roomId}/${sha256}`), `:221-258` (`register` dedupe per room per sha256), `:290-291`, `:342` (verifikasi hash). Client: `web/cloud-assets.js:1-9` hanya aktif selama terhubung ke room.
- Tidak ada referensi aset di `integrations/design-tools.mjs` (tidak ada `upload_asset`), importer, atau `integrations/design-store.mjs`. Schema menolak referensi selain data URL atau URL aset room (`web/document-core.js:568-573`).
- **Catatan baru:** ada dedupe SHA-256 kedua yang tidak disebut audit. Template pack zip menyimpan `assets/<sha256>.<ext>` dan mereferensikannya sebagai `verynize-asset:assets/<name>` (`desktop/template-packs.cjs:8-9`, `:23`). Itu hanya format arsip (referensi diganti lagi saat dibaca), tapi bisa dipakai ulang untuk desain `asset:<sha256>`.

### 1c. Konstanta sebenarnya: CONFIRMED

| Batas                                                                  | Nilai                                                                                                       | Bukti                                                  |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Impor HTML desktop (teks atau file)                                    | `5 * 1024 * 1024` **byte**                                                                                  | `desktop/html-import.cjs:9`, `:50`, `:63`              |
| MCP `import_html` inline                                               | `z.string().max(5_000_000)`: **code unit UTF-16**, bukan byte                                               | `integrations/design-tools.mjs:2897`                   |
| MCP `import_html` path                                                 | `info.size > 5_000_000` **byte**                                                                            | `integrations/design-tools.mjs:2928-2929`              |
| Parser HTML                                                            | `String(source).length > 5_000_000` karakter                                                                | `integrations/codec-html.mjs:183-184`                  |
| Resource eksternal impor                                               | 2 MiB/resource, 4 MiB/gambar, 12 MiB total, 8 s, 48 sheet, depth 8, `maxElements = NODE_LIMITS.perDocument` | `integrations/codec-html.mjs:45-53`                    |
| Dokumen native/headless (juga save desktop lewat `design-files.cjs:7`) | 20 MiB (`JSON.stringify` + 1 byte)                                                                          | `integrations/design-store.mjs:9`, `:18-19`            |
| Dokumen/halaman room                                                   | 20 MiB; meta 2 MiB; pesan 21 MiB                                                                            | `web/room-limits.js:11-17`                             |
| Node                                                                   | 10.000/halaman, 50.000/dokumen                                                                              | `web/document-core.js:25`                              |
| Aset room                                                              | 20 MiB/aset, 2.000/room, inline 8 KiB, SVG 256 KiB                                                          | `web/storage-limits.js:24-28`, `cloud/assets.js:30-32` |

README menyebut "5 MiB impor, 5 juta karakter parser" dengan benar; perlu ditambahkan bahwa ketiga jalur masuk memakai satuan berbeda (MiB byte vs 5.000.000 byte vs 5.000.000 code unit), jadi HTML 4,9 MB yang lolos MCP bisa ditolak desktop dan sebaliknya.

### 1d. "File is too large" lewat pencocokan teks: PARTIAL

- Benar untuk jalur sync: `web/cloud-panel.js:103-108` `status(text)` memanggil `storageLimits.isSizeError(text)` lalu `reportError(text, "sync")`. Regexnya `/exceeds|too large|larger than|over the .* limit|inline .*data|limit for shared/i` (`web/storage-limits.js:329-334`). Ack server juga diklasifikasikan lewat teks `reasons`/`error` (`web/cloud-panel.js:645-650`), dan save desktop (`web/desktop-panel.js:1261`).
- Yang kurang di laporan: `isSizeError` juga menerima `error.code === "storage_limit"` dan `error.status === 413`; pre-check lokal `assertShareable` (`web/storage-limits.js:339-350`) memakai error terstruktur. Ack WebSocket punya flag `tooLarge` (`cloud/rooms.js:367,409,478`) yang dibaca client (`web/cloud-panel.js:648`). Jadi pencocokan teks adalah jalur fallback utama untuk sync dan save, tapi bukan satu-satunya jalur.
- Efek samping teks: status apa pun yang kebetulan mengandung "exceeds" atau "too large" (mis. pesan lain dari server) memunculkan dialog ukuran.
- UI-nya `Dialog` dengan judul `File is too large to ${action}` (`web/src/islands/storage/storage-alerts.tsx:65-71`), bukan banner.

## 2. Sentry (diverifikasi langsung, read-only)

`search_issues` (`verynize-server`, `is:unresolved`, 30d, fresh) mengembalikan **17 issue**:

- Nyata: **VERYNIZE-SERVER-5** (20 event, escalating, 11-07 06:40:10 → 11-08 02:06:29) dan **VERYNIZE-SERVER-4** (11 event, escalating, 11-07 06:39:40 → 17:16:24). Culprit `…/api/rooms/:id/ops`.
- 15 lainnya (SERVER-6, -7, -8, -9, -A … -H, -J, -K, -M) semuanya first/last seen pada 2026-11-08 10:38:24 – 12:19:32Z, culprit `rpcFail` (14) atau D1 (SERVER-M), 0 user.

SERVER-6 (`get_issue_details`): `cloud/apps.js:210` (`PublishedApp.finalize`) → `cloud/http.js:123`, mechanism `auto.faas.cloudflare.durable_object`, `handled: no`, release `a63a0e9…`, environment `cloudflare`, geo ID/Jakarta (mesin developer, bukan Cloudflare US). Test yang memicunya: `tests/cloud-apps.mjs:220-228` (PUT `<p>tampered</p>`, lalu finalize dengan `sha256: "0".repeat(64)`, `assert.equal(response.status, 409, …)`). Koreksi kecil: rentang baris 220-228, bukan 222-231.

**Verdict: CONFIRMED** (15/17 test, hanya SERVER-4/-5 nyata).

## 3. `.env` masuk ke build biasa

### Fakta konfigurasi

- `.env` dan `.dev.vars` di-ignore (`.gitignore:9-13`). `.env` berisi `SENTRY_AUTH_TOKEN`, `SENTRY_DSN_DESKTOP`, `SENTRY_DSN_SERVER`, `SENTRY_DSN_WEB`, `SENTRY_ORG`, `SENTRY_SAMPLE_RATE`, `SENTRY_TRACES_SAMPLE_RATE` (terisi) serta `SENTRY_ENVIRONMENT`, `SENTRY_RELEASE` (kosong). `.dev.vars` berisi keempat nama DSN dan token (terisi).
- Jalur rilis memakai `scripts/env.mjs` (`package.json:22,28,29,44`), yang menggabungkan `.env` ke environment child (`scripts/env.mjs:36`).
- Jalur test **tidak** memakai `env.mjs`: `scripts/run-tests.mjs:620` (`node_modules/vite-plus/bin/vp build`) dan `tests/cloud-harness.mjs:36-41`.
- `web-start/build/telemetry.mjs`: `webTelemetry(env = process.env)` (`:71`) membaca `env.SENTRY_DSN_SERVER`/`SENTRY_DSN_WEB` di hook `config` (`:77-84`) lalu menulisnya ke `define`; `upload = !!env.SENTRY_AUTH_TOKEN` (`:72`) dan `sourceMapUpload` membaca `process.env.SENTRY_AUTH_TOKEN` (`:52-53`) saat file config dievaluasi.
- Worker: `serverOptions` memakai `vars.SENTRY_DSN_SERVER || build.dsn` (`web-start/src/server-telemetry.ts:21-24`); harness test tidak mem-bind DSN, jadi DSN hasil define-lah yang aktif.

### Mekanisme yang sebenarnya (koreksi terhadap sonnet-sentry §4.1)

Sonnet menyimpulkan "the loader is the `vp` front-end, not Vite's `loadEnv`". Itu **keliru**. Pemuatnya adalah plugin TanStack Start yang dipasang oleh `tanstackStart()` di `vite.config.ts:23`:

```js
// node_modules/@tanstack/start-plugin-core/dist/esm/vite/load-env-plugin/plugin.js
configResolved(config) {
  Object.assign(process.env, loadEnv(config.mode, config.root, ""));
}
```

(didaftarkan di `node_modules/@tanstack/start-plugin-core/dist/esm/vite/plugin.js:143`). Prefix `""` berarti semua variabel `.env` masuk ke `process.env` global, dan direktorinya `config.root`, bukan `envDir`. Ini menjelaskan semua pengamatan Sonnet:

- evaluasi config pertama `SENTRY_DSN_SERVER in process.env = false`, evaluasi berikutnya `true`: hook `config` berjalan sebelum `configResolved`, dan proses yang sama memuat config lagi setelah `process.env` dimutasi;
- `envDir: false` tidak membantu, karena plugin memakai `config.root`;
- snapshot `{ ...process.env }` saat config dimuat tidak membantu pada evaluasi kedua/ketiga.

Front-end `vp` sendiri tidak memuat `.env`: docs lokal hanya menyebut `vpx --env-file=.env` (`node_modules/vite-plus/docs/guide/vpx.md:61`) dan menyatakan task berjalan di environment bersih (`node_modules/vite-plus/docs/guide/cache.md:69`). `@cloudflare/vite-plugin` (2.0.0-beta) juga memuat `.env`, tapi hanya menyalin variabel berawalan `CLOUDFLARE_` ke `process.env` (`node_modules/@cloudflare/vite-plugin/dist/index.mjs:86020`).

Docs Vite (Context7, `/vitejs/vite`, `docs/config/index.md`): "variables defined in `.env` … are **not** automatically injected into `process.env` while your `vite.config.*` is running … If, however, values from `.env*` files must influence the config itself (for example … compute `define` replacements), you can load them manually using the exported `loadEnv` helper." `loadEnv` sendiri (`node_modules/vite/dist/vite/node/chunks/node.js:8068`) tidak memutasi `process.env` kecuali `VITE_USER_NODE_ENV`/`BROWSER`. Jadi mutasi itu datang dari TanStack Start, bukan dari Vite.

### Bukti artefak (tanpa build baru)

Output build lokal yang sudah ada, `.cloudflare/output` (mtime 2026-11-08 22:31 lokal = 15:31Z, sama dengan record release `2630c30` di laporan Sonnet), berisi satu literal DSN di `bundle/index.js` (project server) dan satu di bundle client (project web), serta 0 file `.map` (konsisten dengan `filesToDeleteAfterUpload`, tapi tidak membuktikan upload). Tidak diketahui apakah build itu lewat `env.mjs` atau `vp build` biasa.

### Verdict

- **3a CONFIRMED.** Reproduksi Sonnet (DSN ter-bake tanpa variabel yang diekspor) cocok dengan mekanisme di atas. Penyebabnya TanStack Start load-env, bukan `vp`.
- **3b CONFIRMED secara statis, tidak dijalankan.** Pada evaluasi config setelah mutasi, `SENTRY_AUTH_TOKEN` ada di `process.env`, jadi `sentryVitePlugin` terpasang dan `build.sourcemap = "hidden"`. Tidak diuji ulang karena build bisa mengupload.
- **Implikasi untuk fix Sonnet (`VERYNIZE_RELEASE_BUILD`):** fix tetap benar, karena flag itu tidak ada di `.env` dan hanya di-set oleh `env.mjs`. Jangan pernah menaruh flag itu di `.env`, karena TanStack akan menyalinnya juga. Alternatif yang lebih tepat sasaran: baca nilai Sentry dari snapshot `process.env` yang diambil **sebelum** plugin berjalan (saat file config pertama kali dimuat dan belum dimutasi), atau abaikan nilai yang sumbernya `.env` kecuali flag rilis aktif.
- `vp dev` juga terkena: selain mutasi `process.env`, `.dev.vars` menjadi binding Worker. Guard runtime yang diusulkan Sonnet (#10) tetap relevan.

## 4. Jalur 4xx: CONFIRMED

- `cloud/http.js:121-124` `rpcFail` melempar `new Error("[status] message")`; `rpc()` (`:125-133`) mengubahnya kembali menjadi `HttpError` di Worker, **setelah** wrapper DO menangkapnya.
- `web-start/src/server.cloudflare.ts:25-31` membungkus `DesignRoom`, `AccountDirectory`, `PublishedApp` dan `AiRun` dengan `Sentry.instrumentDurableObjectWithSentry`.
- Jalur sendiri sudah memfilter: `cloud/telemetry.js:8-9` (`errorStatus < 500` → return) dan `cloud/worker.js:963-966` (`>= 500` saja).
- `scrubEvent` (`web/telemetry-scrub.js:433-…`) hanya allowlist field, tanpa filter status. Dipakai oleh Worker lewat `web/src/lib/telemetry/privacy.ts:33` (`beforeSend`) dan Node/Vercel lewat `server/telemetry.mjs:43`.
- Docs (Context7, Sentry Cloudflare): DO "each need their own wrapper: `instrumentDurableObjectWithSentry`"; untuk filter: "`beforeSend` … you can either modify the event's data or drop it completely by returning `null`. This hook is called for both error and message events", dan `ignoreErrors` "receives a list of strings and regular expressions to match against the error message". Usulan filter `^\[[1-4]\d\d\] ` di `scrubEvent` (berlaku untuk semua runtime) sesuai docs. `ignoreErrors` di `serverOptions` hanya menutup Worker.

## 5. Telemetri desktop

- `getRendererName` (`desktop/telemetry.cjs:141-144`) mengembalikan `untrusted` untuk webContents yang URL-nya bukan `app://verynize`; `keep` (`:130`) membuang event dengan `tags["event.process"] === "untrusted"`. Jendela render/PDF memuat `verynize-render://document/` (`desktop/render.cjs:187,203,350,367`), jadi diberi nama `untrusted`.
- **Koreksi (PARTIAL):** perilaku `@sentry/electron` 8.3.0 menentukan event mana yang benar-benar dibuang:
  - `render-process-gone` di integrasi ChildProcess memanggil `getRendererName(contents)` tapi hanya memasukkan namanya ke teks pesan (`'untrusted' process exited with 'abnormal-exit'`) dan memanggil `core.captureMessage(message, level)` **tanpa** tag `event.process` (`node_modules/@sentry/electron/main/integrations/child-process.js:76-83`). Integrasi electron-context memberi default `event.process: 'browser'` (`electron-context.js:56-60`), jadi `keep()` **tidak** membuangnya.
  - Yang dibuang adalah event minidump native untuk crash renderer (`sentry-minidump/index.js:107-125`, `event.process = getRendererName(contents)` = `untrusted`) dan ANR renderer (`renderer-anr.js:127`).
  - Event `child-process-gone` (GPU, network/utility) diberi tag `details.type` dan tidak dibuang.
- **5b PARTIAL:** default `events: ['abnormal-exit','launch-failed','integrity-failure']`, breadcrumbs = semua `EXIT_REASONS` (`child-process.js:6-8`). Jadi `crashed`/`oom`/`killed` hanya breadcrumb, sementara tiga reason lain menjadi event. Docs Electron (Context7, `docs/api/app.md`): `child-process-gone` "does not include renderer processes"; reason yang mungkin: `clean-exit`, `abnormal-exit`, `killed`, `crashed`, `oom`, `launch-failed`, `integrity-failure`, `memory-eviction`. Docs crash-reporting: "listen for … `render-process-gone` on `app`, or on a single `webContents` … `child-process-gone` on `app` for all other child processes".
- **5c CONFIRMED:** `readConsent` false tanpa `telemetry.json` `enabled: true` (`desktop/telemetry.cjs:105-111`); `start()` return sebelum `initSdk` (`:206-213`); komentar `desktop/main.cjs:76` "off by default". Semua poin di atas hanya berlaku kalau pengguna sudah opt-in.
- Tambahan: `reportError` hanya dipanggil oleh handler `unhandledRejection`/`uncaughtException` di file yang sama (`:160-189`); `handle()` IPC dan kegagalan render tidak dilaporkan.

## 6. Screenshot gagal (`ERR_FAILED verynize-render://`)

Validasi statis saja.

- Jalur kode: `renderNow` membuat BrowserWindow tersembunyi dengan `partition: "render-" + randomUUID()` dan `sandbox: true` (`desktop/render.cjs:178-193`), lalu `serveRenderPage` (`:281-311`) memasang `webRequest.onBeforeRequest` (membatalkan semua URL selain `RENDER_URL`/`data:`/`blob:`) dan `session.protocol.handle("verynize-render", …)` yang **selalu** mengembalikan `new Response(...)` (200 untuk URL dokumen, 404 untuk lainnya). Setelah itu `loadURL(RENDER_URL)` (`:203`).
- Skema `verynize-render` tidak didaftarkan lewat `registerSchemesAsPrivileged` (hanya `app` yang didaftarkan: `desktop/app-protocol.cjs:62`). Docs Electron (Context7, `docs/api/protocol.md`) menunjukkan `ses.protocol.handle('atom', …)` per sesi tanpa syarat privileged, dan tes render lulus di jalur ini, jadi ini bukan penyebabnya.
- **Deduksi dari implementasi `protocol.handle`** (Context7, `lib/browser/api/protocol.ts`): handler yang melempar menghasilkan `ERR_UNEXPECTED`, response tidak valid juga `ERR_UNEXPECTED`, dan hanya `Response.error()` (type `error`) yang menghasilkan `ERR_FAILED`. Handler kita tidak pernah mengembalikan `Response.error()`. `onBeforeRequest` yang membatalkan request menghasilkan `ERR_BLOCKED_BY_CLIENT`, dan skema tanpa handler menghasilkan `ERR_UNKNOWN_URL_SCHEME`. Jadi `ERR_FAILED` pada `loadURL` hampir pasti tidak berasal dari logika JS handler, melainkan dari lapisan di bawahnya (IPC ke network service/renderer, proses anak mati, atau ketidakcocokan Mojo). Ini konsisten dengan hipotesis runtime basi, tapi tidak membuktikannya.
- Bukti waktu: `node_modules/electron` 45.2.3 dibuat 2026-11-08 17:30:52 lokal (ctime/birth `node_modules/electron/dist`); commit Electron 45 `fc535dd` pukul 19:29 +0700. App dev (`npm start`) yang diluncurkan sebelum 17:30 lalu memunculkan helper dari path yang sudah diganti cocok dengan mekanisme sol. Tidak ada proses app Verynize lama yang berjalan saat validasi ini (yang ada hanya Electron 45 milik agen lain, dimulai 05:06), jadi binary yang di-mapping proses lama tidak bisa diperiksa.
- Catatan baru: `dist/Verynize.app` (versi 0.18.0, dibangun 2026-11-08 14:47) masih memuat Electron Framework 42.11.18. Bundle itu self-contained, jadi tidak terkena penggantian `node_modules`. Kalau screenshot gagal terjadi di app terpaket itu, hipotesis runtime basi **tidak** berlaku dan penyebab lain harus dicari.
- **6a CONFIRMED:** tidak ada `render-process-gone`, `child-process-gone` atau `unresponsive` di `desktop/*.cjs`; satu-satunya `did-fail-load` ada di `desktop/preview.cjs:971` (bukan jalur render). Koreksi kecil untuk sol §7 ("No … `did-fail-load` diagnostics were found in the desktop sources"): ada satu, tapi di preview, bukan render. Kegagalan render ditelan beberapa `catch` (`desktop/render.cjs:318,330,335,474`).
- **6b UNVERIFIED:** "tes render lulus di Electron 45" tidak dijalankan ulang (dilarang menjalankan Electron). Test yang relevan ada: `tests/render-export.cjs` (`scripts/test-manifest.mjs:334`).

## Koreksi terhadap laporan asli (daftar)

1. **README temuan 7 dan sonnet §4.1:** "`vp` memuat `.env`" diganti menjadi "plugin `load-env` TanStack Start (`tanstackStart()` di `vite.config.ts`) menyalin semua variabel `.env` di `config.root` ke `process.env` pada `configResolved`". Akibatnya sama: `vp build` biasa (test runner, cloud harness) mem-bake DSN dan bisa mengupload source map.
2. **README temuan 7 dan sonnet §5.1:** "jendela render/preview/capture … event-nya dibuang" dipersempit menjadi "minidump crash native dan ANR dari jendela itu dibuang; pesan `render-process-gone` untuk `abnormal-exit`/`launch-failed`/`integrity-failure` tetap terkirim (dengan nama `untrusted` di teks), sedangkan `crashed`/`oom`/`killed` hanya menjadi breadcrumb". Semua ini hanya kalau pengguna sudah opt-in.
3. **README temuan 4:** "Banner ukuran muncul lewat pencocokan teks" menjadi "jalur sync dan save mengklasifikasikan error ukuran terutama lewat regex teks (`web/storage-limits.js:329-334`), selain `code: storage_limit`/413; UI-nya Dialog".
4. **Batas:** tambahkan perbedaan satuan (5 MiB byte desktop, 5.000.000 byte file MCP, 5.000.000 code unit inline MCP dan parser) dan batas 50K node/dokumen.
5. **Aset:** sebutkan dedupe SHA-256 kedua di `desktop/template-packs.cjs` (format `verynize-asset:`) sebagai prior art.
6. **SERVER-6:** baris test aktual `tests/cloud-apps.mjs:220-228`.
7. **Screenshot:** tambahkan deduksi bahwa handler tidak bisa menghasilkan `ERR_FAILED`, dan bahwa `dist/Verynize.app` masih memakai Electron 42. Hipotesis runtime basi hanya berlaku untuk app dev dari `node_modules`.
