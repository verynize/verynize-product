# Validasi alur Wonder — ringkasan 30 Oktober 2026

Validasi terhadap [wonder-design-workflow-2026-10-30.md](../wonder-design-workflow-2026-10-30.md) dikerjakan oleh tiga agent paralel. Hanya agent computer use yang mengontrol desktop.

| Agent        | Metode                                                                                                                                                              | Laporan                                                                                                                                 |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Source       | Membaca renderer Wonder 0.2.190. `app.asar` hanya berisi shell Electron; editor dimuat dari app.wonder.so, sehingga source diambil dari cache browser lokal terbaru | [validation-source-agent](2026-10-30-validation-source-agent.md)                                                                        |
| Computer use | Mengoperasikan Wonder yang sedang berjalan dan mengambil 32 screenshot (v01–v32). Semua perubahan percobaan di-undo                                                 | [validation-computer-use-agent](2026-10-30-validation-computer-use-agent.md) · [screenshot](../../design/wonder/2026-10-30/validation/) |
| Bukti        | Mencocokkan setiap klaim dengan screenshot 00–42, ukuran export dan link                                                                                            | [validation-evidence-agent](2026-10-30-validation-evidence-agent.md)                                                                    |

## Terkonfirmasi

- File Thrush / Page 1 dengan artboard Frame berukuran 800×570. Spark merupakan child absolute di X680/Y40.
- Kelima tipe variable tersedia. Binding untuk fill, radius, padding/gap, tipografi, opacity dan warna ikon sesuai dengan dokumen.
- Nilai variable dipropagasi secara live: `spacing`, `accent` dan `strength` diubah, lalu di-undo.
- Rename tetap mempertahankan binding karena binding merujuk ke ID variable. Delete dan detach mempertahankan nilai yang sudah di-resolve.
- Export PNG berukuran 1600×1140. Screenshot 00–42 lengkap tanpa celah, dan semua link relatif valid.

## Koreksi untuk dokumen utama

Klaim-klaim berikut berbeda dari hasil validasi:

1. **Duplicate variable:** tidak ada di menu (Rename, Reference variable, Delete), sehingga statusnya _Tidak tersedia_, bukan _Belum_. Temuan ini dikonfirmasi oleh source dan UI.
2. **Blend:** ada 18 mode. Difference, Exclusion, Hue, Saturation, Color dan Luminosity perlu ditambahkan.
3. **Drop shadow:** tidak ada di menu filter. Fitur ini adalah tipe "Drop" pada Shadow.
4. **Export SVG:** hanya muncul jika seluruh seleksi berupa node SVG, jadi bukan fitur yang hilang.
5. **Anchor:** hanya Left/Right dan Top/Bottom, tanpa Center. **Image fill:** Fill/Cover/Contain/None.
6. **List view Icons:** tersedia dan sedang aktif, sehingga tidak tepat lagi disebut _Belum_.
7. **Rujukan gambar yang salah:**
   - V13/V14 dan baris 317 merujuk 32. Bukti yang benar ada di 35–36.
   - Rename Spark merujuk 33. Bukti yang benar ada di 39–40.
   - Teks "AX PlaceSpark/nameSpark" pada baris 80 rusak.
8. **Klaim lebih kuat daripada bukti:**
   - Baris 5 menyebut efek "diuji".
   - Rotasi P02 hanya didukung capture sesudah.
   - Capture 28 tidak menunjukkan seluruh desain.
   - Spread −4 pada capture 16 masih dalam proses edit.
   - Chip binding pada `svg-color-variable.png` tertutup toast.
9. **Perubahan radius tidak tercatat:** capture 29 menunjukkan 8/32/48/32, sedangkan capture 30–31 menunjukkan 8/32/32/32.
10. **Typo spasi di seluruh dokumen:** misalnya "pada1600×1140", ",800×570", "Page1" dan "Deleteusedcolor37".

## Celah cakupan dari source

- Variable bertipe Number hanya bisa di-bind ke Opacity.
- Margin, border/outline width, shadow blur/spread, filter dan shader tidak dapat di-bind.
- Belum diuji: alias variable (Reference/Detach reference), rename/delete folder, mask Image/Custom, mode Alpha/Luminance, operasi Add/Subtract/Intersect/Exclude, serta Replace/Copy SVG, Select occurrences dan Detach from library pada ikon.
- Binding warna ikon hanya berlaku untuk SVG satu warna.

Rincian per baris dan bukti source tersedia di masing-masing laporan agent.
