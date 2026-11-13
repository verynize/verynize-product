# FigCraft performance probe

Independent Python standard-library harness; no FigCraft source or assets are copied. Pin: `53ebf1f39c51361282ca55e18c83fbffed2f9a34`.

The checked-in `observations-2026-11-04/results.json` contains five environment probes only. No FigCraft executable ran: Cargo and rustc are unavailable. Those samples do not constitute five rendering trials.

After inspecting upstream dependencies/build scripts and provisioning Rust >=1.95, use its documented build in `/tmp/perf-research/figcraft`:

```sh
cargo build --release -p figcraft-cli
```

From this Verynize worktree, choose a **new** output directory:

```sh
python3 eval/canvas-perf/figcraft/run.py --out /tmp/perf-research/run-1
# Environment-only verification, no upstream execution:
python3 eval/canvas-perf/figcraft/run.py --probe-only --out /tmp/perf-research/probe-1
```

The full mode invokes the release CLI five times per requested size (1K/10K/50K/100K), skips the unrelated component benchmark, saves stdout/stderr, captures CPU/RAM/load before and after each run, process elapsed time and macOS `/usr/bin/time -l` peak RSS in bytes. It summarizes the median of five successful upstream means, retaining row labels/units. Outputs have rounded upstream precision. The 30-minute timeout is per process; this is not a build-time budget.

Limitations: process peak RSS includes generation, serialization and every benchmark, not steady-state canvas or GPU memory. Process elapsed time is not first-frame latency. The CLI supplies means, not raw frame samples; medians of these means are **not** pan/zoom p50/p95. It ignores some render-return failures, so a zero exit code alone does not validate pixels. This harness has only been executed in probe mode; full mode remains unverified.

For interactive acceptance, add per-frame presentation timestamps and render-completion timestamps to a disposable upstream checkout (not Verynize), validate output pixels, record actual node counts and fonts, fix viewport/DPR, and run five independent sessions. Collect pan and zoom separately at 100% and fit, first coarse and first refined frame, cold/warm caches and process/GPU memory. Report per-run p50/p95 then median across runs. Repeat on an otherwise idle Mac; concurrent Electron benchmarks make CPU timings unsuitable for direct renderer comparisons.
