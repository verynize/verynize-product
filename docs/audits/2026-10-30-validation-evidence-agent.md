# Validasi bukti gambar — 30 Oktober 2026

Penanggung jawab: agent validasi bukti. Agent ini tidak mengoperasikan desktop dan tidak mengubah dokumen utama. Cakupan: [dokumen alur Wonder](../wonder-design-workflow-2026-10-30.md), [audit Properties](2026-10-30-properties-agent.md), dan [audit Variables/Icons](2026-10-30-variables-icons-agent.md). Setiap klaim yang merujuk gambar dicocokkan dengan gambar yang dibuka langsung.

## Pemeriksaan mekanis

| Pemeriksaan                                   | Hasil                                                                                                                                                                                                                                                                                         |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Jumlah screenshot Wonder                      | 43 file `00-*.png` … `42-*.png`, berurutan tanpa celah, ditambah `wonder-workflow.png`. Cocok dengan klaim "43 screenshot (00–42)".                                                                                                                                                           |
| Folder `design/wonder/2026-10-30/validation/` | Ada, tetapi kosong. Tidak dirujuk dokumen.                                                                                                                                                                                                                                                    |
| Export Wonder `wonder-workflow.png`           | `sips`: 1600 × 1140. Cocok. Isi: judul, body, tiga label dan Spark berada di dalam gambar. Tidak ada chrome atau selection.                                                                                                                                                                   |
| Artboard 800×570                              | Terlihat pada 01–06, 27–29, 32–42. Pada 23–26 artboard sementara 800×510, sesuai catatan dokumen.                                                                                                                                                                                             |
| Ikon X680/Y40                                 | Terlihat pada 40 (X 680, Y 40, rotation 0, toggle absolute aktif). Sebelumnya ikon memakai koordinat halaman X60/Y−265 (09–13, 39), yang setara dengan 680/40 relatif terhadap frame di −620/−305.                                                                                            |
| Export Verynize                               | `workflow-export.png` dan `workflow-export-before-scale-fix.png` sama-sama 1600 × 1140. Versi sebelum perbaikan berisi artwork 800×570 di pojok kiri atas. `export-verification.json` mencatat width 1600, height 1140, layers 8 dan svgTintPresent 1.                                        |
| Screenshot produk Verynize                    | `01-individual-corners`, `02-individual-border-widths`, `svg-color-variable` dan `workflow-canvas` masing-masing 2880 × 1740. Jumlahnya empat, sesuai klaim baris 310.                                                                                                                        |
| `workflow.verynize.json`                      | Ada 8 node, 2 token warna dan 4 typed variable (6 variable, 5 tipe). Spark berstatus `position: absolute` pada 680/40. Artboard 800×570 terikat `surface`, sedangkan radius/padding/gap terikat `spacing`. Cocok dengan baris 284. Catatan: nama token tetap `surface`, bukan `surface/base`. |
| Tautan relatif                                | Semua tautan Markdown di ketiga dokumen terselesaikan ke file yang ada, termasuk anchor `wonder-canvas-spec.md#3-inspector-…`.                                                                                                                                                                |
| "61 baris checklist" (baris 319)              | P01–P32 (32), V01–V19 (19) dan I01–I10 (10) berjumlah 61. Cocok.                                                                                                                                                                                                                              |

## Tabel klaim dan bukti

Status: **Sesuai** (gambar menunjukkan klaim), **Berlebihan** (klaim lebih kuat dari gambar), **Salah rujukan** (bukti ada di gambar lain), **Tidak didukung** (tidak ada gambar yang menunjukkan klaim).

### Jurnal sesi

| Klaim                                                                                         | Baris      | Gambar      | Status                 | Catatan                                                                                                                                        |
| --------------------------------------------------------------------------------------------- | ---------- | ----------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Baseline Thrush / Page 1, canvas kosong, Page 2B2B2B 100%                                     | 43, 47     | 00          | Sesuai                 | Variables/Icons dilipat, zoom 100%.                                                                                                            |
| Frame 800×570, X−620, Y−305, rotation 0                                                       | 48, 96–102 | 01          | Sesuai                 | Isi inspector (Position/Layout/Appearance/Fill/section lain) cocok.                                                                            |
| Fill 111827, radius 24, menu lima tipe                                                        | 49         | 02          | Sesuai                 |                                                                                                                                                |
| Variables 5; strength 0; weight sedang diedit                                                 | 50         | 03          | Sesuai                 |                                                                                                                                                |
| surface/spacing/strength=1/family/weight=600                                                  | 51         | 04          | Sesuai                 |                                                                                                                                                |
| Chip surface dan spacing, Flex aktif                                                          | 52         | 05          | Sesuai                 | Flex Row, gap 10/10 dan padding 0 masih literal.                                                                                               |
| Column; vertical gap dan padding X/Y = spacing                                                | 53, 109    | 06          | Sesuai                 | Horizontal gap tetap literal 10.                                                                                                               |
| Judul X24/Y24, 487.7 Hug × 58 Hug, family/weight chip, 48px, −1.5px, F8FAFC                   | 54         | 07          | Sesuai                 | Line height Auto dan alignment left/top juga terlihat.                                                                                         |
| Body copy; menu Upload/Paste/Add from selection (disabled)                                    | 55         | 08          | Sesuai                 | Alasan "tidak ada selection" adalah inferensi. Inspector menampilkan Page, sehingga inferensi itu masuk akal.                                  |
| Icons 1, pasted 64×64, Colors 5EEAD4, opacity chip strength, ikon redup                       | 56         | 09          | Sesuai                 | Nilai strength=1 tidak terlihat di 09; nilai itu terlihat di 04.                                                                               |
| strength 0.6, chip tetap                                                                      | 57         | 10          | Sesuai                 |                                                                                                                                                |
| surface #172033, spacing 32px, propagasi                                                      | 58, 109    | 11 (vs 10)  | Sesuai                 | Ada sebelum–sesudah: 10 (#111827/24) → 11 (#172033/32). Inset teks bergeser dan radius membesar. Layak dilabel **Teruji**.                     |
| strength 60, ikon jelas                                                                       | 59, 124    | 12          | Sesuai                 | Perbandingan 10 → 12 menunjukkan efek.                                                                                                         |
| Variables 6, Colors chip accent, opacity strength                                             | 60         | 13          | Sesuai                 | Nilai accent #5EEAD4 baru terlihat pada 34/42.                                                                                                 |
| Grid 690×210, field 2 diedit, preview 3×1                                                     | 61         | 14          | Sesuai                 |                                                                                                                                                |
| Tiga track, padding 20/20, margin 0/0, radius 16, fill 1E293B, border 1 All, gap chip spacing | 62         | 15          | Sesuai                 | Warna border di 15 masih 000000; 334155 muncul di 16.                                                                                          |
| Border 334155, outline 5EEAD4/1/4, shadow X0 Y12 blur4 spread−4 hitam 25%                     | 63         | 16          | Sesuai                 | Field spread masih dalam mode edit (kursor aktif), sehingga commit nilai tidak terlihat. Nilai −4 belum terbukti tersimpan.                    |
| Blur 2; daftar Layer dan Backdrop                                                             | 64         | 17          | Sesuai                 |                                                                                                                                                |
| Brightness 1.1; Linear alpha 100 rotation 180°                                                | 65         | 18          | Sesuai                 |                                                                                                                                                |
| Radial; Mode Auto, Repeat, X0%/Y0%, Size auto                                                 | 66         | 19          | Sesuai                 | Nilai X/Y/Size tampil abu-abu dan tampak seperti placeholder, bukan nilai yang diisi.                                                          |
| Conic 45°, alpha 100, Invert tidak aktif                                                      | 67         | 20          | Sesuai                 |                                                                                                                                                |
| Mask disembunyikan; Export Frame 2x PNG                                                       | 68         | 21          | Sesuai                 | Bagian 2x/PNG terpotong di tepi bawah.                                                                                                         |
| Menu PNG/JPG/WebP/PDF/Code, tanpa SVG                                                         | 69         | 22          | Sesuai                 |                                                                                                                                                |
| Fill literal 172033 tanpa perubahan warna; radius spacing; 800×510                            | 70, 136    | 23          | Sesuai (Diterapkan)    | Keadaan bound tepat sebelum detach tidak ditangkap. Bukti sebelumnya adalah 11/13. Status V16 "mempertahankan" layak, tetapi bukan **Teruji**. |
| Linear; menu L/R/C; stop 172033 dan 456099                                                    | 71         | 24          | Sesuai sebagian        | Hex stop tertutup menu. Nilainya terbaca dari Selection colors dan dari 25/26.                                                                 |
| Radial, stop 456099/172033 100%                                                               | 72         | 25          | Sesuai                 |                                                                                                                                                |
| Conic dengan handle melingkar                                                                 | 73         | 26          | Sesuai                 |                                                                                                                                                |
| Menu blend Normal…Hard light; artboard 800×570                                                | 74, 138    | 27          | Sesuai                 | Klaim "dropdown berlanjut" tidak dapat diverifikasi dari gambar.                                                                               |
| Multiply: "seluruh komposisi menjadi gelap"                                                   | 75         | 28          | Berlebihan ringan      | Canvas digulir. Hanya bagian bawah artboard yang terlihat, judul dan ikon tidak.                                                               |
| Radius Mixed 8/32/48/32; menu W                                                               | 76, 140    | 29          | Sesuai                 | **Tetapi** 30 dan 31 menunjukkan 8/32/**32**/32. Perubahan BR 48→32 di antara 29 dan 30 tidak dicatat.                                         |
| Shifted Swirls 3; picker Background/SVG/Image; parameter warna                                | 77         | 30          | Sesuai                 |                                                                                                                                                |
| Shader settings, slider tanpa nilai numerik                                                   | 78         | 31          | Sesuai                 | Slider Grain Strength terpotong.                                                                                                               |
| Komposisi solid; fill surface/radius spacing dipasang kembali "menurut pelaksana"; Icons grid | 79         | 32          | Sesuai sebagian        | Fill dan radius tidak terlihat di 32 (inspector hanya menampilkan Position/Layout). Bukti binding kembali ada pada 35/36.                      |
| Asset di-rename pasted→Spark; search Spark                                                    | 80         | 33          | Salah rujukan sebagian | 33 hanya menampilkan query "Spark" dan satu thumbnail. Nama "Spark" baru terlihat pada inspector 39/40. Frasa "AX PlaceSpark/nameSpark" rusak. |
| Capture akhir: enam variable, Spark, judul/body, tiga label, tanpa selection                  | 81         | 34          | Sesuai                 | Menampilkan accent #5EEAD4, surface #172033, spacing 32px dan strength 60.                                                                     |
| Rename via F2, chip menjadi base                                                              | 82         | 35          | Sesuai                 | Struktur nama `surface/base` terbukti pada 36. F2 adalah catatan pelaksana.                                                                    |
| Folder surface → base #172033, binding base                                                   | 83         | 36          | Sesuai                 |                                                                                                                                                |
| Search kosong, fill literal 172033                                                            | 84         | 37          | Sesuai                 | Teks "No variables match 'surface'".                                                                                                           |
| CmdZ mengembalikan folder dan chip                                                            | 85         | 38          | Sesuai                 | Sebelum–sesudah 37→38 tersedia. Layak **Teruji**.                                                                                              |
| Ikon miring dan mirrored, −15°                                                                | 86         | 39          | Sesuai                 | Nilai awal 15° sebelum flip tidak tertangkap.                                                                                                  |
| Child absolute X680/Y40, rotation 0, accent/strength bertahan                                 | 87         | 40          | Sesuai                 | Label "Locked to layout" tidak terlihat sebagai teks. Ikon toggle absolute aktif.                                                              |
| Export wonder-workflow 2× PNG, toast; file 1600×1140                                          | 88         | 41 + export | Sesuai                 | Dimensi diverifikasi dengan `sips`.                                                                                                            |
| Capture akhir dengan folder surface/base, enam variable, satu ikon                            | 89         | 42          | Sesuai                 | Baris weight terpotong di bawah panel.                                                                                                         |

### Binding, catatan unit, filter/mask

| Klaim                                                                  | Baris   | Gambar                | Status              | Catatan                                                                          |
| ---------------------------------------------------------------------- | ------- | --------------------- | ------------------- | -------------------------------------------------------------------------------- |
| Tabel binding: surface/base, spacing, strength, family, weight, accent | 111–118 | 06, 07, 13, 34–36, 42 | Sesuai              | Nilai accent tidak terlihat pada 13 yang dirujuk; nilainya terlihat pada 34/42.  |
| Brightness 110 dibatasi menjadi 3 lalu dikoreksi                       | 128     | —                     | Tidak didukung      | Tidak ada gambar dan tidak diberi label "menurut pelaksana".                     |
| Binding blur shadow tidak menghasilkan chip                            | 132     | 16                    | Sesuai              | Klaim negatif. Gambar hanya menunjukkan blur 4 literal, bukan percobaannya.      |
| Detach mempertahankan warna                                            | 136     | 23                    | Sesuai (Diterapkan) | Lihat jurnal 23.                                                                 |
| Gradient fill dua stop; Add Stop terlihat                              | 138     | 24–26                 | Sesuai              |                                                                                  |
| Capture 29 membuktikan edit per-corner                                 | 140     | 29                    | Sesuai              | Perubahan 29→30 (48→32) perlu dicatat.                                           |
| Delete 37, Undo 38                                                     | 144     | 37, 38                | Sesuai              |                                                                                  |
| Posisi awal flex flow Y576                                             | 146     | —                     | Tidak didukung      | Hanya catatan pelaksana. Gambar 09–39 menampilkan Y−265 dalam koordinat halaman. |

### Checklist Properties / Variables / Icons

| Klaim                                                    | Baris    | Gambar                          | Status                 | Catatan                                                                                                       |
| -------------------------------------------------------- | -------- | ------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------- |
| P02 "rotation diuji 39"                                  | 172      | 39, 40                          | Berlebihan             | Hanya ada keadaan sesudah. Lebih tepat "diterapkan".                                                          |
| P04 rotation 15 → flip → −15; pulih 0/unflipped          | 174      | 39, 40                          | Sesuai                 | Nilai 15 awal tidak tertangkap.                                                                               |
| P07, P08, P10–P13, P17–P20                               | 177–190  | 05–07, 09–10, 14–15, 23, 27, 29 | Sesuai                 |                                                                                                               |
| P14 "tampilan normal kembali 29"                         | 184      | 29                              | Sesuai                 | Status menu blend tidak terlihat di 29. Tampilan terang menjadi bukti tidak langsung.                         |
| P15 per-corner 8/32/48/32 pada 29                        | 185      | 29, 30, 31                      | Sesuai, tidak lengkap  | 30/31 menunjukkan 8/32/32/32.                                                                                 |
| P21 "Color binding melalui Variables 05"                 | 191      | 05                              | Sesuai sebagian        | Chip terlihat. Jalur picker Choose color → Variables tidak tertangkap.                                        |
| P22 stop 172033/456099 pada 24                           | 192      | 24–26                           | Sesuai                 | Pada 24 nilai stop tertutup.                                                                                  |
| P24 shader "dinonaktifkan 32"                            | 194      | 32                              | Sesuai sebagian        | Fill tidak terlihat di 32. Canvas solid menjadi bukti tidak langsung. Fill literal/bound terlihat lagi di 35. |
| P25–P29, P30, P32                                        | 195–202  | 12–13, 16–22, 41                | Sesuai                 | Spread −4 belum ter-commit pada 16.                                                                           |
| V02 rename menjadi folder surface/base 35–36             | 213      | 35, 36                          | Sesuai                 |                                                                                                               |
| V06 search/kosong/reset 36, 37, 42                       | 217      | 36, 37, 42                      | Sesuai                 |                                                                                                               |
| V10, V15 propagasi 24→32 pada 11                         | 221, 226 | 10, 11                          | Sesuai (Teruji)        |                                                                                                               |
| V11 "strength→opacity teruji 09–12"                      | 222      | 09, 10, 12                      | Sesuai                 | 09→10 tidak berbeda secara visual. Efek terlihat pada 10→12.                                                  |
| V13 "bind kembali surface 32"                            | 224      | 32                              | Salah rujukan          | Fill tidak terlihat di 32. Gunakan 35 (chip `base`) atau 36.                                                  |
| V14 "bound spacing lagi 32; radius32 mengembalikan chip" | 225      | 32                              | Salah rujukan          | Radius tidak terlihat di 32. Chip spacing setelah per-corner terlihat pada 35–38. "radius32" ambigu.          |
| V16, V17, V18                                            | 227–229  | 23, 37, 38                      | Sesuai                 |                                                                                                               |
| V19 "PNG desain export 41 teruji"                        | 230      | 41 + export                     | Sesuai                 |                                                                                                               |
| I01, I02, I04, I06, I07, I10                             | 240–249  | 08, 09, 12, 13, 40, 41          | Sesuai                 |                                                                                                               |
| I03 "rename/search Spark 33"                             | 242      | 33                              | Salah rujukan sebagian | Rename terlihat di 39/40, bukan 33.                                                                           |
| I05 Rotate 15 + Flip H 39                                | 244      | 39, 40                          | Sesuai                 |                                                                                                               |
| I09 "Rename pasted→Spark … dikonfirmasi 33"              | 248      | 33                              | Salah rujukan          | Nama Spark terbukti di 39/40. 33 hanya bukti tidak langsung (hasil search).                                   |

### Ringkasan status (baris 312–323)

| Klaim                                                             | Baris | Gambar        | Status        | Catatan                                                                                                                         |
| ----------------------------------------------------------------- | ----- | ------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| "Terbukti 00–42"                                                  | 314   | 00–42         | Sesuai        |                                                                                                                                 |
| Lima tipe, enam variable                                          | 315   | 04–13, 34, 42 | Sesuai        |                                                                                                                                 |
| Detach lalu "binding dipasang lagi 32 menurut pelaksana"          | 317   | 23, 32        | Salah rujukan | Ganti 32 dengan 35.                                                                                                             |
| SVG Colors + opacity 13; Spark dicari 33                          | 318   | 13, 33        | Sesuai        |                                                                                                                                 |
| Hasil PNG 41; 1600×1140                                           | 321   | 41 + export   | Sesuai        |                                                                                                                                 |
| Ringkasan sesi: "Cakupan yang diuji meliputi flex/grid, … shader" | 5     | 05–31         | Berlebihan    | Menurut tabel label, sebagian besar item ini **Diterapkan** atau **Terlihat**, bukan **Teruji**. Shader settings hanya diamati. |

### Bukti produk Verynize

| Klaim                                                                | Baris    | Gambar                | Status          | Catatan                                                                                                                                                                                                                                                      |
| -------------------------------------------------------------------- | -------- | --------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Editor radius per-corner                                             | 273      | verynize/01           | Sesuai          | TL 8, TR 32, BR 48, BL 32, Mixed.                                                                                                                                                                                                                            |
| Border per-side, kembali ke binding                                  | 273      | verynize/02           | Sesuai          | T2/R4/B6/L8 dengan radius bound `space`.                                                                                                                                                                                                                     |
| "SVG proof": warna bentuk terikat variable, terpisah dari background | 277      | svg-color-variable    | Berlebihan      | Bentuk hijau dan variable accent #00FF00 terlihat. Baris Colors/chip binding pada inspector tidak terlihat karena panel tertutup tumpukan toast "invalid SVG data". Thumbnail Icons tampil sebagai gambar rusak. Gambar tidak menunjukkan indikator binding. |
| Toast invalid SVG yang diharapkan                                    | 276      | svg-color-variable    | Sesuai          | Toast terlihat. Gambar yang sama dipakai untuk dua klaim berbeda.                                                                                                                                                                                            |
| Export 1600×1140 setelah perbaikan                                   | 278, 288 | workflow-export, JSON | Sesuai          |                                                                                                                                                                                                                                                              |
| Rekonstruksi: 8 layer, 6 variable, Spark absolute                    | 284      | workflow-canvas, JSON | Sesuai via JSON | Screenshot hanya menampilkan satu layer induk yang dilipat. Jumlah layer berasal dari JSON/verification.                                                                                                                                                     |

## Inkonsistensi antar-dokumen

1. **Audit Variables/Icons, bagian "Fresh Wonder evidence"**: tertulis bahwa 13 menunjukkan Colors terikat accent "independently of its background". Gambar 13 tidak menampilkan background ikon sama sekali, sehingga klaim independensi berlebihan.
2. **Audit Variables/Icons**: tabel awal "Evidence and coverage" masih menyatakan bahwa ikon tidak memiliki editable SVG colors dan malformed base64 dapat melempar error saat insert. Bagian lanjutan menyatakan keduanya sudah ditangani (SVG Colors monochrome, I1 fixed). Tabel awal tidak diberi tanda "sebelum perbaikan".
3. **Gap rename warna (V3)**: audit Variables/Icons mencatat bahwa nama color variable tidak bisa di-rename di Verynize dan tidak menandainya selesai. Daftar gap pada dokumen utama (baris 280, 331) tidak menyebut gap ini.
4. **Variabel lingkungan bukti**: audit Properties memakai `BD_WONDER_EVIDENCE_DIR` (sesuai `tests/inspector-variable-binding.cjs`), sedangkan audit Variables/Icons memakai `VERYNIZE_EVIDENCE_DIR` (sesuai `tests/inspector-variable-library.cjs`). Keduanya benar per test, tetapi reproduksi bukti `design/verynize/2026-10-30/` memerlukan dua variabel. Dokumen utama tidak menyebutkannya.
5. **`npm run build:ui`**: dokumen utama menulis "Lulus" tanpa catatan. Audit Variables/Icons mencatat warning aset `x.png` dan `…` yang belum terselesaikan.
6. **Nama variable rekonstruksi**: `workflow.verynize.json` memakai `surface`, sedangkan keadaan akhir Wonder memakai `surface/base`. README dan dokumen utama tidak menyebutkan perbedaan ini.

## Koreksi konkret yang disarankan

1. Baris 76/140/185 (P15): tambahkan catatan bahwa capture 30–31 menunjukkan radius 8/32/32/32, karena BR diubah dari 48 ke 32 setelah 29. Jika perubahan ini tidak disengaja, catat sebagai keadaan tak terjelaskan.
2. Baris 224 (V13), 225 (V14), 317: ganti rujukan "32" dengan "35–36" untuk bukti fill `base` dan radius `spacing` yang terikat kembali. Ganti "radius32" dengan "radius 32px" atau hapus.
3. Baris 80, 242 (I03), 248 (I09): rujuk 39/40 untuk nama Spark yang terlihat. Perbaiki "dikonfirmasi AX PlaceSpark/nameSpark" menjadi misalnya "dikonfirmasi pelaksana melalui Accessibility (nama `Spark`)".
4. Baris 5: ganti "Cakupan yang diuji meliputi …" dengan "Cakupan yang dicoba/diterapkan meliputi …", agar tidak bertentangan dengan definisi label **Teruji**.
5. Baris 172 (P02): ganti "rotation diuji 39" dengan "rotation diterapkan 39".
6. Baris 75: ganti "Seluruh komposisi menjadi gelap" dengan "Bagian artboard yang terlihat menjadi gelap (canvas digulir)".
7. Baris 128: beri label "menurut pelaksana" untuk percobaan Brightness 110 → 3.
8. Baris 63: catat bahwa spread −4 masih dalam mode edit saat capture.
9. Baris 277: tulis bahwa `svg-color-variable.png` membuktikan tint bentuk dan variable accent, tetapi chip binding tertutup toast. Lebih baik ambil ulang screenshot tanpa toast, dengan inspector Colors terlihat.
10. Audit Variables/Icons: hapus "independently of its background" untuk capture 13, dan tandai tabel awal sebagai keadaan sebelum perbaikan.
11. Tambahkan gap rename warna Verynize (V3) ke daftar gap dokumen utama, atau nyatakan statusnya.
12. Perbaiki spasi yang hilang dan kata yang tergabung (lihat bagian berikut).

## Typo: spasi hilang dan kata tergabung

Pola ini sistemik: spasi sebelum angka, `#` atau `−` hilang di hampir semua tabel. Daftar per baris dokumen utama:

- 5: `pada1600×1140`
- 9: `Page1` (bandingkan `Page 1` di baris 43/47) dan `**Frame**,800×570`
- 54: `size48px`, `spacing−1.5px`
- 56: `Icons1`, `berukuran64×64`
- 57: `menjadi0.6`
- 58: `menjadi#172033`, `spacing32px`
- 59: `nilai0.6`
- 60: `Variables6`
- 61: `Field2`, `masih3×1`
- 62: `padding20/20`, `margin0/0`, `radius16`, `fill1E293B`, `width1`
- 63: `Border334155`, `outline5EEAD4`, `width1`, `offset4`, `blur4`, `spread−4`, `hitam25%`
- 64: `Blur2`
- 65: `Brightness1.1`, `alpha100`, `rotation180°`
- 67: `rotation45°`, `alpha100`
- 68: `konfigurasi2x`
- 70: `sementara800×510`
- 71: `memakai172033`, `dan456099`
- 72: `stop456099/172033`, `masing-masing100%`
- 74: `kembali800×570`
- 76: `dengan8/32/48/32`
- 77: `Swirls3`, `Center456099`, `Edge172033`, `ColorFFFFFF`, `Background000000`
- 79: `label01/Variables`, `Icons1`
- 80: `menjadiSpark`, `PlaceSpark/nameSpark`
- 82: `denganF2`, `menampilkanbase`
- 83: `nilai#172033`, `tetapbase`
- 84: `searchsurface`
- 85: `CmdZ` (lebih jelas: `Cmd+Z`), `bindingbase`
- 86: `menunjukkan−15°`, `memulihkan0°/unflipped`
- 87: `membuatchild`, `absoluteX680/Y40`
- 88: `scale2×`, `formatPNG`
- 113: `rename35`, `Undo38`
- 115: `fraksi0–1`
- 124: `bernilai1`, `menjadi60`, `untuk60%`, `gunakan60`, `bukan0.6`, `dinormalisasi0–1`
- 128: `menampilkan1.1`
- 130: `Pada21`
- 132: `tetap4`
- 138: `menu27`, `gelapnya28`
- 140: `individual8/32/48/32`, `sementara510`, `kembali570`
- 144, 229: `CmdZ`
- 146: `membuatchild`, `menunjukkanX680/Y40`, `export2×PNG`, `diukur1600×1140`
- 172: `FrameX−620/Y−305`, `absolutechildX680/Y40`
- 174: `rotation15`, `FlipHorizontal39`, `menampilkan−15`, `pulih0/unflipped40`, `Rotate90/FlipV`
- 176: `absolute40`, `ZAuto`
- 177: `Flex05`, `Column06`, `Grid14–15`
- 178: `fixed800×570`, `transientH510`, `lalu570`, `Hug07`
- 181: `frame14–15`
- 183: `strength09–10`
- 184: `Menu27`, `kembali29`
- 185: `spacing05–06`, `per-corner8/32/48/32`
- 187: `size48px`
- 188: `heightAuto`, `spacing−1.5px`
- 190: `surface05–06`, `F8FAFC07`
- 191: `Variables05`
- 192: `Linear24`, `Radial25`, `Conic26`, `stop172033/456099`
- 194: `ShiftedSwirls3`, `dinonaktifkan32`, `settings31`
- 195: `Border1px`, `warna334155`
- 196: `Outline1px`, `offset4`, `warna5EEAD4`
- 198: `Blur2`, `Brightness1.1`
- 199: `Linear180°`, `Conic45°18–20`, `off21`, `saat20`
- 202: `berhasil41`, `menu22`
- 213: `surface#111827`, `dibuat03`, `berubah172033`, `renamefolder`
- 215: `akhir60`
- 216: `familyInter`, `weight600`, `dibuat04`, `judul07`
- 217: `Searchsurface`, `folderbase36`, `hasilkosong`, `saatdelete37`, `akhir42`
- 218: `surface/base35`, `delete37`, `Undo38`
- 221: `paddingX/Y/gap06`, `edit24→32`
- 222: `teruji09–12`, `gunakan60`, `untuk60%`, `bukan0.6`
- 223: `literal48px`
- 224: `detach23`, `surface32`
- 225: `individual29`, `lagi32`, `radius32`
- 226: `surface#111827`, `spacing24→32`
- 227: `detach23`, `mempertahankan172033`
- 228: `Deleteusedcolor37`, `mempertahankan172033`
- 229: `bindingbase38`, `Redo/edit/bindundo`
- 230: `export41`, `reopen/variableCSSexport`
- 240: `Menu08`
- 242: `Grid32`, `rename/searchSpark33`
- 243: `Spark64×64`, `ikutexport41`
- 244: `Rotate15+FlipHorizontal39`
- 245: `accent13`
- 248: `dikonfirmasi33`
- 278: `memenuhi1600×1140`
- 317: `lagi32`
- 321: `41;1600×1140/2×`
- 322: `PNG41`

Tidak ditemukan typo serupa yang signifikan pada kedua audit agent.
