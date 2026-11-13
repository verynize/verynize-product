# Empty raster capture hardening — 2026-11-09

## Scope and diagnosis

Worktree: `verynize-integrate`, branch `integrate/perf-ux-p0p2`; baseline `2630c30`.
The original failure is in
`/data/test-results/verynize/integrate-20261109T033001Z/runner.log`:
`2160p: artwork fills the output: 0,0,0,0 ≈ 255,0,0,255`.
That assertion proves a transparent edge pixel, not that the entire image was transparent.
The original failing PNG was not retained by the test, which removes its temporary directory.

The confirmed code defect is insufficient capture validation: `NativeImage.isEmpty()`
checks for an image representation, not correct painted coverage. A later integrate run
reproduced the same failure even with an all-transparent-image guard enabled, proving that
the bad capture contains some paint while the expected edges are missing. Neither a valid
PNG size nor a nonzero-alpha pixel is sufficient to accept this capture. The renderer also waited for frames
before decoding background images and inserting/removing its zoom probe, leaving later DOM
work outside the paint barrier. Neither observation establishes the precise trigger of the
original intermittent failure, or proves that the integrated branches introduced it.

There is no tile-render path in this implementation: `renderHTML` captures one bounded
viewport. The renderer serializes requests and creates a separate hidden window for each.
No evidence justified changing the export UI or queue.

## Change

- Request a full repaint and wait for two animation frames after readiness and measurement.
- Normalize native capture pixels to the requested export size, then derive a one-bit-per-pixel
  coverage mask from alpha. Even alpha 1 counts as painted; RGB changes are ignored.
- Require two consecutive nonempty captures with identical painted coverage that also retains
  all regions observed in earlier attempts. A partial/stale
  frame that differs from the next frame cannot be returned as success. Captures are separated
  by a 100 ms yield, repaint, and frame barrier, with at most four captures total. An empty
  or unstable result after that budget throws before any data URL can reach export/save.
- Log invalid attempts, painted-pixel counts, previous counts, and native/output dimensions.
- Add bitmap regressions for transparent 2160p images, sparse artwork, missing regions,
  equal-count-but-moved paint, allowed colour/opacity changes, and recovery without forgetting
  previously painted regions. The real Electron test
  rejects blank 2160p output and verifies painted queue recovery. Existing artwork pixel
  assertions remain unchanged. Update the test manifest's coverage.

## Experiment protocol

The box is `coba` (4 vCPU). All Electron work takes
`flock /data/tmp/locks/electron.lock`; tests run sequentially under
`xvfb-run -a -s '-screen 0 3840x2160x24'` with `CI=1` and Node 24.
Four parallel `node -e 'for(;;){Math.sqrt(Math.random())}'` processes create continuous CPU
load (observed approximately 86–88% CPU each in the full-test batch). They run through both before-fix slots,
then are killed by the harness cleanup trap. The after-fix run uses the same load.

The diagnostic copy of `tests/inspector-paints.cjs` only forwards `[render]` stderr and logs
preset, PNG byte length, dimensions, and the two pixels already sampled by the original
assertions. No assertion, timing threshold, or interaction is weakened. Each run has a
240-second outer timeout, elapsed wall time, and its own log. The diagnostic copy is
removed after the run. PNGs and temporary Electron profiles use the original test cleanup.

The source is transferred as a diff tarball relative to `origin/staging`, with new files
included, and applied via `/data/home/vfix-slot integrate <tgz> <deleted.txt>`. Both tarballs
are removed from `/data/tmp/incoming` after refresh. Baseline source is at `2630c30`;
pre-existing modified screenshot fixtures are unrelated to the tested sources.

## Results

Before-fix CPU-load comparison (15 full inspector-paints runs per slot):

- Integrate: **15/15 passed**, 38–44 seconds/run (mean 39.5 s).
- Baseline: **14/15 passed**; run 5 failed with the identical 2160p edge assertion.
  Runs took 37–47 seconds (mean 45.3 s, including the early failure).
- Successful 2160p PNGs were 48,500 bytes, 2700×2160, with both edge samples
  `[255,0,0,255]`. The baseline failure was 28,759 bytes with both samples `[0,0,0,0]`.
- From baseline run 8, extra diagnostics counted alpha pixels; later runs also recorded
  painted bounds and would preserve failing PNGs. No further failure occurred in that batch.
  Successful images had 5,744,258 nonzero-alpha pixels and bounds `[0,0,2699,2159]`.
  The first failed PNG was already removed, so these data alone cannot establish whether
  it was entirely empty or partially painted.

Before report: `/data/test-results/verynize/render-stress-before-20261109T035647Z/`.
`runner.log`, `base-5.log`, `harness.sh`, and `diagnostic-final.cjs` preserve the evidence.
This reproduces the symptom in staging under the same load, so it is not exclusive to the
six integrated branches. The original integrate failure did not reproduce in these 15 runs.

An initial after-fix batch at
`/data/test-results/verynize/render-stress-after-20261109T041817Z/` exposed an overly strict
new dimension check: Linux CI in `desktop/main.cjs` forces device scale 2, and this runtime
returns native capture dimensions at 2× the requested output.
That draft guard was removed; the final change inspects the normalized bitmap and retains
the existing window-size check. The batch was stopped and is excluded from final validation.

The second candidate (repaint plus an all-transparent-image guard) ran at
`/data/test-results/verynize/render-stress-after-20261109T042130Z/`: **9 passed, run 10 failed**
with the same 28,759-byte PNG and transparent edges. The alpha guard did not reject it,
confirming that the failed image was only partly painted. This result motivated consecutive
coverage verification; it is not counted as final validation.

Additional baseline diagnostics: the standalone simple-HTML renderer completed 60 cycles
at `/data/test-results/verynize/render-probe-base-20261109T041943Z/`. A full-app probe using
actual canvas-exported markup completed 120 cycles at
`/data/test-results/verynize/render-ui-probe-base-20261109T042821Z/`; each cycle rendered
scales 5.12, 6.4, and 27 under the same four-worker CPU load. All recorded 2160p images in
that completed run were correct. An earlier full-app probe at `...T042103Z` stopped in its
failure-artifact writer (`require` was unavailable in the evaluation context); its incomplete
results are not used as a passing gate. No failing PNG was retained by these probes.

A preliminary consecutive-coverage batch at `.../render-stress-after-20261109T043225Z/`
was stopped during implementation review to add the observed-region memory and fourth-capture
recovery budget. It is excluded from final validation.

Final consecutive-coverage stress: **10/10 consecutive passes**, 42–44 seconds/run
(mean 42.6 s), with the same four CPU workers. All 2160p PNGs were 48,500 bytes and
2700×2160 with both expected red edge pixels. Runs 3–10 additionally counted 5,744,258
painted pixels and full output bounds `[0,0,2699,2159]`. No invalid-capture retry was logged
in this final batch. Report:
`/data/test-results/verynize/render-stress-after-20261109T043604Z/`.
The diagnostic script and individual logs are retained; the source/test SHA-256 values
were checked against the local source/test files (`source-hashes.json` in the report).

Related tests: **30 passed, 0 failed, 0 skipped**, in 187.1 s. The 26 explicitly named
inspector/render/capture/export test files selected four additional dependents. This includes
real blank-capture refusal and painted queue recovery, image/font exports, inspector paints,
and capture fidelity/live-state. Linux app tests use the existing 2× display configuration.
Report: `/data/test-results/verynize/integrate-20261109T044359Z/`.

An additional `TEST_RENDER_DEVICE_SCALE=1` run of `tests/render-export.cjs` passed
(1/1, 4.9 s total): `/data/test-results/verynize/integrate-20261109T044706Z/`.
No full-suite rerun was performed for this change.

The corrected runner command uses `--changed --files`;
an initial invocation without `--changed` exited before running any tests at
`/data/test-results/verynize/integrate-20261109T044313Z/`.

Local final-source checks all exited 0: `npm run check`, `npx vp lint`, `npm run lint:ui`,
`npm run typecheck:ui`, and `npm run typecheck:ratchet`. Full lint reports 14 existing warnings
in unrelated audit reproduction scripts. Ratchet counts: desktop 782/783, legacy-web 706/758,
integrations 128/128, cloud 341/341. Logs are copied to
`/data/test-results/verynize/render-static-20261109/runner.log`.
The bitmap and render-limit unit tests passed 8/8 locally.

## Limits and risks

Fully transparent artwork deliberately fails closed, because it cannot be distinguished
from a lost frame. Colour or nonzero-opacity animation with a stable footprint is accepted;
animation that keeps moving/changing its alpha footprint may be refused as unstable.
Consecutive coverage validation detects transient missing regions, not semantic correctness:
two identically wrong nonempty frames, wrong colours, or other stable rendering errors are
outside this check. The exact Chromium scheduling trigger remains unisolated.

Valid raster renders now require two captures and one 100 ms settling yield (up to two additional captures
form the bounded recovery budget). Coverage inspection adds a temporary bitmap buffer of up
to approximately 128 MB at the existing 32-megapixel bound; retained masks use one bit per
pixel (up to 4 MB each), not two retained RGBA buffers. PDF/vector/code export is unchanged.
