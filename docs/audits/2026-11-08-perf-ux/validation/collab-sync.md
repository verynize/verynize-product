# Validasi temuan kolaborasi/sync (2026-11-09)

Saya memvalidasi temuan sendiri, tanpa menganggap laporan asli benar. Yang dicek: `staging` di `2630c30` (kode aplikasi tidak diubah). Bukti diambil dari kode dan dari reproduksi lokal dengan Node dan workerd (Miniflare lewat `tests/cloud-harness.mjs`, bundle `.cloudflare/output/v0/workers/default/bundle` yang di-build 8 Nov 22:32, setelah perubahan terakhir di `cloud/` pada 16:23). Electron dan production tidak disentuh. Skrip ada di `validation/repro/`.

| #   | Klaim                                                                                                             | Verdict                                                                            |
| --- | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| 1   | Client menaikkan revisi pakai `Math.max` tanpa cek lompatan                                                       | **CONFIRMED**                                                                      |
| 2   | Batch yang dikirim ulang dibalas `duplicate:true, ops:[]`, client menganggapnya ack dan membuang edit sendiri     | **CONFIRMED** (hanya permanen kalau ack socket hilang)                             |
| 3   | Reconnect membalas `same:true` hanya dari nomor revisi                                                            | **CONFIRMED**                                                                      |
| 4   | Op ke node tak dikenal ditolak "Missing node" tapi revisi tetap naik                                              | **PARTIAL**: benar di client, salah di server                                      |
| 5   | Satu perubahan dipecah per 4.000 op, client lain melihat setengahnya                                              | **CONFIRMED** (mekanisme). Tanda 904 tidak muncul dari diff biasa                  |
| 6   | Edit remote mengganti seluruh dokumen sehingga gesture hilang; timer kirim di-reset tiap perubahan                | **CONFIRMED** (gesture hilang: dari kode, tidak dijalankan ulang)                  |
| 7   | Batch ditolak menahan semua edit berikutnya dan dikirim ulang dengan nomor batch baru                             | **CONFIRMED**, tapi dua perilaku itu terjadi pada dua jenis penolakan yang berbeda |
| 8   | `Ops.apply` menyalin seluruh dokumen per batch, node baru disalin dua kali, server atomik lewat `transactionSync` | **CONFIRMED** (heap diukur di Node, bukan di workerd)                              |

Baseline: `node tests/cloud-rooms.mjs` PASS (1,9 s) dan `node tests/cloud-room-poison.mjs` PASS (1,5 s), keduanya dengan `CLOUD_WORKER_BUNDLE` menunjuk ke bundle di atas.

Skrip repro:

- `repro/server-protocol.mjs` (workerd): klaim 2, 3, 4 dan 5.
- `repro/client-receive.mjs` (Node VM): menjalankan fungsi asli `apply`, `rebuild`, `sendPending`, `retryRetained`, `queueOps` dan `receiveOps`. Teksnya diambil langsung dari `web/cloud-panel.js`, lalu dijalankan bersama `web/cloud-ops.js` dan `web/room-limits.js` yang asli. Yang di-stub hanya hook UI, network dan storage. Mencakup klaim 1, 2, 4, 6 dan 7.
- `repro/poison-resend.mjs` (workerd, subclass fault seperti `tests/cloud-room-poison.mjs`): klaim 7, sisi server.
- `repro/ops-apply-memory.mjs` (`node --expose-gc`): klaim 8.

## Bukti per klaim

### 1. Tidak ada cek lompatan revisi: CONFIRMED

- `web/cloud-panel.js:643`: `if (Number.isSafeInteger(message.revision)) revision = Math.max(revision, message.revision);`. Tidak ada perbandingan dengan `revision + 1`.
- `client-receive.mjs` `claim1_gap`: client ada di revisi 1 dengan 3 node, revisi 2 (peer menambah `m0`) tidak pernah sampai, lalu revisi 3 datang dan mengedit `m0`. Hasilnya `revisionAfter: 3`, node yang dipegang client dan editor tetap `[a,b,c]`, status "Synced revision 3".
- Pemicunya harus berupa broadcast yang hilang **saat socket masih terbuka**. Broadcast yang terlewat saat socket putus tidak menaikkan revisi, jadi reconnect tetap mengambil snapshot. Kandidat di kode: `broadcast` menelan setiap exception dari `socket.send` (`cloud/rooms.js:221-229`). Context7 tidak memberi dokumentasi kapan `ws.send` melempar error: docs hanya menyebut `getWebSockets` tidak mengembalikan socket yang sudah putus, dan contoh resminya mengecek `readyState === WebSocket.OPEN` sebelum `send`. Jadi jalur ini tetap **UNVERIFIED**.

### 2. Ack duplikat tanpa ops: CONFIRMED

- Server: `cloud/rooms.js:397-411` mengembalikan `{duplicate:true, ops:[], rejected:0}` dengan revisi saat ini. Rentang `394-412` di README sedikit melenceng; isinya sama.
- Hasil workerd (`claim2_duplicate`): POST pertama mengembalikan revisi 1 dengan 1 op. POST ulang dengan batch yang sama mengembalikan persis `{"type":"ops","client":"dupclient01","batch":1,"revision":1,"ops":[],"rejected":0,"duplicate":true}`. Server menyimpan 4 node.
- Client: `web/cloud-panel.js:655` menjalankan `pending = pending.filter(b => b.n > message.batch)`, padahal `confirmed` tidak berubah karena `ops` kosong (`:636`). Lalu `rebuild()` (`:674`) menyetel editor ke `confirmed + pending`.
- Hasil VM (`claim2_dupack`, memakai balasan server di atas): editor `[a,b,c,mine]` menjadi `[a,b,c]`, `pendingAfter: 0`, status "Saved shared revision 1".
- Nuansa: jalur yang realistis adalah `flushOps` (`:716-748`). Fungsi ini menunggu ack socket 5 s, lalu POST ulang lewat HTTP. Kalau ack socket asli datang belakangan, `ops`-nya diterapkan ke `confirmed` dan kondisinya pulih. Jadi edit hilang permanen hanya kalau ack/broadcast ke pengirim **hilang**. Rujukan `636-666` di README benar sebagai blok. Baris yang membuang batch adalah `:655`; `:653` ada di cabang penolakan.

### 3. `same:true` hanya dari revisi: CONFIRMED

- `cloud/rooms.js:1161-1168`: `data.revision === revision` menghasilkan `{same:true, revision, acked, rejectedBatches, pages: this.store.index()}` tanpa isi dokumen.
- Hasil workerd (`claim3_sync`): server punya 503 node di revisi 1. Client yang mengirim `sync` dengan revisi 1 mendapat `same:true` dan tidak ada `document`. Dengan revisi 0, client mendapat snapshot 503 node.
- Jalur ini selalu dipakai desktop: `openSocket` selalu menyetel `lazy=1` (`web/cloud-panel.js:937`), dan saat menerima welcome client mengirim `sync` dengan revisinya (`:961-971`). Setelah reload, `confirmed` dan `revision` dipulihkan dari outbox (`:1294`, `:1312`, `:1325`), dan saat `same` client tidak mengubah `confirmed` (`:986`).
- Tambahan: `store.index()` sudah mengirim `{id, bytes, nodes}` per halaman di balasan `same` (`cloud/room-store.js:111-114`), tapi client mengabaikannya. Membandingkan jumlah node per halaman dengan data itu sudah cukup untuk mendeteksi divergensi seperti 4.903 vs 3, bahkan sebelum ada hash.

### 4. "Missing node" tapi revisi naik: PARTIAL

- **Server: REFUTED.** Kalau semua op ditolak, `applyBatchNow` kembali di `cloud/rooms.js:450-459` tanpa `UPDATE room SET revision`. Hasil workerd (`claim4_server.onlyMissing`): revisi 0, `reasons:[{reason:"Missing node"}]`, revisi tersimpan 0. Batch campuran (1 op valid, 1 op Missing) menaikkan revisi ke 1 dengan `rejected:1`. Itu benar, karena ada op yang diterapkan.
- **Client: CONFIRMED.** `receiveOps` hanya mengambil `.doc` dari `Ops.apply` (`web/cloud-panel.js:637`), sedangkan `Ops.apply` menolak op dengan "Missing node" (`web/cloud-ops.js:448`, `:464`, `:483`). Hasil VM (`claim4_client`): `applied:0`, `rejected:[Missing node]`. Di `claim1_gap` revisi tetap naik ke 3. Inilah yang membuat divergensi tidak pernah pulih.

### 5. Pemecahan per 4.000 op: CONFIRMED (mekanisme)

- `web/room-limits.js:29`: `batch.length >= 4000` memulai batch baru. `queueOps` juga membatasi penggabungan di 4.000 (`web/cloud-panel.js:467`). Setiap batch di-commit dan di-broadcast sendiri.
- Hasil workerd (`claim5_split`): grup `[4000, 901]`. Peer menerima revisi 1 (4.000 op) lalu revisi 2 (901 op). Di antara keduanya server menyimpan **904** node dan nama sudah "copy"; setelah batch kedua, 3 node.
- **Koreksi atau catatan:** angka 904 muncul karena di skrip ini op `doc:name` saya taruh **di depan** secara manual. `Ops.diff` yang asli untuk "muat salinan 3 node dengan nama lain" menaruh 4.900 `remove` dulu, jadi grup pertama berisi 4.000 remove dan server menyimpan **903** (dicek dengan `node -e` memakai `Ops.diff` + `batchOps`; sama dengan angka opus). Tanda production 904 = 4.903 − 3.999 tetap butuh tepat satu op non-remove di grup pertama. Pemicunya belum diketahui.

### 6. Edit remote mengganti dokumen; debounce di-reset: CONFIRMED

- Rantai ganti dokumen: `receiveOps` → `rebuild()` (`:674`) → `apply(next)` (`:391`) → `window.design.setDocument(doc)` (`:311`). Itu alias dari `loadDocument` (`web/app.js:1378`), yang di `:1334-1345` menjalankan `checkpoint()` (undo), `design = checked` (objek baru), `selection.clear()` dan `render()`.
- Hasil VM (`claim6_remoteReplace`): satu op remote ke node `b` menghasilkan `setDocumentCalls: 1`.
- Drag memegang referensi objek node lama: `free = nodes.filter(...).map(n => ({n, ...}))` (`web/canvas-interactions.js:1702`), lalu memutasi `s.n.x` (`:1739`). Setelah `design` diganti, mutasi itu mengenai objek yang sudah terlepas, jadi wajar drag hilang. **Tidak saya jalankan ulang** (Electron dilarang), jadi angka 2/2 drag dan 1/1 resize tetap hasil opus.
- Debounce: `web/cloud-panel.js:474-475` (`clearTimeout(sendTimer); sendTimer = setTimeout(sendPending, 40)`). Hasil VM (`claim6_debounce`): 59 edit, satu tiap 16 ms selama 1.003 ms, terkirim **sekali** di +1.027 ms dengan 59 op. Ini cocok dengan angka opus (91 edit, satu kirim di +1,54 s).

### 7. Batch ditolak: CONFIRMED, dengan dua kasus berbeda

- `web/cloud-panel.js:645-654`: penolakan berupa ukuran atau `tooLarge` memindahkan **semua** batch `pending` ke `retained`. `sendPending` berhenti selama `retained.length` (`:399`). Setiap edit baru lewat `queueOps` → `retryRetained` (`:439-445`, `:422-438`).
- **Penolakan "interrupted"** (penanda poison, `tooLarge:true`), hasil VM:
  - Tanpa batch lain yang menunggu (`claim7_onlyRejected`): tidak ada yang terkirim. Edit kecil berikutnya dikirim sebagai **batch 2** berisi `["b:node","big:add"]`, jadi isi yang diracun ikut lagi.
  - Ada batch lain yang menunggu (`claim7_withLaterBatch`): `retryAfterRejection` langsung mengirim **batch 3** `["a:node","big:add"]` **tanpa** perlu edit baru.
- **Penolakan ukuran yang memang melebihi batas** (`claim7_sizeLimit`, halaman di atas 20 MiB): `retryRetained` berhenti di cek batas (`:426-430`). Edit berikutnya ditahan (`retainedOps: 2`, tidak ada yang terkirim). Di sini "menahan semua edit berikutnya" benar secara harfiah.
- Sisi server (`poison-resend.mjs`): batch 1 menghasilkan reset (500). Batch 1 diulang menghasilkan 413 "interrupted". **Batch 2** dengan isi yang sama ditambah edit kecil menghasilkan **reset lagi** (500), dan revisi tersimpan tetap 0 (`a.x` tetap 0). Penanda poison dikunci per `(client, batch)` (`cloud/rooms.js:330-333`), jadi nomor baru tidak terdeteksi.

### 8. Salinan di `Ops.apply` dan atomisitas server: CONFIRMED

- `web/cloud-ops.js:30` (`clone = JSON.parse(JSON.stringify(v))`), `:288` (`let doc = clone(document)`), `:435` (`clone(op.value)` ke dokumen) dan `:443` (`clone(op.value)` lagi untuk `applied`).
- Hasil `ops-apply-memory.mjs`:
  - Batch add 4.900 × 4 KB ke halaman kosong (pesan 19,8 MB): **9.801** panggilan stringify (1 + 2 × 4.900) atas 39,1 MB, apply 70 ms. Kenaikan heap yang tertahan **~101 MB** untuk parse, stamp, apply dan string broadcast. Angka ini belum termasuk string pesan mentah (19,8 MB) dan stringify di `RoomStore.commit`.
  - Satu op properti di halaman yang berisi 4.900 × 4 KB (19,5 MB): clone 19,5 MB, heap tertahan ~64 MB.
  - Jadi estimasi "~128 MB, setara batas isolate" masuk akal. Tapi ini pengukuran heap V8 di Node, bukan memori isolate workerd.
- Atomisitas: `cloud/rooms.js:383` menjalankan `transactionSync(finish)`, yang mencakup commit, `store.flush()`, `revision+1` (`:483`), history, `clients` dan penanda. `cloud-room-poison.mjs` PASS: setelah reset dokumen tidak berubah dan revisi tetap 0.
- Docs Cloudflare (Context7, `/websites/developers_cloudflare_durable-objects`):
  - _Metrics and analytics_: "Each isolate is subject to a 128 MB memory limit." dan "Memory is measured per isolate, not per Durable Object … A single isolate can host multiple Durable Objects of the same class … they all share that isolate's memory." _Pricing_: DO "may run in the same isolate … and share the 128 MB of memory."
  - _SQLite storage API, `transactionSync`_: "If `callback()` throws an exception, the transaction is rolled back. The callback must complete synchronously … Only synchronous storage operations can be part of the transaction."
  - _Automatic write coalescing_: beberapa write tanpa `await` "will automatically be combined and submitted atomically … either all of the writes will have been stored to disk or none." _`sync()`_: "Synchronizes any pending writes to disk."
  - _Output gate_: "This response is held by the output gate until the write completes."
  - _Limits_: "WebSocket message size 32 MiB (only for received messages)", CPU per request 30 s default (bisa sampai 5 menit).
  - _Hibernation_: `getWebSockets` tidak mengembalikan socket yang sudah putus, tapi bisa mengembalikan socket yang sedang `CLOSING`. Perilaku `ws.send` yang melempar error **tidak tercakup** di docs yang ditemukan.

## Koreksi terhadap laporan asli

1. **Klaim 4 (README temuan 1)** terlalu umum. Server **tidak** menaikkan revisi untuk batch yang semua op-nya "Missing node" (`cloud/rooms.js:450-459`, dicek di workerd). Yang menaikkan revisi sambil membuang op adalah **client** (`web/cloud-panel.js:637` + `:643`), sesuai versi sol.
2. **Rujukan baris:** blok duplikat ada di `cloud/rooms.js:397-411`. Baris client yang membuang batch adalah `web/cloud-panel.js:655`; `:653` ada di cabang penolakan (`retained = pending…`). Rujukan lain (`:643`, `:311`, `:399`, `:475`, `rooms.js:1161`, `room-limits.js:29`, `app.js:1334`, `cloud-ops.js:288/435/443`) masih tepat di `2630c30`.
3. **Klaim 7** menggabungkan dua kasus. Untuk penolakan ukuran yang sungguhan, edit **ditahan** dan tidak dikirim ulang. Untuk penolakan "interrupted", edit **tidak ditahan**: isi yang diracun dikirim ulang dengan nomor baru, langsung (kalau ada batch lain yang menunggu) atau pada edit berikutnya. Room reset lagi dan edit kecilnya tidak pernah tersimpan.
4. **Klaim 2** hanya permanen kalau ack socket untuk batch itu hilang. Kalau ack hanya terlambat, ack yang datang belakangan memulihkan `confirmed`.
5. **Klaim 5:** diff biasa dari "muat salinan" menghasilkan 903, bukan 904. Tanda production 904 belum terjelaskan oleh jalur yang direproduksi.
6. **Peluang yang terlewat:** balasan `same:true` sudah membawa jumlah node per halaman (`store.index()`). Client bisa memakainya sebagai deteksi divergensi yang murah, sebelum solusi hash per halaman.

## Tidak diverifikasi

- Gesture drag, resize dan caret teks saat runtime (perlu Electron).
- Penyebab broadcast atau ack hilang di production.
- Memori isolate workerd yang sebenarnya untuk batch 4.900 node.
