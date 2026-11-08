# Implementasi celah Figma — laporan agen (30 Oktober 2026)

Celah: "Native Figma clipboard conversion, OAuth account connection and full Figma fidelity; native .fig/.pen compatibility. PAT-based supported REST import is implemented but awaits a live account test."

## Ringkasan

| Bagian                                                                                                               | Status                                       | Bukti                                                                               |
| -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- | ----------------------------------------------------------------------------------- |
| Tempel (paste) lapisan dari Figma                                                                                    | Diimplementasikan                            | `tests/figma-binary.cjs`, `tests/figma-paste.cjs` (Electron, clipboard sistem asli) |
| Impor file `.fig` (dialog + drag-drop)                                                                               | Diimplementasikan                            | `tests/figma-binary.cjs`, `tests/figma-paste.cjs`                                   |
| OAuth Figma (PKCE, loopback, safeStorage, refresh, disconnect)                                                       | Diimplementasikan, **needs live credential** | `tests/figma-oauth.cjs` terhadap server OAuth fixture lokal                         |
| Fidelity konversi (vektor, boolean, auto layout, constraint, efek, gradien, stroke per sisi, teks, komponen, gambar) | Diimplementasikan dengan batas tercatat      | `tests/figma-binary.cjs`, `tests/figma-import.cjs`                                  |
| `.pen`                                                                                                               | Tidak layak — ditolak dengan penjelasan      | `tests/figma-binary.cjs`, `tests/figma-paste.cjs`                                   |

## Arsitektur

- `integrations/figma-kiwi.mjs` (baru): codec biner "kiwi" yang ditulis sendiri (format publik, proyek referensinya berlisensi MIT; tidak ada kode vendor/dependensi baru). Membaca skema biner yang dibawa setiap arsip, lalu men-decode pesan dengan skema itu. Juga: arsip `fig-kiwi` (chunk raw-deflate, zstd lewat `zlib.zstdDecompressSync`, atau tanpa kompresi), pembaca/penulis zip (stored + deflate), parser/pembuat HTML clipboard (`(figmeta)…(/figmeta)` dan `(figma)…(/figma)`), batas ukuran (200 MB arsip, 400 MB hasil dekompresi, kedalaman dan panjang array).
- `integrations/figma-scene.mjs` (baru): `nodeChanges` → node berbentuk REST API (transform absolut → `absoluteBoundingBox`, `size`, `relativeTransform`; blob perintah path → string path SVG; paint, efek, auto layout, constraint, teks dan tabel override gaya; instance diekspansi dari komponennya dengan override dan data turunan berbasis guid path, properti komponen diwarisi). Halaman `internalOnly` tidak ditampilkan tetapi dipakai untuk komponen.
- `desktop/figma.cjs`: satu konverter `convertFigma` untuk REST, clipboard dan `.fig`. Handler IPC baru: `figmaClipboard`, `figmaFile`, `figmaFileOpen`; `importFigma` menerima `useAccount`. REST kini meminta `geometry=paths`.
- `desktop/figma-oauth.cjs` (baru): alur OAuth. Didaftarkan di `desktop/main.cjs` (satu baris); API di `desktop/preload.cjs` (`figmaClipboard`, `figmaFile`, `figmaFileOpen`, `figmaOAuth.*`).
- `web/figma-panel.js/.css`: dialog Figma (tempel, buka `.fig`, tautan dengan PAT atau akun, pengaturan akun: client ID, client secret opsional, port redirect, Connect/Disconnect), drop `.fig`/`.pen` di kanvas, dan `window.figmaPaste`.
- `web/canvas-interactions.js`: tiga baris di handler paste — HTML Figma diserahkan ke `window.figmaPaste`, hasilnya ditempel lewat `paste()` yang sudah ada (validasi, penempatan di viewport, seleksi, satu langkah undo).
- `web/src/islands/settings/pages.tsx`: hanya teks baris Figma di Settings › Connections (tombolnya membuka dialog yang sama, tempat client ID diatur).

## Fidelity konversi

Dipetakan ke model dokumen yang sudah ada (tanpa perubahan skema):

- Posisi dari transform node: rotasi dan flip (determinan negatif → `flipX`), pusat kotak lokal dipetakan agar rotasi CSS di tengah elemen sama dengan Figma.
- Vektor, bintang, poligon, garis, busur ellipse dan operasi boolean → gambar SVG tertanam (fill per paint, gradien linear/radial sebagai `userSpaceOnUse` dengan matriks dari handle, stroke dari `strokeGeometry`; kotak diperluas mengikuti geometri). Operand boolean tidak dikeluarkan.
- Gradien: linear dengan sudut dari handle di ruang piksel dan posisi stop diproyeksikan ulang ke garis gradien CSS; radial/diamond dengan pusat dan jari-jari dari handle (diamond diaproksimasi radial); angular → `conic-gradient`. Beberapa paint → `fills` (urutan dibalik, indeks 0 di atas).
- Gambar: fill/fit/stretch/tile → cover/contain/fill/none; di frame menjadi paint gambar.
- Stroke: seragam → outline (offset inside/center/outside, putus-putus); per sisi → `strokeWidths` dengan kompensasi offset anak dan padding.
- Efek: drop/inner shadow → `shadows` (box/drop/text sesuai jenis lapisan), layer/background blur → `filters` (radius/2).
- Auto layout: arah, padding per sisi (sebelumnya jatuh ke posisi bebas), gap, wrap + gap sumbu silang, perataan, hug/fill, anak absolut. Constraint (kiri/kanan/tengah/stretch/skala) lewat `anchorPatch` milik kanvas, diukur di dalam border induk.
- Teks: family, bobot dari nama style, italic, ukuran, perataan, line height, letter spacing (persen → px), case, dekorasi, rentang tebal/miring/warna/ukuran.
- Komponen/instance diratakan menjadi lapisan bernama `Instance (Komponen)`; opacity, blend mode, clip content, radius sudut per sudut.

Diperingatkan (tidak diam-diam hilang): mask (disembunyikan, saudara tidak di-clip), family/spacing/dekorasi/bobot lebih ringan per rentang, perataan teks vertikal, transform crop gambar, stroke teks, induk berputar, gradien off-centre di tumpukan multi-paint, gambar yang tidak ada di data clipboard (clipboard hanya membawa referensi hash gambar).

Dua asersi lama di `tests/figma-import.cjs` diganti dengan yang lebih ketat karena perilakunya kini lebih setia: frame dengan padding asimetris kini `flex` dengan padding per sisi yang diperiksa persis (sebelumnya diharapkan `free` + peringatan), dan fill gambar `FILL` kini `objectFit: 'cover'` tanpa peringatan "contain scaling".

## OAuth — needs live credential

Authorization code + PKCE (S256), `state` acak, listener loopback `http://127.0.0.1:<port>/figma/callback` (port default 47615, harus terdaftar di aplikasi OAuth Figma milik pengguna), pertukaran kode dengan `code_verifier`, client secret opsional lewat Basic auth, token dan secret disegel dengan Electron `safeStorage` di `userData/figma-oauth.json` (mode 0600), refresh satu kali bersamaan saat sisa umur < 1 menit, cancel/timeout 5 menit, disconnect. Tanpa secure storage tidak ada rahasia yang disimpan. Endpoint default Figma (`/oauth`, `/v1/oauth/token`, `/v1/oauth/refresh`); `VERYNIZE_FIGMA_OAUTH_ORIGIN` (hanya http loopback) untuk server fixture.

Diuji terhadap server OAuth fixture lokal (redirect HTTP nyata ke listener loopback, verifikasi challenge S256 di server). Tidak ada aplikasi OAuth Figma atau akun nyata yang tersedia, jadi pendaftaran redirect, apakah Figma menerima PKCE tanpa secret untuk aplikasi tertentu, dan impor REST terautentikasi **belum diverifikasi secara live**. Di Electron, tes hanya menyimpan client ID/port (tanpa memanggil safeStorage, agar tidak memicu prompt Keychain); penyegelan diuji di node dengan implementasi AES-GCM berantarmuka sama.

## .pen — tidak layak

File `.pen` dienkripsi oleh vendornya dan hanya dapat dibuka dengan alat vendor tersebut. Mendekripsinya berarti membobol perlindungan vendor; itu tidak dilakukan. Drop atau pemilihan `.pen` ditolak dengan pesan yang menyarankan ekspor ke format lain (misalnya SVG/PNG).

## Fixture

`tests/fixtures/figma-scene-fixture.mjs` menulis skema subset sendiri dengan nama field yang dibaca importer, menyusun adegan (dokumen, halaman internal dengan komponen, frame dengan gradien/shadow/stroke per sisi, teks bergaya, vektor, boolean, auto layout wrap, anak absolut, instance dengan override teks, constraint, rotasi, ellipse radial, gambar, kaca blur, garis, node tersembunyi dan terhapus), meng-encode-nya dengan codec kita (deflate dan zstd), membungkusnya sebagai HTML clipboard dan sebagai zip `.fig` dengan PNG 2×2 yang dibuat sendiri. Tidak ada konten file Figma.

Batas yang diketahui: skema fixture ditulis dari pengetahuan publik tentang nama field Figma; data dari Figma asli belum pernah dicoba (tidak ada sampel bebas hak cipta). Decoder bersifat generik terhadap skema, tetapi bila Figma memakai nama/semantik field yang berbeda, pemetaan di `figma-scene.mjs` perlu disesuaikan. Lapisan yang diubah ukurannya tanpa `derivedSymbolData` mempertahankan posisi anak komponen (diperingatkan).

## Validasi

- `node --test tests/figma-import.cjs tests/figma-binary.cjs tests/figma-oauth.cjs`: 15/15 lulus.
- `node tests/figma-paste.cjs`: lulus (paste clipboard sistem → 15 lapisan, render SVG/teks/backdrop-filter, satu undo, data rusak dilaporkan, drop `.fig` dengan gambar, drop `.pen` ditolak, pengaturan client ID tersimpan).
- `node tests/desktop-ipc.cjs`, `node tests/settings.cjs`, `node tests/canvas-interactions.cjs`: lulus.
- `npm run build:ui`, `npm run lint:ui`, `npm run typecheck:ui`, `npm run check`: bersih (pada satu putaran sebelumnya `typecheck:ui` sempat gagal di `inspector/properties.tsx` dan `settings/projects.tsx` milik agen lain; putaran terakhir bersih).
- `node eval/run-fidelity.mjs`: 26/26 fixture, 105/105 cek.
- Tes baru ditambahkan ke `test:desktop` di `package.json`. Format hanya file saya, per path.
