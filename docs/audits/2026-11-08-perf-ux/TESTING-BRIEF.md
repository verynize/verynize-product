# Testing brief untuk agen P0-P2 (2026-11-09)

Semua test dijalankan **berurutan**. Box instabox `coba` (free plan, 1 sandbox) adalah tempat utama. Mac hanya untuk test yang memang butuh macOS.

## Lokal (Mac), boleh kapan saja

- `node --test ...`, `integrations/*.test.mjs`, dan test cloud berbasis workerd (`node tests/cloud-*.mjs`). Ini cepat dan tidak membuka jendela.
- `npm run check`, `npm run lint`, `npm run lint:ui && npm run typecheck:ui` (lint pakai `npx vp lint` penuh, bukan subset).
- Format: `chore/format-lint` belum merge, jadi **hanya format file baru** (`npx vp fmt <file baru>`). Jangan format ulang file lama.

## Electron dan suite di instabox (berurutan)

1. Buat tarball dari perubahan di worktree-mu, relatif ke root repo:
   ```sh
   git diff --name-only origin/staging --diff-filter=d > /tmp/<slot>-files.txt
   git ls-files --others --exclude-standard >> /tmp/<slot>-files.txt
   git diff --name-only origin/staging --diff-filter=D > /tmp/<slot>-deleted.txt
   COPYFILE_DISABLE=1 tar -czf /tmp/<slot>.tgz -T /tmp/<slot>-files.txt
   instabox push coba /tmp/<slot>.tgz /data/tmp/incoming/<slot>.tgz
   instabox push coba /tmp/<slot>-deleted.txt /data/tmp/incoming/<slot>-deleted.txt
   ```
   Jangan pakai `instabox push --all` untuk seluruh worktree, karena bisa macet lebih dari 20 menit.
2. Siapkan slot (salinan bersih dari `origin/staging`, ditambah perubahanmu):
   `instabox exec coba --timeout 600 -- /data/home/vfix-slot <slot> /data/tmp/incoming/<slot>.tgz /data/tmp/incoming/<slot>-deleted.txt`
3. Jalankan test. Script sudah memakai `CI=1` dan `flock /data/tmp/locks/electron.lock`, jadi agen lain otomatis antre:
   - Singkat (≤ 10 menit): `instabox exec coba --timeout 600 -- /data/home/test-slot <slot> --changed --base origin/staging`
   - Panjang: `instabox exec --background coba -- /data/home/test-slot <slot> --group canvas`, lalu `instabox jobs wait coba <job>` dan `instabox jobs logs coba <job>`.
   - Opsi runner: `--changed`, `--files a,b`, `--group`, `--lane`, `--explain` (lihat header `scripts/run-tests.mjs`).
4. Laporan ada di `/data/test-results/verynize/<slot>-*/`. Baca `runner.log`.

Kalau ada yang gagal, bandingkan dulu dengan baseline `origin/staging` di slot `base` (`/data/home/vfix-slot base` tanpa tarball) sebelum menyebutnya regresi. Yang diketahui flaky di box: `cloud-switch-cache`, `capture-live-state`, `capture-fidelity`, `mcp-shell`, `preview-interaction`.

## Mac (hanya bila perlu macOS)

Contoh: render offscreen dengan `screen.scaleFactor`, keychain, dan agent-desktop. Hanya satu Electron test pada satu waktu. Ambil lock dengan `until mkdir /tmp/verynize-electron.lock 2>/dev/null; do sleep 5; done`, lalu hapus dengan `rmdir` setelah selesai. App Verynize dev milik user (`vpr start`) jangan ditutup.

## Aturan

- Tidak ada edit di production. Jangan deploy, push, atau buat PR.
- Test baru wajib masuk `scripts/test-manifest.mjs` (`integrations/*.test.mjs` otomatis). Jangan pernah melonggarkan assertion yang sudah ada.

## Baseline `origin/staging` 2630c30 di box (2026-11-09, `CI=1`, `--all`)

261 lulus, 3 gagal, 1 dilewati dalam 890 s. Yang gagal di baseline: `tests/telemetry-desktop.cjs`, `tests/chat-indicators.cjs`, `tests/settings.cjs`. Kegagalan di tiga test ini bukan regresi kecuali pesan errornya berbeda.

Catatan box: sejak 2026-11-09 sekitar 00:35Z semua slot adalah worktree dari `/data/workspace/.repo.git` (bare clone). Disk `/data` dibatasi 20 GiB, jadi hapus slot dan hasil test yang sudah tidak dipakai.
