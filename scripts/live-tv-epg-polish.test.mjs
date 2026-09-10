import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('Live TV display text and channel number presentation are bounded', () => {
  const text = read('src/features/live/liveTvProgramText.ts');
  const row = read('src/features/live/LiveTvChannelRow.tsx');
  assert.match(text, /decodeDisplayTextEntities/);
  assert.match(row, /Loading program…/);
  assert.match(row, /numberOfLines=\{1\}/);
  assert.match(row, /width: 42/);
  assert.match(row, /fontVariant: \['tabular-nums'\]/);
  assert.match(row, /Number\.isFinite\(data\.number\)/);
});

test('category EPG warmup uses bounded batches and one merge callback', () => {
  const epg = read('src/features/live/liveTvChannelEpg.ts');
  const model = read('src/features/live/useLiveTvScreenModel.ts');
  assert.match(epg, /fetchManagedEpgBatch/);
  assert.match(epg, /slice\(0, 12\)/);
  assert.match(epg, /offset \+= 32/);
  assert.match(epg, /onBatchEnriched/);
  assert.match(model, /applyEpgBatch/);
  assert.match(model, /setChannels\(\(current\) =>/);
  assert.doesNotMatch(model, /onChannelEnriched: \(enriched\) =>/);
  assert.match(epg, /inFlight\.set\(channelId, request\)/);
  assert.match(model, /1_500/);
  assert.match(epg, /generation !== epgGeneration/);
});

test('EPG warmup cannot gate playback and temporary release audits are absent', () => {
  const model = read('src/features/live/useLiveTvScreenModel.ts');
  const client = read('src/features/guide/managedEpgClient.ts');
  const live = read('src/features/live/liveTvChannelEpg.ts');
  assert.doesNotMatch(model, /await[^\n]*resolvePlayback/);
  assert.doesNotMatch(client, /NovaCast Managed EPG Release Audit/);
  assert.doesNotMatch(live, /NovaCast Live EPG Classification Audit/);
});

test('device EPG batch remains custom-device-authenticated and configured without JWT', () => {
  const edge = read('supabase/functions/device-epg/index.ts');
  const config = read('supabase/config.toml');
  assert.match(edge, /authenticateDevice\(request, client\)/);
  assert.match(edge, /requestedIds\.length > 32/);
  assert.match(config, /\[functions\.device-epg\]\s+verify_jwt = false/);
});
