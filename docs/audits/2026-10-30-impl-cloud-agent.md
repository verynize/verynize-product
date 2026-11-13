# Implementasi cloud: akun, profil, peran, rotasi token, penggabungan operasi, publikasi aplikasi

Tanggal: 30 Oktober 2026. Agen: cloud. Celah yang ditangani (dari `docs/implementation-status.md`):

1. "Accounts, public creator profiles, identity-based permissions, token recovery/rotation, full real-time semantic merging."
2. "Published running applications with build/deployment automation; current public publishing is a design snapshot."

Semua perilaku hanya diuji secara lokal: workerd lewat Miniflare, Electron sungguhan, dan build proyek sungguhan. Tidak ada deploy produksi, akun eksternal, maupun penyedia email sungguhan.

## Yang dibangun

### Worker (`cloud/`)

- `worker.js` sekarang hanya berisi router. Kodenya dipecah ke `rooms.js` (DO `DesignRoom`), `accounts.js` (DO `AccountDirectory`), `apps.js` (DO `PublishedApp`), `mail.js` (batas penyedia email), `pages.js` (halaman profil publik) dan `http.js` (utilitas bersama).
- **Akun**: sign-in lewat magic link. Tautannya sekali pakai, berlaku 15 menit, dan hanya hash-nya yang disimpan. Sesi `vs_…` berlaku 30 hari dan disimpan sebagai hash SHA-256. Tersedia sign out (sesi ini) dan sign out everywhere, serta rate limit `AUTH_LIMIT`.
- **Email**: penyedia `outbox` khusus dev/test, dibaca lewat `GET /api/dev/outbox`, dan `webhook` (relay HTTP dengan secret). Nilai lain menonaktifkan sign-in (503). Pengiriman nyata **perlu kredensial live** dan belum diuji. Passkey/WebAuthn (opsional) **tidak** diimplementasikan.
- **Profil publik**: handle unik dengan daftar nama terlarang, nama tampilan, avatar khusus https, dan daftar publikasi (desain dan aplikasi). Tersedia `GET /api/profiles/:handle` dan halaman `GET /u/:handle` yang di-escape, tanpa skrip, dengan CSP ketat. Email tidak pernah ditampilkan.
- **Izin berbasis identitas**: peran viewer < commenter < editor < owner. Peran efektif adalah yang tertinggi antara peran tautan kapabilitas dan peran keanggotaan akun. Owner dapat mengundang lewat email; akun yang belum ada dibuat sebagai akun belum terverifikasi dan menerima email undangan. Peran bisa diubah atau dicabut, dan anggota bisa keluar sendiri. Pemilik terakhir tidak bisa dihapus jika tidak ada tautan owner. Komentar (commenter+) disiarkan langsung.
- **Tautan berperan, rotasi, pemulihan**: owner bisa membuat tautan per peran dan mencabutnya satu per satu. `tokens/rotate` mencabut semua tautan kapabilitas dan menerbitkan tautan owner baru. Socket yang bergantung pada tautan yang dicabut menerima `revoked` lalu ditutup dengan kode 4401, sedangkan anggota akun tetap punya akses. Akun owner dapat memulihkan akses hanya dengan sesinya (rotate tanpa token). `claim` menautkan ruangan lama ke akun.
- **Penggabungan semantik real-time** (`web/cloud-ops.js`, dipakai bersama Worker dan panel):
  - Operasi per halaman, per node dan per properti, masing-masing dengan stempel HLC. Konflik pada satu properti diselesaikan dengan LWW.
  - Teks digabung per rentang (three-way). Rentang yang tumpang tindih kembali ke LWW.
  - Pemindahan pohon ditolak jika membentuk siklus atau induknya hilang, dan anak yatim dipasang kembali ke halaman.
  - Hapus mengalahkan edit properti yang bersamaan; undo dengan stempel lebih baru memulihkan node.
  - Deduplikasi batch per klien, stempel yang tersimpan di SQLite (bertahan saat restart), dan stempel masa depan diganti stempel server.
  - Snapshot `PUT` lama tetap jalan (409 dipertahankan) dan ikut memberi stempel.
- **Kompatibilitas**: ruangan dari Worker lama dimigrasikan otomatis (token lama → tautan owner). Panel kembali ke protokol snapshot beserta prompt konflik jika server tidak melaporkan `protocol: 2`.
- **Aplikasi yang dipublikasikan**:
  - Unggah per file (≤25 MB/file, ≤3000 file, ≤100 MB/versi), dengan path divalidasi dan manifest SHA-256 diverifikasi saat seal.
  - Setiap versi immutable. Tersedia URL versi tersemat `@v`, rollback (`activate`), hapus versi (versi live ditolak) dan unpublish.
  - Disajikan di `/apps/<handle>/<name>/` dengan content-type sesuai ekstensi, ETag/304, fallback SPA, dan injeksi `<base href>`.
  - Header `CSP: sandbox allow-scripts …` membuat aplikasi berjalan di origin opak sehingga tidak bisa membaca storage editor.
- `cloudflare.config.ts`: tiga kelas DO SQLite, `AUTH_LIMIT`, `EMAIL_PROVIDER` (`webhook`) beserta dua secret, dan worker-first untuk `/api/*`, `/u/*`, `/apps/*`.

### Desktop

- `desktop/app-publish.cjs` (baru):
  - Mendeteksi package manager dan skrip `build`. Build Vite/Vite+ diberi `--base=./`.
  - Menjalankan build proyek tanpa shell (timeout 10 menit, cuplikan log), lalu mencari output (`dist/build/out/public` atau `verynize.outputDir`).
  - Meng-hash file, mengunggah empat sekaligus, lalu melakukan seal.
- IPC baru `cloudAppDetect` dan `cloudAppPublish`. Perubahannya di `main.cjs` dan `preload.cjs` masing-masing satu baris, dan didokumentasikan di `desktop/README.md`.
- `web/cloud-panel.js` ditulis ulang tanpa mengubah semua id dan perilaku lama. Isinya:
  - Klien operasi: dokumen terkonfirmasi ditambah batch tertunda, kirim ulang setelah reconnect, dan fallback REST sebelum publish. `activePage` tidak disinkronkan.
  - Bagian **Account**: email → tautan → sign in, edit profil, buka profil publik, sign out (everywhere), dan daftar "Your rooms" dengan Open dan New owner link (pemulihan).
  - Bagian **People & access**: peran Anda, daftar anggota beserta pemilih peran, undang lewat email, tautan berperan, Rotate all links, dan Add this room to my account.
  - Bagian **Comments**, serta bagian **Publish app** (Build & publish, daftar versi dengan Make live, Unpublish).
  - Viewer tidak bisa mengubah dokumen bersama: suntingan lokalnya dikembalikan dan pesan status ditampilkan.
- `web/index.html`: satu tag `<script src="cloud-ops.js">` ditambahkan sebelum `cloud-panel.js`.

## Pengujian (semua lulus pada mesin ini)

| Perintah                                                                  | Isi                                                                                                                                                                                     |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run test:cloud`                                                      | `cloud-rooms` (asersi lama tidak diubah), `cloud-merge` (baru), `cloud-accounts` (baru), `cloud-apps` (baru)                                                                            |
| `node tests/cloud-desktop.mjs`                                            | Dua klien Electron. Lihat catatan di bawah.                                                                                                                                             |
| `node tests/cloud-accounts-desktop.mjs` (baru, ditambahkan ke `npm test`) | Alur UI lengkap: sign-in, profil, undangan berperan, viewer dibatasi, promosi live, tautan, rotasi, komentar, pemulihan, build/publish/rollback/unpublish aplikasi, sign out everywhere |
| `node tests/cloud-async.cjs`                                              | Lulus tanpa perubahan                                                                                                                                                                   |
| `node tests/desktop-ipc.cjs`                                              | Lulus                                                                                                                                                                                   |
| `npm run build:ui`, `lint:ui`, `typecheck:ui`, `check`                    | Bersih                                                                                                                                                                                  |
| `npm run deploy:check`                                                    | Build berhasil dan dry run `cf deploy` menampilkan semua binding. **Tidak ada deploy.**                                                                                                 |

Catatan tentang `cloud-desktop.mjs`:

- Bagian "simultaneous edits retain the losing client's work" kini menguji perilaku baru yang diminta: suntingan bersamaan bergabung tanpa konflik (layer, properti berbeda pada satu layer, rentang teks berbeda), dan kedua dokumen identik.
- Asersi prompt konflik dan resolusi lama **tidak dihapus**. Asersi itu dipindahkan ke server lama sungguhan (`tests/fixtures/cloud-worker-v1.js`, salinan Worker sebelum perubahan ini) supaya jalur kompatibilitas tetap teruji.

`tests/cloud-harness.mjs` berisi konfigurasi Miniflare multi-modul bersama dan helper sign-in lewat outbox. Pengaturan dua tes lama diubah untuk memakainya, sedangkan asersinya tetap.

## Batasan yang jujur

- Penggabungan ini diurutkan oleh server (server-sequenced), bukan CRDT peer-to-peer. Suntingan offline digabung saat socket tersambung kembali.
- Undo lokal memulihkan seluruh dokumen. Jika di antaranya ada perubahan remote, undo bisa menghasilkan operasi yang membalik perubahan remote tersebut. Perubahan remote juga masuk ke tumpukan undo (sama seperti sebelumnya, karena `setDocument` membuat checkpoint).
- Aplikasi disajikan dengan sandbox CSP, sehingga `localStorage` dan cookie tidak tersedia bagi aplikasi. Isolasi origin penuh memerlukan domain aplikasi terpisah (**perlu domain live**). Build non-Vite yang memakai URL absolut `/` perlu dikonfigurasi dengan base relatif.
- Email sungguhan (webhook) dan sign-in di produksi **perlu kredensial live**. Passkey belum ada.
- Belum ada kuota akun selain 50 aplikasi per akun, penghapusan ruangan, maupun pelaporan penyalahgunaan profil/aplikasi.

## Untuk koordinator

- `CLAUDE.md` (bagian Cloud) masih menyebut "whole-document snapshots … no CRDT". Bagian itu perlu diperbarui ke "operation-based merging + accounts/roles/apps" (lihat `cloud/README.md`). File ini tidak saya ubah karena merupakan file bersama.
- Dua celah di `docs/implementation-status.md` dapat diperbarui sesuai batasan di atas. File itu sengaja tidak saya sunting.

## Tindak lanjut: passkey dan undo lokal (30 Oktober 2026)

### Passkey/WebAuthn

- `cloud/webauthn.js` adalah verifikasi orisinal dengan WebCrypto dan pembaca CBOR/COSE minimal, tanpa dependensi baru. Algoritma yang didukung: ES256, Ed25519 dan RS256. Attestation diminta `none` dan tidak dievaluasi.
- Pengecekan yang dilakukan:
  - tipe ceremony, challenge sekali pakai, origin, hash RP ID, user presence dan credential ID;
  - tanda tangan atas `authData‖SHA-256(clientData)`;
  - user handle;
  - counter yang harus naik (indikasi authenticator yang di-clone).
- Ceremony berjalan di halaman `/passkey` pada origin server (`script-src 'self'`), karena renderer `file://` tidak bisa menjadi relying party. Registrasi memakai tiket dari sesi. Sign-in memakai _handoff_: desktop menyimpan secret, lalu mengklaim sesi lewat polling (202 selama menunggu, sekali pakai).
- Tersedia `GET/DELETE /api/me/passkeys`. Tabel passkey, challenge, tiket dan handoff ada di `AccountDirectory`.
- `desktop/cloud-passkey.cjs` membuka jendela ceremony: tanpa preload, sesi in-memory, sandbox, navigasi terkunci ke origin server, popup ditolak. IPC `cloudPasskeyOpen`/`cloudPasskeyClose` masing-masing ditambahkan dengan satu baris di `main.cjs` dan `preload.cjs`.
- UI di Share › Account: tombol **Sign in with a passkey**, daftar **Passkeys** dengan tombol Remove, dan **Add a passkey**.
- Temuan: jendela Electron tidak memiliki pemilih akun WebAuthn, sehingga sign-in tanpa username (discoverable) gagal dengan `NotAllowedError`. Karena itu desktop mengirim email, dan server mengembalikan `allowCredentials` akun tersebut. Konsekuensinya, endpoint ini mengungkap apakah sebuah email punya passkey (didokumentasikan). Di browser biasa, sign-in tetap bisa tanpa email.
- Tes:
  - `tests/cloud-passkeys.mjs` (masuk `test:cloud`) memakai authenticator perangkat lunak yang ditulis di tes, dengan kunci ES256/Ed25519 asli. Tes ini menolak origin palsu, replay, tanda tangan yang diubah, tipe salah, RP lain, counter mundur dan user handle salah, serta menguji persistensi setelah restart dan penghapusan passkey.
  - `tests/cloud-passkeys-desktop.mjs` (masuk `npm test`) memakai Electron dengan virtual authenticator Chromium lewat CDP (`WebAuthn.addVirtualAuthenticator`, kredensial ditangkap lewat `credentialAdded`). Alurnya: registrasi dari panel, sign out, sign-in dengan passkey lewat handoff, lalu memastikan penghapusan menolak sign-in.
- Batasan: Touch ID/iCloud passkey di jendela Electron belum diverifikasi (perlu entitlement atau perangkat nyata). Hanya authenticator virtual yang diuji.

### Undo tidak membalik suntingan kolaborator

- `web/cloud-panel.js` menyediakan `window.cloudHistory`. `web/app.js` (empat substitusi kecil) memakainya untuk `#undo`, `#redo`, status tombol, `canUndo` dan `canRedo` selama kolaborasi berbasis operasi aktif.
- Setiap langkah lokal menyimpan dokumen sebelum dan sesudah perubahan. Perubahan beruntun dalam 600 ms tanpa suntingan remote di antaranya digabung menjadi satu langkah.
- Undo memutar operasi invers yang di-_rebase_ atas operasi remote yang datang setelah langkah itu:
  - properti, urutan dan node yang kemudian diubah kolaborator tidak disentuh;
  - penambahan node tidak dibatalkan jika node itu diedit kolaborator;
  - invers teks digabung per rentang dan dilewati jika rentangnya tumpang tindih.
- Redo bekerja dengan cara yang sama. Riwayat direset saat koneksi diputus.
- Regresi dua klien di `tests/cloud-desktop.mjs`:
  - A mengubah x dan B mengubah y; undo A hanya mengembalikan x, dan redo bekerja.
  - A mengubah w lalu B menimpa w; undo A tidak melakukan apa-apa (pesan "nothing to undo").
  - A menambahkan sufiks teks dan B menambahkan prefiks; undo A hanya menghapus sufiksnya.
  - Di akhir, dokumen kedua klien identik.

### Perbaikan lain

- Panel kini menampilkan "Published version N" setelah URL dan daftar versi diperbarui. Ini memperbaiki race yang terlihat saat tes dijalankan berurutan di mesin yang sibuk.
- Pada satu run, `cloud-desktop.mjs` sekali gagal karena timeout visibilitas elemen. Gagal itu tidak terulang dalam beberapa run berikutnya.

### Validasi

`npm run build:ui`, `lint:ui`, `typecheck:ui` dan `check` bersih. `npm run test:cloud` (rooms, merge, accounts, passkeys, apps), `tests/cloud-desktop.mjs`, `tests/cloud-accounts-desktop.mjs`, `tests/cloud-passkeys-desktop.mjs`, `tests/cloud-async.cjs` dan `tests/desktop-ipc.cjs` semuanya lulus. `npm run deploy:check` hanya dry run; **tidak ada deploy**.
