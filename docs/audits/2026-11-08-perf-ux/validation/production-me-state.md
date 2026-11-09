# Validasi runtime: polling `/api/me/state` di production

Tanggal ukur: 2026-11-09, sekitar 05:42–05:52 WIB (2026-11-08 22:42–22:52 UTC). Target: https://verynize.gayaloo.app/ halaman Files, akun yang sudah login (profil Chrome user). Pengukuran ini melengkapi klaim 2 di `production-web.md`, yang sebelumnya hanya terkonfirmasi dari kode dan data astra.

## Ringkasan verdict

| #   | Klaim                                             | Verdict                                       | Angka terukur                                                                                                                                                                                                                                                                                                            |
| --- | ------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Respons ~4 MB decoded / ~556 KB encoded           | **CONFIRMED**                                 | decoded 4.084.341 B pada 20 dari 20 respons. Encoded median 555.859 B, transfer ~556,2 KB. Content-encoding `zstd`, HTTP/3. 65 item, 99,9% byte dari 13 item `chat:` (satu item 1,77 MB).                                                                                                                                |
| 2   | Polling tiap 3 s (`web/account-store.js:388-390`) | **CONFIRMED**                                 | 20 GET dalam 60 s di foreground. Jeda median 3.000 ms, min 2.999, max 3.001. Per menit: 11,13 MB transfer dan 81,7 MB decoded.                                                                                                                                                                                           |
| 2a  | Polling hanya saat tab terlihat                   | **CONFIRMED** (koreksi untuk perkiraan biaya) | Tab di background selama 66 s: **0** request `/api/me/state`, dan 0 untuk endpoint lain. Polling langsung lanjut saat tab kembali aktif.                                                                                                                                                                                 |
| 3   | GET penuh setelah focus/online (`:375-381`)       | **CONFIRMED**                                 | Setiap kali tab kembali aktif ada 1 GET langsung (5 dari 5). Event `focus` sintetis: 3 GET tambahan dari 5 event. Dua lainnya tergabung dengan sync yang sedang berjalan (`syncing` dibagi bersama). Event `online` sintetis: 1 GET langsung (+0 ms).                                                                    |
| 4   | GET penuh setelah tiap put/sync (`:67`, `:298`)   | **UNVERIFIED-runtime** (CONFIRMED dari kode)  | Tidak diuji karena butuh tulisan ke akun. Kode production identik dengan `web/account-store.js` di staging (diff kosong, 14.979 B). Selama pengukuran 0 tulisan dicoba (pemblokir tulisan mencatat 0).                                                                                                                   |
| 5   | `no-store`, tanpa ETag                            | **CONFIRMED**                                 | Semua 200: `cache-control: no-store`, tanpa `etag`, tanpa `last-modified`, tanpa `vary`. Request tidak mengirim `If-None-Match`. 304 tidak pernah muncul (0 dari ±70 respons) dan memang tidak mungkin tanpa validator.                                                                                                  |
| 6   | Telemetri "9.648 GET vs 154 PUT dalam 7 hari"     | **CONFIRMED** (direproduksi persis)           | Jendela Sol (2026-11-01 15:30 → 11-08 15:30 UTC, tepi lama terpotong retensi ke ~11-02 13:30Z): GET 200 = **9.648**, PUT 200 = **154**, PUT 413 = 21, OPTIONS 204 = 3.923. Jendela 7 hari yang berakhir saat pengukuran: GET 200 `/api/me/state` = 10.122, PUT 200 `/api/me/state/<key>` = 157, PUT 413 = 21.            |
| 7   | Request lain yang berulang saat idle              | **TEMUAN BARU**                               | `/api/orgs/<org>/rooms` dan `/api/me/rooms` masing-masing ±19×/menit (jeda median 3.096 ms; `refetchInterval: 3000` di `web/src/islands/home/cloud-files.ts:89`). Keduanya `no-store` tanpa ETag tapi kecil (encoded ~0,7 KB, decoded 1,8–3,0 KB). Selama idle tidak ada `/access`, snapshot room, aset, atau WebSocket. |

## Metode

**Koneksi ke browser.** Chrome user (v156) tidak membuka remote debugging. `agent-browser --auto-connect` gagal ("No running Chrome instance found"), file `DevToolsActivePort` tidak ada, dan `devtools.remote_debugging.user-enabled = false` di `Local State`. Menyalakan toggle `chrome://inspect/#remote-debugging` berarti mengubah setelan Chrome user dan perlu klik "Allow" dari user, jadi itu tidak dilakukan. Chrome user juga tidak ditutup atau di-restart.

**Jalan yang dipakai.** Ini cara yang didukung agent-browser (`--profile`): menyalin profil secara read-only. Yang disalin hanya `Local Storage` dan IndexedDB origin `verynize.gayaloo.app` dari `Profile 26` (±39 MB), ke direktori scratch sementara. Hasilnya dijalankan dengan binary Google Chrome yang sama, headless, sebagai instance terpisah. Sesi akun Verynize ada di localStorage (header `X-Verynize-Session`), jadi cookie tidak perlu disalin. Salinan profil dihapus setelah selesai. Tab "Verynize" milik user tidak disentuh dan tetap terbuka.

**Instrumentasi.** Init script dipasang sebelum navigasi:

- membungkus `fetch` untuk mencatat waktu, path (id org/uuid disamarkan), status, header non-sensitif, `document.hidden` dan `hasFocus()`;
- **memblokir semua method selain GET/HEAD ke `/api/*`**. Pemblokir mencatat 0 percobaan selama sesi;
- menghitung komposisi body per prefix key. Hanya jumlah dan byte yang disimpan, tanpa key lengkap atau nilai.

Ukuran encoded/decoded diambil dari `PerformanceResourceTiming` (`encodedBodySize`/`decodedBodySize`/`transferSize`). Tidak ada klik atau ketikan di app, dan tidak ada room yang dibuka.

**Skenario.**

- Foreground: 60 s idle di Files, tab terlihat dan fokus.
- Background: tab lain di browser yang sama diaktifkan selama 66 s, sehingga `visibilitychange` → hidden. Hasilnya sama dengan tab background di Chrome biasa.
- Focus: (a) 5× `blur`/`focus` sintetis di `window` dengan jeda 2 s. Ini meniru pindah aplikasi saat tab tetap terlihat. (b) 5× pindah tab sungguhan dengan jeda 1 s.
- Online: 1× event `online` sintetis.

**Telemetri.** `cf o11y telemetry query --preview` dipakai read-only, dengan query yang sama seperti `sol-errors-limits.md` §1: `scriptName=verynize`, `$metadata.type=cf-worker-event`, dan filter tambahan `request.url includes /api/me/state`, dikelompokkan per method dan status (serta per path untuk membedakan `/api/me/state` dari `/api/me/state/<key>`). Tidak ada query yang disimpan. Nilai yang keluar adalah agregat Cloudflare yang sudah disesuaikan sampling (`sampleInterval` ≈ 1,00). Sentry tidak dipakai karena Cloudflare sudah cukup.

## Detail angka

### 1. Idle 60 s, foreground

| Endpoint                | Jumlah | Jeda (median / min / max) | Status  | Encoded median |     Decoded | Transfer total 60 s | Decoded total 60 s |
| ----------------------- | -----: | ------------------------- | ------- | -------------: | ----------: | ------------------: | -----------------: |
| `/api/me/state`         |     20 | 3.000 / 2.999 / 3.001 ms  | 200 ×20 |      555.859 B | 4.084.341 B |        11.125.365 B |       81.686.820 B |
| `/api/orgs/<org>/rooms` |     19 | 3.096 / 3.083 / 3.461 ms  | 200 ×19 |          702 B |     1.846 B |            19.038 B |           35.074 B |
| `/api/me/rooms`         |     19 | 3.096 / 3.083 / 3.460 ms  | 200 ×19 |          738 B |     3.016 B |            19.722 B |           57.304 B |

- Durasi `/api/me/state` median 353 ms (request pertama 764 ms). Satu jendela 60 s terpisah memberi angka yang sama: 19 `/api/me/state` (10,57 MB transfer, 77,6 MB decoded), 18+18 rooms, 0 resource lain, 0 WebSocket.
- Kalau diproyeksikan ke satu jendela foreground per jam: 1.200 GET, ±667 MB transfer, ±4,9 GB JSON decoded. Ini proyeksi linear, bukan hasil ukur.
- Long task (>50 ms) selama 30 s idle: 0 di mesin ini (headless, M-series). Biaya parse 4 MB tiap 3 s tidak terlihat sebagai long task di sini. Di mesin yang lebih lambat belum diukur.

### 2. Background vs foreground

- Tab hidden selama 66,4 s: 0 request ke endpoint mana pun. Penyebabnya `if (!document.hidden && !networkAttempts)` di `account-store.js:389` dan perilaku default react-query (`refetchIntervalInBackground: false`).
- Saat kembali: `/api/me/state` + 2 rooms langsung pada event `focus`/`visibilitychange` yang sama (+1 ms), lalu polling 3 s lanjut.
- Catatan: "background" di sini berarti tab tidak terlihat. Jendela yang **terlihat tapi tidak fokus** (misalnya Chrome di monitor kedua atau di belakang app lain yang tidak menutupinya penuh) tetap `document.hidden = false`, jadi polling tetap jalan. Ini sudah terlihat pada uji focus sintetis, di mana polling 3 s berjalan terus di antara blur/focus.

### 3. Efek focus/online

| Skenario                                       | Durasi | GET `/api/me/state` | Baseline 3 s (perkiraan) |                                                                 Tambahan |
| ---------------------------------------------- | -----: | ------------------: | -----------------------: | -----------------------------------------------------------------------: |
| 5× blur/focus sintetis (tab tetap terlihat)    | 10,9 s |                   7 |                        4 |                       **+3** (2 tergabung dengan sync yang sedang jalan) |
| 5× pindah tab sungguhan (hidden 1 s → visible) | 10,7 s |                   5 |                        — | 1 GET langsung tiap kembali (5/5). Tick interval selama hidden dilewati. |
| 1× `online` sintetis                           |      — |                   1 |                        — |                                                      +1 langsung (+0 ms) |

- Rooms (react-query) ikut refetch saat kembali ke tab (`visibilitychange`), tapi tidak pada event `focus` sintetis saja.
- Setiap GET tambahan adalah respons penuh 4 MB, karena tidak ada validator atau delta.

### 4. Komposisi body (tanpa nilai)

| Prefix           | Item | Byte total | Item terbesar |
| ---------------- | ---: | ---------: | ------------: |
| `chat:`          |   13 |  4.079.885 |     1.765.448 |
| `file:`          |   16 |      1.767 |           111 |
| `preference:`    |   20 |      1.305 |            81 |
| `agent-default:` |   10 |        665 |            71 |
| `draft:`         |    6 |        470 |            79 |

Top-level: `items` (65) dan `account`. Transkrip chat menyumbang 99,9% payload. Hanya 52 item non-chat yang dipakai halaman Files, dengan total ±4,2 KB.

### 5. Telemetri Cloudflare

| Jendela                                    | GET 200 | GET 0 | GET 401 | PUT 200 | PUT 413 | PUT 0 | OPTIONS 204 |
| ------------------------------------------ | ------: | ----: | ------: | ------: | ------: | ----: | ----------: |
| Jendela Sol (7 hari s/d 2026-11-08 15:30Z) |   9.648 |     9 |       — |     154 |      21 |     1 |       3.923 |
| 7 hari s/d pengukuran ini (22:49Z)         | 10.122* |    11 |       2 |     157 |      21 |     1 |  4.005 + 96 |
| Sesi pengukuran (±8 menit)                 |     268 |     1 |       — |       — |       — |     — |          80 |

\* Hanya path persis `/api/me/state`. Semua PUT ke `/api/me/state/<key>`.

- Rasio GET:PUT ≈ 63:1. Pada tempo 20 GET/menit, 9.648 GET setara ±482 menit (±8 jam) satu jendela foreground. Jadi volumenya cocok dengan sedikit user yang membiarkan Files terbuka, bukan dengan banyak user.
- Perkiraan byte untuk 9.648 GET dengan ukuran akun ini: ±5,4 GB encoded dan ±39 GB decoded. Ukuran tiap akun berbeda, jadi ini estimasi, bukan hasil ukur.
- Per hari (bucket 24 jam mulai 11-01 22:49Z): GET 200 = 0, 53, 0, 159, 1.739, 2.946, 5.225 (hari terakhir termasuk sesi ini).
- `OPTIONS 204` (±4.000) adalah preflight CORS. Browser web same-origin tidak mengirim preflight, jadi kemungkinan besar ini dari klien desktop (`app://verynize` → origin cross-site, header `X-Verynize-Session`). Artinya polling desktop menambah satu request preflight untuk sebagian GET. Belum dicek apakah `Access-Control-Max-Age` dipasang.
- Sesi pengukuran ini sendiri menyumbang ±160 GET (8 menit × 20). Sisanya dari tab user yang terbuka dan klien lain pada jam yang sama.

## Batasan

- Pengukuran dilakukan di instance Chrome headless terpisah dengan data login yang sama, bukan di tab user. Kode app, server, akun, dan ukuran respons sama. Yang berbeda hanya status fokus jendela OS yang sungguhan.
- Focus jendela OS sungguhan (alt-tab antar app) tidak diuji secara fisik. Listener yang sama (`window` `focus`) dipicu lewat event sintetis.
- Jalur put→sync→GET (`:67`, `:298`) dan GET tambahan setelah 409 (`:253`) tidak diuji runtime karena butuh tulisan.
- Hanya satu akun diukur. Akun dengan riwayat chat lebih kecil atau lebih besar akan punya payload berbeda.

## Data mentah (tersanitasi)

Folder `production-me-state/` berisi:

- `idle-foreground-60s.json`: tiap request (offset ms, path, status, durasi, hidden/focus, header non-sensitif) dan resource timing (transfer/encoded/decoded, protokol).
- `idle-background-60s.json`: event visibility/focus dan request saat tab kembali.
- `idle-all-resources-60s.json`: semua resource dalam jendela idle 60 s kedua, per path.
- `focus-synthetic-5x.json`, `focus-tab-switch-5x.json`, `online-event.json`: uji focus/online.
- `body-composition.json`: jumlah dan byte per prefix key.
- `longtasks-30s.json`: long task saat idle.
- `cloudflare-7d-current.json`, `cloudflare-windows.json`: agregat telemetri (jendela Sol, 7 hari terkini per path, per hari, sesi ukur).

Tidak ada cookie, token, email, nama akun, id org/room, atau isi body yang disimpan.
