# Audit performa, kolaborasi dan UI/UX (2026-11-08)

Audit read-only oleh empat agen: astra (renderer, Wonder, performa lokal dan production), sol (Cloudflare, screenshot, batas ukuran), opus (API, caching, kolaborasi live) dan Sonnet (Sentry). Laporan sol, opus dan Sonnet adalah hasil audit ulang (laporan pertama terhapus bersama scratchpad). Trace dan JSON dari run astra pertama (`astra/`) hilang, jadi link ke `astra/` di `astra-renderer-perf.md` tidak bisa dibuka.

| File                           | Isi                                                                                                                             |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `astra-renderer-perf.md`       | Klaim Wonder, perbandingan DOM / Canvas2D / WebGL / WebGPU, ukuran Electron lokal 1K/5K/10K                                     |
| `astra-prod.md`, `astra-prod/` | Ukuran production di Chrome yang sudah login (Spaces read-only), trace yang sudah disanitasi                                    |
| `opus-api-collab.md`, `opus/`  | Reproduksi lokal divergensi, room menyusut, gesture hilang, debounce, batch ditolak, biaya commit; skrip repro di `opus/repro/` |
| `sol-errors-limits.md`         | Reset Durable Object, kegagalan screenshot, peta batas ukuran, desain aset                                                      |
| `sonnet-sentry.md`             | Inventaris issue Sentry                                                                                                         |
| `RECOMMENDATIONS.md`           | Rekomendasi perbaikan final (P0/P1/P2, lokasi kode, bukti, test regresi) berdasarkan audit + validasi                           |
| `validation/`                  | Validasi independen 2026-11-09 (verdict per temuan, repro, ukuran ulang); ringkasan di `validation/README.md`                   |

## Temuan utama

1. **Kolaborasi berbeda hasil: bug di client, bukan tulisan server yang tidak atomik.** Di production server punya 4.903 node dan desktop 3 node, keduanya revisi 37 dan "Synced". Dua jalur direproduksi lokal: (a) client menaikkan revisi dengan `Math.max` tanpa cek lompatan revisi (`web/cloud-panel.js:643`), jadi broadcast yang terlewat tidak pernah diambil; (b) batch yang dikirim ulang dibalas `duplicate: true, ops: []` (`cloud/rooms.js:394-412`) dan client menganggapnya ack lalu membuang edit sendiri (`web/cloud-panel.js:636-666`). Reconnect membalas `same: true` karena nomor revisi sama (`cloud/rooms.js:1161`), jadi tidak pernah pulih. Op ke node tak dikenal ditolak "Missing node" tapi revisi tetap naik. Room menyusut 4.903 → 904: satu perubahan dipecah per 4.000 op (`web/room-limits.js:29`) sehingga client lain melihat setengahnya.
2. **Gesture hilang dan tidak live.** Edit remote mengganti seluruh dokumen (`web/cloud-panel.js:311` → `web/app.js:1334`): drag (2/2) dan resize (1/1) dibuang, caret teks lompat ke awal. Timer kirim di-reset tiap perubahan (`web/cloud-panel.js:475`): 91 edit dalam 1,5 s terkirim sekali di +1,54 s.
3. **App tersendat.** Di 5K node satu edit properti ~166-177 ms, ~118 ms di antaranya ~10 `structuredClone` dokumen penuh (7 di loop subscriber `web/app.js:507`, ~76 ms). Satu op remote ~205 ms, satu pointermove presence ~30 ms. Select all: lokal 6,3 s (5K) dan 18,9 s (10K); production Spaces 7.699 node **12,3 s**, hapus seleksi 3,7 s, heap ~1,06 GiB.
4. **"File terlalu besar".** Importer menyisipkan base64 per node (`integrations/codec-html.mjs:1367`). Dedupe aset SHA-256 + R2 sudah ada untuk room tapi tidak dipakai impor lokal/MCP. Banner ukuran muncul lewat pencocokan teks. Batch ditolak menahan semua edit berikutnya (`web/cloud-panel.js:399`, `:653`), dan setiap edit baru mengirim ulang isi yang ditolak dengan nomor batch baru sehingga room crash lagi. Di server, `Ops.apply` menyalin seluruh dokumen per batch (`web/cloud-ops.js:288`) dan node baru disalin dua kali (`:435`, `:443`): batch 4.900 node @ 4 KB butuh ~128 MB heap, setara batas isolate DO.
5. **Payload dan cache.** `/api/me/state` (~4 MB decoded, seluruh data akun termasuk transkrip chat, `cloud/account-state.js:11-33`) di-polling penuh tiap 3 detik dan setelah tiap sync/focus (`web/account-store.js:388-390`); 9.648 GET vs 154 PUT dalam 7 hari. Tidak ada file `_headers`, jadi bundle ber-hash disajikan `max-age=0, must-revalidate`. Dua panggilan `/access` per buka room. Snapshot Spaces 6,7 MB decoded.
6. **Screenshot gagal.** Tes render lulus di Electron 42 dan 45. Dugaan: app yang jalan memakai runtime lama dan memunculkan proses render dari runtime baru.
7. **Observability.** 15 dari 17 issue server berasal dari test lokal (SERVER-6 juga test); yang nyata hanya SERVER-4/-5. `vp` memuat `.env` sehingga build biasa memasukkan DSN production dan mengaktifkan upload source map. 4xx masuk lewat `instrumentDurableObjectWithSentry`. Jendela render/preview/capture ditandai untrusted dan event-nya dibuang (`desktop/telemetry.cjs:130,141-143`), telemetri desktop opt-in.
8. **Renderer.** Wonder memakai HTML/CSS. Di benchmark, WebGL/WebGPU tidak menang di 10K/100K node dan heap-nya ~20× lebih besar. DOM tetap dipakai.

## Plan

**Fase 0: minggu ini**

1. Restart penuh app untuk soal screenshot; tambah smoke test render saat startup, log `render-process-gone`/`child-process-gone`, dan error "perlu restart" kalau runtime berubah.
2. Perbaiki ack duplikat (balas outcome asli atau `resyncRequired`, jangan buang outbox sebelum rekonsiliasi), tolak lompatan revisi, op ke node tak dikenal memicu resync, dan reconnect membandingkan hash isi tiap halaman. Tambah test kegagalan di tiap tahap commit.
3. Edit remote diterapkan ke node yang berubah saja; selama gesture ditunda sampai gesture selesai.
4. Throttle kirim tetap (50–100 ms, tidak di-reset) dan gabungkan edit beruntun pada properti yang sama; kirim posisi selama drag.
5. Batch ditolak hanya menahan batch itu dan tidak dikirim ulang dengan nomor baru; error ukuran pakai kode error. Batasi batch berdasarkan byte, dan satu perubahan logis tidak dipecah jadi batch yang terlihat setengah.
6. Hentikan polling 3 detik `/api/me/state` dan refresh setelah write; baca per key, lalu change feed dengan cursor.
7. Sentry: DSN dan upload source map hanya di build release (`VERYNIZE_RELEASE_BUILD=1`), buang 4xx di `scrubEvent`, laporkan process-gone dan jendela internal desktop, telemetri desktop ditanya di awal.
8. Bundle ber-hash di-cache `immutable` (file `_headers`).

**Fase 1: 2–4 minggu**

1. Commit inkremental: satu snapshot per revisi, subscriber menerima node/halaman yang berubah, simpan dengan debounce saat idle. Target edit 1K < 16 ms, edit 10K turun ≥ 50%.
2. Seleksi terbatas: tampilkan jumlah dan bounding box dulu, inspector/tree bertahap dan tervirtualisasi, hapus seleksi tanpa membangun ulang semuanya. Target select all 5K < 1 s tanpa task > 100 ms.
3. Aset `asset:<sha256>` di semua jalur (lokal, IndexedDB, R2) memakai dedupe yang sudah ada; importer menulis referensi; render mengambil aset lewat protokol; tool MCP `upload_asset`.
4. Hapus salinan dokumen penuh di `Ops.apply`; impor besar bertahap dan bisa dilanjutkan.

**Fase 2: kuartal ini**

1. Node disimpan per baris di server; presence sebagai update kecil dengan heartbeat.
2. Halaman lazy load, undo per halaman berbasis patch; batas 10K/50K dinaikkan setelah terukur.
3. Importer `.pen` langsung (komponen, instance, override, `lucide:*`, layer tersembunyi) dan `finish_artboard intent: "faithful-import"`.
4. Tetap DOM; evaluasi tile Canvas2D sebagai overview zoom jauh setelah Fase 1.

Urutan prioritas: sync tidak boleh berbeda, drag tidak boleh hilang, biaya seleksi dan commit, aset dan ukuran file, lalu arsitektur.

## Belum terukur

Waktu persis sampai canvas bisa dipakai, header cache room/aset, frame WebSocket di Spaces, drag/edit di dokumen besar di production, Cmd+A keyboard, profil 10K node. Masih dugaan: apa yang menghilangkan broadcast/ack di production (error `socket.send` yang ditelan di `broadcast`, atau reset setelah commit) dan siapa yang menghapus 3.999 node.
