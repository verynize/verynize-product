# Implementasi: capture halaman web & generasi gambar (2026-10-30)

Agen: capture/generation. Cakupan: dua celah di `docs/implementation-status.md` › "Remaining gaps against Wonder's shipped product":

1. _Arbitrary remote webpage capture with full assets/custom fonts, interactive region selection, source mapping, and interactive behavior recovery._
2. _Photographic image model providers and smooth/high-fidelity curve tracing._

Semua kode dan teks UI ditulis orisinal (paritas perilaku, tidak menyalin kode vendor). `docs/implementation-status.md` tidak diubah; koordinator yang memperbaruinya.

## 1. Capture halaman web arbitrer

### Yang dibangun

- **`desktop/capture-core.cjs` (baru)**: inti capture yang dipakai bersama oleh capture localhost (`desktop/preview.cjs`) dan capture halaman web. Fungsi in-page `snapshotDocument` kini juga mengumpulkan URL CSS background, aturan `@font-face` (lewat CSSOM; stylesheet lintas-origin dicatat untuk diambil main process), source mapping, dan daftar transition. `finishSnapshot` menanam gambar, background, dan font sebagai data URL lalu membangun dokumen v2 serta HTML mandiri.
- **`desktop/capture-remote.cjs` (baru)**: IPC `captureRemoteProbe` dan `captureRemote` untuk URL http(s) apa pun (tanpa kredensial di URL). Halaman dimuat di `BrowserWindow` tersembunyi dengan partisi sesi in-memory baru per capture (`capture-remote-<uuid>`, tanpa `persist:`), `sandbox`, `contextIsolation`, tanpa Node, tanpa preload. JavaScript halaman tetap jalan supaya halaman yang dirender klien ikut tergambar. Izin, popup, download, serta navigasi/request non-http(s) ditolak. Aset lintas-origin diambil lewat `session.fetch` dari partisi yang sama, dengan batas 2 MB per aset, 8 MB untuk gambar, dan 6 MB untuk font.
- **Aset**: `<img>` lintas-origin disimpan sebagai `src` data URL. CSS `background-image: url()` menjadi paint `fills` bertipe `image` (fit cover/contain/fill) di atas paint solid dari `background-color`. Gradien tetap masuk ke `gradient`.
- **Font kustom**: hanya `@font-face` yang family-nya dipakai teks hasil capture yang diunduh (woff2 > woff > ttf/otf, `local()` dilewati). Format diverifikasi dari magic bytes. Hasilnya disimpan di field dokumen baru `fontFaces` (`{family, weight, style, src: data:font/...;base64, unicodeRange?}`), divalidasi di `validate()` `web/app.js` dan `validateDocument` `integrations/design-store.mjs`. Editor mendaftarkan font ini lewat `<style id="bd-embedded-fonts">` (`web/live-preview.js`), dan HTML hasil capture memuat `@font-face` yang sama.
- **Source mapping**: setiap node menyimpan `capture.source = {url, selector, xpath}`. Untuk halaman localhost ada tambahan `dev: {file, line, column, via}` dari atribut `data-source`/`data-source-file|line|column`/`data-inspector-*`/`data-locator`, fiber dev React (`_debugSource` / `__source`), atau `__file` milik Vue. Frame "Captured region" menyimpan URL halaman dan region.
- **Pemulihan perilaku interaktif**: untuk elemen interaktif (link, button, input, `[role=button]`, `[tabindex]`, `cursor:pointer`; maksimal 60), main process memakai DevTools protocol `CSS.forcePseudoState` untuk `:hover`, `:focus`, `:focus-visible`, dan `:active`. Transition dibekukan selama probing, lalu delta computed style dicatat sebagai `capture.states[state] = {style, from, descendants:[{selector, name, style}]}`. `transition-*` dicatat sebagai `capture.transitions`, dan ringkasan yang bisa dibaca manusia ada di `capture.notes`. `previewApp({capture:true})` (localhost, jendela offscreen) memakai probing yang sama. `captureLivePreview` (iframe live) mendapat source mapping tanpa probing state, karena debugger tidak dipasang ke jendela editor.
- **Pemilih region interaktif** (`web/live-preview.js` `pickRegion`): overlay dengan hover highlight beserta label elemen. Klik mengambil kotak elemen, drag membuat persegi panjang bebas, Esc membatalkan. Koordinatnya CSS px viewport halaman, tidak bergantung pada zoom kanvas. Ada di dua tempat:
  - Toolbar preview live: tombol `#live-pick` (⬚). Hover memanggil IPC `previewElementAt`, lalu capture memakai `captureLivePreview({region})`.
  - Dialog "Capture web page" (`#capture-web-dialog`, menu Insert › Capture web page, `window.webCapture.open()`): pilih viewport desktop/tablet/mobile, lalu probe mengirim screenshot dan kotak elemen; hover dan drag dilakukan di atas screenshot. Opsi "Record hover, focus and active states" bisa dimatikan.
- Hasil capture disisipkan dengan id baru di sebelah konten yang sudah ada, dan `fontFaces` digabung tanpa duplikat.

### Bukti uji

- `tests/capture-remote.cjs` (Electron + dua server HTTP di port berbeda, sehingga semua aset lintas-origin; font woff2 asli dari `@fontsource/inter` disajikan dengan nama "Fixture Display"/"Fixture Body"):
  - URL `file:`/`javascript:`/dengan kredensial/tidak valid ditolak. Cookie yang diset halaman tidak terbawa ke capture berikutnya (partisi baru). `window.open` halaman tidak membuka jendela.
  - Elemen yang dibuat script ikut tertangkap, sedangkan script-nya sendiri tidak.
  - `<img>` lintas-origin dan background disimpan **byte-identik** dengan fixture. Paint solid `#010203` ada di bawah gambar. Gradien tetap terjaga.
  - `fontFaces` berisi tepat dua family yang dipakai, byte-identik dengan file woff2. Face yang tidak dipakai **tidak pernah diunduh** (penghitung hit server = 0).
  - Selector/XPath, `dev` file:line:column dari `data-source` dan dari fiber React.
  - `:hover` background `rgb(10,20,30) → rgb(200,0,0)`, outline `:focus-visible`, transform `scale(.95)` dari `:active`, restyle anak (`.card:hover .card-title`), dua transition (250ms ease-in-out, 120ms linear), dan notes.
  - Region clipping dan penolakan region di luar viewport.
  - Dialog UI: hover highlight `button#cta` di atas screenshot, drag 300×90 menghasilkan frame ±2 px. Font terdaftar di editor (`document.fonts` berstatus `loaded`). Dokumen lolos `validateDocument`. `fontFaces` yang tidak valid ditolak oleh kedua validator.
  - Picker live: hover highlight di iframe, klik menangkap kotak tombol, Esc membatalkan.
- `tests/capture-core.cjs` (`node --test`): parsing `@font-face`/`@import`, pemilihan sumber font, sniffing font, konversi warna, normalisasi descriptor, dan model dokumen.
- Regresi tetap lulus: `tests/capture-fidelity.cjs` (kebijakan same-origin untuk capture lokal tidak berubah, `foreignHits` tetap 0), `tests/preview-toolbar.cjs`, `tests/preview-interaction.cjs`.

## 2. Provider model gambar fotografis

- **`integrations/image-provider.mjs` (baru)**:
  - Adapter `openai`: POST `{baseURL}/images/generations` dengan `{model, prompt, n:1, size}`, membaca `data[0].b64_json` atau `data[0].url`. URL diunduh **tanpa** API key.
  - Adapter `http` generik: POST `{baseURL}` dengan `{prompt, model, width, height}`. Respons berupa byte gambar mentah, atau JSON `image`/`b64_json`/`url`.
  - Base URL wajib https; http hanya untuk loopback. URL yang memuat kredensial/query/fragment ditolak.
  - Output diverifikasi sebagai PNG/JPEG/WebP lewat magic bytes beserta dimensinya, maksimal 15 MB. Timeout 120 detik, dan bisa dibatalkan.
  - Pesan error provider diringkas, lalu key (serta pola `Bearer …`/`sk-…`) **diredaksi**. Tidak ada logging.
- **`desktop/generate.cjs`**: IPC `imageProviderGet` / `imageProviderSet` / `generateImage`. Pengaturan disimpan di `userData/image-provider.json` (mode 0600, ditulis atomik). API key hanya disimpan sebagai ciphertext `safeStorage` (Keychain macOS). Jika enkripsi OS tidak tersedia, key hanya disimpan di memori sesi dan tidak pernah ditulis ke disk. Key tidak pernah dikembalikan ke renderer. `cancelGeneration` juga membatalkan request gambar.
- **UI** (`web/generate-panel.js`): dialog "Generate image" punya pilihan Engine (agen lokal → SVG, atau Image model → foto). Pengaturan provider ada di dialog yang sama (provider, base URL, model, ukuran, API key bertipe password yang dikosongkan setelah disimpan, status penyimpanan key, Remove key). Hasilnya disisipkan sebagai node `image` dengan ukuran natural, diskalakan ke maksimal 512 px.
- **Provider live = "needs live credential"**: tidak ada akun eksternal yang dipakai. Semua uji memakai server fixture lokal yang mengembalikan PNG asli (`tests/fixtures/png.cjs`, encoder PNG nyata dengan zlib dan CRC).
- Bukti:
  - `integrations/image-provider.test.mjs` (6 uji): bentuk request, Bearer, decode PNG byte-identik, URL hasil diunduh tanpa key, provider generik (raw/JSON), 401 tanpa key di pesan, non-gambar ditolak, pembatalan, dan parser JPEG.
  - `tests/generation-image.cjs` (Electron):
    - Alur UI lengkap dengan fixture OpenAI-compatible: gambar 96×64 disisipkan byte-identik.
    - Key tidak muncul di hasil `get()`, file pengaturan, localStorage/sessionStorage/dokumen, maupun stdout/stderr/console. Ciphertext tersimpan, dan setelah **relaunch** key dari Keychain dipakai lagi tanpa diketik ulang.
    - Error 401 tanpa key. Provider generik dengan PNG mentah 40×30. `clearKey` menghapus key.

## 3. Tracing kurva halus (`web/trace-bitmap.js`, ditulis ulang)

- Pipeline:
  1. Downscale ke `detail` (default 256, rentang 16–1024).
  2. Kuantisasi palet. Warna dipilih dari jumlah piksel _interior_ (piksel AA di tepi tidak menjadi warna baru), dan warna yang berjarak < 24 dari warna terpilih digabung.
  3. **Contour tracing** per warna di sepanjang tepi piksel (loop luar dan lubang, `fill-rule="evenodd"`).
  4. Penghapusan tangga: titik tengah setiap run, dengan sudut piksel asli dipertahankan bila kedua run ≥ 3 px.
  5. **Ramer–Douglas–Peucker** untuk deteksi sudut tambahan (belokan > 60°) dan untuk menentukan segmen lurus (`L`).
  6. **Fitting Bézier kubik gaya Schneider** (least-squares, reparameterisasi Newton, split di titik error terbesar, tangen tengah yang kontinu). Loop tanpa sudut ditutup dengan tangen simetris.
  - Warna yang menutupi seluruh kanvas opak digambar sebagai `<rect>` latar, dan lapisan yang lebih kecil diberi hairline stroke berwarna sama untuk menutup celah anti-alias. `shape-rendering="crispEdges"` dihapus.
- **Metrik fidelitas** (`tests/generation-trace.cjs`): sumber anti-alias di-trace, SVG dirasterisasi ulang di ukuran sumber, lalu IoU dihitung per kelas warna.

  | Kasus                         | Ambang (ditetapkan) | Hasil                         |
  | ----------------------------- | ------------------- | ----------------------------- |
  | Lingkaran                     | ≥ 0.985             | 0.996 / 0.994                 |
  | Lingkaran 512 px di-downscale | ≥ 0.98              | 0.998 / 0.998                 |
  | Bintang                       | ≥ 0.975             | 0.995 / 0.985                 |
  | Glyph tebal "Rg"              | ≥ 0.965             | 0.995 / 0.980                 |
  | Scene empat warna             | ≥ 0.965 per warna   | 0.997 / 0.985 / 0.987 / 0.978 |

  Uji kehalusan juga lulus:
  - Lingkaran menjadi satu subpath dengan **4 kubik**, deviasi radial maksimum **0.20 px** (ambang 0.75).
  - Bintang memakai 17 segmen (ambang 10–30).
  - Persegi dua warna tetap memakai sudut tepat dan garis lurus.

- `tests/generation.cjs` (uji tracing dua warna yang lama) tetap lulus tanpa perubahan asersi.

## File

- Baru:
  - `desktop/capture-core.cjs`, `desktop/capture-remote.cjs`
  - `integrations/image-provider.mjs`, `integrations/image-provider.test.mjs`
  - `tests/capture-core.cjs`, `tests/capture-remote.cjs`, `tests/generation-image.cjs`, `tests/generation-trace.cjs`, `tests/fixtures/png.cjs`
- Milik agen ini:
  - `desktop/preview.cjs`: bagian capture dipindah ke core, ditambah `previewElementAt` dan registrasi capture remote.
  - `desktop/generate.cjs`
  - `web/live-preview.js` / `.css`
  - `web/generate-panel.js` / `.css`
  - `web/trace-bitmap.js`
- Edit kecil di file bersama (Edit tool):
  - `desktop/preload.cjs`: `captureRemote`, `captureRemoteProbe`, `previewElementAt`, `imageProvider`.
  - `web/app.js` dan `integrations/design-store.mjs`: validasi `fontFaces`.
  - `web/src/islands/chrome/AppMenu.tsx` dan `legacy.ts`: item menu `capture-webpage`.
  - `package.json`: `test:desktop` ditambah `generation-image`, `generation-trace`, `capture-core`, `capture-remote`. `integrations/*.test.mjs` sudah tercakup glob.
  - `desktop/README.md`: kontrak IPC baru.
- Format hanya dijalankan pada file baru/milik sendiri per path (`vp fmt <paths>`). File bersama tidak diformat ulang, karena repo tidak punya config fmt dan versi HEAD-nya sendiri sudah tidak lolos `--check` default.

## Validasi

- `npm run build:ui` ✔ · `npm run lint:ui` ✔ · `npm run typecheck:ui` ✔ (sempat gagal sementara karena `web/src/islands/code/controller.ts` milik agen lain yang sedang dikerjakan; lulus di run berikutnya) · `npm run check` ✔ · `node eval/run-fidelity.mjs` **26/26** (105/105 cek).
- Uji yang terdampak lulus: `capture-core`, `capture-remote`, `capture-fidelity`, `generation`, `generation-image`, `generation-trace`, `preview-toolbar`, `preview-interaction`, `integrations/image-provider.test.mjs`.
- Catatan di luar area ini:
  - `node --test integrations/*.test.mjs` hasilnya 162 lulus dan 3 gagal. Ketiganya ada di `integrations/codec-roundtrip.test.mjs` / `codec-source.mjs` (stub "not yet" serta kitchen-sink `outlineToken/strokeColors/strokeToken`), yaitu pekerjaan agen lain yang sedang berlangsung.
  - `tests/capture-live-state.cjs` kadang gagal (`loads` 2 ≠ 1). Kegagalan yang sama **terreproduksi pada ekspor HEAD yang bersih**, jadi ini flake yang sudah ada sebelumnya, bukan regresi dari perubahan ini.

## Batasan yang tersisa (jujur)

- **Provider live: needs live credential.** Adapter OpenAI-compatible belum diuji terhadap API OpenAI sungguhan. Respons `gpt-image-1`/`dall-e` ditangani lewat bentuk `b64_json`/`url`.
- `fontFaces` sudah dirender di kanvas editor dan di HTML capture, tetapi belum diteruskan ke ekspor `export-html.mjs` / render PNG/PDF `desktop/render.cjs`. Jalur font di sana masih memakai cache Fontsource, jadi family kustom akan jatuh ke fallback di ekspor.
- State interaktif disimpan sebagai metadata dan notes. Belum ada UI inspector untuk melihat atau menerapkan varian hover, dan belum menjadi komponen/varian yang bisa diedit.
- Animasi `@keyframes`, pseudo-element (`::before/::after`), background yang berulang (tile, didekati dengan cover), iframe di dalam halaman, shadow DOM, dan konten di luar viewport (tanpa auto-scroll) belum direkonstruksi. Batasnya 500 elemen, 40 gambar/background, dan 40 font.
- Capture iframe live tidak memprobe state, karena DevTools debugger tidak dipasang pada jendela editor.
- Halaman yang mewajibkan login hanya bisa ditangkap sebagai tampilan publiknya, karena sesi capture sengaja dibuat terisolasi tanpa cookie.
- Tracing di-tuning untuk ilustrasi/logo/grafik datar. Foto dengan gradasi halus tetap dikuantisasi ke maksimal 16 warna (posterisasi), sesuai sifat vektorisasi.

## Tindak lanjut: `fontFaces` dipakai oleh semua ekspor (2026-10-30)

Batasan "font hasil capture belum diteruskan ke ekspor" sudah ditutup.

- **`integrations/font-faces.mjs` (baru)**: `documentFontCss(document, markup)` menyusun aturan `@font-face` dengan sumber data URL. Setiap face divalidasi ulang, dan hanya family yang muncul di markup yang ikut (nama class Tailwind yang memakai `_` untuk spasi juga dikenali). Builder yang sama untuk renderer ada di `web/live-preview.js` sebagai `window.embeddedFontCss`.
- **HTML**:
  - `web/app.js` (edit kecil) menyisipkan aturan font ke HTML artwork (`exportArtwork`, dipakai PNG/JPG/WebP/PDF/SVG/HTML/Code dari inspector) dan ke ekspor HTML halaman (`exportHTML`, `exportPrintHTML`).
  - `integrations/export-html.mjs` (CLI/MCP/screenshot bridge) melakukan hal yang sama.
  - CSP `exportPDF` lama di `desktop/preview.cjs` kini mengizinkan `font-src data:`.
- **PNG/JPG/WebP/PDF** (`desktop/render.cjs`, edit kecil):
  - `liftEmbeddedFonts` mengangkat `@font-face` data dari HTML, menyuntikkannya lewat `insertCSS` supaya URL navigasi tetap kecil, dan tidak mencari family tersebut di cache Fontsource (tidak ada request jaringan, tidak dilaporkan `missing`).
  - **Bug yang ditemukan dan diperbaiki**: `renderPDF` (halaman tanpa JavaScript) mencetak sebelum font web selesai dimuat, sehingga PDF berisi teks dengan font web kosong (743 byte, tanpa glyph). Ini juga terjadi pada font Fontsource biasa. `settleFonts` kini memuat dan menunggu `document.fonts` lewat DevTools `Runtime.evaluate` sebelum `printToPDF`.
- **Code export** (`integrations/export-code.mjs`, edit kecil):
  - Flavor CSS mempertahankan `@font-face` dari HTML artwork, atau menambahkannya dari `document`.
  - Komponen Tailwind memuat blok komentar "Embedded fonts used by the classes below", mengikuti konvensi blok variabel yang sudah ada. Karena berbentuk komentar, importer JSX tidak terpengaruh.
- **Bukti piksel** (`tests/capture-export-fonts.cjs`, ditambahkan ke `test:desktop`):
  - Halaman lokal memakai woff2 Inter Bold dengan nama "Fixture Display" dan fallback `serif`. Halaman di-capture, lalu layer teksnya diekspor.
  - Mask glyph dibandingkan dengan IoU: hasil vs referensi yang dirender dengan Inter Bold harus ≥ 0.9, hasil vs fallback serif harus ≤ 0.7. PDF dirasterisasi dengan `sips` macOS.

    | Format | IoU vs referensi Inter Bold | IoU vs fallback serif |
    | ------ | --------------------------- | --------------------- |
    | PNG    | 1.000                       | 0.283                 |
    | JPG    | 1.000                       | 0.285                 |
    | WebP   | 1.000                       | 0.283                 |
    | PDF    | 1.000                       | 0.301                 |

  - Byte woff2 di `exportHTML` identik dengan file yang di-capture. Font yang tidak dipakai tidak ikut diekspor. Ekspor Tailwind dan CSS memuat aturannya. `fonts.missing` tidak menyebut family hasil capture.
- **Validasi**:
  - `build:ui` ✔ · `lint:ui` ✔ · `typecheck:ui` ✔ · `check` ✔ · fidelity **30/30** (159/159 cek; jumlah fixture bertambah karena agen lain).
  - `node --test integrations/*.test.mjs` 174/174 ✔.
  - `tests/render-export.cjs`, `capture-export-fonts`, `capture-remote`, `capture-core` dan `generation` ✔.
  - `tests/capture-fidelity.cjs` kadang gagal (`foreignHits` 1 ≠ 0). Kegagalan yang sama terjadi 1 dari 6 kali pada **ekspor HEAD yang bersih**, jadi ini flake yang sudah ada sebelumnya, bukan regresi.
- **Sisa batasan**: SVG hanya membawa font lewat `foreignObject` dari HTML artwork (vektor murni tidak memakai glyph font). Font tetap disertakan sebagai data, sehingga ukuran ekspor bertambah sebesar file font yang dipakai (maksimal 2 MB per font).
