# Distribusi ALPHA web dan desktop

Diperbarui 8 November 2026. Scope saat ini adalah distribusi ALPHA yang bisa diunduh, dibuka, dan dipakai untuk alur dasar. Ini bukan klaim kesiapan produksi atau jaminan tidak ada bug.

## Scope

Web menggunakan jalur Cloudflare yang sudah dikonfigurasi di repo; desktop macOS menggunakan engine dokumen yang sama dan dapat terhubung ke backend yang sama. Web memiliki editor, akun, kolaborasi, serta AI melalui akun/key OpenRouter pengguna. Desktop menambahkan file lokal, Git, terminal, dan runtime Claude/Codex; Codex menggunakan koneksi Verynize **Sign in with ChatGPT** yang terpisah dari login terminal.

Distribusi macOS menyediakan ZIP terpisah untuk Apple Silicon (`arm64`) dan Intel (`x64`). Paket ALPHA ditandatangani ad-hoc, belum Apple-notarized, dan diperbarui secara manual. Windows/Linux, updater otomatis, serta kesetaraan semua fitur antarruntime belum masuk scope. Node/Docker tetap pilihan self-hosted; Vercel/Nitro tidak menjadi dependensi rilis ALPHA ini.

Tempat pengguna menemukan unduhan adalah repo situs `verynize-marketing`. Binary disimpan sebagai GitHub Release assets di `verynize/verynize-product`; situs menampilkan rilis ALPHA yang benar-benar tersedia. Jika belum ada asset, situs menyampaikan bahwa download belum tersedia, tanpa membuat URL unduhan yang belum ada.

## Urutan pekerjaan dan acceptance minimum

### 1. Selaraskan dokumentasi dan kontrak unduhan

Gunakan `package.json` sebagai sumber versi, `web/room-limits.js` untuk kapasitas, dan dokumentasi runtime untuk capability. Bedakan konfigurasi hosted origin dari hasil pengujian layanan live. Labeli hasil pengujian lama sebagai bukti historis.

**Selesai ketika:** petunjuk build, nama asset, arsitektur, status ALPHA, kebutuhan login, dan batas fitur konsisten. Tidak perlu menyelesaikan seluruh dokumentasi historis atau seluruh backlog produk sebelum membagikan ALPHA.

### 2. Bangun dan uji paket macOS

`npm run package:mac` membangun UI dan integrations sebelum menghasilkan `dist/Verynize.app`. Untuk mengganti paket lokal sebelumnya gunakan `npm run package:mac -- --replace`. Jalankan `npm run test:package`, lalu `node scripts/desktop-release.mjs` untuk membuat ZIP, checksum SHA-256, dan metadata di `dist/releases`.

**Selesai ketika:** build bersih menghasilkan asset dengan versi dan arsitektur yang benar; app dapat dibuka; pengguna dapat mengedit, menyimpan, dan membuka kembali dokumen. CI juga mengekstrak ZIP lalu menjalankan smoke test terhadap app hasil ekstraksi. Gagal launch, asset UI hilang, atau gagal save/open adalah blocker; notarization dan seluruh suite fitur bukan blocker ALPHA.

### 3. Jalankan CI/CD ALPHA

Workflow `.github/workflows/desktop-alpha.yml` membangun `arm64` dan `x64` pada runner macOS terpisah. PR yang menyentuh jalur packaging dan dispatch manual menghasilkan build artifacts. Push tag dengan pola `desktop-v<package.version>-alpha.<N>` menerbitkan GitHub prerelease setelah package smoke lolos; contoh untuk versi `0.18.0`: `desktop-v0.18.0-alpha.1`.

Asset setiap arsitektur mengikuti pola:

- `Verynize-0.18.0-macos-arm64.zip` (atau `x64`)
- `Verynize-0.18.0-macos-arm64.zip.sha256`
- `Verynize-0.18.0-macos-arm64.zip.json` (metadata versi, SHA, arsitektur dan checksum)

**Selesai ketika:** workflow berhasil pada tag kandidat dan prerelease berisi kedua ZIP serta checksum/metadata. Build untuk PR/manual tidak berarti sudah ada rilis publik. Tag dan publikasi hanya dilakukan ketika memang akan merilis kandidat tersebut.

### 4. Hubungkan situs marketing

Situs mengambil daftar prerelease yang benar-benar diterbitkan, memilih asset macOS sesuai nama/arsitektur, dan menawarkan release notes serta checksum. Jangan memakai endpoint GitHub `releases/latest` untuk menemukan ALPHA karena prerelease bukan stable latest release.

**Selesai ketika:** pengguna bisa memilih Apple Silicon/Intel dan mencapai asset rilis yang sesuai. Status loading, belum ada rilis, serta kegagalan mengambil daftar rilis harus jelas. Build/typecheck/test situs tetap menjadi pemeriksaan perubahan marketing.

### 5. Uji alur dasar web dan desktop

Gunakan Instabox untuk build/test Linux yang relevan dan Mac/CI macOS untuk package smoke. Pilih test terkait perubahan; tidak wajib menjalankan seluruh suite produk untuk perubahan distribusi ALPHA. Uji konfigurasi backend dan alur share/sync yang diumumkan menggunakan backend lokal atau lingkungan yang memang tersedia. Catat test yang belum dijalankan tanpa mengubahnya menjadi hasil lulus.

**Selesai ketika:** hasil build dan smoke tersimpan, download cocok dengan versi/arsitektur, dan tidak ada blocker pada alur dasar yang dipromosikan. Pengujian Linux tidak membuktikan paket `.app` bekerja. Pengujian lokal tidak membuktikan email atau login produksi berhasil.

## Batas ALPHA yang tetap diumumkan

- Paket belum notarized, sehingga macOS dapat meminta persetujuan pengguna untuk membukanya. Tidak ada auto-update; unduh versi berikutnya secara manual.
- File baru yang dibuat saat signed-in dan offline dapat hilang setelah reload, menurut known gaps yang masih dicatat di `implementation-status.md`. Gunakan file native/export untuk salinan penting; jangan menjanjikan offline cloud editing yang tahan reload.
- Beberapa operasi lintas halaman belum menjangkau halaman yang belum dimuat. URL asset yang sudah dibagikan juga belum otomatis dicabut ketika anggota dikeluarkan atau link dirotasi. Kedua gap tetap menjadi backlog; perubahan distribusi tidak memperbaikinya.
- Hosted auth/email, provider AI nyata, passkey tertentu, dan layanan produksi memerlukan bukti tersendiri. Jangan menganggap smoke paket sebagai pengujian layanan tersebut.

ALPHA boleh didistribusikan dengan batas yang jelas ini. Kemudahan distribusi tidak membenarkan klaim bahwa seluruh data, integrasi, atau fitur sudah terjamin.

## Setelah ALPHA, bukan syarat unduhan pertama

Signing Developer ID/notarization, updater otomatis, environment staging terpisah, regression matrix penuh, backup/restore drill lintas D1/Durable Objects/R2, perbaikan offline dan lintas halaman, kebijakan pencabutan asset, kuota/lifecycle/abuse, serta telemetry release CI dapat dikerjakan bertahap setelah jalur unduhan berfungsi.

Branch git `staging` belum merupakan environment hosted staging. `scripts/db-migrate.mjs` memilih database dari `cloudflare.config.ts` dan menolak arbitrary override; jangan menjalankan rehearsal pada database tersebut seolah-olah staging. Rollback code juga tidak otomatis membalik migrasi data room atau asset.

## Bukti dan catatan rilis

Audit awal dilakukan dua agen dan ditinjau Opus 5.5 medium. `node --test tests/platform-contract.cjs` pada audit tersebut lulus 5/5; itu hanya bukti kontrak capability/preload. Rencana kemudian disederhanakan sesuai scope ALPHA, sehingga persyaratan produksi dari review awal bukan gate wajib di sini.

Catat versi/tag, SHA, arsitektur, hasil workflow/package smoke, checksum, dan known issues dalam GitHub prerelease. Konfigurasi CI yang sudah ditambahkan belum berarti workflow remote pernah berhasil atau asset sudah diterbitkan; halaman download harus mengikuti rilis yang benar-benar ada.

### Validasi implementasi — 8 November 2026

- Instabox Linux: `npm run build:ui`, `npm run check`, serta 8 tests release/platform lulus. Registrasi test manifest juga diperiksa.
- Marketing di Instabox: build dan typecheck lulus; 9 tests Playwright lulus. Sesudah penyeragaman pola tag ALPHA, 3 tests download dijalankan ulang dan lulus. Route tree hasil build disinkronkan ke repo marketing.
- macOS Apple silicon: packaging, smoke app langsung, pembuatan ZIP, verifikasi signature/checksum, dan smoke app hasil ekstraksi ZIP semuanya lulus. Smoke mencakup launch, versi/UI, edit, native save dan reopen.
- Artefak lokal `dist/releases/Verynize-0.18.0-macos-arm64.zip`: 360,762,216 byte, SHA-256 `1fb36a3e4931ea77ddc2c993ef56e79e3637fe4879fcb3c183e2c4c4d5ae1122`. Dibangun dari working tree di atas `983f330`, dengan perubahan belum di-commit (`sourceDirty: true`), bukan artefak tag publik.
- Review akhir Opus 5.5 medium tidak menemukan blocker untuk scope ALPHA. Perbedaan kecil regex tag marketing sudah diperbaiki. Formatter dan diff checks bersih.

Belum diuji pada validasi lokal ini: run workflow GitHub pertama, paket Intel, dan pembukaan setelah download browser yang menambahkan quarantine/Gatekeeper. Belum ada tag rilis, publikasi GitHub Release, atau deployment marketing dari pekerjaan ini. Setelah workflow dan situs dipublikasikan, push tag ALPHA yang sesuai versi akan menjalankan jalur build → smoke → prerelease → penemuan aset oleh halaman `/download`.

Sebelum commit/PR, product ditarik ke `origin/staging` pada `60396ac`; perubahan Home-first terbaru tergabung tanpa konflik. Paket `.app` dibangun ulang dan smoke launch/edit/save/reopen serta 8 tests release/platform kembali lulus. ZIP dengan checksum di atas tetap merupakan artefak validasi sebelum pull, bukan ZIP baru dari basis `60396ac`.
