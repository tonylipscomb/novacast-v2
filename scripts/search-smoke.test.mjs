import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SEARCH_MIN_QUERY_LENGTH,
  resolveSearchNotificationForStatus,
  resolveSearchStatusAfterResults,
  searchHitKey,
  searchHitKindLabel,
  shouldApplySearchResult,
} from '../src/features/search/searchScreenLogic.ts';
import {
  getSearchScreenMemory,
  rememberSearchScreenMemory,
  resetSearchScreenMemory,
} from '../src/features/search/searchScreenMemory.ts';
import {
  collectVisibleSearchResultKeys,
  isSearchFocusKeyVisible,
} from '../src/features/search/searchFocusLogic.ts';
import {
  isSearchableQuery,
  normalizeSearchQuery,
  tokenizeSearchQuery,
} from '../src/features/search/searchQuery.ts';
import {
  compareSearchCandidates,
  computeSearchMatchTier,
  matchesSearchQuery,
} from '../src/features/search/searchRanking.ts';
import {
  addSearchHistoryEntry,
  clearSearchHistory,
  resetSearchHistoryForTests,
} from '../src/features/search/searchHistoryStore.ts';
import { searchLiveChannelIndex, ingestLiveChannels, resetLiveChannelIndex } from '../src/features/search/liveChannelIndex.ts';
import { GLOBAL_PREVIEW_LIMIT, SEARCH_DEBOUNCE_MS, SEARCH_PAGE_SIZE } from '../src/features/search/searchConstants.ts';

test('Search notifications only surface recoverable errors', () => {
  assert.equal(resolveSearchNotificationForStatus('idle', false), null);
  assert.equal(resolveSearchNotificationForStatus('ready', false), null);
  assert.equal(resolveSearchNotificationForStatus('empty', false), null);
  assert.equal(resolveSearchNotificationForStatus('loading', false), null);

  const error = resolveSearchNotificationForStatus('error', false);
  assert.equal(error?.title, 'Search unavailable');
  assert.match(error?.message ?? '', /could not search/i);
  assert.equal(resolveSearchNotificationForStatus('error', true)?.persistent, true);
});

test('Search helpers format result metadata consistently', () => {
  assert.equal(SEARCH_MIN_QUERY_LENGTH, 2);
  assert.equal(searchHitKindLabel('movie'), 'Movie');
  assert.equal(searchHitKindLabel('series'), 'Series');
  assert.equal(searchHitKindLabel('live'), 'Live TV');
  assert.equal(searchHitKey({ kind: 'movie', id: '42', title: 'Action Movie' }), 'movie:42');
});

test('normalizeSearchQuery trims, collapses spaces, and lowercases safely', () => {
  assert.equal(normalizeSearchQuery('  Action   Movie  '), 'action movie');
  assert.equal(normalizeSearchQuery("O'Brien"), 'obrien');
  assert.equal(normalizeSearchQuery('Sci-Fi'), 'sci fi');
  assert.equal(normalizeSearchQuery('6'), '6');
  assert.equal(normalizeSearchQuery('HD'), 'hd');
});

test('isSearchableQuery allows short numeric and channel tokens', () => {
  assert.equal(isSearchableQuery(''), false);
  assert.equal(isSearchableQuery('   '), false);
  assert.equal(isSearchableQuery('6'), true);
  assert.equal(isSearchableQuery('HD'), true);
  assert.equal(isSearchableQuery('BET'), true);
  assert.equal(isSearchableQuery('a'), false);
});

test('ranking prefers exact and prefix matches with stable tie-breaking', () => {
  assert.equal(computeSearchMatchTier('action', { title: 'Action' }), 'exact');
  assert.equal(computeSearchMatchTier('act', { title: 'Action Movie' }), 'prefix');
  assert.equal(computeSearchMatchTier('movie', { title: 'Action Movie' }), 'word-prefix');
  assert.equal(computeSearchMatchTier('romance', { title: 'Action Movie', metadata: 'romance thriller' }), 'metadata');

  const ranked = [
    { title: 'Beta Show', metadata: 'drama' },
    { title: 'Alpha Show', metadata: 'drama' },
    { title: 'Alpha Show', metadata: 'drama' },
  ].sort((left, right) => compareSearchCandidates('alpha', left, right));

  assert.equal(ranked[0]?.title, 'Alpha Show');
  assert.equal(ranked[1]?.title, 'Alpha Show');
  assert.equal(ranked[2]?.title, 'Beta Show');
});

test('search history deduplicates and caps entries', async () => {
  resetSearchHistoryForTests();
  await addSearchHistoryEntry('Action');
  await addSearchHistoryEntry('Drama');
  const deduped = await addSearchHistoryEntry('Action');

  assert.equal(deduped[0]?.query, 'action');
  assert.equal(deduped.filter((entry) => entry.query === 'action').length, 1);
  assert.ok(deduped.length >= 2);
  resetSearchHistoryForTests();
});

test('live channel index search matches names and numbers without loading react state', () => {
  resetLiveChannelIndex('provider-a');
  ingestLiveChannels('provider-a', [
    {
      id: '1',
      categoryId: 'news',
      number: 6,
      name: 'HD News',
      shortName: 'HD',
      current: 'Morning Report',
      next: '',
      following: '',
      description: '',
      resolution: '',
      audio: '',
      remaining: '',
      progress: 0,
      tone: '#000',
      currentStart: '',
      currentEnd: '',
    },
  ]);

  const byNumber = searchLiveChannelIndex('provider-a', '6', 0, 10);
  assert.equal(byNumber.items.length, 1);
  assert.equal(byNumber.items[0]?.title, 'HD News');

  const byName = searchLiveChannelIndex('provider-a', 'hd', 0, 10);
  assert.ok(matchesSearchQuery('hd', { title: 'HD News' }));
  assert.equal(byName.items.length, 1);
  resetLiveChannelIndex('provider-a');
});

test('search constants define bounded preview and page sizes', () => {
  assert.equal(GLOBAL_PREVIEW_LIMIT, 12);
  assert.equal(SEARCH_PAGE_SIZE, 50);
});

test('tokenizeSearchQuery splits normalized words', () => {
  assert.deepEqual(tokenizeSearchQuery('  Sci   Fi  '), ['sci', 'fi']);
});

test('shouldApplySearchResult rejects stale or aborted searches', () => {
  assert.equal(shouldApplySearchResult(2, 2, false), true);
  assert.equal(shouldApplySearchResult(2, 3, false), false);
  assert.equal(shouldApplySearchResult(2, 2, true), false);
});

test('resolveSearchStatusAfterResults maps counts to ready or empty', () => {
  assert.equal(resolveSearchStatusAfterResults(0), 'empty');
  assert.equal(resolveSearchStatusAfterResults(1), 'ready');
});

test('resolveScopedSeedFromGrouped reuses All-tab preview when switching scope', async () => {
  const { resolveScopedSeedFromGrouped } = await import('../src/features/search/searchScreenLogic.ts');
  const grouped = {
    live: { items: [], totalCount: 0, hasMore: false },
    movie: {
      items: [{ type: 'movie', id: '1', providerId: 'p', title: 'Scary Movie' }],
      totalCount: 1,
      hasMore: true,
    },
    series: { items: [], totalCount: 0, hasMore: false },
    guide: { items: [], totalCount: 0, hasMore: false },
  };

  assert.equal(resolveScopedSeedFromGrouped(grouped, 'movie')?.items[0]?.title, 'Scary Movie');
  assert.equal(resolveScopedSeedFromGrouped(grouped, 'live'), null);
  assert.equal(resolveScopedSeedFromGrouped(grouped, 'all'), null);
});

test('search screen memory persists query, scope, and focus per provider', () => {
  resetSearchScreenMemory();
  rememberSearchScreenMemory('provider-a', { query: 'action', scope: 'movie', focusedResultKey: 'movie:42' });
  const memory = getSearchScreenMemory('provider-a');
  assert.equal(memory.query, 'action');
  assert.equal(memory.scope, 'movie');
  assert.equal(memory.focusedResultKey, 'movie:42');
  resetSearchScreenMemory('provider-a');
});

test('search debounce constant stays within responsive TV bounds', () => {
  assert.equal(SEARCH_DEBOUNCE_MS, 300);
  assert.ok(SEARCH_DEBOUNCE_MS >= 200);
  assert.ok(SEARCH_DEBOUNCE_MS <= 500);
});

test('search focus keys drop stale targets after result updates', () => {
  const grouped = {
    live: { items: [{ type: 'live', id: '1', title: 'News' }], totalCount: 1, hasMore: false },
    movie: { items: [], totalCount: 0, hasMore: false },
    series: { items: [], totalCount: 0, hasMore: false },
    guide: { items: [], totalCount: 0, hasMore: false },
  };
  const keys = collectVisibleSearchResultKeys('all', [], grouped);
  assert.equal(isSearchFocusKeyVisible('live:1', keys), true);
  assert.equal(isSearchFocusKeyVisible('movie:99', keys), false);
});

test('search media detail maps movie and series hits into browse summaries', async () => {
  const { movieSearchResultToSummary, seriesSearchResultToSummary } = await import('../src/features/search/searchMediaDetail.ts');

  const movie = movieSearchResultToSummary({
    type: 'movie',
    id: 'movie-1',
    providerId: 'provider-a',
    title: 'Scary Movie',
    year: 2000,
    genres: ['Comedy'],
  });
  assert.equal(movie.id, 'movie-1');
  assert.equal(movie.title, 'Scary Movie');

  const series = seriesSearchResultToSummary({
    type: 'series',
    id: 'series-1',
    providerId: 'provider-a',
    title: 'Family Tales',
    seriesId: 'series-root-1',
  });
  assert.equal(series.seriesId, 'series-root-1');
});
