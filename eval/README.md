# Evaluasi bertingkat (Tahap 6)

Tujuan: cara yang bisa diulang untuk membuktikan atau membantah bahwa taste UI hasil Verynize ≥ Wonder dan Pen. Dasar: [review kritis](../docs/audits/2026-10-29-design-quality-review.md) (Kritik 5, Tahap 6) dan [audit](../docs/audits/2026-10-29-design-quality.md) (definisi "minimal 1:1").

| Tier | Apa                                                         | Biaya                      | Perintah                                                                               |
| ---- | ----------------------------------------------------------- | -------------------------- | -------------------------------------------------------------------------------------- |
| 1    | Fidelity codec deterministik (30 fixture: JSX dan HTML+CSS) | gratis, CI                 | `node eval/run-fidelity.mjs [--verbose]`                                               |
| 1b   | Fidelity import HTML/CSS vs render Chrome asli              | gratis, butuh Chrome       | `node eval/run-import-fidelity.mjs [--verbose]`                                        |
| 2    | Checklist judge multimodal per brief                        | 1 panggilan CLI per gambar | `node eval/run-judge.mjs --brief <id> --image <png>` lalu `node eval/summarize.mjs`    |
| 3    | Blind pairwise + Bradley-Terry                              | waktu reviewer             | `node eval/make-pairs.mjs` → `eval/pairwise/review.html` → `node eval/score-pairs.mjs` |

Semua import ke modul repo hanya lewat `eval/lib/adapter.mjs`. Jika API codec berubah, perbaiki di sana saja.

## Tier 1 — fidelity

Fixture = `eval/fidelity/fixtures/NN-nama.jsx` (atau `NN-nama.html` untuk HTML+CSS lewat importer `integrations/codec-html.mjs`, dengan `viewport` di JSON) + `NN-nama.json` (asersi). Asersi model membaca dokumen hasil codec (padding per sisi, radius per sudut, gap x/y, warna palette + alpha, inheritance teks, hug/fill, absolute, gradient, shadow, truncate, warning kelas invalid). Asersi `rendered` mengekspor HTML lalu mengukur kotak di Chrome headless (Google Chrome sistem atau Chromium Playwright; bila tidak ada → SKIP, bukan PASS). `edits` menjalankan directive `update_elements`; `roundTrip` memeriksa serialize → parse → serialize stabil dan properti tidak berubah. Exit code ≠ 0 bila ada fixture gagal — inilah gate regresi codec. Fixture boleh ditambah; jangan longgarkan asersi agar lulus.

## Tier 1b — fidelity import HTML/CSS

`run-import-fidelity.mjs` merender halaman asli di Chrome headless, mengimpornya (stylesheet eksternal, @import, @layer, media query untuk viewport, custom property, Tailwind v4), merender hasil export dokumen, lalu membandingkan kotak setiap elemen yang menjadi layer (dipasangkan lewat `data-name="eN"`). Halaman: referensi Tailwind 07/08 dan halaman CSS orisinal di `eval/fidelity/import/`. Exit code ≠ 0 bila rasio layer dalam toleransi (`--tol`, default 2px) di bawah `--min` (default 0.9), atau bila tidak ada Chrome (tidak pernah dianggap PASS). Font Inter disematkan di kedua sisi agar yang diukur hanya konversinya.

## Brief (beku)

`eval/briefs/*.json`: 8 brief, masing-masing berisi `prompt` (teks identik untuk semua app), `viewport`, `requiredContent`, `constraints`, `assetsAllowed`, `inputs`, `budget`, dan 12–14 item checklist biner (`critical: true` = cacat kritis).

- 07 rekonstruksi: lampirkan `eval/references/07-reference.png` (desain orisinal; sumber `07-reference.html`, Tailwind v4). Jangan berikan HTML-nya ke app.
- 08 refinement: lampirkan `eval/references/08-start.png`; untuk app yang menerima kode tempel `08-start.html`; untuk Verynize tempel `08-start.jsx` via `create_artboard` dulu, lalu kirim prompt.
- Jika referensi diubah: `node eval/render-references.mjs`, lalu naikkan `version` brief. Hasil dengan versi brief berbeda tidak boleh dibandingkan.

## Membekukan kondisi run

Catat di `eval/results/<app>/RUNLOG.md` per run: versi app, model, effort, tanggal, durasi, jumlah follow-up.

- Model/effort: Verynize dan Wonder sama-sama Claude Agent SDK → pakai model yang sama (mis. `claude-opus-5-5`, effort `high`) di kedua app. Pen: pilih model yang setara; bila tidak bisa disamakan, catat sebagai keterbatasan.
- Satu sesi/dokumen baru per run, tanpa riwayat chat, tanpa design system/library pribadi kecuali brief memintanya.
- Kirim `prompt` apa adanya (copy dari JSON), lampiran sesuai `inputs`. `budget.followUpTurns` = 0: tidak ada koreksi manual. Hentikan pada `budget.maxMinutes`; ambil apa yang ada.
- Simpan juga hasil pass pertama bila app melakukan iterasi terlihat: `<run>.first.png` (diabaikan pairwise).

## Mengambil output

Konvensi file: `eval/results/<app>/<brief-id>/<run>.png`, `app` ∈ `verynize | wonder | pen | figma | figcraft`, `run` = `run-1`, `run-2`, …. Gunakan `eval/capture.mjs` agar ukuran seragam (1×, lebar = viewport brief):

```sh
node eval/capture.mjs --brief 01-saas-dashboard --app wonder --run run-1 --png ~/Downloads/Frame.png
node eval/capture.mjs --brief 01-saas-dashboard --app verynize --run run-1 --html /tmp/export.html
```

**Verynize.** Jalankan app desktop (`npm start`), buka dokumen baru, kirim prompt di panel chat dengan model/effort yang dibekukan. Setelah selesai, ambil gambar artboard dengan salah satu cara (konsisten untuk semua run):

1. Utama: pilih artboard → Export → PNG 1× → simpan → `capture.mjs --png`. Ini memakai renderer offscreen yang sama dengan `take_screenshot` MCP.
2. Lewat MCP dari agent luar: `take_screenshot { id: <artboard>, scale: 1 }` mengembalikan PNG base64; simpan blok gambar ke file lalu `capture.mjs --png`.
3. Cadangan headless: `npm run cli -- --root <folder-dokumen> export <NAMA> > /tmp/export.html` lalu `capture.mjs --html` (renderer `export-html.mjs` memakai mapping gaya yang sama dengan canvas, `web/node-style.js`; bedanya hanya font/lingkungan browser — tetap jangan dicampur dengan cara 1 dalam satu perbandingan).

**Wonder (0.2.185).** File baru → kirim prompt di chat → tunggu selesai. Klik frame/artboard hasil (label frame di kiri atas) → panel kanan **Properties** → bagian **Export** (klik `+` bila belum ada) → skala **1x** (default 2x; kalau tetap 2x tidak masalah, `capture.mjs` menurunkannya) → format **PNG** → **Export as PNG** → simpan → `capture.mjs --png`. Untuk brief full page, pastikan frame tinggi penuh (tidak di-clip) sebelum export.

**Pen (1.2.20).** Dokumen `.pen` baru → kirim prompt ke agent Pen → tunggu selesai. Pilih frame hasil → panel properti → **Export** → PNG, scale 1× → simpan → `capture.mjs --png`. Bila export tidak tersedia: zoom 100%, sembunyikan panel, screenshot macOS area frame saja (`⌘⇧4`, lalu seret tepat di tepi frame) → `capture.mjs --png` (periksa ukurannya sesuai viewport).

**Figma / FigCraft** (kontrol tambahan, bukan klaim parity utama): pilih frame → Export → PNG 1× → `capture.mjs --png`.

Aturan blind: hanya artboard, tanpa chrome aplikasi, kursor, label frame, atau handle seleksi. Jangan beri nama file yang mengungkap app di luar struktur folder.

## Tier 2 — judge

```sh
node eval/run-judge.mjs --brief 01-saas-dashboard --image eval/results/wonder/01-saas-dashboard/run-1.png [--judge claude|codex] [--model opus]
node eval/summarize.mjs [--judge claude]
```

Judge mendapat screenshot (halaman tinggi dikirim sebagai overview + potongan resolusi penuh), brief, checklist, dan rubrik `eval/judge/rubric.json` (hierarchy 20, typography 20, spacing 20, color 10, content 10, assets 10, consistency 10). Ia tidak tahu nama app. Output divalidasi (`eval/judge/schema.json`; tiap id checklist tepat sekali, skor bulat 1–10) dan disimpan di `eval/results/<app>/<brief>/<run>.json` di bawah `judgements.<judge>`, plus `derived.weightedScore` (0–100) yang dihitung script, bukan oleh model. Claude dipanggil via `claude -p --input-format stream-json` (gambar base64) tanpa tool; Codex via `codex exec --image ... --output-schema`. Bekukan model judge untuk satu studi (`--model`), dan gunakan judge yang sama untuk semua app. Smoke test satu panggilan Claude (Sonnet) lulus; jalur Codex belum diuji.

## Tier 3 — blind pairwise

```sh
node eval/make-pairs.mjs --seed 2026 [--apps verynize,wonder,pen] [--max-per-brief 12]
# buka eval/pairwise/review.html; tombol A/←, B/→, T/↓ (tie), U (kembali), Z (zoom). Vote tersimpan di localStorage.
# reviewer menekan "Export votes JSON"; kumpulkan di eval/pairwise/votes/
node eval/score-pairs.mjs [--margin 50] [--samples 2000]
```

`review.html` mandiri (gambar ter-embed) dan tanpa nama app; `key.json` adalah kunci unblinding — jangan dibagikan. ~10% pasangan diulang dengan sisi ditukar untuk mengukur konsistensi reviewer. Skor: win/tie/loss per kompetitor (total dan per brief), rating Bradley-Terry (skala Elo, tie = ½) dengan CI bootstrap 95% (resample per pasangan).

## Jumlah run

- **Pilot**: 8 brief × 2 run × 3 app (Verynize, Wonder, Pen) = 48 gambar; 48 panggilan judge; pairwise 8 × 3 pasangan app × 4 kombinasi run = 96 pasangan (+ulangan), ≥3 reviewer. Tujuannya mengkalibrasi checklist dan judge, bukan klaim statistik.
- **Studi utama** (setelah pilot stabil): 3 run per brief per app (72 output, sesuai audit), ≥3 reviewer manusia. Judge dijalankan ulang bila rubrik atau brief berubah.

## Gate penerimaan

Verynize dinyatakan "≥ Wonder dan Pen" hanya jika semua terpenuhi, terhadap **masing-masing** kompetitor:

1. **Nol cacat kritis**: tidak ada `criticalDefects` dan tidak ada item checklist `critical` yang gagal di run Verynize mana pun (`summarize.mjs`).
2. **Median skor judge** (weighted, 0–100) Verynize tidak di bawah median kompetitor, secara keseluruhan dan per brief (`summarize.mjs`, exit 0).
3. **Pairwise**: CI 95% selisih rating BT (Verynize − kompetitor) tidak berada di bawah −margin (default 50 Elo), yaitu verdict `non-inferior` atau `superior` (`score-pairs.mjs`, exit 0). `inconclusive` = data belum cukup, bukan lulus.
4. Tier 1 hijau (`run-fidelity.mjs` exit 0) sebagai syarat sebelum menjalankan Tier 2/3 untuk rilis.

Laporkan juga rentang skor, disagreement reviewer, versi app/model, dan keterbatasan (model yang tidak bisa disamakan, font yang hilang).
