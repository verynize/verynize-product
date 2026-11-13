# Review kritis atas audit Astra — orchestrator → UI canvas

Tanggal: 29 Oktober 2026. Mereview [audit Astra](2026-10-29-design-quality.md) beserta lampirannya. Metode: 4 agent paralel (pipeline Verynize, bundle Wonder 0.2.185, bundle Pen 1.2.20, riset Figma/FigCraft + Context7), lalu probe ulang temuan P0 secara langsung. Tidak ada kode produksi yang diubah. Probe ada di `/tmp/bd-probe/`.

## Ringkasan

Klaim kode Astra sebagian besar benar, tetapi **diagnosis dan prioritasnya meleset**:

1. Astra menganggap masalah codec = "padding/radius per sisi hilang". Itu kosmetik. Akar masalah yang jauh lebih besar: **codec memproduksi layout absolut fixed-pixel**, bukan auto-layout. Ini yang membuat hasil terlihat "halusinasi" dan rusak saat diedit.
2. Astra menyimpulkan orchestrator Wonder "hosted, tidak bisa diketahui". **Salah.** Plumbing Wonder hampir identik dengan Verynize (Claude Agent SDK lokal, preset `claude_code` + persona, Tailwind JSX, tool `create_artboard`/`update_elements`/`take_screenshot`/`finish_artboard`). Pembedanya adalah **lapisan pengetahuan desain** (fundamentals + skills + style guides) yang dilayani `mcp.wonder.so` — dan sebagian besar teksnya sudah tercache lokal.
3. Karena itu prioritas Astra (codec → verifikasi → _baru_ grounding) kurang tepat. Lapisan taste (fundamentals/archetype/skill) adalah **P0 setara codec**, bukan P1. Kedua pembanding utama menaruh taste di sana, bukan di orchestrator.

## Klaim Astra: hasil verifikasi

| Klaim                                                                    | Status                 | Catatan                                                                                                                                                      |
| ------------------------------------------------------------------------ | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `px-8 py-3` → padding 32 semua sisi, tanpa warning (`jsx-codec.mjs:124`) | **Benar, understated** | `pt-10` saja → padding 40 di _semua_ sisi.                                                                                                                   |
| Radius per sudut diratakan (`:148-149`)                                  | Benar                  |                                                                                                                                                              |
| `gap-x/gap-y`, `md:`, `flex-1` diabaikan "tanpa warning"                 | **Imprecise**          | Ketiganya _masuk_ warnings. Yang benar-benar silent: padding, radius, `min-w-0`.                                                                             |
| `finish_artboard` tidak memverifikasi (`design-tools.mjs:231-239`)       | Benar                  |                                                                                                                                                              |
| Ukuran teks diestimasi (`design-edit.mjs:110-117`)                       | Benar                  |                                                                                                                                                              |
| Ikon di-skip, gambar remote → placeholder                                | Benar                  | Tambahan: 89 ikon Lucide di `web/assets/icons/lucide` adalah glyph UI app (`wonder-parity.js:16`), bukan library yang bisa dipetakan codec.                  |
| Guidelines di `design-tools.mjs:39-44`                                   | Imprecise              | Ada di `:41-45` dan hanya muncul di hasil `get_design_context`.                                                                                              |
| Image attachment hanya "paths"                                           | **Salah sebagian**     | Claude SDK mengirim base64 image block (`agent-runtime.cjs:302-309`), Codex app-server `localImage` (`:434`). Hanya fallback CLI yang path.                  |
| Screenshot "bila tersedia" (implisit: model mungkin tidak melihat)       | Perlu koreksi          | `take_screenshot` sudah mengembalikan MCP `image` block (`design-tools.mjs:187`). Model Claude **sudah bisa melihat**. Gap-nya enforcement, bukan kemampuan. |
| Orchestrator Wonder hosted, tidak bisa diekstrak                         | **Salah**              | Lihat bagian Wonder di bawah.                                                                                                                                |
| Pen: 26 archetype                                                        | **Tidak lengkap**      | `SKILL.md` mendaftar 26, bundle mendefinisikan **34** archetype + **88 preset** (archetype × palette).                                                       |
| Pen `ctx.problems` sebagai pemeriksa layout                              | **Overstated**         | Di kode bundle, `ctx.problems` hanya mendeteksi _clipping_. Kontras, overlap, overflow teks diserahkan ke agent/screenshot.                                  |
| Riset hooks: PostToolUse untuk enforcement                               | Kurang tepat           | Yang bisa menolak agent selesai adalah **`Stop` hook** (`decision:"block"` + `reason`). PostToolUse tidak bisa memaksa.                                      |

## Temuan baru yang terlewat (Verynize)

**P0-1 — `div` tanpa `flex`/`grid` menjadi frame absolut dan padding hilang.** Default `layout:'free'` (`jsx-codec.mjs:8`), anak ditumpuk dengan y yang dipanggang (`design-edit.mjs:230-237`), renderer memaksa `padding:0` untuk frame free (`web/app.js`). Probe: `<div className="w-[400px] p-8">` → anak di x=0,y=0; padding 32 lenyap tanpa warning. `<header>`/`<section>` di dalam div 1440px keluar dengan **w=100**.

**P0-2 — Gaya teks tidak diwariskan.** `applySpec` hanya menerapkan warna/font ke node teks (`design-edit.mjs:95-103`). Probe ulang (saya jalankan sendiri): container `bg-[#000] text-[#fff] text-sm font-['Geist'] tracking-tight` → anak `color #25252e`, `fs 36/16`, `ff system-ui`. **Teks gelap di latar hitam, nol warning.** Ini pola Tailwind paling umum dan sumber besar kesan "halusinasi".

**P0-3 — Edit tidak me-reflow.** Semua w/h dipanggang piksel; codec tidak pernah mengisi `wMode/hMode` walau renderer mendukung hug/fill (`app.js:16-18`). Probe ulang: teks "A" diganti paragraf panjang → `w=45 h=442`, sibling "B" tetap di y=19, parent tetap h=38 → overlap.

**P0-4 — Palette warna Tailwind tidak didukung.** `bg-slate-900`, `text-gray-500`, `bg-white/80`, `from-*/to-*`, `ring-*`, `divide-*` diabaikan (ber-warning), fallback `transparent` / `#25252e`. Model dilatih menulis kelas ini; sistem diam-diam menggantinya.

**P0-5 — Tidak ada lapisan pengetahuan desain sama sekali.** Tidak ada archetype, type scale, spacing tier, anti-slop rules, palette, font pairing. Persona (`agent-runtime.cjs:33-45`) hanya "work in small verifiable steps… prefer tokens". Ini persis kondisi yang Anthropic sebut _distributional convergence_ (model kembali ke gaya paling umum) — [sumber](https://claude.com/resources/articles/improving-frontend-design-through-skills).

**P1-1 — Shorthand tipografi umum hilang:** `text-sm/6`, `text-5xl/tight`, `leading-7`, `uppercase`, `line-clamp`, `text-balance`.
**P1-2 — Margin dan centering diabaikan:** `m-*`, `mx-auto`, `grow`, `basis-*`, `col-span-*`, `-translate-x-1/2`; `max-w-*`, `aspect-*`, `truncate`, `object-cover`, `flex-wrap` hilang **tanpa** warning.
**P1-3 — `absolute` di dalam parent flex diabaikan:** flag di-set (`jsx-codec.mjs:174`) tapi tidak dibaca. Badge `absolute top-2 right-2` → jadi anak flow di (0,0).
**P1-4 — Font:** hanya Inter 400–700 untuk UI app. `font-['Playfair_Display']` diterima tanpa warning lalu fallback. Screenshot dirender dari `data:` URL dengan CSP `font-src data:` tanpa `@font-face` (`desktop/render.cjs:19`) → font yang tidak terinstal sistem-wide akan fallback di screenshot yang dilihat model (inferensi dari kode, belum dijalankan).
**P1-5 — Alat desain berjalan di dalam coding agent penuh:** preset `claude_code` + persona (`agent-runtime.cjs:95`), Bash/edit file tetap tersedia; `allowedTools` hanya pre-approve, tidak membatasi. Tidak ada default model/effort (`agent-settings.cjs:21`) → kualitas tergantung konfigurasi CLI user. (Wonder merekomendasikan Opus 5.5 secara eksplisit.)
**P1-6 — Tidak ada ikon/gambar untuk agent:** tidak ada `get_icons`, `generate_image`, stock photo; `generate.cjs` (SVG) tidak diekspos sebagai MCP tool.
**P2-1 — `get_element_code` mengajarkan bentuk yang salah:** serializer mengeluarkan `absolute left-[x] top-[y] w-[Npx] h-[Npx]` untuk setiap node (`jsx-codec.mjs:210-212`). Saat model membaca balik desainnya, ia belajar menulis layout absolut → loop degradasi.
**P2-2 — Tokens hanya warna** (`design-edit.mjs:489-491`); tidak ada typography/spacing/radius/shadow tokens.

## Wonder 0.2.185: apa yang sebenarnya ada

- **Loop agent lokal**: `app.asar/package.json` bergantung pada `@anthropic-ai/claude-agent-sdk` 0.3.293; `Contents/Resources/agents/` membawa `claude-code.tgz` dan `codex.tgz`. Model picker merekomendasikan `claude-opus-5-5[1m]`.
- **Teks prompt dilayani server dan dicache**: `~/Library/Application Support/Wonder/agent-text.json` (817 key: persona, deskripsi tool, template konteks).
- **Pengetahuan desain dan mutasi canvas di `mcp.wonder.so`**: tool `get_skills`, `get_design_guidelines`, `get_design_context`, `get_icons`, `generate_image`, `generate_svg`, `vectorize_image`, `fetch_image_description`, design tokens CRUD, dll. Teks fundamentals dan beberapa skill (new-design, edit-design, design-to-code) terekam di transcript Claude lokal user (`~/.claude/projects/-Users-me-wonder-workspaces-belajar-wonder-piranha/`).
- **Mekanisme taste (diparafrase)**: tentukan dulu "impress vs present clearly"; satu focal point + satu CTA tersaturasi per section; container hug content; tiga tier spacing; shadow berlapis 5–15% opacity; radius konsentris; hindari Inter/Roboto/system font kecuali diminta; palette diturunkan dari "scene" bernama + daftar palette "AI-looking" yang dilarang; kontras ≥4.5:1; data realistis tidak bulat; satu set ikon, tanpa emoji; hero memakai foto nyata. Skill new-design: sumber look = brief → token repo → bahasa visual canvas → named style; skeleton berlabel dua level; viewport standar; ≤4 variasi yang benar-benar berbeda; **design-review wajib setelah perubahan besar**.
- **Bukti loop**: satu sesi transcript: 45 `take_screenshot`, 44 `update_elements`, 30 `finish_artboard`.
- **Belum didapat**: skill design-review, references, arrange, design-library, generate-assets, dan named style guides. Bisa diambil read-only setelah Wonder MCP login (saat ini tidak memuat tool di sesi ini).

Kesimpulan: Verynize sudah meniru _plumbing_ Wonder, tapi tidak meniru _isi_ yang membuat Wonder bagus — dan codec-nya jauh lebih lemah daripada yang Wonder pakai di server.

## Pen 1.2.20: apa yang Astra lewatkan

- **Archetype = prosa + parameter mengikat**: identity, composition, typography (2 pairing), imagery, creative range, token roles; parameter font per role (heading/body/caption/data), palette, roundness, elevation, decorative imagery. **Palette opsional, font/radius/elevation mengikat.**
- **Blok "Design quality" bersama**: pass reduksi ("apa yang jadi lebih sulit kalau elemen ini hilang?"), hero sebagai satu stage foto+statement (bukan kolom copy di samping kartu foto), larangan data/metrik karangan, art direction per gambar (role, subject, viewpoint, light, crop, quiet area untuk teks), larangan latar beige/cream/ivory dan shadow keras.
- **Katalog konkret**: 26 palette dengan key semantik (surface×4, foreground×4, border×2, accent×3, status×4), skala radius 0–9999, 4 set elevation dua lapis alpha sangat rendah, ~70 Google Fonts terkurasi.
- **Playbook domain bernumerik**: landing (satu CTA, accent hanya untuk aksi, body ≥14px, 50–75 karakter/baris, promise → proof → action), mobile (status bar, padding samping 16–20, gap 24–32 / 12–16, tab bar kapsul), web-app (density mode eksplisit, semua state wajib), slides (20 kontrak layout, split jangan shrink), table (Table→Row→Cell).
- **Scene model**: flex satu sumbu yang dihitung engine, `fit_content`/`fill_container`, `textGrowth`, absolute hanya via `layoutPosition`. Inilah yang Verynize tidak punya di jalur agent.
- Runtime `read_skill`/`get_style` tidak terverifikasi hari ini (Pen tidak berjalan → MCP gagal connect).

## Figma dan FigCraft: koreksi riset eksternal

- Figma punya **`html_to_figma`**: HTML self-contained → layer polos, _tanpa_ komponen/variables. Skill resmi Figma memakainya untuk desain baru ([tools](https://developers.figma.com/docs/figma-mcp-server/tools-and-prompts/), [skill](https://github.com/figma/mcp-server-guide)). Artinya pendekatan JSX/HTML → canvas Verynize **valid**; yang salah adalah eksekusinya (regex codec) dan output yang tidak ter-bind.
- Penyebab "halusinasi" Figma yang terdokumentasi: First Draft tidak bisa memakai design system user ([help](https://help.figma.com/hc/en-us/articles/23955143044247)), `use_figma` beta dan font harus diupload ([write-to-canvas](https://developers.figma.com/docs/figma-mcp-server/write-to-canvas/)), dan insiden Make Designs berasal dari korpus contoh yang tidak dikurasi ([retrospektif](https://www.figma.com/blog/inside-figma-a-retrospective-on-make-designs/)). Pelajaran: kurasi referensi, bukan "model lebih pintar".
- Gate Figma yang patut ditiru: **dilarang mutasi canvas sebelum tabel komponen/variables/styles terisi**; wrapper + placeholder section dulu, lalu satu section per call; screenshot **per section** (full-page downscale menyembunyikan clipping dan sisa teks "Title"/"Button").
- **FigCraft** ([repo](https://github.com/storytold/figcraft)): agent tidak menulis JSX, tapi memanggil ~455 command bertipe; layout engine Rust sendiri (hug/fill/fixed, wrap, grid, baseline); text shaping harfrust; satu renderer untuk canvas, export, dan screenshot MCP; `batch` atomik dengan `$ref` antar langkah; prompt MCP (`landing_page`, `mobile_screen`) yang diakhiri "screenshot, lihat, perbaiki"; `text.fit`, `text.missingFonts`. Riset Astra hanya membaca deskripsi repo.

## Kritik terhadap rekomendasi Astra

1. **Fix codec yang diusulkan terlalu sempit.** "Directional padding/gap/radius" menambal gejala. Opsi yang benar: **render JSX dengan Tailwind asli di Chromium offscreen** (Electron sudah ada) lalu baca computed style + box, ATAU ganti ke operasi scene bertipe. `tailwindcss@4.3.3` sudah ada di `node_modules`: `compile(css).build(candidates)` dan `__unstable__loadDesignSystem(css).candidatesToCss()` (mengembalikan `null` untuk kelas invalid → diagnostic gratis). Lalu konversi ke node dengan `wMode/hMode` hug/fill dan layout flex yang dipertahankan, bukan piksel absolut.
2. **Grounding bukan P1.** Kedua pembanding utama menaruh taste di fundamentals/skill/archetype. Tanpa itu, codec sempurna pun hanya merender desain generik dengan setia.
3. **Kontrak 9 langkah tidak menyebut lapisan pengetahuan desain sama sekali** (fundamentals, archetype, playbook domain, larangan anti-slop). Ini justru inti Wonder dan Pen.
4. **Enforcement salah alat.** Untuk Claude, `Stop` hook bisa memblok selesai tanpa receipt screenshot ber-revision; untuk Codex/CLI, gate di MCP (`finish_artboard` menolak tanpa receipt valid). Astra hanya menyebut PostToolUse.
5. **Benchmark terlalu mahal sebagai langkah pertama.** 72 output + 3 reviewer manusia sebelum fondasi diperbaiki akan hanya mengonfirmasi hal yang sudah jelas. Urutan lebih efisien: (a) fixture rekonstruksi deterministik (codec fidelity, murah, CI); (b) checklist judge multimodal per task gaya [ArtifactsBench](https://arxiv.org/abs/2507.04952); (c) baru blind pairwise kecil (Bradley-Terry seperti [Design Arena](https://www.designarena.ai/about)) melawan Wonder dan Pen.
6. **Tidak menyentuh model/effort default.** Wonder merekomendasikan Opus 5.5; Verynize tidak punya default. Variabel ini bisa menelan semua perbaikan lain dalam benchmark.

## Rencana perbaikan yang direkomendasikan

**Tahap 1 — Fidelity yang jujur (P0)**

- Codec berbasis Tailwind v4 asli + layout Chromium offscreen → node dengan flex, hug/fill, padding per sisi, warna palette, inheritance teks, absolute di dalam flow. Kelas invalid → diagnostic eksplisit.
- Serializer `get_element_code` mengeluarkan flex/hug/fill, bukan `absolute left/top`.
- Font: Fontsource/Google Fonts dimuat dan di-embed ke renderer screenshot; `missingFonts` sebagai gate.
- Fixture: kartu, header, hero gelap, badge absolut, edit-reflow — semua harus round-trip.

**Tahap 2 — Lapisan pengetahuan desain (P0, paralel dengan Tahap 1)** — ditulis sendiri, bukan disalin:

- `get_design_guidelines`: fundamentals dikembalikan di setiap context call.
- 20–30 archetype dengan parameter mengikat (font per role, radius, elevation, imagery) + palette semantik + elevation dua lapis.
- Playbook domain bernumerik: landing, web-app, mobile, dashboard/table, slides.
- Routing skill per job: new-design, edit-design, design-review, code-to-design.
- Persona baru yang menetapkan brief singkat (impress vs present, audience, density) sebelum menggambar.

**Tahap 3 — Loop verifikasi yang dipaksa (P0)**

- `take_screenshot` per section; receipt terikat ke revision; edit membatalkan receipt.
- Lint terukur selain clipping: overflow teks, kontras terhadap backdrop nyata, overlap sibling, card-in-card, grid identik berulang, shadow keras, body <14px, accent dipakai di luar aksi.
- `finish_artboard` menolak tanpa receipt valid; `Stop` hook untuk Claude.
- Repair dibatasi 3 iterasi dan ditulis ke laporan.

**Tahap 4 — Aset (P1)**

- `get_icons` via Iconify offline (satu set per desain).
- Stock Unsplash + generate image dengan art direction; barrier readiness sebelum screenshot.
- Ekspos `generate.cjs` (SVG) sebagai MCP tool.

**Tahap 5 — Default runtime (P1)**

- Default model/effort yang direkomendasikan.
- Profil agent desain yang membatasi tool non-desain bila tidak dibutuhkan.

**Tahap 6 — Evaluasi bertingkat**: fixture → checklist judge → blind pairwise vs Wonder dan Pen.

## Keterbatasan

- Wonder MCP tidak memuat tool di sesi ini (kemungkinan perlu login); skill design-review dan named styles belum terbaca.
- Pen tidak berjalan sehingga `read_skill`/`get_style` runtime tidak terverifikasi; data archetype dibaca dari bundle.
- Klaim fallback font di screenshot adalah inferensi dari CSP, belum dijalankan.
- Tidak ada generasi kompetitif yang dijalankan; parity 1:1 tetap belum terbukti.

## Status implementasi (29 Oktober 2026)

Semua tahap diimplementasikan oleh agent paralel, lalu diverifikasi ulang: `npm test` EXIT 0, `node --test integrations/*.test.mjs` 91/91, `eval/run-fidelity.mjs` 26/26 fixture (105/105 cek, tanpa mengubah ekspektasi fixture), `scripts/check.cjs` lulus.

| Tahap         | Implementasi                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 Fidelity    | Codec memakai engine Tailwind v4 asli (`tailwind-engine.mjs`, `tailwind-map.mjs`, `codec-css.mjs`, `codec-text.mjs`, `codec-layout.mjs`). Block flow, hug/fill, padding/radius per sisi, inheritance teks, absolute + inset, reflow setelah edit, warning eksplisit untuk kelas tak didukung. Satu fungsi style bersama (`web/node-style.js` / `integrations/node-style.mjs`) untuk canvas, export, dan screenshot. |
| 2 Pengetahuan | `integrations/design-knowledge/`: fundamentals, 27 archetype (palette lolos kontras), 8 playbook, 6 skill, persona baru. Tool `get_design_guidelines`, `get_skills`, `apply_style_tokens`.                                                                                                                                                                                                                          |
| 3 Verifikasi  | `design-lint.mjs` (struktural, kontras terhadap backdrop nyata, taste) + `verification.mjs` (receipt per revision, finish gate, budget repair 3). `take_screenshot` merekam receipt + lint dengan box terukur (editor dan fallback offscreen); `finish_artboard` mewajibkan `reviewNote` dan memblok critical; `Stop` hook Claude.                                                                                  |
| 4 Aset        | Ikon Iconify offline (lucide/ph/tabler) → `<Icon name=…>`; `get_icons`; `search_images` (Unsplash bila `UNSPLASH_ACCESS_KEY`, else Openverse) + unduh async ke data URL; font Fontsource di-embed ke screenshot dan canvas live.                                                                                                                                                                                    |
| 5 Runtime     | Default Claude `claude-opus-5-5` effort `high` (bisa dioverride); persona dari knowledge layer; packaging macOS kini menyertakan `node_modules` produksi.                                                                                                                                                                                                                                                           |
| 6 Evaluasi    | `eval/`: 8 brief beku, fidelity gate, judge checklist (`claude`/`codex`), blind pairwise + Bradley-Terry. Script `npm run eval:*`.                                                                                                                                                                                                                                                                                  |

Sisa gap yang diketahui:

- **Belum ada bukti parity 1:1.** Taste baru bisa dibuktikan dengan pilot `eval/` melawan Wonder dan Pen. Satu smoke judge memakan ~$0.69, jadi pilot 48 gambar ≈ $30.
- **Codec:**
  - h1–h6 memakai default ukuran tag, sedangkan preflight Tailwind mewarisi ukuran body.
  - Inline siblings ditumpuk vertikal.
  - Grid track custom dirata-ratakan.
  - Varian `md:`/`hover:`/`dark:` diabaikan, dengan warning.
- **Tool & aset:**
  - `generate_svg` tidak diekspos, karena `desktop/generate.cjs` bergantung pada IPC Electron.
  - Pencarian Openverse lambat (30–45 detik); disarankan memakai kunci Unsplash.
- **Codex:** tidak punya `Stop` hook. Enforcement-nya hanya lewat gate di `finish_artboard`.
- **Formatting:** `vp check` melaporkan formatting di 270 file. Ini kondisi lama repo dan belum dijalankan `--fix`.
