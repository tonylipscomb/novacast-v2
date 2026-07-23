import { spawnSync } from 'node:child_process';

const suites = [
  'app-notifications.test.mjs',
  'notification-focus.test.mjs',
  'auth-notifications.test.mjs',
  'category-regional-pipeline.test.mjs',
  'category-normalization.test.mjs',
  'us-american-sort.test.mjs',
  'catalog-sync-playback.test.mjs',
  'catalog-sync-smart.test.mjs',
  'content-sorting.test.mjs',
  'content-hub-notifications.test.mjs',
  'hub-format.test.mjs',
  'hub-live-now.test.mjs',
  'library-performance.test.mjs',
  'live-guide-smoke.test.mjs',
  'live-tv-channel-accent.test.mjs',
  'guide-polish.test.mjs',
  'live-tv-scroll-perf.test.mjs',
  'navigation-smoke.test.mjs',
  'new-releases-curation.test.mjs',
  'onboarding-smoke.test.mjs',
  'one-provider.test.mjs',
  'personalization.test.mjs',
  'playback-stabilization.test.mjs',
  'provider-integrity.test.mjs',
  'provider-smoke.test.mjs',
  'repository-switch.test.mjs',
  'search-smoke.test.mjs',
  'search-performance.test.mjs',
  'series-overhaul.test.mjs',
  'settings-notifications.test.mjs',
  'smart-categories.test.mjs',
  'startup-splash.test.mjs',
  'pairing-flow.test.mjs',
  'unified-player.test.mjs',
  'xtream-repositories.test.mjs',
].map((name) => `scripts/${name}`);

const result = spawnSync(process.execPath, ['--experimental-strip-types', '--test', ...suites], {
  stdio: 'inherit',
  windowsHide: true,
});

if (result.error) {
  console.error(result.error);
  process.exitCode = 1;
} else {
  process.exitCode = result.status ?? 1;
}
