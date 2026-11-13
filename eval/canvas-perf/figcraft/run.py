#!/usr/bin/env python3
"""Record environment or five independent runs of FigCraft's upstream perf CLI.
No upstream source is copied, changed, built, or downloaded by this script.
"""
import argparse
import datetime
import json
import os
from pathlib import Path
import re
import shutil
import statistics
import subprocess
import time

COMMIT = '53ebf1f39c51361282ca55e18c83fbffed2f9a34'


def command(args):
  p = subprocess.run(args, capture_output=True, text=True, check=False)
  return {'code': p.returncode, 'stdout': p.stdout.strip(), 'stderr': p.stderr.strip()}


def machine():
  return {
    'utc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'cpu': command(['/usr/sbin/sysctl', '-n', 'machdep.cpu.brand_string']),
    'ram_bytes': command(['/usr/sbin/sysctl', '-n', 'hw.memsize']),
    'loadavg': list(os.getloadavg()),
  }


def main():
  parser = argparse.ArgumentParser(description=__doc__)
  parser.add_argument('--source', type=Path, default=Path('/tmp/perf-research/figcraft'))
  parser.add_argument('--out', type=Path, required=True)
  parser.add_argument('--probe-only', action='store_true')
  args = parser.parse_args()
  args.out.mkdir(parents=True, exist_ok=False)
  rev = command(['git', '-C', str(args.source), 'rev-parse', 'HEAD'])
  if rev['stdout'] != COMMIT:
    raise SystemExit('Unexpected checkout; inspect and update the pin before running.')
  report = {'commit': COMMIT, 'cargo': shutil.which('cargo'), 'rustc': shutil.which('rustc'),
            'mode': 'environment only' if args.probe_only else 'upstream CLI means', 'runs': []}
  binary = args.source / 'target/release/figcraft-cli'
  if not args.probe_only and not binary.is_file():
    raise SystemExit('Build with the documented cargo build --release -p figcraft-cli first.')
  for size in ([None] if args.probe_only else [1000, 10000, 50000, 100000]):
    for trial in range(1, 6):
      row = {'requested_layers': size, 'trial': trial, 'before': machine()}
      if size is not None:
        start = time.monotonic()
        p = subprocess.run(['/usr/bin/time', '-l', str(binary), 'perf', '--layers', str(size),
                            '--instances', '0'], capture_output=True, text=True, timeout=1800)
        row.update(exit_code=p.returncode, process_wall_seconds=time.monotonic() - start)
        prefix = f'{size}-{trial}'
        (args.out / f'{prefix}.stdout.md').write_text(p.stdout)
        (args.out / f'{prefix}.stderr.txt').write_text(p.stderr)
        rss = re.search(r'(\d+)\s+maximum resident set size', p.stderr)
        row['process_peak_rss_bytes'] = int(rss[1]) if rss else None
        row['upstream_mean_rows'] = {}
        if p.returncode == 0:
          for line in p.stdout.splitlines():
            fields = [s.strip() for s in line.strip().strip('|').split('|')]
            if line.startswith('|') and len(fields) == 2:
              try:
                row['upstream_mean_rows'][fields[0]] = float(fields[1])
              except ValueError:
                pass
      row['after'] = machine()
      report['runs'].append(row)
      (args.out / 'results.json').write_text(json.dumps(report, indent=2) + '\n')
  report['median_start_loadavg'] = [statistics.median(r['before']['loadavg'][i] for r in report['runs']) for i in range(3)]
  report['median_of_upstream_means'] = {}
  if not args.probe_only:
    for size in [1000, 10000, 50000, 100000]:
      rows = [r for r in report['runs'] if r['requested_layers'] == size and r['exit_code'] == 0]
      if len(rows) != 5:
        continue
      common = set.intersection(*(set(r['upstream_mean_rows']) for r in rows))
      report['median_of_upstream_means'][size] = {
        k: statistics.median(r['upstream_mean_rows'][k] for r in rows) for k in sorted(common)
      }
  (args.out / 'results.json').write_text(json.dumps(report, indent=2) + '\n')


if __name__ == '__main__':
  main()
