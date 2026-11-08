# Spike: verifying the file:// → app://verynize storage migration on a real profile

Branch `spike/migration-verify` (from `spike/app-router`, PR #15). This checks `desktop/storage-migration.cjs`
against a copy of a real, long-used profile, and runs the manual `npm start` flow on the new origin. No
private data is recorded here: key names are generalised, values appear only as SHA-256 comparisons, and
document names, chat content and account details are left out.

## Method and safety

- The real profile is `~/Library/Application Support/Verynize` (`app.setName('Verynize')`, 6.8 MB). An older
  `~/Library/Application Support/Better Design` profile (3.3 MB, from the app's earlier name) also exists.
  No current build reads it, so it is out of scope for this migration. Verynize was not running when the
  profile was copied (`cp -Rp`) to `/tmp`, once per scenario, starting from one pristine copy.
- Every app run used `--user-data-dir=<copy>`. `mcp.json`, `design-preferences.json`, `documents/`,
  `dev-servers.json` and `repositories.json` all resolve inside userData. Paths outside userData were
  redirected to temp dirs: `HOME`, `VERYNIZE_HOME_DIR`, `VERYNIZE_WORKSPACES_DIR` and `VERYNIZE_AGENT_HOME`.
  Each run also used `--use-mock-keychain`, so the run never touched the login keychain. As a hard guarantee,
  Electron ran under `sandbox-exec` with `(deny file-write* (subpath "$HOME"))`. That needs Chromium's
  `--no-sandbox` because nested seatbelt sandboxes fail. Process isolation stays on (`sandbox: true`,
  contextIsolation). Afterwards nothing under the real profile or `~/Verynize` was newer than the copy.
  `verynize://` protocol registration is a no-op for unpackaged runs.
- The baseline came from an independent script, not from the migration code. It loads a blank page in a
  hidden window at `file://` or at a privileged `app://verynize`, then lists localStorage keys
  (size + SHA-256) and IndexedDB databases/stores (record count + per-record hashes).
- Gotcha: this agent environment exports `ELECTRON_RUN_AS_NODE`, which turns `electron` into plain Node.
  The tests already delete it. Manual runs must unset it.

## Task 1: migration on a real profile copy

|                               | file:// before | app:// after migration | file:// after |
| ----------------------------- | -------------- | ---------------------- | ------------- |
| localStorage keys             | 16             | 16                     | 16            |
| bytes (UTF-16, key+value)     | 2,687,780      | 2,687,780              | 2,687,780     |
| identical SHA-256 vs baseline | n/a            | 16/16                  | 16/16         |
| IndexedDB databases           | none           | none                   | none          |

Key groups: the document model (`verynize-v2`), the file library (`verynize-library-v1`, ~0.4 M chars),
chats and drafts per project and unattached (`better-agent-chats:*`, `better-agent-drafts:*`, ~1.9 M chars),
agent defaults and usage, preferences (`better-preferences`), preview URL, sidebar sections, code-workspace
state (`verynize-code-*`), the cloud account and session (`verynize.cloud.account`) and onboarding. The real
profile has no IndexedDB at all, so the `verynize-cloud` outbox path is covered only by `tests/app-protocol.cjs`.

Timings (this Mac, warm disk):

- Pre-check (`hasFileOriginData`): 4–10 ms.
- Copy: 258–323 ms in four runs. One hidden window (`show: false`; the visible windows only ever listed
  the editor). In a full app launch, the migration window appeared at 411 ms and the editor window at
  700 ms, so the migration delays the first window by about 0.3 s, once.
- Relaunch: marker present, 0.2–0.6 ms, no window. The editor shows directly at `app://verynize/editor`.

The record file reads `{found: 16, copied: 16, kept: 0, failed: 0, outbox: 0}`.

UI on the migrated copy:

- The Files home lists 5 documents, the same as the `file://` origin shows in staging.
- The last-open document renders identically to staging.
- Theme is dark, and all 16 preference fields are present.
- Chats and the project workspace are restored.
- The cloud account shows signed in: the workspace header with the personal organisation. The session
  record has the `account`, `personalOrganizationId`, `server` and `session` fields. The cloud server does
  not rotate sessions, so using the copy cannot invalidate the real app's session.
- There were no console errors. The only warning is Electron's dev-mode CSP warning, which staging prints
  too.

Note that `verynize-library-v1` is rewritten on every app session (same length, new value), so hash
equality only holds when you check right after the copy, before the editor runs.

Relaunch: no migration window, still 16 keys and 5 files, nothing duplicated.

Downgrade: `origin/staging` (file://) launched on the migrated copy shows 5 files, all 16 keys, the same UI
and no console errors. The `file://` data is byte-identical to the baseline.

### Edge cases

1. **Both origins hold data, no marker** (e.g. an earlier unmigrated app:// build): existing app:// keys
   are kept and the rest are copied. This is the intended behaviour, covered by `tests/app-protocol.cjs`.
2. **Bug, fixed: retry after a failed first copy lost the user's data.** A failed copy (timeout, crash)
   left no marker, but the editor still opened on the empty app:// origin. The editor immediately writes
   9 first-run keys: an empty file library, default `verynize-v2`, an empty unattached chat list, default
   agent settings, etc. The "retry" on the next launch then kept all 9 as "existing". Reproduced on a real
   copy: the record showed `copied 7, kept 9`, and the Files home showed **1 file instead of 5**. Unattached
   chats, the library and agent defaults were stuck on defaults for good. The old data still sat on
   file://, but nothing would ever copy it.
   Fix in `desktop/storage-migration.cjs`:
   - The marker is written as `{pending: true, attempts}` before the copy.
   - A pending marker on a later launch means recovery mode. Before writing, the app:// values that differ
     from file:// are saved to `userData/storage-origin-migration-replaced.json` (0600). Then file:// wins
     for those keys. Keys only on app:// are kept, and equal values are left alone.
   - After 3 failed attempts it gives up, because each attempt can block startup for up to 15 s.
   - The record now includes `replaced` and `failedKeys` (key names only).
   - Writing the marker can no longer reject `migrateStorage` and stop startup.
     After the fix, the same real-copy scenario gives `{recovered: true, copied 7, replaced 7, kept 2}`:
     16/16 hashes identical to the baseline and 5 files on the home screen.
     Regression test: `tests/storage-migration.cjs`, added to `test:desktop`. It fails on the old code at
     "file:// data wins over defaults".
3. **Near quota.** In this Electron build, filling localStorage until `setItem` throws stops at about
   52.4 M chars (about 100 MB UTF-16) per origin. A real copy padded to the limit (216 keys, 104,856,440 bytes)
   migrated in 848 ms, with 216/216 identical hashes and nothing failed. Passing the data through
   `executeJavaScript` at that size is fine.

## Task 2: manual `npm start` flow

`npm start -- <electron args>` forwards the args to `electron .` (the script is
`node scripts/build-ui.cjs && electron .`). For example:
`npm start -- --user-data-dir=/tmp/profile`.

A real `npm start` on a fresh copy built the UI, migrated (16/16) and opened `app://verynize/editor` with 5
files. Reload kept `/editor`, and there were no console errors. The full flow ran through Playwright
`_electron.launch({args: ['.', '--user-data-dir=…']})`, which is the same `electron .`. It ran on a second
fresh copy for this branch and on a third fresh copy for detached `origin/staging`:

| Step                                                           | spike/app-router (this branch)                    | staging (file://)                  |
| -------------------------------------------------------------- | ------------------------------------------------- | ---------------------------------- |
| Launch                                                         | `app://verynize/editor`, 5 files                  | `file://…/web/index.html`, 5 files |
| Files tab → home                                               | `app://verynize/`                                 | home (URL unchanged)               |
| Back                                                           | `/editor`, editor view                            | no-op: stays on home               |
| Forward                                                        | `/`, home                                         | no-op                              |
| ⌘R (menu `CmdOrCtrl+R`) on `/`                                 | stays on `/`, home view, styles loaded            | comes back as **editor**           |
| ⌘R on `/editor`                                                | `/editor`, editor                                 | editor                             |
| Settings                                                       | opens                                             | opens                              |
| New file (name prompt)                                         | 6 files, new document opens                       | same                               |
| R + drag rectangle                                             | 0 → 1 layer                                       | same                               |
| Save (menu, stubbed dialog → /tmp)                             | `.verynize.json` written with 1 node              | same                               |
| Open project folder (stubbed dialog → /tmp)                    | ok                                                | ok                                 |
| Quit + relaunch                                                | 6 files, new document reopened with its rectangle | same                               |
| Console errors/warnings (excluding Electron's dev CSP warning) | none                                              | none                               |

Nothing regressed versus staging. Back/Forward and reload-on-home are new behaviour that works.

Closing the window over CDP leaves the process running. That is the usual macOS app lifetime (no quit on
window-all-closed) and matches staging.

## Open risks

- **Downgrade then upgrade diverges.** After migration, edits made in an older (file://) build stay on
  file://, and the done marker never copies them again. Users who switch builds will see different
  documents per build. Re-running the copy keyed on the file:// change time, or a merge of the library,
  would fix this. That is out of scope here.
- In recovery mode, data written during the failed session is replaced, not merged. It is preserved in
  `storage-origin-migration-replaced.json`, but nothing in the UI surfaces it.
- The real profile had no IndexedDB, so the outbox copy is verified only with the synthetic test record.
- Keychain-backed secrets (`safeStorage`, e.g. Figma OAuth, `Cookies`) were not exercised, because the
  verification ran with a mock keychain. They do not depend on the page origin.
- The legacy `Better Design` userData directory is not migrated by anything. That predates this branch.
