import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAX_SERIES_COMPLETENESS_CANDIDATES,
  compareSeriesCompleteness,
  classifySeriesCompleteness,
  dedupeAndBoundSeriesCandidates,
  isCandidateYearCompatible,
  probeSeriesCandidates,
  readSeriesWinnerCache,
  scoreSeriesDetail,
  selectSeriesCompletenessWinner,
  writeSeriesWinnerCache,
} from '../src/features/series/seriesCompletenessRescue.ts';

const detail = (seasons) => ({
  seriesId: 'x', title: 'Example', genres: [], seasons,
  episodesBySeason: Object.fromEntries(seasons.map((season) => [season.seasonNumber, Array.from({ length: season.episodes }, (_, i) => ({
    id: `${season.seasonNumber}-${i}`, seriesId: 'x', title: `Episode ${i + 1}`,
    seasonNumber: season.seasonNumber, episodeNumber: String(i + 1), streamId: `${season.seasonNumber}-${i}`, extension: 'ts',
    airDate: season.date,
  }))])),
});

test('completeness ignores specials and metadata-only seasons', () => {
  const score = scoreSeriesDetail(detail([
    { seasonNumber: '0', episodes: 20 }, { seasonNumber: '1', episodes: 3 }, { seasonNumber: '2', episodes: 0 },
  ]));
  assert.deepEqual(score, { playableSeasonCount: 1, highestSeasonNumber: 1, totalEpisodeCount: 3, latestEpisodeDate: undefined });
});

test('winner ranking prefers seasons, episodes, date, then original id', () => {
  const one = detail([{ seasonNumber: '1', episodes: 3, date: '2024-01-01' }]);
  const two = detail([{ seasonNumber: '1', episodes: 3, date: '2024-01-02' }, { seasonNumber: '2', episodes: 1 }]);
  assert.equal(selectSeriesCompletenessWinner([{ providerSeriesId: '1001', detail: one }, { providerSeriesId: '2488', detail: two }], '1001').providerSeriesId, '2488');
  assert.equal(selectSeriesCompletenessWinner([{ providerSeriesId: '1001', detail: one }, { providerSeriesId: '2488', detail: detail([{ seasonNumber: '1', episodes: 3, date: '2024-01-01' }]) }], '1001').providerSeriesId, '1001');
  assert.equal(compareSeriesCompleteness(scoreSeriesDetail(two), scoreSeriesDetail(one)) > 0, true);
});

test('episode count breaks an otherwise equal season tie', () => {
  const fewer = detail([{ seasonNumber: '1', episodes: 2 }]);
  const more = detail([{ seasonNumber: '1', episodes: 3 }]);
  assert.equal(selectSeriesCompletenessWinner([
    { providerSeriesId: 'fewer', detail: fewer }, { providerSeriesId: 'more', detail: more },
  ], 'fewer').providerSeriesId, 'more');
});

test('latest episode date breaks an otherwise equal completeness tie', () => {
  const older = detail([{ seasonNumber: '1', episodes: 1, date: '2024-01-01' }]);
  const newer = detail([{ seasonNumber: '1', episodes: 1, date: '2024-02-01' }]);
  assert.equal(selectSeriesCompletenessWinner([
    { providerSeriesId: 'older', detail: older }, { providerSeriesId: 'newer', detail: newer },
  ], 'older').providerSeriesId, 'newer');
});

test('candidate ids are deduped and bounded', () => {
  const candidates = Array.from({ length: 8 }, (_, i) => ({ providerSeriesId: String(i), title: 'Example' }));
  const result = dedupeAndBoundSeriesCandidates([...candidates, candidates[1]], '0');
  assert.equal(result.length, MAX_SERIES_COMPLETENESS_CANDIDATES);
  assert.equal(result.some((candidate) => candidate.providerSeriesId === '0'), false);
});

test('candidate probes run at bounded concurrency', async () => {
  let active = 0; let maximum = 0;
  await probeSeriesCandidates(Array.from({ length: 4 }, (_, i) => ({ providerSeriesId: String(i), title: 'Example' })), async (candidate) => {
    active += 1; maximum = Math.max(maximum, active);
    await new Promise((resolve) => setTimeout(resolve, 2));
    active -= 1;
    return candidate;
  });
  assert.equal(maximum, 2);
});

test('a unique candidate set performs no alternate probes', async () => {
  let calls = 0;
  await probeSeriesCandidates([], async () => { calls += 1; return null; });
  assert.equal(calls, 0);
});

test('failed alternate probes do not discard the selected playable detail', async () => {
  const selected = detail([{ seasonNumber: '1', episodes: 2 }]);
  const results = await probeSeriesCandidates([{ providerSeriesId: 'bad', title: 'Example' }], async () => {
    throw new Error('provider failure');
  });
  assert.deepEqual(results, []);
  assert.equal(selectSeriesCompletenessWinner([{ providerSeriesId: 'selected', detail: selected }], 'selected').providerSeriesId, 'selected');
});

test('cache is reused only for its catalog generation', () => {
  const cache = new Map();
  writeSeriesWinnerCache(cache, 'provider:show', { generation: 7, winnerProviderSeriesId: '2488' });
  assert.equal(readSeriesWinnerCache(cache, 'provider:show', 7)?.winnerProviderSeriesId, '2488');
  assert.equal(readSeriesWinnerCache(cache, 'provider:show', 8), undefined);
});

test('episode stream identity is preserved by the winning detail', () => {
  const winning = detail([{ seasonNumber: '2', episodes: 1 }]);
  winning.episodesBySeason['2'][0].streamId = 'provider-stream-2488';
  const winner = selectSeriesCompletenessWinner([{ providerSeriesId: '2488', detail: winning }], '1001');
  assert.equal(winner.detail.episodesBySeason['2'][0].streamId, 'provider-stream-2488');
});

test('all incomplete candidates still return the best provider detail', () => {
  const selected = detail([{ seasonNumber: '1', episodes: 1 }]);
  const metadataOnly = detail([{ seasonNumber: '2', episodes: 0 }]);
  const winner = selectSeriesCompletenessWinner([
    { providerSeriesId: '1001', detail: selected },
    { providerSeriesId: '2488', detail: metadataOnly },
  ], '1001');
  assert.equal(winner.providerSeriesId, '1001');
});

test('year compatibility prevents remakes from grouping', () => {
  assert.equal(isCandidateYearCompatible(2020, 2021), true);
  assert.equal(isCandidateYearCompatible(2020, 2022), false);
  assert.equal(isCandidateYearCompatible(undefined, 2022), true);
});

test('cached winner failure re-evaluates remaining canonical candidates', async () => {
  const selected = detail([{ seasonNumber: '1', episodes: 1 }]);
  const replacement = detail([{ seasonNumber: '1', episodes: 1 }, { seasonNumber: '2', episodes: 1 }]);
  const cache = new Map([['provider:selected', { generation: 3, winnerProviderSeriesId: 'stale-winner' }]]);
  const cached = await probeSeriesCandidates([{ providerSeriesId: 'stale-winner', title: 'Example' }], async () => null);
  assert.deepEqual(cached, []);
  cache.delete('provider:selected');
  const reEvaluated = await probeSeriesCandidates([{ providerSeriesId: 'valid-duplicate', title: 'Example' }], async () => ({ providerSeriesId: 'valid-duplicate', detail: replacement }));
  const winner = selectSeriesCompletenessWinner([{ providerSeriesId: 'selected', detail: selected }, ...reEvaluated], 'selected');
  assert.equal(winner.providerSeriesId, 'valid-duplicate');
  assert.equal(readSeriesWinnerCache(cache, 'provider:selected', 3), undefined);
});

test('missing TMDB expectation leaves provider completeness unchanged', () => {
  const score = scoreSeriesDetail(detail([{ seasonNumber: '1', episodes: 2 }]));
  assert.equal(classifySeriesCompleteness(score), 'selected_complete');
});

test('larger optional TMDB expectation reports suspicion without creating data', () => {
  const provider = detail([{ seasonNumber: '1', episodes: 2 }]);
  const score = scoreSeriesDetail(provider);
  assert.equal(classifySeriesCompleteness(score, 2), 'provider_missing_newer_season');
  assert.deepEqual(provider.seasons.map((season) => season.seasonNumber), ['1']);
  assert.deepEqual(Object.keys(provider.episodesBySeason), ['1']);
});
