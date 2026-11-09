# Riset ulang screenshot di Electron 45 (2026-11-09)

Temuan 6 di audit ("screenshot gagal, `ERR_FAILED verynize-render://` + Mojo bad IPC") sebelumnya UNVERIFIED. Ada dua kandidat penyebab: app yang jalan memakai runtime lama, atau masalahnya di `dist/Verynize.app` yang masih Electron 42.

## Langkah

1. `dist/Verynize.app` (Electron 42.11.18, versi app 0.18.0, 962 MB) dihapus. Itu satu-satunya build Verynize di mesin ini, tidak ada di `/Applications` atau `~/Applications`, dan sedang tidak berjalan.
2. App dijalankan dengan `vpr start` (= `node scripts/build-ui.cjs && electron .`), Electron 45.2.3.
3. agent-desktop (`snapshot --skeleton --app Electron`) memastikan jendela "Verynize" tampil dan tree aksesibilitasnya lengkap (tab Files, chat, file library). Isi akun tidak disimpan ke repo.
4. `take_screenshot` dipanggil lewat bridge MCP lokal (`~/Library/Application Support/Verynize/mcp.json`, skrip `electron45-rerun/repro/mcp-call.mjs`). Hanya tool baca dan render yang dipakai, tidak ada edit.

## Hasil

| Uji                                                                                                                            | Hasil                                                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Jalur `editor` (dokumen aktif, `source:"editor"`)                                                                              | 2/2 berhasil, 165-383 ms. Jalur ini tidak memakai `verynize-render://`.                                                                                                       |
| Jalur `offscreen` (dokumen tersimpan `live:false`, `source:"offscreen"`, `desktop/render.cjs` → `verynize-render://document/`) | 37/37 render menghasilkan PNG: `spaces-research` artboard `buv`/`pop`, skala 0,25-1, termasuk 5 cold start (`repro/cold-start.sh`). Waktu 450-880 ms. Tidak ada `ERR_FAILED`. |
| Log app (6 sesi, `vpr start`)                                                                                                  | Tidak ada Mojo/bad IPC, `ERR_FAILED`, `render-process-gone`, crash atau OOM.                                                                                                  |

**Kesimpulan temuan 6:** di Electron 45 dari source, kegagalan `ERR_FAILED` tidak muncul. Hipotesis "runtime lama" makin kuat (verdict: **PLAUSIBLE**). App yang memunculkan error itu adalah instance lama: Electron 42 terpaket, atau proses dev yang dimulai sebelum `node_modules` di-upgrade ke Electron 45 pada 11-08 17:30. Dengan app lama dihapus, sumber itu sudah hilang. Kegagalannya sendiri tidak bisa direproduksi lagi tanpa runtime lama, jadi penyebab persisnya tetap belum terbukti. Smoke test render saat startup dan handler `render-process-gone`/`child-process-gone` (Fase 0 #1) tetap perlu.

## Temuan baru

1. **Artboard di atas 10.000 CSS px tidak bisa di-screenshot di skala berapa pun.** `desktop/render.cjs:18-27` memeriksa `width > 10000 || height > 10000` sebelum skala diterapkan. Ketiga artboard di `spaces-flowchart-kit` (`ber`, `goc`, `tuc`, lebar 18.420 px) ditolak dengan "Invalid render dimensions: sides must be 1–10000 CSS px". Begitu juga di skala 0,25, nilai minimum MCP (`integrations/design-tools.mjs:1333`). Ini salah satu penyebab nyata "screenshot gagal" di sesi impor `.pen`, terlepas dari soal runtime. Perbaikan: batasi ukuran output (px × skala), bukan ukuran CSS, atau render per tile.
2. **Satu render offscreen salah dari 38 percobaan.** Render pertama sesi (skala 0,25, `buv`) mengembalikan potongan kiri atas tanpa zoom, dengan font fallback (`screens/scale025-first-call-wrong.png` vs `screens/scale025-correct.png`; selisih rata-rata 97/255 terhadap referensi). Hasilnya tetap dilaporkan `geometry: measured` dan dapat receipt. Kondisinya tidak terulang di 16 render hangat dan 5 cold start. Dugaan: `setZoomFactor` dan `insertCSS` font belum diterapkan saat `capturePage` (`desktop/render.cjs:211-229`). Belum terbukti.
3. **Skala diturunkan diam-diam.** `buv` (2.400 × 5.477) di skala 1 dikembalikan di skala 0,748 (output 1.795 × 4.096). `requestedScale` dan `scale` keduanya dilaporkan, jadi ini sesuai desain (batas 4.096 px). Dicatat supaya tidak dikira bug.
4. **Dokumen `spaces-concept-06` kosong** (194 byte, 0 artboard). Lane Concept dari sesi `.pen` tidak ada di file itu. File library aktif "Spaces" di desktop juga hanya berisi 3 node starter (Heading, Violet card, Caption). Ini konsisten dengan divergensi "desktop 3 node" di temuan 1, tapi tidak diselidiki lebih jauh (read-only).

## Tidak diuji

Drag/resize yang hilang saat ada edit remote: butuh client kedua di room yang sama dan edit di production, jadi tidak dilakukan di sesi ini.

## Status app

`dist/Verynize.app` sudah tidak ada. Build ulang dengan `npm run package:mac` akan memakai Electron 45. App dev dibiarkan berjalan lewat `vpr start`.
