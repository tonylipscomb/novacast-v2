import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

const root = new URL('..', import.meta.url);
const read = (path) => fs.readFile(new URL(path, root), 'utf8');

test('NovaShift probe has one bounded lifecycle with stale-timer and stage guards', async () => {
  const source = await read('src/features/live/liveTimeshiftDiagnostics.ts');
  assert.match(source, /emitted\.has\(stage\)/);
  assert.match(source, /disposed/);
  assert.match(source, /stage: 'seek--10s',\s*delayMs: 0/);
  assert.match(source, /stage: 'seek--55s',\s*delayMs: 0/);
  assert.match(source, /near-window-end/);
  assert.match(source, /duration - 1/);
  assert.match(source, /8_000/);
  assert.match(source, /waitForSettled/);
  assert.match(source, /dispose: \(/);
  assert.match(source, /recordDiagnostic\(\{/);
  assert.match(source, /eventType: 'live_timeshift_capability'/);
  assert.doesNotMatch(source, /timeUpdate/);
  assert.match(source, /player\.currentTime\s*=/);
  assert.doesNotMatch(source, /seekBy\s*\(/);
});

test('NovaShift probe logs only safe identities and no URL-bearing fields', async () => {
  const source = await read('src/features/live/liveTimeshiftDiagnostics.ts');
  assert.match(source, /safeIdentity/);
  assert.match(source, /safeIdentity\(input\.channelKey\)/);
  assert.doesNotMatch(source, /streamUrl|username|password|authorization|token/i);
  assert.match(source, /NovaCast NovaShift Probe/);
  assert.match(source, /JSON\.stringify\(payload\)/);
});

test('single HLS probe is opt-in and uses the normal Live player connection', async () => {
  const screen = await read('src/features/live/LiveTvScreen.tsx');
  assert.match(screen, /EXPO_PUBLIC_NOVASHIFT_SINGLE_HLS_PROBE === 'true'/);
  assert.match(screen, /buildLiveStreamUrl\(singleHlsProbeChannel\.id, 'm3u8'\)/);
  assert.doesNotMatch(screen, /createVideoPlayer\(null\)/);
  assert.match(screen, /contentType: 'hls'/);
  assert.match(screen, /player: liveStreamPlayer/);
  assert.match(screen, /sharedPlayerMode: true/);
  assert.match(screen, /playerStreamSource/);
  const probe = await read('src/features/live/liveTimeshiftDiagnostics.ts');
  assert.match(probe, /playerMode: 'single-hls'/);
  assert.match(probe, /status !== 'error'/);
  assert.match(probe, /stopped/);
  assert.doesNotMatch(probe, /replaceAsync/);
});

test('catalog priority enters tuning protection and resumes throttled Live idle mode', async () => {
  const source = await read('src/features/catalog/catalogForegroundPriority.ts');
  assert.match(source, /LIVE_CATALOG_TUNING_COOLDOWN_MS = 1_200/);
  assert.match(source, /markLiveCatalogInteraction/);
  assert.match(source, /state: 'live-tuning'/);
  assert.match(source, /state: 'live-idle'/);
  assert.match(source, /pauseMs: 250, reason: 'live-tuning'/);
  assert.match(source, /catalogUiSurface === 'live' \? 96 : 48/);
});

test('catalog hard gate blocks background permission until Live is left', async () => {
  const priority = await import('../src/features/catalog/catalogForegroundPriority.ts');
  priority.resetCatalogForegroundPriorityForTests();
  priority.setCatalogUiSurface('live');
  assert.equal(priority.isCatalogLiveGateActive(), true);
  const release = setTimeout(() => priority.setCatalogUiSurface('other'), 20);
  await priority.waitForCatalogLiveGate();
  clearTimeout(release);
  assert.equal(priority.isCatalogLiveGateActive(), false);
  priority.resetCatalogForegroundPriorityForTests();
});

test('Live tuning is wired at channel tune and fullscreen surf boundaries', async () => {
  const screen = await read('src/features/live/LiveTvScreen.tsx');
  assert.match(screen, /markLiveCatalogInteraction\('channel-tune'\)/);
  assert.match(screen, /markLiveCatalogInteraction\('fullscreen-surf'\)/);
});

test('diagnostics ingest accepts the structured capability event', async () => {
  const ingest = await read('supabase/functions/diagnostics-ingest/index.ts');
  assert.match(ingest, /'live_timeshift_capability'/);
});
