import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

import {
  getEarlyBootSlowOpsForTests,
  initializeEarlyBootAudit,
  earlyBootTimedSync,
  resetEarlyBootAuditForTests,
} from '../src/features/diagnostics/earlyBootAudit.ts';
import { invalidateCatalogSyncForProvider } from '../src/features/catalog/catalogSyncCoordinator.ts';

test.beforeEach(() => {
  resetEarlyBootAuditForTests();
  process.env.EXPO_PUBLIC_NOVACAST_CATALOG_AUDIT = '1';
  initializeEarlyBootAudit();
});

test.afterEach(() => {
  resetEarlyBootAuditForTests();
  delete process.env.EXPO_PUBLIC_NOVACAST_CATALOG_AUDIT;
});

test('earlyBootTimedSync records ops over 50ms', () => {
  earlyBootTimedSync('synthetic.block', () => {
    const end = Date.now() + 60;
    while (Date.now() < end) {
      // busy wait to simulate sync stall
    }
  });
  const ops = getEarlyBootSlowOpsForTests();
  assert.ok(ops.some((op) => op.name === 'synthetic.block' && op.sync === true && op.elapsedMs >= 50));
});

test('analytics init is deferred after launch in root layout', async () => {
  const layout = await fs.readFile(new URL('../src/app/_layout.tsx', import.meta.url), 'utf8');
  assert.match(layout, /analytics_init_scheduled/);
  assert.match(layout, /Sentry\.init/);
  assert.match(layout, /setTimeout\(\(\) => \{[\s\S]*Sentry\.init/);
  assert.match(layout, /stage295-native-completion-v1/);
  assert.doesNotMatch(
    layout,
    /useEffect\(\(\) => \{\s*void initializeNovaAnalytics\(\);\s*void initializeDevice/,
  );
});

test('smart cache builders use time-budgeted snapshot scans', async () => {
  const source = await fs.readFile(
    new URL('../src/features/providers/providerCatalogSync.ts', import.meta.url),
    'utf8',
  );
  assert.match(source, /series-smart-query/);
  assert.match(source, /movie-smart-query/);
  assert.match(source, /processTimeBudgeted\([\s\S]*snapshot/);
  assert.match(source, /CATALOG_SYNC_CHECKPOINT_VERSION = 10/);
  assert.match(source, /curateSeriesNewReleases/);
  assert.match(source, /listAllEntries/);
});

test('launch sequence defers video player past first paint', async () => {
  const source = await fs.readFile(
    new URL('../src/features/startup/NovaCastLaunchSequence.tsx', import.meta.url),
    'utf8',
  );
  assert.match(source, /launch_video_defer_scheduled/);
  assert.match(source, /LaunchIntroVideo/);
  assert.match(source, /allowVideoMount/);
  assert.match(source, /PREFER_STATIC_TV_INTRO/);
  assert.match(source, /launch_video_skipped_tv_static/);
});

test('native module exposes registry snapshot and provider cancel', async () => {
  const kotlin = await fs.readFile(
    new URL(
      '../modules/novacast-catalog-decode/android/src/main/java/expo/modules/novacastcatalogdecode/NovacastCatalogDecodeModule.kt',
      import.meta.url,
    ),
    'utf8',
  );
  assert.match(kotlin, /getJobRegistrySnapshot/);
  assert.match(kotlin, /cancelDecodeJobsForProvider/);
  assert.match(kotlin, /cancellationCount/);
  assert.match(kotlin, /completedCleanupCount/);
  assert.match(kotlin, /Channel<DecodeBatch>\(capacity = 0\)/);
});

test('provider invalidation cancels native decode jobs', async () => {
  const source = await fs.readFile(
    new URL('../src/features/catalog/catalogSyncCoordinator.ts', import.meta.url),
    'utf8',
  );
  assert.match(source, /cancelNativeDecodeJobsForProvider/);
  // Call should not throw in Node stub environment.
  invalidateCatalogSyncForProvider('provider-test');
});

test('writer-only diagnostic flag remains off by default', async () => {
  const shared = await fs.readFile(
    new URL('../src/features/catalog/nativeCatalogDecodeShared.ts', import.meta.url),
    'utf8',
  );
  assert.match(shared, /EXPO_PUBLIC_CATALOG_SQLITE_WRITER_ONLY_DIAGNOSTIC/);
  assert.equal(process.env.EXPO_PUBLIC_CATALOG_SQLITE_WRITER_ONLY_DIAGNOSTIC, undefined);
});

test('writer-only path maps native records once and releases batches', async () => {
  const source = await fs.readFile(
    new URL('../src/features/providers/providerCatalogSync.ts', import.meta.url),
    'utf8',
  );
  const writer = await fs.readFile(
    new URL('../src/features/catalog/catalogSqliteSyncWriter.ts', import.meta.url),
    'utf8',
  );
  assert.match(writer, /mapNativeRecordToCatalogItem/);
  assert.match(source, /mapNativeRecordToCatalogItem/);
  assert.match(source, /movie-native-raw/);
  assert.match(source, /series-native-raw/);
});
