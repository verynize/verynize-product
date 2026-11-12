# Identity guard

`scripts/check-identity.mjs` keeps the owner's personal identity out of the repository. Committed
files (screenshots and fixtures under `design/wonder/**`, `metrics.json`, notes, docs, code) and
commit metadata must not contain:

- personal email addresses (any address that is not a placeholder such as `you@…`, an
  `example.com`/`.test`/`.invalid` address, a `users.noreply.github.com` address, or a role address
  like `noreply@anthropic.com` / `noreply@openai.com` / `git@github.com`);
- home-directory paths: `/Users/<name>`, `/home/<name>` (except `/home/runner`), `C:\Users\<name>`;
  write `~/…` instead;
- terminal prompts such as `<user>@<host> ~ %` or `<user>@<host>:~$`;
- private Wonder URLs `app.wonder.so/<workspace>/…` (the bare domain and `/assets/` are fine);
- identifying image metadata: PNG `tEXt`/`iTXt`/`zTXt`/`eXIf`, JPEG/WebP Exif and XMP (Author,
  Artist, Copyright, `dc:creator`, or any of the patterns above);
- text visible in images (OCR with `tesseract`, when installed).

The account profile photo cannot be detected automatically: crop or blur avatars before committing
screenshots (the PR template asks for this).

Commit author emails must be `55482107+AdamAbd@users.noreply.github.com` or
`noreply@anthropic.com`; committers may also be `noreply@github.com` (web merges).

## Where it runs

- **Pre-commit** (`.vite-hooks/pre-commit`, installed by `vp hooks enable` / `vp config`):
  `node scripts/check-identity.mjs --staged --author`. It reads the staged blobs (`git show :path`),
  not the working copy, and the identity from `git var GIT_AUTHOR_IDENT`. Staged images are OCR'd
  when `tesseract` is on PATH (`brew install tesseract`). Also available as `npm run check:identity`.
- **CI** (`.github/workflows/identity.yml`, required check `identity`, PRs to `staging`/`main`):
  `--range BASE..HEAD --author --ocr=required` over the PR head SHA. It checks every commit's
  author/committer and message, every blob added or modified by any commit in the range (a leak
  that a later commit removes still fails, because the history is published), and OCRs changed
  images.
- **Audit**: `node scripts/check-identity.mjs --all` scans the whole tracked tree. OCR is off for
  `--all` (about 1900 images); add `--ocr` to include it.

Hits print as `path:line: kind: <redacted match>` (line `0` for image metadata/OCR) and exit 1.
Text files over 5 MB and non-image binaries are skipped with a note.

## Fixing a hit

Redact the content (replace paths with `~/…`, emails with `you@example.com`, crop the screenshot,
strip metadata with `exiftool -all= file.png` or re-export). Do not rewrite published history
without the owner's decision; a leak in an unmerged PR branch is fixed by amending/rebasing that
branch.

Only genuine false positives go into `.identity-allow` at the repository root: one
`path-glob[:substring]` per line, with a comment explaining why it is not personal data. The
substring is matched against the raw hit, so prefer it over a bare path glob.

Tests: `node --test tests/identity-check.mjs`.
