# Validasi temuan performa renderer (temuan 3 dan 8)

Tanggal: 2026-11-09. Checkout `2630c30` (branch `staging`), `web/dist/ui.js` di-build ulang dengan `npm run build:ui` sebelum mengukur. Tidak ada kode aplikasi yang diubah dan tidak ada commit. Yang divalidasi: klaim di `README.md` (temuan 3 dan 8), `astra-renderer-perf.md` dan tabel commit-cost di `opus-api-collab.md` §2.

## Ringkasan verdict

| #   | Klaim                                                                                                                                | Verdict                                                                                  | Angka terukur (mesin ini)                                                                                                                                                                                                              |
| --- | ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 5K: satu edit properti ~166–177 ms; ~118 ms dari ~10 `structuredClone` dokumen penuh, 7 di loop subscriber `web/app.js:507` (~76 ms) | **CONFIRMED** (jumlah dan lokasi clone tepat sama; di sini angka absolutnya lebih buruk) | 5K: sync **237 ms** median (209–245), fence 274 ms; **10 clone sinkron = 155 ms**, 7 di `app.js:507` = **104 ms**. Pada run pustaka 190–197 ms. 1K: 43–75 ms, 10K: 441–444 ms                                                          |
| 2   | Select all ~0,8 s (1K) / ~6,3 s (5K) / ~18,9 s (10K), ~394K elemen, heap ~1,1 GiB di 10K                                             | **CONFIRMED**                                                                            | 0,77–0,78 s / 5,2–5,9 s / 13,7–17,2 s; elemen **394.575** (sama persis); heap **1.147–1.156 MiB**                                                                                                                                      |
| 3   | Pan/zoom lancar (zoom p95 1,9/6,5/12 ms)                                                                                             | **PARTIAL**                                                                              | Waktu handler zoom p95 2,0 / 6,0–6,1 / 10,5–11,7 ms cocok. Tapi di 10K rAF p95 zoom **33,4 ms** dan **13–17 %** interval >25 ms, jadi zoom 10K tidak lancar                                                                            |
| 4   | File library menulis seluruh library ke localStorage tiap render; storage-limits menelusuri seluruh dokumen                          | **CONFIRMED** (storage-limits dengan catatan: di-debounce, bukan tiap render)            | Tiap edit: `setItem("verynize-library-v1")` sinkron sebesar **semua file** (2 file: 3.732.965 char = dokumen 5K 3.112.779 + file 1K ~620K). storage-limits: 2 `JSON.stringify` penuh (~39 ms di 5K), sekali setelah jeda 700 ms + idle |

Angka ini kasar. Hasilnya dari satu mesin yang tidak terisolasi, dengan 2–3 ulangan per ukuran, dan load average bervariasi selama run.

## Mesin dan metode

- Apple M1, 8 CPU logis, 8 GiB RAM, macOS 27.2. Electron **45.2.3** / Chromium **156.0.8078.80**, Node v26.13.0. Mesin baru di-boot. Load average 1 menit saat run 1,6–6,7 (5 dan 15 menit: 5–12). App lain (T3 Code dan agen lain) tetap berjalan.
- Skrip: `validation/repro/measure-renderer.cjs`. Skrip ini memakai fixture sintetis yang sama dengan audit, `synthetic(n)` dari `eval/canvas-perf/bench-verynize.cjs` (satu halaman; 10 % frame, 65 % rectangle, 20 % text, 5 % image SVG), dan helper `eval/canvas-perf/renderer.cjs` (`__perf.action/motion`, fence = setTimeout 0 + 2 rAF). Setiap ukuran dijalankan di Electron baru dengan `--user-data-dir` sementara, satu instance sekali jalan, berurutan. Profilnya dihapus setelah selesai.
- Instrumentasi di halaman: wrapper penghitung pada `structuredClone` (hanya nilai yang berisi `pages`, atau record file yang berisi `document.pages`), `JSON.stringify` (>50K char), `Storage.prototype.setItem` dan `Element.prototype.getBoundingClientRect`. Wrapper hanya aktif selama operasi yang diukur. Satu edit atribusi menangkap 2 frame pemanggil, lalu 7 edit dengan penghitung saja, lalu 5 edit tanpa instrumentasi. Hasil edit tanpa instrumentasi (5K: 237,1 ms) sama dengan yang berinstrumentasi (238,5 ms), jadi overhead wrapper bisa diabaikan.
- Edit memakai `window.design.updateNodes(["n1"], {color|x})`. Angkanya: sync (durasi pemanggilan), fence, dan "deferred" (semua yang terjadi 1,5 s setelahnya).
- Run: `renderer-results-run1.json` dan `renderer-results-run2.json` (1K/5K/10K), `renderer-results-run3.json` (5K/10K dengan waktu `getBoundingClientRect`), `renderer-results-run-rects.json` (atribusi `getBoundingClientRect` di 5K), `renderer-results-library.json` (pustaka 2 file).

Perintah:

```sh
npm run build:ui
node docs/audits/2026-11-08-perf-ux/validation/repro/measure-renderer.cjs --sizes 1000,5000,10000 --out /abs/run.json
node docs/audits/2026-11-08-perf-ux/validation/repro/measure-renderer.cjs --sizes 5000 --edits 2 --rect-sites --out /abs/rects.json
node docs/audits/2026-11-08-perf-ux/validation/repro/measure-renderer.cjs --library --out /abs/lib.json   # opsional --hold DIR --shots DIR
```

## Klaim 1: biaya commit dan `structuredClone`

### Di kode (file:line saat ini)

Satu `updateNodes` (`web/app.js:1199-1225`):

- `JSON.stringify(design)` untuk undo (`app.js:1206`) dan `JSON.parse(before)` untuk cek world bounds (`app.js:1214`).
- `validate(structuredClone(design))` (`app.js:1213`): **1 clone**.
- `render()` → `save()` (idle, `app.js:143-161`), lalu loop subscriber `fn(fn.length ? structuredClone(design) : undefined)` (`app.js:505-509`). Di runtime ada 15 subscriber dan **7** di antaranya punya parameter (diambil dari binding `subscribers`):
  - `web/live-preview.js:695` `(doc) => …`
  - `web/live-preview.js:809/824` `syncEmbeddedFonts(doc)`
  - `web/src/lib/bridge.ts:97` `(doc) => { snapshot = doc … }`
  - `web/src/islands/sidebar/hooks.ts:27`, **4 instance** (satu per hook `useDesignSelect` yang ter-mount)
- Subscriber tanpa parameter `web/wonder-shell.js:891-893` memanggil `window.design.getDocument()` (`app.js:1333`, **1 clone**), lalu `sync()` melakukan `JSON.stringify(document)` (`:270`), `file.document = structuredClone(document)` (`:273`, **1 clone**) dan `persist()` (`:176-205`).
- Total sinkron: **10 clone dokumen penuh per edit**, sama dengan klaim. `canvas-tiles.js:419` tidak ikut subscribe di konfigurasi default.

Clone yang tertunda (masih akibat edit yang sama, di task terpisah dalam 1,5 s): `agent-bridge.js:115` (`getDocument` di setTimeout `syncFonts`), `fileLibrary.list()` `wonder-shell.js:973` (`structuredClone(f)` **per file** di pustaka) ditambah `documentSafety.check` (`document-safety.js:360`, clone lagi), dan `version-history.js:230` (`flush`). Totalnya **14 clone per edit dengan 1 file, 15 dengan 2 file**.

### Terukur

|  Nodes | 1 clone (median) |     Edit sync median | Edit fence median | Clone sinkron | ms clone sinkron | 7 clone `app.js:507` | Total clone ≤1,5 s |
| -----: | ---------------: | -------------------: | ----------------: | ------------: | ---------------: | -------------------: | -----------------: |
|  1.000 |       2,9–6,4 ms |             43–75 ms |         77–108 ms |            10 |            30–46 |              20,5 ms |      14 / 47–65 ms |
|  5.000 |            18 ms | **237 ms** (209–245) |            274 ms |            10 |          **155** |           **104 ms** |        14 / 231 ms |
| 10.000 |         30–31 ms |       **441–444 ms** |            488 ms |            10 |      **297–298** |           **209 ms** |    14 / 438–464 ms |

Atribusi per lokasi di 5K (run2): `app.js:507` 7× = 103,8 ms; `app.js:1213` 15,2 ms; `getDocument` dari `wonder-shell.js:892` 15,1 ms; `wonder-shell.js:273` 10,5 ms. Tertunda: `agent-bridge.js:115` 40,7 ms, `wonder-shell.js:973` 11,1 ms, `document-safety.js:360` 10,6 ms, `version-history.js:230` 14,8 ms. Di 1K, run1 (75 ms) lebih lambat dari run2 (43 ms) karena run1 jalan tepat setelah boot (clone 1K 6,4 ms vs 2,9 ms). Ini contoh betapa kasarnya angka di sini.

Kesimpulan: struktur klaim terbukti persis (10 clone, 7 di `app.js:507`). Porsi clone ~65 % dari waktu sync, sama dengan klaim (118/177 ≈ 67 %). Angka absolut di 5K lebih tinggi (237 vs 166–177 ms). Tabel astra sendiri mencatat 217,5 ms, jadi angka 166–177 ms dari opus adalah yang paling rendah di antara ketiganya.

## Klaim 2: select all

|  Nodes |        Sync |              Fence (run1 / run2 / run3) |   Klaim | Elemen setelahnya |     Heap setelahnya | Panggilan / waktu `getBoundingClientRect` |
| -----: | ----------: | --------------------------------------: | ------: | ----------------: | ------------------: | ----------------------------------------: |
|  1.000 |  170–175 ms |                            776 / 771 ms |  837 ms |            41.353 |         131–142 MiB |                                       100 |
|  5.000 | 1,69–1,77 s | 5,23 / 5,56 / 5,85 s (rects run 5,92 s) |  6,33 s |           198.339 |         588–614 MiB |                     500 / **1,32–1,40 s** |
| 10.000 | 5,86–6,13 s |                 16,59 / 17,21 / 13,67 s | 18,86 s |       **394.575** | **1.147–1.156 MiB** |                        1.000 / **5,38 s** |

Elemen sebelum select all: 4.082 / 14.082 / 26.582. Jumlah elemen setelah select all sama persis dengan audit, dan heap 10K ≈ 1,12 GiB. Waktunya 7–28 % lebih cepat dari klaim, tapi tetap di orde yang sama. Verdict CONFIRMED.

Temuan tambahan (atribusi): hampir seluruh bagian sinkron dihabiskan di `getBoundingClientRect`. Penyebabnya `web/selection-chrome.js:318-321` memanggil `ctx.worldRect(n.id)` untuk setiap node top-level yang terseleksi, dan `worldRect` (`web/canvas-interactions.js:690-693`) membaca `el.getBoundingClientRect()` tepat setelah kelas seleksi dipasang pada ribuan layer. Di 5K tercatat 250 panggilan dari lokasi itu, total 1.398 ms. Di 10K tercatat 5,38 s dari ~6,1 s sync. Ini layout/style paksa yang sinkron (lihat referensi MDN di bawah), dan sejalan dengan klaim astra bahwa 5,68 s CPU dikaitkan dengan `getBoundingClientRect` dan ada 7,40 s UpdateLayoutTree. Sisa fence (10K: ~7–11 s) terjadi di task berikutnya, antara lain panel layer yang membuka semua turunan (screenshot: tree terbuka) dan inspector multi-seleksi.

## Klaim 3: pan/zoom

|  Nodes | Gesture |       Handler p50 / p95 |           rAF p50 / p95 | Interval >25 ms | Klaim handler p95 |
| -----: | ------- | ----------------------: | ----------------------: | --------------: | ----------------: |
|  1.000 | pan     |        0,8–0,9 / 1,1 ms |     16,7 / 16,7–18,7 ms |             0 % |               1,1 |
|  1.000 | zoom    |            1,7 / 2,0 ms |     16,7 / 16,8–18,7 ms |             0 % |               1,9 |
|  5.000 | pan     |        1,0–1,1 / 1,3 ms |     16,7 / 16,8–18,7 ms |           1,7 % |               1,3 |
|  5.000 | zoom    |        5,7 / 6,0–6,1 ms |     16,7 / 18,0–18,7 ms |           1,7 % |               6,5 |
| 10.000 | pan     |        1,4 / 1,5–1,6 ms |     16,7 / 17,0–17,5 ms |       1,8–2,7 % |               1,8 |
| 10.000 | zoom    | 9,9–10,0 / 10,5–11,7 ms | 16,7 / **33,4–33,5 ms** | **13,1–17,0 %** |              12,1 |

Angka handler cocok dengan klaim. Pan lancar di semua ukuran, dan zoom lancar di 1K/5K. Di 10K, p95 interval rAF zoom 2 frame (33 ms) dan 13–17 % interval terlambat, sama dengan tabel astra sendiri (34,2 ms, 14,58 %). Jumlah event zoom yang sempat dikirim juga turun (93–98 vs 120). Jadi "lancar" hanya berlaku sampai 5K. Verdict PARTIAL. Catatan: input wheel sintetis, satu event per rAF, tanpa jalur input OS dan tanpa hitungan frame compositor.

## Klaim 4: file library dan storage-limits

Di kode:

- `wonder-shell.js:891-893`: setiap `render()` (tanpa `saving`) memanggil `sync(getDocument())`. `sync()` (`:240-284`) mengerjakan `JSON.stringify(document)` untuk dibandingkan dengan `lastSerialized` (`:270`). Kalau berbeda, ia mengerjakan `structuredClone` (`:273`) lalu `persist()` (`:176-205`), yaitu `localStorage.setItem("verynize-library-v1", JSON.stringify({...library, files}))` yang **sinkron** dan berisi **semua file lokal** beserta dokumen lengkapnya. Hanya file cloud milik akun yang diganti placeholder. `persist()` juga memanggil `emit()`, dan pendengar pustaka kemudian memanggil `fileLibrary.list()` (`:971-977`), yang meng-clone dan memvalidasi **setiap** file.
- `app.js:143-161`: `persist()` editor juga menulis `verynize-v2` (dokumen penuh) lewat `requestIdleCallback` (timeout 200 ms).
- `web/storage-limits.js:160-191` `measure()`: `sharedSize` (`JSON.stringify` dengan replacer) per halaman ditambah satu untuk seluruh dokumen, lalu `inlineBinaries` (walk penuh). Dijadwalkan lewat `schedule()` (`:301-309`): debounce 700 ms + `requestIdleCallback`, dipicu dari `web/src/islands/storage.tsx:29`. Fungsi ini memang menelusuri seluruh dokumen, tapi sekali per rentetan edit, tidak di tiap render.

Terukur (`renderer-results-library.json`, setiap edit):

| Kondisi                | `verynize-library-v1` (sinkron dalam edit) | `verynize-v2` (idle) | Clone file di `list()` | stringify storage-limits |
| ---------------------- | -----------------------------------------: | -------------------: | ---------------------: | -----------------------: |
| 1 file (1K aktif)      |                               620.049 char |         619.809 char |                      1 |            10,1 + 5,2 ms |
| 2 file (5K aktif + 1K) |   **3.732.965 char** (= 3.112.779 + ~620K) |       3.112.779 char |  **2** (2,7 + 10,5 ms) |           25,8 + 13,3 ms |
| Run ukuran, 10K        |                             6.229.421 char |       6.229.180 char |                      1 |                      n/a |

`setItem` sendiri murah (2,7 ms untuk 3,7 M char di 5K, 4,6 ms untuk 6,2 M char di 10K). Biaya yang lebih besar ada di stringify/clone yang menyertainya, dan biaya itu naik sesuai ukuran **seluruh pustaka**, bukan hanya file yang sedang diedit. Verdict CONFIRMED.

## Referensi (Context7, MDN `/mdn/content`)

- `structuredClone()`: "creates a deep clone of a given value using the structured clone algorithm"; algoritmanya "clones by recursing through the input object while maintaining a map of previously visited references" (`files/en-us/web/api/window/structuredclone`, `web_workers_api/structured_clone_algorithm`). Karena itu biayanya linear terhadap ukuran graf dokumen, sesuai dengan ukuran di sini: 2,9 / 18 / 30 ms untuk 0,22 / 1,13 / 2,26 M char JSON.
- `PerformanceScriptTiming.forcedStyleAndLayoutDuration`: "total time spent … by the script processing forced layout/style", dengan rujukan "Avoid layout thrashing". `getBoundingClientRect()` mengembalikan posisi/ukuran hasil layout, jadi membacanya setelah DOM/kelas berubah memaksa style dan layout dihitung secara sinkron. Ini menjelaskan 5,38 s di `worldRect` saat select all 10K.

## Bukti visual

Jendela app benar-benar tampil. `agent-desktop list-windows` menunjukkan jendela "Verynize" milik proses Electron uji (1440×870, visible). Screenshot diambil lewat `agent-desktop screenshot --window-id …`, dan snapshot aksesibilitas berisi tree "Layers" (frame 4980 …), "Benchmark", "Share" dan tombol mode Design/Code. Semua screenshot hanya memuat data sintetis, tanpa email, avatar foto atau path. Avatar di kanan atas adalah inisial generik "P".

- `screens/renderer-agent-desktop-1000-loaded.png`: dokumen 1K setelah dimuat
- `screens/renderer-agent-desktop-1000-selectall.png`: "1000 nodes selected", tree layer terbuka
- `screens/renderer-agent-desktop-library-5000.png`: dua tab (Benchmark 1000 dan 5000) pada uji pustaka
- `screens/renderer-electron-5000-loaded.png`, `renderer-electron-10000-selectall.png` ("10000 nodes selected"), `renderer-electron-library-5000.png`: screenshot halaman lewat Playwright

## Batasan

Mesin tidak idle dan hanya ada 2–3 ulangan, jadi variasinya terlihat (1K edit 43 vs 75 ms, select all 10K 13,7–17,2 s). Fence bukan waktu presentasi frame. Wrapper `site()` hanya dipakai pada pass atribusi. Run ini tidak memakai room/cloud, dokumen hasil impor nyata, Cmd+A keyboard, atau ukuran RSS/GPU. Semua instance Electron ditutup oleh skrip, profil sementara dihapus, dan app Verynize milik user tidak disentuh (tidak sedang berjalan).
