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
  assert.match(row, /showEpgLoading = epgPending && !hasProgram/);
  assert.match(row, /width: 64/);
  assert.match(row, /ellipsizeMode="clip"/);
  assert.match(row, /data\.number > 0/);
  assert.match(row, /fontVariant: \['tabular-nums'\]/);
  assert.match(row, /Number\.isFinite\(data\.number\)/);
});

test('loaded EPG wins over a pending refresh and favorites use static row chrome', () => {
  const row = read('src/features/live/LiveTvChannelRow.tsx');
  assert.match(row, /const hasProgram = displayCurrent !== LIVE_TV_NO_PROGRAM_LABEL;/);
  assert.match(row, /isFavorite && styles\.favoriteRow/);
  assert.match(row, /favoriteRow: \{/);
  assert.doesNotMatch(row, /showResolution \? <Text style=\{styles\.resolution\}/);
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

test('Live presentation keeps category rows text-only and marquee behavior focus-scoped', () => {
  const category = read('src/features/live/LiveTvCategoryRow.tsx');
  const channel = read('src/features/live/LiveTvChannelRow.tsx');
  const detail = read('src/features/live/LiveTvProgramDetailPanel.tsx');
  const marquee = read('src/features/live/LiveTvMarqueeText.tsx');
  assert.doesNotMatch(category, /ProviderCategoryMarker|showMarker|markerSlot/);
  assert.match(channel, /<LiveTvMarqueeText focused=\{isFocused\}/);
  assert.match(channel, /focused=\{isFocused && hasProgram\}/);
  assert.match(detail, /<LiveTvMarqueeText focused/);
  assert.match(marquee, /if \(!focused \|\| distance <= 0\)/);
  assert.match(marquee, /useNativeDriver: true/);
});

test('device EPG batch remains custom-device-authenticated and configured without JWT', () => {
  const edge = read('supabase/functions/device-epg/index.ts');
  const config = read('supabase/config.toml');
  assert.match(edge, /authenticateDevice\(request, client\)/);
  assert.match(edge, /requestedIds\.length > 32/);
  assert.match(config, /\[functions\.device-epg\]\s+verify_jwt = false/);
});
