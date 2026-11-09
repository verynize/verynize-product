# Validasi runtime: gesture hilang saat edit remote masuk (dua client nyata, production)

Tanggal: 2026-11-09, sekitar 05:59–06:27 WIB. Target: room production "AUDIT collab test (delete me)" di https://verynize.gayaloo.app (±8.904 node, revisi 45 → 216 selama uji). Kode aplikasi tidak diubah (`staging` @ `2630c30`). Tidak ada commit dan tidak ada deploy.

Ini melengkapi klaim 6 di `collab-sync.md`. Di sana bagian "gesture hilang" hanya terkonfirmasi dari kode. Angka sebelumnya (drag 2/2, resize 1/1, caret 1/1) datang dari `opus-api-collab.md` dengan workerd lokal dan raw socket.

## Ringkasan verdict

| #   | Skenario                                                               | Verdict                             | Angka                                                                                                                                                                                                                                                                         |
| --- | ---------------------------------------------------------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Drag node A hilang kalau edit remote ke node B masuk di tengah gesture | **CONFIRMED** (dua arah)            | Hilang **11/11** bila edit remote diterapkan sebelum pointerup: desktop menggeser 7/7, web menggeser 4/4. Kontrol tanpa edit remote: berpindah **7/7**. Bila edit remote baru tiba setelah pointerup: berpindah **4/4**.                                                      |
| 2   | Resize lewat handle hilang                                             | **CONFIRMED** (dua arah)            | Hilang **8/8** (desktop 4/4, web 4/4). Kontrol **6/6** ter-resize. Edit tiba setelah pointerup: **3/3** ter-resize.                                                                                                                                                           |
| 3   | Edit teks: caret lompat, teks masuk di tempat salah                    | **CONFIRMED** (dua arah)            | Caret pindah dari offset 9 ke **0** pada **12/12** percobaan (desktop 8/8, web 4/4). Hasil akhirnya `" twoHello one"`, bukan `"Hello one two"`. Kontrol **5/5** urutannya benar. Teks yang sudah diketik **tidak** hilang: editor tetap terbuka, elemennya sama, fokus tetap. |
| 4a  | Timer kirim di-reset tiap edit (`web/cloud-panel.js:474-475`)          | **CONFIRMED** (runtime, production) | Web: 75–76 edit selama 1,5 s menghasilkan tepat **1** pengiriman di +1.501…1.506 ms (75–76 op, ±12,7 KB), 3/3. Desktop menerima **0** pembaruan selama burst. Edit pertama baru terlihat 2,64–2,78 s kemudian.                                                                |
| 4b  | Latensi satu edit, client ke client                                    | **TERUKUR**                         | Web → desktop: median **1.175 ms** (1.148–1.321, n=5). Dari angka itu, 749–808 ms habis di `setDocument` desktop. Desktop → web: median **1.037 ms** (1.034–1.233, n=5). Dari angka itu, ±0,5–0,7 s habis di `updateNodes` desktop sebelum pengiriman.                        |

Semua percobaan yang "hilang" konsisten di ketiga tempat: client yang melakukan gesture, client lain, dan server (GET room yang segar) sama-sama menunjukkan posisi/ukuran awal. Client yang melakukan gesture **tidak mengirim op sama sekali** setelah pointerup. Frame WebSocket keluar: 0 pada percobaan yang hilang, 1 frame berisi 2 op pada kontrol.

## Setup

**Desktop.** App dev (`vpr start`) ditutup dengan `agent-desktop close-app Electron`, lalu dijalankan ulang dengan `npx electron . --remote-debugging-port=9333`. userData default, jadi tetap login. Hanya ada satu instance. Kendali lewat `chromium.connectOverCDP`. Room dibuka dengan `window.fileLibrary.openRoomFile(...)`, yaitu jalur yang sama dengan klik di Files. Window 1440×870 dan fokus di layar.

**Web.** Chrome user tidak disentuh (tidak punya remote debugging, tidak ditutup, setelannya tidak diubah). Saya memakai cara yang sama seperti `production-me-state.md`: menyalin `Local Storage` dan IndexedDB origin `verynize.gayaloo.app` dari profil Chrome user (±39 MB) ke direktori scratch. Hasilnya dijalankan dengan binary Google Chrome yang sama, `--headless=new --remote-debugging-port=9334`, sebagai instance terpisah. Sesi akun ada di localStorage, sehingga client web langsung login. Room dibuka dengan `openRoomFile` juga.

**Node uji.** Empat node dibuat dari desktop (`window.design.addNode`) di area kosong (koordinat negatif):

| Nama           | Tipe                | Posisi awal    | Peran                                          |
| -------------- | ------------------- | -------------- | ---------------------------------------------- |
| `AUDIT-drag-A` | rectangle 120×80    | (-1800, -1200) | yang di-drag                                   |
| `AUDIT-drag-B` | rectangle 120×80    | (-1500, -1200) | diubah warnanya oleh client lain (edit remote) |
| `AUDIT-drag-R` | rectangle 120×80    | (-1800, -1000) | yang di-resize                                 |
| `AUDIT-drag-T` | text 400×60 "Hello" | (-1800, -800)  | edit teks                                      |

**Harness.** File `repro/gesture-remote.mjs` memasang probe di kedua halaman:

- membungkus `window.design.setDocument` (jalur apply remote `cloud-panel.js` `apply()`) untuk mencatat waktu, durasi dan nilai node uji di dokumen yang masuk;
- listener pointerdown/move/up, termasuk rect elemen layer dan atribut `data-dragging` di tiap pointermove;
- CDP `Network.webSocketFrameSent/Received`, dengan tipe, jumlah op dan ukuran saja.

Edit remote adalah edit lokal biasa di client lain (`window.design.updateNodes([B], {color})`), jadi lewat jalur kirim yang normal, termasuk timer 40 ms. Setelah tiap percobaan node uji direset dari client yang melakukan gesture, dan `serverAfter` dibaca dari GET `/api/rooms/<id>` yang segar.

- **Drag:** pointerdown di tengah A, 19 pointermove (-10, -7) px dengan jeda 70 ms, lalu pointerup. Zoom 1, jadi target = (-1990, -1333). Edit remote dipicu pada move ke-6.
- **Resize:** A dipilih, lalu handle `se` digeser 19 × (+6, +4). Target = 234×156.
- **Teks:** klik, double-click, caret di-collapse ke akhir, ketik `" one"`, edit remote, tunggu sampai op tersebut diterapkan di client ini, ketik `" two"`, Escape. Target `"Hello one two"`.
- **Menahan gesture:** desktop mengirim lambat (lihat skenario 4), sehingga pada run web pertama edit dari desktop baru tiba setelah pointerup. Run berikutnya menahan gesture: pointer digoyang 1 px di posisi akhir sampai client tersebut menerapkan edit remote, lalu dilepas di posisi akhir yang sama. Target tidak berubah.

## 1. Drag: CONFIRMED

| Run (file)                                                  | Penggerak | Kontrol (pindah) | Edit remote di tengah gesture (hilang) | Edit remote setelah pointerup (pindah)              |
| ----------------------------------------------------------- | --------- | ---------------- | -------------------------------------- | --------------------------------------------------- |
| `gesture-results-desktop-run1.json`                         | desktop   | 2/2              | 2/2                                    | 1/1 (tidak ada `setDocument` sebelum up)            |
| `gesture-results-desktop-drag+text.json`                    | desktop   | 1/1              | 4/4                                    | –                                                   |
| `gesture-results-desktop-shot-before+drag+resize+text.json` | desktop   | –                | 1/1                                    | –                                                   |
| `gesture-results-web-run1.json`                             | web       | 2/2              | –                                      | 3/3 (edit desktop tiba 2,3–9,7 s setelah pointerup) |
| `gesture-results-web-drag+resize.json`                      | web       | 2/2              | 3/3                                    | –                                                   |
| `gesture-results-web-shot-before+drag+resize+text.json`     | web       | –                | 1/1                                    | –                                                   |
| **Total**                                                   |           | **7/7**          | **11/11**                              | **4/4**                                             |

Contoh posisi dari satu percobaan yang hilang (desktop, `drag+text`, percobaan ke-2):

|                 | x     | y     |
| --------------- | ----- | ----- |
| Sebelum         | -1800 | -1200 |
| Diharapkan      | -1990 | -1333 |
| Desktop sesudah | -1800 | -1200 |
| Web sesudah     | -1800 | -1200 |
| Server sesudah  | -1800 | -1200 |

Warna B yang diubah remote ikut masuk di semua tempat. Kontrolnya: -1990/-1333 di ketiga tempat.

Jejak event (desktop, run1, percobaan remote pertama yang hilang):

- move 1–5: layer A bergerak (699 → 619 px) dengan `data-dragging=true`;
- `setDocument` di +1.954 ms, durasi **601 ms** (8.908 node);
- setelah itu layer **masih mengikuti pointer** (689 → 609 px), tapi `data-dragging=false`. Elemen baru dari `render()` digeser `follow()` berdasarkan id, sedangkan mutasi `s.n.x` mengenai objek node lama (`canvas-interactions.js:1702,1739`);
- saat pointerup, A kembali ke (-1800, -1200) tanpa op terkirim.

Di web, `setDocument` hanya 1 ms karena dokumen kecil (lihat catatan), tapi hasilnya sama. Jadi kehilangan ini tidak bergantung pada ukuran dokumen.

Di desktop, `setDocument` di tengah drag makan 576–659 ms per kejadian (n=7). Akibatnya user melihat canvas membeku ±0,6 s di tengah gesture, sebelum gesture-nya hilang.

## 2. Resize: CONFIRMED

| Penggerak                     | Kontrol       | Remote di tengah gesture                       | Remote setelah up |
| ----------------------------- | ------------- | ---------------------------------------------- | ----------------- |
| desktop (run1 + shot)         | 2/2 → 234×156 | **4/4 tetap 120×80** (`setDocument` 93–307 ms) | –                 |
| web (run1, drag+resize, shot) | 4/4 → 234×156 | **4/4 tetap 120×80**                           | 3/3 → 234×156     |

Hasil di server dan di client lain sama dengan client yang melakukan gesture. Tidak ada op terkirim setelah pointerup pada percobaan yang hilang.

Catatan: satu kontrol web (run1) menunjukkan desktop masih 120×80 saat dicek (+1,8 s), padahal server sudah 234×156. Penyebabnya desktop yang lambat menerapkan perubahan, bukan kehilangan.

## 3. Edit teks: CONFIRMED (caret lompat, teks tidak hilang)

| Penggerak | Kontrol               | Dengan edit remote                                                 |
| --------- | --------------------- | ------------------------------------------------------------------ |
| desktop   | 3/3 urutan benar*     | **8/8** caret 9 → 0, hasil `" twoHello one"` (run1: `" two one"`*) |
| web       | 2/2 `"Hello one two"` | **4/4** caret 9 → 0, hasil `" twoHello one"`                       |

\* Di run1 caret belum di-collapse, sehingga double-click memilih "Hello" dan ketikan menggantinya. Kontrolnya `" one two"` dan versi remote-nya `" two one"`. Polanya tetap sama. Run berikutnya meng-collapse caret ke akhir.

Data per percobaan (`beforeRemote`/`afterRemote`/`afterTyping`):

- sebelum remote: `editing=true`, teks `"Hello one"`, caret 9;
- setelah `setDocument` (desktop ±1,02–1,04 s, web 2 ms): editor masih elemen yang sama (`sameElement=true`), masih fokus, teks DOM masih `"Hello one"`, tapi **caret = 0**;
- `" two"` masuk di depan. Hasil `" twoHello one"` tersimpan di server dan di client lain.

Dokumen remote saat itu masih berisi `"Hello"` (ketikan belum di-commit). Editor tidak ditimpa, jadi yang rusak hanya posisi caret. Ini cocok dengan temuan opus.

## 4. Latensi dan timer kirim

Diukur dua kali:

- **run1** (`*-latency-run1.json`): sesudah ±170 revisi uji. Heap renderer desktop **1,75 GB** dan satu `updateNodes` ±1,07 s.
- **run2** (`*-latency.json`): sesudah renderer desktop dimuat ulang. Heap 512 MB dan `updateNodes` 457–612 ms.

Angka di bawah dari run2 kecuali disebut lain. Waktu diukur dengan `performance.timeOrigin + now()` di masing-masing halaman. Selisih jam kedua halaman terhadap `Date.now()` 51 vs 48 ms, jadi selisih antar-halaman ±3 ms. "Kirim" diukur dari waktu event CDP di Node, yang ±50 ms lebih awal relatif ke jam halaman.

**Satu edit (n=5 per arah)**

| Arah                 | Terlihat di client lain                                    | Rincian                                                                                                                                                           |
| -------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| web → desktop        | 1.321, 1.148, 1.168, 1.175, 1.189 ms (median 1.175)        | Kirim dari web ±10–14 ms (+±50 ms koreksi jam, cocok dengan timer 40 ms). `setDocument` di desktop **749–808 ms**. Sisanya ±0,35–0,5 s untuk jaringan dan server. |
| desktop → web        | 1.034, 1.037, 1.034, 1.071, 1.233 ms (median 1.037)        | Frame keluar desktop baru muncul 688–734 ms setelah edit, karena `updateNodes` sendiri memblokir ±0,5–0,7 s pada 8,9K node. Apply di web 2–5 ms.                  |
| run1 (desktop berat) | web → desktop 1.480–1.835 ms; desktop → web 2.350–2.653 ms | `setDocument` desktop ±1,0 s; kirim desktop 2,0–2,3 s setelah edit                                                                                                |

**Edit beruntun, 1,5 s, satu edit tiap ±16 ms (3 run per arah)**

- **Web sebagai pengirim** (edit murah): 75, 76 dan 76 edit, masing-masing hanya **1** frame `ops` (pada +1.504, +1.506 dan +1.501 ms; 75–76 op; 12,6–12,8 KB).
  - Desktop: **0** pembaruan selama burst. Pertama terlihat **2.644–2.782 ms** setelah edit pertama, dan nilai akhir 1.156–1.301 ms setelah edit terakhir.
  - Hasil run1 sama (1 kirim di +1.482–1.497 ms, pertama terlihat di 3,07–3,38 s).
  - Ini konfirmasi runtime di production untuk `clearTimeout(sendTimer); sendTimer = setTimeout(sendPending, 40)`.
- **Desktop sebagai pengirim:** hanya 2–3 edit muat dalam 1,5–2 s, karena tiap `updateNodes` memblokir 0,5–0,7 s. Hasilnya tetap 1 kirim setelah burst (+1.920…2.017 ms, 2–3 op). Pada dokumen sebesar ini yang membatasi adalah biaya per edit, bukan reset timer.

## Temuan tambahan (tidak diminta, dicatat apa adanya)

1. **Client web memegang salinan dokumen yang basi pada nomor revisi yang sama.**
   - Saat dibuka, client web menunjukkan revisi 45 dengan **4 node**, sementara server dan desktop punya **8.904 node** di revisi 45. Sampai akhir uji (revisi 216) web tetap 4 node + node uji, walaupun op baru tetap diterima.
   - Ini cocok dengan klaim 3 `collab-sync.md`: reconnect membalas `same:true` hanya berdasarkan nomor revisi. Asal salinan 4 node itu (record library lokal di profil web) belum ditelusuri. Ini terlihat 1/1 dan tidak direproduksi ulang.
   - Konsekuensi untuk uji ini: `setDocument` di web murah (1–2 ms), di desktop mahal. Kehilangan gesture terjadi di keduanya.
2. **Reload desktop di route room menghasilkan "Forbidden".** `location.reload()` di `app://verynize/editor/room%3A<id>` memberi halaman hitam bertuliskan "Forbidden" (`window.design` tidak ada). Navigasi ke `app://verynize/` memulihkannya. Kejadian 1/1. Belum dicek apakah Cmd+R oleh user memicu hal yang sama.
3. **Biaya interaksi desktop pada room 8,9K node.**
   - `updateNodes` 457–612 ms (segar), naik ke ±1,07 s dengan heap 1,75 GB setelah ±170 revisi dalam satu sesi. Dugaan saya checkpoint undo dari `setDocument` (belum diverifikasi).
   - Satu pointermove drag memakan ±210 ms di awal sesi, lalu ±900 ms. Satu pointermove resize ±600–700 ms, sehingga gesture 19 langkah berlangsung 11–14 s (41 s di run terakhir).
   - Batasan: probe membaca `getBoundingClientRect` di tiap pointermove (memaksa layout), dan Playwright menunggu tiap event selesai. Jadi angka durasi gesture ini bukan ukuran bersih performa app.
4. Di tengah uji, status desktop sempat berbunyi "2 changes were superseded by newer edits". Kemungkinan dari reset node uji yang beradu dengan op lain. Tidak ditelusuri.

## Bukti

- Skrip: `validation/repro/gesture-remote.mjs` (butuh `ROOM=<id room AUDIT>`; id tidak disimpan di repo).
- Data mentah: `validation/repro/gesture-results-*.json`. Isinya hanya id/geometri/warna/teks node `AUDIT-drag-*`, waktu, durasi `setDocument`, dan tipe/ukuran frame WebSocket (tanpa payload), plus status sync.
  - `desktop-run1`, `desktop-drag+text`, `desktop-shot-before+drag+resize+text`: gesture di desktop.
  - `web-run1`, `web-drag+resize`, `web-shot-before+drag+resize+text`: gesture di web.
  - `desktop-latency(-run1)`, `web-latency(-run1)`: skenario 4. Nama file = client pengirim edit.
- Screenshot: `validation/screens/gesture-*.png`. Hanya area canvas room AUDIT, view tetap world (-2020…-1350, -1360…-700) zoom 0.85. Kursor kolaborator (yang memuat nama akun) disembunyikan saat capture. Tidak ada panel, avatar, email atau path. Semua sudah dicek manual.
  - `gesture-before-{desktop,web}.png`: kondisi awal.
  - `gesture-drag-{desktop,web}-after.png`: setelah drag dengan edit remote di tengahnya. A tetap di posisi awal dan B sudah berubah warna.
  - `gesture-resize-{desktop,web}-after.png`: R tetap 120×80.
  - `gesture-text-{desktop,web}-editing.png`: teks `" twoHello one"`.

## Batasan

- Input sintetis lewat CDP (`Input.dispatchMouseEvent`/keyboard), bukan mouse fisik. Jalur event di renderer sama (pointer events).
- Client web adalah Chrome headless dengan salinan data login, bukan tab user. Client web juga memegang salinan dokumen basi (temuan 1).
- Satu akun dipakai di dua client (client id berbeda).
- Arah web → desktop butuh "menahan gesture" agar edit tiba sebelum pointerup. Itu memperlihatkan bahwa jendela kerentanannya sepanjang gesture ditambah latensi kirim client lain.

## Cleanup

- Empat node `AUDIT-drag-*` dihapus (`edit.delete` dari desktop). Pengecekan sesudahnya: 0 tersisa di desktop, di web dan di server (GET segar, revisi 216). Server kembali ke 8.904 node.
- Chrome headless dihentikan. Salinan profil (berisi token sesi) di direktori scratch **sudah dihapus** (`rm -rf`, dicek tidak ada).
- Electron dengan port debug ditutup. App dijalankan lagi dengan `vpr start` tanpa port debug (port 9333 tertutup) dan dibiarkan berjalan.
- Tidak ada cookie, token, email, nama akun atau id room yang disimpan di repo. Selain room AUDIT, tidak ada Space atau file yang dibuka atau diubah.
