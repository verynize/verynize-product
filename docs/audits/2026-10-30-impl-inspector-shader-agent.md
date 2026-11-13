# Implementasi paritas inspector dan pustaka shader — 30 Oktober 2026

Agen: inspector + shader. Cakupannya dua gap di `docs/implementation-status.md`: "Remaining inspector parity" dan "Exact Wonder shader library and parameter compatibility". Acuannya adalah `design/wonder/2026-10-30/15–21` dan `30–31`, `validation/v06`, `v09`, `v15`, serta `extra/52`, ditambah audit [effects](2026-10-30-impl-effects-agent.md), [variables](2026-10-30-impl-variables-agent.md) dan [paint/export](2026-10-30-impl-paint-export-agent.md). Yang ditiru hanya perilakunya. Kode GLSL, nama preset dan teks UI ditulis sendiri.

## Yang diimplementasikan

### 1. Satu jalur untuk semua warna yang dapat di-bind

`BetterNodeStyle.eachPaintColor` (`web/node-style.js`) kini mengunjungi setiap holder `{color, token}` pada sebuah layer:

- paint solid dan stop gradien,
- shadow,
- border uniform (`strokeColor` + `strokeToken`) dan border per sisi (`strokeColors[4]`),
- outline (`outlineColor` + `outlineToken`),
- warna shader (`shaderColors`).

Rename, delete dan sync color variable di renderer (`vars.ts`, hapus token di `app.js`) dan di headless (`renameTokenRefs`, `unbindToken`, `syncTokenColors`) semuanya memakai fungsi ini. Dengan begitu tipe binding baru otomatis ikut diproses. Efek sampingnya, rename color variable kini juga memperbarui token shadow, yang sebelumnya terlewat.

### 2. Binding warna border (uniform dan per sisi) serta outline

| Fitur                       | Model                                                           | Render                                                                                            | UI                                                                                                                                                                                                                                                                                                |
| --------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Warna border dapat di-bind  | `strokeToken`                                                   | `border-color` diambil dari variable bila nilainya ter-resolve. Bila tidak, dipakai `strokeColor` | Baris warna di Border (`[name=strokeColor]`) memakai picker dengan tab Variables. Selama terikat, field menampilkan nama variable dan tombol **Detach border colour variable** muncul. Detach mempertahankan nilai hasil resolve                                                                  |
| Warna per sisi              | `strokeColors: [{color, token?} ×4]` (top, right, bottom, left) | `border-color` dengan empat nilai                                                                 | Tombol **Independent border colours** membuka empat baris T/R/B/L (`[name=strokeColorTop]`…). Setiap sisi dapat di-bind atau di-detach sendiri. Saat dibuka, binding uniform yang ada menjadi nilai awal keempat sisi. **Use one border colour** menggabungkannya kembali memakai warna sisi atas |
| Warna outline dapat di-bind | `outlineToken`                                                  | Warna `outline` di-resolve dari variable                                                          | Section Outline. Picker apa pun yang di-bind menampilkan tombol detach (`EffectColorField`), sehingga shadow juga mendapatkannya                                                                                                                                                                  |

Validasi berada di `validateEffects`, yang dipanggil oleh `validate()` di `app.js` dan oleh `validateDocument` di `design-store.mjs`. Skema MCP (`design-tools.mjs`) menerima ketiga field tersebut.

Codec JSX:

- Export menulis `border-[color:var(--x)]`, `border-t/r/b/l-[…]` dan `outline-[color:var(--x)]`.
- Import (`tailwind-map.mjs` dan `applySpec`) membaca `var()` kembali menjadi `strokeToken`/`outlineToken`, dan warna per sisi menjadi `strokeColors`.
- Kelas warna biasa melepas binding, karena kelas tetap menjadi sumber kebenaran.

### 3. Mask: Image, Custom, Advanced, operasi boolean, Detach mask as shape

- **Tipe baru.** `image` menyimpan data URL base64 di `src`, dirender sebagai `url("…")`. `custom` menyimpan gradien CSS di `css`; validasi menolak `url()` dan karakter berbahaya.
- **Advanced.** Mode (Auto/Alpha/Luminance → `mask-mode`), Repeat (`mask-repeat`), Position X/Y dalam % (`mask-position`), dan Size (`auto`, `cover`, `contain`, atau 1–2 nilai `%`/`px` → `mask-size`).
- **Operasi.** Add, Subtract, Intersect dan Exclude (`mask-composite`) menentukan cara mask menggabung dengan mask di bawahnya. Daftar CSS per layer hanya ditulis bila ada nilai non-default, sehingga dokumen lama menghasilkan CSS yang sama persis.
- **UI** (`masks.tsx`):
  - Segmented menyediakan lima tipe. Memilih Image membuka pemilih file; untuk image juga ada pratinjau dan _Replace image…_.
  - Field CSS Custom (`[name=mask-N-css]`).
  - Select _Combine with masks below_.
  - Disclosure **Advanced** (`[data-mask-advanced]`).
  - **Detach mask as shape** (`[data-mask-detach]`) menghapus mask dari layer dan menambahkan rectangle `"<nama> mask"` tepat di atasnya dengan bounds yang sama. Fill rectangle itu adalah mask tersebut: gradien hitam→transparan dengan alpha dan invert, image paint, atau gradien CSS untuk Custom. Layer baru dipilih, dan seluruh operasi menjadi satu langkah undo. Di dalam auto layout, shape dibuat `position: absolute`.
- **Codec.** Kelas `[mask-image:url("data:…")]` sebelumnya ditolak sebagai "unsafe". Kini kelas itu diimpor sebagai mask terstruktur (`image`/`custom`), sehingga side channel `data-vn` milik agen codec dapat memulihkan opsi Advanced dan item tersembunyi.

### 4. Folder pada picker variable

- Menu bind (◆) dan tab Variables pada color picker kini dikelompokkan per folder. Item di root tampil lebih dulu, lalu setiap path folder dengan ikon folder dan nama leaf. Helper yang dipakai adalah `groupByFolder` di `vars.ts`.
- Selector lama tetap berlaku: `[data-variable]` dan `getByRole('option', {name})` memakai nama lengkap lewat `aria-label`.

### 5. Shadow binding dan efek tersembunyi di JSX

Bagian ini sudah ditangani side channel `data-vn` (`integrations/codec-residual.mjs`, milik agen codec), yang mengembalikan `shadows`, `filters` dan `masks` lengkap dengan `token` dan `hidden`. Agen ini tidak menduplikasinya. Yang ditambahkan agen ini adalah dukungan mask image/custom dan field border/outline baru pada kitchen sink `codec-roundtrip.test.mjs`.

### 6. Resize di canvas melepas binding W/H (sub-agen)

Di `web/canvas-interactions.js`, resize lewat handle dan scale tool melepas binding hanya pada sumbu yang berubah. Nilai baru dipertahankan, dan satu kali undo memulihkan ukuran beserta binding-nya. Regresinya ada di `tests/canvas-bound-resize.cjs`; test ini gagal bila perbaikannya dinonaktifkan.

### 7. Tool token MCP untuk variable bertipe (sub-agen)

- `create/update/delete_design_tokens` sudah menangani keempat tipe. Status lama di dokumen implementasi ("MCP token tools don't handle the new variable types yet") sudah tidak akurat.
- Celah yang ternyata masih ada sudah ditutup:
  - `get_design_tokens` mendapat filter `type`/`folder` dan field `folder`.
  - Rename dan delete folder (`folders`) berlaku untuk semua tipe.
  - `bind_variables` kini juga menerima token warna untuk `fill`, `svgColor`, `strokeColor` dan `outlineColor`.
  - `apply_style_tokens` mendaftar semua token.
  - `apply_operations` mendapat `set_variable` dan `delete_token`, dan `set_token` menerima hex 8 digit.

### 8. Pustaka shader (sub-agen + penyelesaian UI)

- **Katalog tunggal** di `web/shaders.js` (`BetterShaders.PRESETS/presetIds/validate/resolve`). File ini dapat diimpor di Node melalui `integrations/shaders.mjs`. Daftar id yang sebelumnya di-hardcode di `app.js`, `design-store.mjs`, `design-edit.mjs`, `design-tools.mjs` dan `jsx-codec.mjs` diganti dengan katalog ini.
- **13 preset parametrik orisinal** dalam empat keluarga: _Tidal Swirl 1–4_, _Ripple Pool 1–3_, _Pixel Bloom 1–3_ dan _Signal Grid 1–3_. Semuanya memakai program GLSL sendiri. Enam preset klasik (Aurora…Swirl) tetap dirender persis seperti sebelumnya.
- **Model parameter** mengikuti capture 30–31:
  - `shaderColors` berisi Gradient Center, Gradient Edge, Ripple Color dan Background, masing-masing `{color (#rrggbb[aa]), token?}`.
  - `shaderParams` berisi Gradient Aspect, Gradient Size, Ripple Density, Distortion Amount dan Grain Strength (0–100).
  - Animation Speed memakai `shaderSpeed` yang sudah ada.
  - Field yang kosong memakai default preset.
- **UI** (`shader-library.tsx`):
  - Picker "Choose shader" (`#shader-gallery`) dengan search per nama atau keluarga. Field search langsung fokus saat picker dibuka.
  - Empat baris warna (hex dan alpha %) yang dapat di-bind ke Colors variable atau di-detach.
  - Popover "Shader settings" (`#shader-options`) dengan enam slider. Setiap commit menjadi satu langkah undo.
  - Untuk preset parametrik, baris fill tunggal yang lama disembunyikan karena tidak berpengaruh. Untuk preset klasik, baris itu tetap ada.
- **Render.** Canvas dan export HTML meneruskan parameter yang sudah di-resolve, termasuk dari variable. Codec JSX membawa `data-shader-colors`/`data-shader-params`.

## File

- **Baru:**
  - `web/src/islands/inspector/border-colors.tsx`, `shader-library.tsx`
  - `integrations/shaders.mjs`
  - Test: `integrations/inspector-parity.test.mjs`, `shader-presets.test.mjs`, `variables-mcp.test.mjs`, `tests/inspector-border-mask-binding.cjs`, `tests/inspector-shader-library.cjs`, `tests/canvas-bound-resize.cjs`
  - Dokumen ini
- **Milik area inspector:** `masks.tsx` (ditulis ulang), `effects.tsx` (tipe Mask, binding outline, tombol detach), `bind.tsx`, `color-picker.tsx`, `vars.ts` (`groupByFolder`), `properties.tsx` (Border, wiring shader), `model.ts`, serta `web/shaders.js`
- **Edit kecil pada file bersama:**
  - `web/node-style.js` (`eachPaintColor`, border/outline/mask)
  - `integrations/node-style.mjs`, `jsx-codec.mjs`, `tailwind-map.mjs`, `design-edit.mjs`, `design-store.mjs`, `design-tools.mjs`, `export-html.mjs`
  - `web/app.js`, `web/canvas-interactions.js`
  - `package.json` (`test:canvas`)
  - `integrations/codec-roundtrip.test.mjs`: menambah field baru ke kitchen sink, karena test tersebut mewajibkan setiap properti skema punya cakupan round trip

## Test dan hasil

| Perintah                                                                                                                                                                                                                                                                                    | Hasil                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run build:ui`, `lint:ui` (0 error/warning), `typecheck:ui`, `npm run check`                                                                                                                                                                                                            | Lulus                                                                                                                                                                                                                                                                                                                                                                   |
| `node eval/run-fidelity.mjs`                                                                                                                                                                                                                                                                | 26/26 fixture, 105/105 check                                                                                                                                                                                                                                                                                                                                            |
| `node --test integrations/*.test.mjs`                                                                                                                                                                                                                                                       | 171 lulus. Satu kegagalan sesaat di `codec-cli.test.mjs` (file baru agen codec, sedang dikerjakan) lulus saat dijalankan ulang. Di `codec-roundtrip.test.mjs`, dua test agen codec ("not yet" dan export Tailwind/CSS) masih merah karena pekerjaannya belum selesai. Test kitchen sink yang menyangkut field agen ini lulus                                            |
| `integrations/inspector-parity.test.mjs` (baru)                                                                                                                                                                                                                                             | 5/5: CSS border/outline/per sisi, validasi, rename/delete/sync, mask image/custom/Advanced/operasi plus export HTML, round trip JSX                                                                                                                                                                                                                                     |
| `tests/inspector-border-mask-binding.cjs` (baru, Electron)                                                                                                                                                                                                                                  | PASS. Mencakup grup folder di picker warna dan menu bind; border bound → variable berubah → detach → undo; warna per sisi (detach, ketik, bind, variable berubah); outline bound; mask Custom dengan Mode/Repeat/Position/Size/Intersect dan penolakan nilai salah; mask Image dari file; reload; Detach mask as shape untuk image dan gradien, termasuk undo; validasi |
| `inspector-shader-library`, `canvas-shaders`, `canvas-bound-resize`, `inspector-effects`, `inspector-variable-binding`, `inspector-variable-folders`, `inspector-variable-library`, `inspector-parity`, `inspector-paints`, `canvas`, `canvas-advanced`, `canvas-precision`, `canvas-codec` | Lulus                                                                                                                                                                                                                                                                                                                                                                   |

Screenshot pemeriksaan (Border/Outline, editor mask, picker shader dengan search, Shader settings) dibandingkan secara visual dengan Wonder 19 dan 30–31. Screenshot ini tidak disimpan sebagai bukti di repo.

## Gap yang tersisa

- **Mask:**
  - Handle gradien di canvas dan stop gradien mask yang dapat diatur belum ada; stop masih hitam→transparan.
  - Detach mask as shape untuk layer di dalam auto layout memakai x/y tersimpan (absolute), sehingga posisinya bisa berbeda bila layout belum menulis koordinat terukur.
  - Image mask besar ikut tertulis penuh di JSX (kelas dan `data-vn`) karena belum ada elisi seperti pada `data-fills`.
- **Border:** Wonder menyediakan select sisi ("All"). Verynize memakai toggle lebar per sisi dan toggle warna per sisi secara terpisah. Warna per sisi yang tersimpan (`color`) adalah nilai saat binding dibuat; render selalu me-resolve variable.
- **Shader:**
  - Nama, GLSL dan nilai default bersifat orisinal. Nilai numerik slider Wonder tidak terlihat di capture, sehingga kesetaraan numerik per parameter tidak diklaim.
  - Pratinjau di picker berupa gradien CSS statis, bukan WebGL langsung.
  - Tab SVG/Image pada picker Wonder belum ada.
  - Import HTML lama tidak memetakan ulang nama variable warna shader bila terjadi bentrok.
- **MCP:** binding typed tidak terlihat di JSX untuk agen. Bila agen mengubah properti yang terikat lewat `update_elements`, sync berikutnya mengembalikan nilai variable. `apply_operations` tidak melakukan re-sync binding.
- Belum ada perbandingan screenshot berdampingan yang tersimpan antara Wonder dan Verynize untuk fitur-fitur ini.
