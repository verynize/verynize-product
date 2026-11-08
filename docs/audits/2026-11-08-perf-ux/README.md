# Audit performa, kolaborasi dan UI/UX (2026-11-08)

Audit read-only oleh empat agen: astra (renderer, Wonder, performa lokal dan production), sol (Cloudflare, screenshot, batas ukuran), opus (API, caching, kolaborasi live) dan Sonnet (Sentry). Laporan sol, Sonnet dan opus adalah ringkasan yang direkonstruksi karena laporan aslinya terhapus bersama scratchpad. Trace dan JSON dari run astra pertama (`astra/`) juga hilang, jadi link ke `astra/` di `astra-renderer-perf.md` tidak bisa dibuka.

| File | Isi |
| --- | --- |
| `astra-renderer-perf.md` | Klaim Wonder, perbandingan DOM / Canvas2D / WebGL / WebGPU, ukuran Electron lokal 1K/5K/10K |
| `astra-prod.md`, `astra-prod/` | Ukuran production di Chrome yang sudah login (Spaces read-only), trace yang sudah disanitasi |
| `opus-api-collab.md` | Reproduksi divergensi kolaborasi, drag hilang, debounce, biaya commit |
| `sol-errors-limits.md` | Reset Durable Object, kegagalan screenshot, peta batas ukuran, desain aset |
| `sonnet-sentry.md` | Inventaris issue Sentry |

## Temuan utama

1. **Kolaborasi berbeda hasil (direproduksi di production).** Satu batch 4.900 node membuat Durable Object crash. Server punya 4.903 node, desktop 3 node, keduanya revisi 37 dan "Synced". Reconnect membalas `same: true` hanya karena nomor revisi sama (`cloud/rooms.js:1161`). Room AUDIT kemudian juga berubah sendiri dari 4.903 ke 904 node. Cloudflare: 46 reset CPU, 23 reset memori, overload (VERYNIZE-SERVER-4/-5).
2. **Drag hilang dan tidak live.** Edit remote mengganti seluruh dokumen (`web/cloud-panel.js:311` → `web/app.js:1334`), jadi drag yang sedang berjalan dibuang. Timer kirim di-reset tiap perubahan (`web/cloud-panel.js:475`). Drag dan teks baru dikirim saat dilepas.
3. **App tersendat.** `notify` menyalin seluruh dokumen per subscriber (`web/app.js:507`), file library menulis localStorage tiap render, `storage-limits` menelusuri seluruh dokumen. Edit di 4,9K node ~176 ms. Select all: lokal 6,3 s (5K) dan 18,9 s (10K); production Spaces 7.699 node **12,3 s**, hapus seleksi 3,7 s, heap ~1,06 GiB.
4. **"File terlalu besar".** Importer menyisipkan base64 per node (`integrations/codec-html.mjs:1367`). Dedupe aset SHA-256 + R2 sudah ada untuk room tapi tidak dipakai impor lokal/MCP. Banner ukuran muncul lewat pencocokan teks, dan satu batch ditolak menahan semua edit (`web/cloud-panel.js:399`, `:653`).
5. **Payload dan cache.** `/api/me/state` ~4 MB decoded dipanggil berulang (9 kali saat Files dibuka, puluhan dalam beberapa menit). Bundle ber-hash disajikan `max-age=0, must-revalidate`. Dua panggilan `/access` per buka room. Snapshot Spaces 6,7 MB decoded.
6. **Screenshot gagal.** Tes render lulus di Electron 42 dan 45. Dugaan: app yang jalan memakai runtime lama dan memunculkan proses render dari runtime baru.
7. **Observability.** 14 dari 17 issue server berasal dari test lokal. Desktop dan web tidak mengirim sinyal nyata.
8. **Renderer.** Wonder memakai HTML/CSS. Di benchmark, WebGL/WebGPU tidak menang di 10K/100K node dan heap-nya ~20× lebih besar. DOM tetap dipakai.

## Plan

**Fase 0: minggu ini**

1. Restart penuh app untuk soal screenshot; tambah smoke test render saat startup, log `render-process-gone`/`child-process-gone`, dan error "perlu restart" kalau runtime berubah.
2. Reconnect membandingkan hash isi tiap halaman, bukan nomor revisi. Op yang merujuk node tak dikenal memicu resync.
3. Edit remote diterapkan ke node yang berubah saja; selama gesture ditunda sampai gesture selesai.
4. Throttle kirim tetap (50–100 ms, tidak di-reset) dan gabungkan edit beruntun pada properti yang sama; kirim posisi selama drag.
5. Batch ditolak hanya menahan batch itu; error ukuran pakai kode error.
6. Hentikan polling `/api/me/state` dan kirim hanya bagian yang berubah.
7. Sentry: DSN production tidak dipakai test, 4xx wajar tidak dilaporkan, telemetri desktop opt-out atau ditanya di awal.
8. Bundle ber-hash di-cache `immutable`.

**Fase 1: 2–4 minggu**

1. Commit inkremental: satu snapshot per revisi, subscriber menerima node/halaman yang berubah, simpan dengan debounce saat idle. Target edit 1K < 16 ms, edit 10K turun ≥ 50%.
2. Seleksi terbatas: tampilkan jumlah dan bounding box dulu, inspector/tree bertahap dan tervirtualisasi, hapus seleksi tanpa membangun ulang semuanya. Target select all 5K < 1 s tanpa task > 100 ms.
3. Aset `asset:<sha256>` di semua jalur (lokal, IndexedDB, R2) memakai dedupe yang sudah ada; importer menulis referensi; render mengambil aset lewat protokol; tool MCP `upload_asset`.
4. Server membatasi batch berdasarkan byte dan beban kerja; impor besar bertahap dan bisa dilanjutkan.

**Fase 2: kuartal ini**

1. Node disimpan per baris di server; presence sebagai update kecil dengan heartbeat.
2. Halaman lazy load, undo per halaman berbasis patch; batas 10K/50K dinaikkan setelah terukur.
3. Importer `.pen` langsung (komponen, instance, override, `lucide:*`, layer tersembunyi) dan `finish_artboard intent: "faithful-import"`.
4. Tetap DOM; evaluasi tile Canvas2D sebagai overview zoom jauh setelah Fase 1.

Urutan prioritas: sync tidak boleh berbeda, drag tidak boleh hilang, biaya seleksi dan commit, aset dan ukuran file, lalu arsitektur.

## Belum terukur

Waktu persis sampai canvas bisa dipakai, header cache room/aset, frame WebSocket di Spaces, drag/edit di dokumen besar di production, Cmd+A keyboard, penyebab tulisan non-atomik di server.
