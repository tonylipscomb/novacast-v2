import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';

const card = fs.readFileSync(new URL('../src/features/novapulse/NovaPulseCard.tsx', import.meta.url), 'utf8');
const liveEpg = fs.readFileSync(new URL('../src/features/novapulse/novaPulseLiveEpg.ts', import.meta.url), 'utf8');
const provider = fs.readFileSync(new URL('../src/features/providers/providerRepositories.ts', import.meta.url), 'utf8');
const xtream = fs.readFileSync(new URL('../src/features/providers/xtreamClient.ts', import.meta.url), 'utf8');

test('B1.5 live channel-logo cards select contained logo mode', () => {
  assert.match(liveEpg, /artworkKind: candidate\.channel\.logoUrl \? 'channel_logo' : 'fallback'/);
  assert.match(card, /liveLogoMode = liveEpg && item\.artworkKind === 'channel_logo'/);
  assert.match(card, /liveLogoArtworkFrame/);
  assert.match(card, /resizeMode=\{artworkFit === 'contain' \? 'contain' : 'cover'\}/);
});

test('B1.5 suppresses strip overlays only in live logo mode', () => {
  assert.match(card, /!liveLogoMode \? <><View pointerEvents="none" style=\{styles\.mediaBlendOne\}/);
  assert.match(card, /!liveLogoMode \? <View style=\{styles\.scrim\}/);
  assert.match(card, /mediaBlendOne:.*width: '18%'/s);
  assert.match(card, /scrim:.*width: '64%'/s);
});

test('B1.5 keeps program artwork unsupported and uses existing channel logo fields only', () => {
  assert.match(provider, /logoUrl\?: string/);
  assert.match(xtream, /epg_channel_id\?: string/);
  assert.doesNotMatch(provider, /programArtwork|epg.*(poster|thumbnail|backdrop)/i);
  assert.doesNotMatch(liveEpg, /fetch|TMDB|search.*image/i);
});

test('B1.5 preserves direct-tune identity and stable live card IDs', () => {
  assert.match(liveEpg, /sourceId: 'live-epg'/);
  assert.match(liveEpg, /action: \{ type: 'channel', target: '\/live', contentId: candidate\.channel\.id \}/);
  assert.match(liveEpg, /id: `live-epg:\$\{input\.providerId\}:\$\{candidate\.channel\.id/);
});
