import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const analyticsDir = path.join(root, 'src', 'features', 'analytics');
const read = (name) => fs.readFileSync(path.join(analyticsDir, name), 'utf8');

test('Stage B analytics feature area contains the foundation modules', () => {
  for (const name of [
    'analyticsTypes.ts',
    'analyticsConfig.ts',
    'analyticsStorage.ts',
    'analyticsQueue.ts',
    'analyticsTransport.ts',
    'analyticsSession.ts',
    'analyticsLifecycle.ts',
    'analyticsHeartbeat.ts',
    'novaAnalytics.ts',
    'index.ts',
  ]) {
    assert.equal(fs.existsSync(path.join(analyticsDir, name)), true, name);
  }
});

test('transport uses existing device authentication and Stage A endpoint', () => {
  const source = read('analyticsTransport.ts');
  assert.match(source, /deviceAuthHeaders/);
  assert.match(source, /analytics-ingest/);
  assert.match(source, /retryable/);
});

test('queue is bounded and persistent', () => {
  const config = read('analyticsConfig.ts');
  const queue = read('analyticsQueue.ts');
  const storage = read('analyticsStorage.ts');
  assert.match(config, /maxQueueItems: 200/);
  assert.match(config, /maxQueueBytes: 256 \* 1024/);
  assert.match(queue, /writeAnalyticsQueue/);
  assert.match(queue, /maxQueueItems/);
  assert.match(storage, /@novacast\/analytics-queue-v1/);
});

test('lifecycle and heartbeat reuse existing sources without a second timer', () => {
  const lifecycle = read('analyticsLifecycle.ts');
  const heartbeat = read('analyticsHeartbeat.ts');
  const layout = fs.readFileSync(path.join(root, 'src', 'app', '_layout.tsx'), 'utf8');
  assert.match(lifecycle, /subscribeAppLifecycle/);
  assert.match(lifecycle, /subscribeOfflineStatus/);
  assert.match(heartbeat, /getUnifiedPlayerState/);
  assert.equal((layout.match(/setInterval\(/g) ?? []).length, 1);
  assert.match(layout, /sendNovaAnalyticsHeartbeat/);
});

test('client foundation contains no product event hooks or session heartbeat event', () => {
  const source = fs.readdirSync(analyticsDir)
    .filter((name) => name.endsWith('.ts'))
    .map((name) => read(name))
    .join('\n');
  assert.doesNotMatch(source, /session_heartbeat/);
  assert.doesNotMatch(source, /playback_requested|playback_started|search_results|catalog_sync_started|guide_load_started/);
});

test('route transitions enqueue sanitized, deduplicated screen views', () => {
  const source = read('novaAnalytics.ts');
  const types = read('analyticsTypes.ts');
  assert.match(types, /'screen_view'/);
  assert.match(source, /split\(\/\[\?\#\]\/\, 1\)/);
  assert.match(source, /currentRoute === normalizedRoute/);
  assert.match(source, /enqueueAnalyticsEvent\('screen_view'/);
});

test('analytics session uses the native build metadata source', () => {
  const metadata = read('analyticsAppMetadata.ts');
  assert.match(read('analyticsSession.ts'), /resolveAnalyticsAppMetadata/);
  assert.match(metadata, /Application\.nativeBuildVersion/);
  assert.match(metadata, /Constants\.nativeBuildVersion/);
  assert.match(metadata, /Constants\.manifest2/);
});

test('analytics app metadata fallback order is native application, constants, manifests, then config', () => {
  const metadata = read('analyticsAppMetadata.ts');
  assert.ok(metadata.indexOf('Application.nativeBuildVersion') < metadata.indexOf('Constants.nativeBuildVersion'));
  assert.ok(metadata.indexOf('Constants.nativeBuildVersion') < metadata.indexOf('manifest2?.extra'));
  assert.ok(metadata.indexOf('manifest2?.extra') < metadata.indexOf('manifest?.android'));
  assert.ok(metadata.indexOf('manifest?.android') < metadata.indexOf('Constants.expoConfig?.android'));
});

test('screen views use one debounced non-blocking flush', () => {
  const source = read('novaAnalytics.ts');
  assert.match(source, /scheduleDebouncedAnalyticsFlush\(\)/);
  assert.match(source, /setTimeout\(.*4_000/s);
  assert.match(source, /void flushNovaAnalytics\(\)\.catch/);
  assert.match(source, /clearTimeout\(debouncedFlushTimer\)/);
});

test('rapid route transitions remain batchable and use the shared flush lock', () => {
  const source = read('novaAnalytics.ts');
  const queue = read('analyticsQueue.ts');
  assert.match(source, /if \(debouncedFlushTimer\) clearTimeout/);
  assert.match(queue, /events\.length \+ item\.events\.length > 50/);
  assert.match(source, /if \(!analyticsConfig\.enabled \|\| flushPromise\)/);
});

test('offline route events remain queued for reconnect flush', () => {
  const lifecycle = read('analyticsLifecycle.ts');
  const source = read('novaAnalytics.ts');
  assert.match(source, /await enqueueAnalyticsBatch/);
  assert.match(lifecycle, /subscribeOfflineStatus/);
  assert.match(lifecycle, /status === 'online'.*flushNovaAnalytics/s);
});

test('development delivery logs include route, queue, flush, and ingest counts', () => {
  const source = read('novaAnalytics.ts');
  for (const phrase of [
    'normalized route',
    'screen_view queued',
    'queue length',
    'debounced flush started',
    'accepted/duplicate/rejected counts',
  ]) {
    assert.match(source, new RegExp(phrase));
  }
});
