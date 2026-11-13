# Rencana renderer canvas: DOM inkremental, GPU ditunda

Direvisi 2026-11-05 berdasarkan [riset terukur 4 November](canvas-performance/README.md) dan [ADR-001](canvas-performance/adr-001-defer-gpu-renderer.md). Rencana PixiJS-first 28 Oktober digantikan: DOM tetap renderer utama dan sumber kebenaran layout/paint CSS; dokumen JSON tetap model kanonis. Belum ada cutover renderer atau klaim parity baru dalam perubahan ini.

## 1. Keputusan dan bukti

Prioritasnya mengurangi pekerjaan, bukan mengganti painter. Pada Apple M1 8 GiB, DPR 2, Electron 42 / Chromium 148, menghapus lima aturan Tailwind `:has(:focus-visible)` melalui eksperimen CSSOM menurunkan handler pan 1.000 node dari 164,4 ke 10,9 ms dan interval pan dari 166,7 ke 16,7 ms. Dua aturan `#workspace:has()` yang semula dicurigai bukan penyebabnya. Mekanisme invalidasi global masih inferensi; efek penghapusan lima aturan diukur. Sumber: [sintesis dan hasil eksperimen](canvas-performance/README.md#root-cause-five-hasfocus-visible-rules), [raw JSON](../eval/canvas-perf/results/experiment-has-2026-11-04.json).

[Strategi B](canvas-performance/renderer-options.md) (DOM keyed, culling, mounting berbatas anggaran, thumbnail) mempertahankan diff piksel 0% pada fixture 100%. Strategi C (tile Canvas 2D) memperbaiki zoom tetapi dapat menampilkan tile kasar/kosong. B+C belum dibangun bersama. PixiJS WebGL/WebGPU yang diuji tidak memberi kemenangan kualitas/latensi/memori yang cukup untuk migrasi. Ini hasil implementasi prototipe, bukan batas universal backend GPU. Lihat [review renderer](canvas-performance/reviews/astra-on-renderer-options.md).

[FigCraft](canvas-performance/figcraft.md#local-measurement-lead) memakai raster CPU tiny-skia dan GPU untuk presentasi texture. Pengukuran lokal fit-all 50K: **9,4 ms dengan LOD vs 80,1 ms tanpa LOD** (median lima proses). Culling, retained pixels, damage, splat/bar LOD dan latest-request scheduling menjelaskan hasil tersebut. Angka ini mengecualikan upload/presentasi/UI dan memakai scene sendiri, bukan pembanding langsung HTML/CSS Verynize. Tekniknya dapat ditransfer; mesin layout/teks non-CSS tidak dapat menggantikan browser tanpa kehilangan kontrak export.

## 2. Arsitektur target

```text
dokumen JSON → DOM CSS keyed (layout + paint + edit + export oracle)
                      ├─ id/children map + indeks spasial → culling
                      ├─ snapshot geometry per revision → label/seleksi overlay
                      └─ cache thumbnail/tile Canvas 2D opsional → zoom/overview
kamera → satu transform world; overlay layar → handle/guides/cursor
live app → iframe DOM yang mengikuti kamera
```

- Pertahankan antarmuka `createRenderer({kind})` sebagai rencana pemisahan tanggung jawab; DOM menjadi default. Canvas 2D hanya lapisan opsional, bukan sumber layout baru. GPU tidak menjadi fallback atau dependency produk.
- Patch berdasarkan `node.id`, invalidasi subtree yang berubah, dan batasi mount/cache. Jangan membangun ulang seluruh canvas pada tiap edit atau gerakan drag; commit/undo tetap benar saat pointer-up.
- Browser tetap menghitung flex/grid/block/inline, mixed text runs, IME, aksesibilitas dan metrik teks. Serializer/model CSS dan export/MCP harus konsisten; migrasi model terpisah tidak menjadi prasyarat perbaikan performa.
- Kamera memakai satu transform; selection chrome berada di ruang layar, tanpa menyebarkan `--iz` ke seluruh subtree. Jangan subscribe React ke pointer-move atau memindahkan canvas imperatif ke React.
- Snapshot layout (rect, clip, line/word boxes) di-cache per revision; baca geometri secara batch hanya pada subtree kotor. **Tidak boleh mengukur LayoutHost saat overview.** Hybrid E menghabiskan 1,7 s pada fit-all 13K, tidak selesai dalam 20 s pada 100K, dan edit p95 sampai 194 ms. Jika kelak dipakai, pengukuran layout masuk anggaran edit sync <16 ms dan wajib diprofilkan terpisah. Sumber: [opsi renderer](canvas-performance/renderer-options.md#what-docscanvas-renderer-migration-planmd-should-change).

## 3. Fase 0–3

| Fase                                 | Pekerjaan                                                                                                                                                                                  | Verifikasi sebelum lanjut                                                                                                                                             |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **0. Perbaiki invalidasi CSS**       | Ganti lima varian `has-*focus*` terukur dengan fokus langsung, class JS atau `focus-within` sesuai semantik keyboard/mouse; rencanakan lint guard                                          | Perilaku fokus tetap aksesibel; rerun baseline dan eksperimen secara berurutan. Jangan menganggap hasil CSSOM sudah menjadi perbaikan produk                          |
| **1. Label dan seleksi**             | Label keyed dari geometri dokumen, tanpa insert/read berulang; id/children map; `topSelected` melalui ancestor walk; hentikan full `render()` selama live drag                             | Profil baru memisahkan label, seleksi, layout dan paint; all-node selection 2.000 <500 ms; tes drag/undo, snapping dan multi-select tetap lolos                       |
| **2. DOM inkremental + culling (B)** | Patch keyed; indeks artboard/viewport, mount berbatas waktu, containment yang aman untuk layout, promosi compositor selama gesture, thumbnail di zoom kecil dengan invalidasi setelah edit | Ukur seluruh tabel penerimaan di bawah pada produk; audit satu frame besar, teks padat, efek bertumpuk, preview dan thumbnail usang. Fixture piksel 100% tetap 0%     |
| **3. Tile Canvas 2D opsional (B+C)** | Hanya jika zoom/overview 50K+ setelah fase 2 belum memenuhi anggaran; tile cache terbatas, dirty-region/damage, coarse/refined scheduling; DOM tetap untuk edit teks dan iframe            | Bangun integrasi B+C dahulu; ukur handoff, memori, blank/stale/coarse area, waktu refinement dan kualitas. Jangan menjanjikan penjumlahan hasil B dan C yang terpisah |

GPU (PixiJS/WebGPU) **ditunda**, tanpa fase cutover terjadwal. [Trigger ADR](canvas-performance/adr-001-defer-gpu-renderer.md#revisit-triggers) menentukan kapan evaluasi dibuka lagi.

## 4. Kriteria penerimaan

Menggantikan target lama “10k node ≥55 fps pan”. Sumber normatif: [README riset](canvas-performance/README.md#acceptance-criteria-to-use-from-now-on); representasi mesin: [budgets.json](../eval/canvas-perf/budgets.json).

| Metrik                                       | Jumlah node   | Anggaran / kewajiban                                                                            |
| -------------------------------------------- | ------------- | ----------------------------------------------------------------------------------------------- |
| Handler pan p95                              | 1K, 13K, 100K | <8 ms                                                                                           |
| Handler zoom p95                             | 1K, 13K, 100K | <8 ms                                                                                           |
| Edit sinkron p95                             | 1K, 13K, 100K | <16 ms                                                                                          |
| Interval frame drag p95                      | 1K, 13K, 100K | <16,7 ms                                                                                        |
| Seleksi seluruh node, waktu sinkron          | 2.000         | <500 ms; bukan keyboard Select All yang hanya memilih scope                                     |
| Fit-all sampai tergambar penuh               | 1K, 13K, 100K | Wajib lapor ms dan bukti completion; batas angka belum ditetapkan sumber                        |
| Area terlihat yang belum lengkap selama zoom | 1K, 13K, 100K | Wajib lapor proporsi area blank/stale/coarse dan durasinya; batas angka belum ditetapkan sumber |
| Diff piksel terhadap export pada zoom 100%   | 1K, 13K, 100K | 0%; perlu fixture export yang cocok, bukan hanya painter reference                              |

rAF/two-rAF fence adalah ukuran main-thread dan peluang paint, bukan bukti frame dipresentasikan. Interval 16,8 ms dapat berasal dari jitter vsync; target tetap dicatat ketat, interpretasi perlu histogram/trace. Angka incomplete prototipe C/D/E adalah proporsi tile/board, **bukan luas area**; B tidak mengukurnya. Fixture fidelity lama hanya satu screen pada 100%, bukan bukti seluruh ukuran, overview atau export. Tambahkan pengukuran presentation/raster dan kualitas area sebelum menyatakan lolos. Checker dan cara rerun: [harness README](../eval/canvas-perf/README.md#budget-report).

## 5. Temuan Wonder dan live preview yang tetap berlaku

Bukti statis 28 Oktober dari cache renderer Wonder 0.2.183 (`/tmp/wonder-canvas-cache/js`, tidak dieksekusi; cache lokal bukan artefak reproduksi yang disimpan):

| Temuan                                                                                                                                                                                         | Status                                                                      |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Preview membuat iframe DOM sungguhan (`surface: canvas`, `pointerEvents = none`) dalam container node; input di mode Navigate, alat terpisah untuk Edit/Capture (Enter elemen, ⌘Enter halaman) | observed                                                                    |
| Bundle PixiJS v8 memiliki `DOMContainer`/`DOMPipe`, sinkronisasi elemen HTML lewat CSS `matrix()`                                                                                              | observed di library; penggunaan langsung untuk iframe Wonder hanya inferred |
| `html-in-canvas` (`layoutsubtree` / `copyElementImageToTexture`) muncul pada satu shader eksperimental dengan Chrome Canary/flag                                                               | observed                                                                    |
| Frame/fill/border/teks memakai container/Graphics Pixi di `Renderer-*.js`, judul overlay DOM                                                                                                   | observed                                                                    |
| Tidak ditemukan Yoga/Taffy; ada `getBoundingClientRect` / `getComputedStyle`                                                                                                                   | mesin layout Wonder tetap unknown                                           |

Live app preview tidak memerlukan PixiJS. Pertahankan iframe DOM sebagai overlay yang mengikuti transform kamera, mode Navigate/Edit/Capture, dan snapshot saat tidak aktif. Uji clipping, rotasi, fokus serta capture secara terpisah; jangan mengasumsikan snapshot setara iframe interaktif. [Ledger roadmap Wonder](wonder-roadmap.md) dan [status implementasi](implementation-status.md) tetap rujukan parity; temuan bundle tidak membuktikan skala atau kualitas runtime.

## 6. Pelajaran PixiJS 8.22 dan batas rencana

Ditemukan pada [prototipe](../eval/canvas-perf/prototypes/strategy-pixi.js) dan [audit fidelity](canvas-performance/renderer-options.md#fidelity-audit): `FillGradient` membalik ramp ketika dx/dy negatif; texture fill dipaksa `repeat`; keduanya diakali dengan texture dari Canvas. Core tidak menyediakan backdrop-filter yang dibutuhkan; `DOMContainer` eksperimental. Implementasi BitmapText satu-style yang diuji kehilangan mixed `textRuns`, emoji/wrap berbeda; ini bukan bukti semua implementasi BitmapText mustahil mendukung runs. E memperbaiki word boxes dengan DOM tetapi masih kehilangan backdrop blur dan berbeda AA (0,63% diff vs D 3,36%, threshold kanal >32/255).

Migrasi GPU berarti mengimplementasikan kembali paint CSS, mask/filter/blend, shaping, zoom-bucket raster teks, editing/IME dan aksesibilitas. Thumbnail D membangun display tree penuh; biaya overview/memori tersebut bukan sifat wajib GPU. Memori yang tersimpan adalah snapshot setelah traversal, bukan peak/residency GPU. Tidak ada dasar untuk menambah dependency atau packaging Pixi sekarang.

Fitur vector editing, ikon, code components, shared previews, akun dan komentar tetap pekerjaan terpisah menurut ledger. Kolaborasi saat ini server-sequenced, bukan Yjs; renderer tidak mensyaratkan penggantian protokol. Semua fase harus menjaga tes perilaku/export yang relevan; riset belum mencakup Intel/Windows, Safari/Firefox atau layar 120 Hz.
