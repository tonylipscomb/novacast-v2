import { spawnSync } from 'node:child_process';

const result = spawnSync('node', ['--test', 'scripts/live-tv-scroll-perf.test.mjs'], {
  encoding: 'utf8',
  stdio: 'pipe',
});

process.stdout.write(result.stdout ?? '');
process.stderr.write(result.stderr ?? '');
process.exit(result.status ?? 1);
