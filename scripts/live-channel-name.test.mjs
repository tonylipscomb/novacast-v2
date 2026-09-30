import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const repositories = fs.readFileSync('src/features/providers/providerRepositories.ts', 'utf8');
const rowData = fs.readFileSync('src/features/live/liveTvChannelRowData.ts', 'utf8');
const detail = fs.readFileSync('src/features/live/LiveTvProgramDetailPanel.tsx', 'utf8');
const screen = fs.readFileSync('src/features/live/LiveTvScreen.tsx', 'utf8');
const normalization = fs.readFileSync('src/features/series/metadata/titleNormalization.ts', 'utf8');

const { displayLiveChannelName } = await import('../src/features/live/liveTvProgramText.ts');
const { toLiveTvChannelRowShell } = await import('../src/features/live/liveTvChannelRowData.ts');
const { hydrateFavoriteLiveChannels } = await import('../src/features/live/liveFavoriteHydration.ts');

function channel(id, name) {
  return {
    id,
    categoryId: 'sports',
    number: 6,
    name,
    shortName: 'TV',
    current: '',
    next: '',
    following: '',
    description: '',
    resolution: 'HD',
    audio: 'Stereo',
    remaining: 'Live',
    progress: 0,
    tone: '#173B67',
    currentStart: 'Now',
    currentEnd: 'Later',
  };
}

test('Live labels preserve uppercase, numeric, and colon-formatted provider names', () => {
  for (const name of ['NCAAF 06: FOX', 'NBA 01: ESPN', 'NFL 04: CBS', 'US 24/7: ACTION', 'ABC 07: WJLA', 'CNN']) {
    assert.equal(displayLiveChannelName(name), name);
    assert.equal(toLiveTvChannelRowShell(channel(name, name)).name, name);
  }
});

test('Live row and preview use the preserved channel name without media-title cleanup', () => {
  assert.match(repositories, /const name = rawName;/);
  assert.doesNotMatch(repositories, /const name = stripProviderStreamTitlePrefix\(rawName\)/);
  assert.match(rowData, /displayLiveChannelName\(channel\.name\)/);
  assert.doesNotMatch(rowData, /displayStreamTitle/);
  assert.match(detail, /displayLiveChannelName\(channel\?\.name\)/);
  assert.doesNotMatch(detail, /displayStreamTitle/);
  assert.match(screen, /displayLiveChannelName\(fullscreenChannel\.name\)/);
  assert.doesNotMatch(screen, /displayStreamTitle/);
});

test('Movie and Series title cleanup remains available through the shared media helper', () => {
  assert.match(normalization, /export function displayStreamTitle/);
  assert.match(normalization, /stripProviderStreamTitlePrefix/);
});

test('Favorite hydration prefers the current catalog label over a legacy shortened title', () => {
  const hydrated = hydrateFavoriteLiveChannels({
    favoriteIds: ['fox'],
    loadedChannels: [channel('fox', 'NCAAF 06: FOX')],
    favoriteRecords: [{ providerId: 'p', mediaType: 'live', contentId: 'fox', title: 'FOX' }],
  });
  assert.equal(hydrated.channels[0]?.name, 'NCAAF 06: FOX');
});
