import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildTitleAliases,
  countryCodeToFlagEmoji,
  extractYearFromTitle,
  fuzzyTitleScore,
  isRecognizedCountryCode,
  normalizeProviderTitle,
  parseProviderCategoryLabel,
  parseProviderTitlePrefix,
  stripProviderStreamTitlePrefix,
} from '../src/features/series/metadata/titleNormalization.ts';
import {
  clearSeriesMetadataCacheForTests,
  getSeriesMetadataCacheEntry,
  markSeriesMetadataFailed,
  markSeriesMetadataMatched,
} from '../src/features/series/metadata/seriesMetadataCache.ts';
import { matchSeriesMetadata } from '../src/features/series/metadata/seriesMetadataMatcher.ts';
import {
  clearMediaLibraryCacheForTests,
  recordEpisodeProgress,
  updateContinueWatching,
  getContinueWatchingEntries,
} from '../src/features/media-browser/mediaLibraryStore.ts';
import {
  buildProgressKey,
  getResumePositionMs,
  savePlaybackProgress,
} from '../src/features/playback/unified/playbackProgressStore.ts';
import { createProviderSeriesDataSource } from '../src/features/series/data/ProviderSeriesDataSource.ts';
import { createSmartSeriesDataSource } from '../src/features/series/smart/SmartSeriesDataSource.ts';
import { resetSeriesCatalogIndex } from '../src/features/series/smart/seriesCatalogIndex.ts';
import { clearMoviesSettingsCacheForTests, setHideSmartCategories } from '../src/features/movies/smart/moviesSettingsStore.ts';
import { createMockProviderRepositories } from '../src/features/providers/providerRepositories.ts';
import {
  buildSeriesEpisodePlaybackItem,
  launchSeriesEpisodePlayback,
} from '../src/features/series/seriesPlayback.ts';
import {
  resolveSeriesDetailNotification,
  resolveSeriesNotificationForStatus,
} from '../src/features/series/seriesScreenLogic.ts';

test('title normalization strips provider noise and extracts year', () => {
  assert.equal(normalizeProviderTitle('Breaking Bad [EN] (2008) 4K'), 'Breaking Bad');
  assert.equal(extractYearFromTitle('Breaking Bad (2008)'), 2008);
  assert.equal(buildTitleAliases('The Office (US)').includes('The Office'), true);
  assert.ok(fuzzyTitleScore('Breaking Bad', 'Breaking Bad 2008') >= 0.85);
});

test('stripProviderStreamTitlePrefix removes provider channel prefixes', () => {
  assert.equal(stripProviderStreamTitlePrefix('nl | UFC 329: Toy Story'), 'Toy Story');
  assert.equal(stripProviderStreamTitlePrefix('en | Action Movies'), 'Action Movies');
  assert.equal(stripProviderStreamTitlePrefix('US | HBO Max'), 'HBO Max');
  assert.equal(stripProviderStreamTitlePrefix('| Help for the Holidays'), 'Help for the Holidays');
  assert.equal(stripProviderStreamTitlePrefix('Multi | EN | Inception'), 'Inception');
  assert.equal(stripProviderStreamTitlePrefix('CA | AF | Documentary'), 'Documentary');
  assert.equal(stripProviderStreamTitlePrefix('20 | RELAXTIME ICELAND UHD'), 'RELAXTIME ICELAND UHD');
  assert.equal(stripProviderStreamTitlePrefix('| WORLD CUP 2026'), 'WORLD CUP 2026');
  assert.equal(stripProviderStreamTitlePrefix('MULTI | VIAPLAY'), 'VIAPLAY');
  assert.equal(stripProviderStreamTitlePrefix('MULTI ▎ Operation Nation'), 'Operation Nation');
  assert.equal(stripProviderStreamTitlePrefix('▎ Operation Nation'), 'Operation Nation');
  assert.equal(stripProviderStreamTitlePrefix('MULTI ▎ EN ▎ Inception'), 'Inception');
  assert.equal(stripProviderStreamTitlePrefix('SPORTS | REPLAY'), 'REPLAY');
  assert.equal(stripProviderStreamTitlePrefix('Inception (2010)'), 'Inception (2010)');
  assert.equal(stripProviderStreamTitlePrefix('Batman: The Dark Knight (2008)'), 'Batman: The Dark Knight (2008)');
});

test('parseProviderTitlePrefix extracts country codes for provider categories', () => {
  assert.equal(parseProviderTitlePrefix('US | Entertainment').countryCode, 'US');
  assert.equal(parseProviderTitlePrefix('US | Entertainment').title, 'Entertainment');
  assert.deepEqual(parseProviderTitlePrefix('UK | Sports'), {
    countryCode: 'GB',
    title: 'Sports',
  });
  assert.deepEqual(parseProviderTitlePrefix('NL | Live Events'), {
    countryCode: 'NL',
    title: 'Live Events',
  });
  assert.deepEqual(parseProviderTitlePrefix('en | Action Movies'), {
    countryCode: undefined,
    title: 'Action Movies',
  });
});

test('parseProviderCategoryLabel strips prefix and keeps recognized country codes', () => {
  const category = parseProviderCategoryLabel('CA | Documentary');
  assert.equal(category.title, 'Documentary');
  assert.equal(category.countryCode, 'CA');
});

test('countryCodeToFlagEmoji renders regional indicator flags', () => {
  assert.equal(countryCodeToFlagEmoji('US'), '🇺🇸');
  assert.equal(countryCodeToFlagEmoji('UK'), '🇬🇧');
  assert.equal(countryCodeToFlagEmoji('NL'), '🇳🇱');
  assert.equal(countryCodeToFlagEmoji('en'), '');
});

test('isRecognizedCountryCode ignores language-only prefixes', () => {
  assert.equal(isRecognizedCountryCode('US'), true);
  assert.equal(isRecognizedCountryCode('EN'), false);
});

test('series metadata cache stores matched and failed lookups', async () => {
  clearSeriesMetadataCacheForTests();

  await markSeriesMetadataMatched({
    providerId: 'demo',
    seriesId: '101',
    providerTitle: 'Test Show',
    normalizedTitle: 'Test Show',
    tmdbId: 42,
    metadata: {
      tmdbId: 42,
      title: 'Test Show',
      genres: ['Drama'],
    },
  });

  const matched = await getSeriesMetadataCacheEntry('demo', '101');
  assert.equal(matched?.status, 'matched');
  assert.equal(matched?.tmdbId, 42);

  await markSeriesMetadataFailed({
    providerId: 'demo',
    seriesId: '102',
    providerTitle: 'Missing Show',
    normalizedTitle: 'Missing Show',
    failureReason: 'No match',
  });

  const failed = await getSeriesMetadataCacheEntry('demo', '102');
  assert.equal(failed?.status, 'failed');
  assert.equal(failed?.failureReason, 'No match');
});

test('metadata matcher returns cached entries without network', async () => {
  clearSeriesMetadataCacheForTests();

  await markSeriesMetadataMatched({
    providerId: 'demo',
    seriesId: '55',
    providerTitle: 'Cached Series',
    normalizedTitle: 'Cached Series',
    tmdbId: 55,
    metadata: {
      tmdbId: 55,
      title: 'Cached Series',
      genres: ['Comedy'],
    },
  });

  const result = await matchSeriesMetadata({
    providerId: 'demo',
    seriesId: '55',
    providerTitle: 'Cached Series [HD]',
  });

  assert.equal(result.status, 'cached');
  assert.equal(result.metadata?.title, 'Cached Series');
});

test('media library store tracks episode continue watching', async () => {
  clearMediaLibraryCacheForTests();

  await recordEpisodeProgress({
    providerId: 'demo',
    seriesId: 'show-1',
    seasonNumber: '1',
    episodeNumber: '3',
    episodeId: 'ep-3',
    title: 'Episode 3',
    positionMs: 120_000,
    durationMs: 3_600_000,
  });

  const entries = await getContinueWatchingEntries('demo', 'episode');
  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.seriesId, 'show-1');
  assert.equal(entries[0]?.episodeNumber, '3');

  await updateContinueWatching('demo', {
    mediaKind: 'episode',
    mediaId: 'show-1:1:3',
    seriesId: 'show-1',
    seasonNumber: '1',
    episodeNumber: '3',
    episodeId: 'ep-3',
    title: 'Episode 3',
    positionMs: 3_300_000,
    durationMs: 3_600_000,
  });

  const cleared = await getContinueWatchingEntries('demo', 'episode');
  assert.equal(cleared.length, 0);
});

test('series episode playback uses the unified player payload and provider-scoped progress keys', async () => {
  clearMediaLibraryCacheForTests();

  const bundle = {
    streamUrlBuilder: {
      buildSeriesStreamUrl: (streamId, extension) => `https://cdn.test/series/${streamId}.${extension}`,
    },
  };

  const episode = {
    id: 'ep-10',
    seriesId: 'series-7',
    title: 'Episode 10',
    seasonNumber: '2',
    episodeNumber: '10',
    streamId: '901',
    extension: 'ts',
  };

  const item = buildSeriesEpisodePlaybackItem({
    bundle: /** @type {any} */ (bundle),
    providerId: 'provider-series',
    episode,
    seriesTitle: 'Demo Show',
    resumePositionMs: 45_000,
  });

  assert.ok(item);
  assert.equal(item?.mediaType, 'episode');
  assert.equal(item?.providerId, 'provider-series');
  assert.equal(item?.id, 'ep-10');
  assert.equal(item?.episodeId, 'ep-10');
  assert.equal(item?.seriesId, 'series-7');
  assert.equal(item?.seasonNumber, '2');
  assert.equal(item?.episodeNumber, '10');
  assert.equal(item?.title, 'Episode 10');
  assert.equal(item?.subtitle, 'Demo Show - Season 2');
  assert.equal(item?.streamUrl, 'https://cdn.test/series/901.ts');
  assert.equal(item?.resumePositionMs, 45_000);

  let launchItem = null;
  let launchOptions = null;
  const launched = await launchSeriesEpisodePlayback({
    bundle: /** @type {any} */ (bundle),
    providerId: 'provider-series',
    episode,
    seriesTitle: 'Demo Show',
    launchSource: 'episode',
    launchPlayback: async (nextItem, options) => {
      launchItem = nextItem;
      launchOptions = options;
    },
  });

  assert.equal(launched, true);
  assert.equal(launchItem?.mediaType, 'episode');
  assert.equal(launchOptions?.launchSource, 'episode');
  assert.equal(launchOptions?.contentFit, 'contain');

  await savePlaybackProgress(
    buildProgressKey('provider-series', 'episode', 'ep-10'),
    {
      title: 'Episode 10',
      positionMs: 93_000,
      durationMs: 600_000,
    },
    {
      seriesId: 'series-7',
      seasonNumber: '2',
      episodeNumber: '10',
      episodeId: 'ep-10',
    },
  );

  const resumeMs = await getResumePositionMs(buildProgressKey('provider-series', 'episode', 'ep-10'));
  assert.equal(resumeMs, 93_000);
});

test('movie playback remains unchanged', async () => {
  clearMediaLibraryCacheForTests();

  await savePlaybackProgress(buildProgressKey('provider-movie', 'movie', 'movie-1'), {
    title: 'Movie 1',
    positionMs: 120_000,
    durationMs: 600_000,
  });

  const resumeMs = await getResumePositionMs(buildProgressKey('provider-movie', 'movie', 'movie-1'));
  assert.equal(resumeMs, 120_000);
});

test('smart series data source prepends Discover rows', async () => {
  clearMoviesSettingsCacheForTests();
  await setHideSmartCategories(false);
  resetSeriesCatalogIndex('demo-provider');

  const base = createProviderSeriesDataSource(createMockProviderRepositories('demo-provider').series);
  const smart = createSmartSeriesDataSource(base, 'demo-provider');
  const categories = await smart.getCategories();

  const discoverIndex = categories.findIndex((category) => category.id === 'section:discover');
  const providerIndex = categories.findIndex((category) => category.id === 'section:provider');

  assert.ok(discoverIndex >= 0);
  assert.ok(providerIndex > discoverIndex);
  assert.ok(categories.some((category) => category.kind === 'smart'));
  assert.ok(categories.some((category) => category.kind === 'provider'));
});

test('smart series data source loads provider and smart category pages', async () => {
  clearMoviesSettingsCacheForTests();
  await setHideSmartCategories(false);
  resetSeriesCatalogIndex('demo-provider');

  const base = createProviderSeriesDataSource(createMockProviderRepositories('demo-provider').series);
  const smart = createSmartSeriesDataSource(base, 'demo-provider');
  const providerCategory = (await smart.getCategories()).find((category) => category.kind === 'provider');
  assert.ok(providerCategory);

  const providerPage = await smart.getSeriesPage({
    categoryId: providerCategory.id,
    offset: 0,
    limit: 5,
  });
  assert.ok(providerPage.items.length > 0);

  const smartCategory = (await smart.getCategories()).find((category) => category.kind === 'smart');
  assert.ok(smartCategory);

  const smartPage = await smart.getSeriesPage({
    categoryId: smartCategory.id,
    offset: 0,
    limit: 5,
  });
  assert.ok(Array.isArray(smartPage.items));
});

test('provider series data source maps episodes by season', async () => {
  const repositories = createMockProviderRepositories('demo-provider');
  const dataSource = createProviderSeriesDataSource(repositories.series);
  const page = await dataSource.getSeriesPage({ categoryId: 'new', offset: 0, limit: 1 });
  const first = page.items[0];
  assert.ok(first);

  const detail = await dataSource.getSeriesInfo(first.seriesId);
  assert.ok(detail);
  assert.ok(Array.isArray(detail.seasons));
});

test('Series load notifications only surface recoverable errors', () => {
  assert.equal(resolveSeriesNotificationForStatus('ready', false), null);
  assert.equal(resolveSeriesNotificationForStatus('empty', false), null);
  assert.equal(resolveSeriesNotificationForStatus('loading', false), null);

  const error = resolveSeriesNotificationForStatus('error', false);
  assert.equal(error?.title, 'Series unavailable');
  assert.match(error?.message ?? '', /could not load series/i);
  assert.equal(resolveSeriesNotificationForStatus('error', true)?.persistent, true);
});

test('Series detail notifications carry retry persistence and custom copy', () => {
  const detail = resolveSeriesDetailNotification(false);
  assert.equal(detail.title, 'Series details unavailable');
  assert.match(detail.message, /could not be loaded/i);

  const custom = resolveSeriesDetailNotification(true, 'Season metadata timed out.');
  assert.equal(custom.message, 'Season metadata timed out.');
  assert.equal(custom.persistent, true);
});
