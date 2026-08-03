import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  beginCatalogSync,
  completeCatalogSync,
  getCatalogMovieItem,
  initializeCatalogDatabase,
  resetCatalogDatabaseForTests,
  resetMovieFragmentRecoveryForTests,
  setCatalogDatabaseOpenerForTests,
  upsertCatalogProvider,
  writeCatalogCategoriesBatch,
  writeCatalogItemsBatch,
} from '../src/features/catalog/index.ts';
import { createNodeSqliteCatalogOpener } from '../src/features/catalog/createNodeSqliteCatalogOpener.ts';
import {
  createSqliteMovieDataSource,
  resetLastValidSqliteMovieCategoriesForTests,
} from '../src/features/movies/data/SqliteMovieDataSource.ts';
import {
  buildLocalMovieDetailFromCatalogItem,
  mergeLocalAndProviderMovieDetail,
  MOVIE_DETAIL_ENRICHMENT_MARKER,
  normalizeDetailContainerExtension,
  resetMovieDetailEnrichmentCacheForTests,
  resolveDetailContainerExtension,
  setCachedProviderMovieInfo,
} from '../src/features/movies/movieDetailEnrichment.ts';
import { createSmartMovieDataSource } from '../src/features/movies/smart/SmartMovieDataSource.ts';

const enrichment = fs.readFileSync('src/features/movies/movieDetailEnrichment.ts', 'utf8');
const sqlite = fs.readFileSync('src/features/movies/data/SqliteMovieDataSource.ts', 'utf8');
const smart = fs.readFileSync('src/features/movies/smart/SmartMovieDataSource.ts', 'utf8');
const model = fs.readFileSync('src/features/movies/useMoviesScreenModel.ts', 'utf8');
const screen = fs.readFileSync('src/features/movies/MoviesScreen.tsx', 'utf8');
const catalogRepo = fs.readFileSync('src/features/catalog/catalogRepository.ts', 'utf8');
const sync = fs.readFileSync('src/features/providers/providerCatalogSync.ts', 'utf8');
const visible = fs.readFileSync('src/features/movies/moviesVisibleCategories.ts', 'utf8');
const handoff = fs.readFileSync('src/features/search/moviesSearchInputHandoff.ts', 'utf8');
const focusLifecycle = fs.readFileSync('src/features/movies/moviesDetailFocusLifecycle.ts', 'utf8');
const loaderPolicy = fs.readFileSync('src/features/movies/movieCategoryCountPolicy.ts', 'utf8');
const playerHost = fs.readFileSync('src/features/playback/unified/UnifiedPlayerHost.tsx', 'utf8');

async function setup() {
  await resetCatalogDatabaseForTests();
  resetMovieFragmentRecoveryForTests();
  resetLastValidSqliteMovieCategoriesForTests();
  resetMovieDetailEnrichmentCacheForTests();
  setCatalogDatabaseOpenerForTests(createNodeSqliteCatalogOpener());
  await initializeCatalogDatabase(':memory:');
}

test.beforeEach(async () => {
  await setup();
});

test.afterEach(async () => {
  await resetCatalogDatabaseForTests();
  resetMovieFragmentRecoveryForTests();
  resetLastValidSqliteMovieCategoriesForTests();
  resetMovieDetailEnrichmentCacheForTests();
  setCatalogDatabaseOpenerForTests(null);
});

async function seedMovies() {
  await upsertCatalogProvider({ providerId: 'p1', providerType: 'xtream', displayName: 'P' });
  const generation = await beginCatalogSync('p1', 'movie');
  await writeCatalogCategoriesBatch(
    [
      {
        providerId: 'p1',
        mediaType: 'movie',
        categoryId: 'c1',
        categoryName: 'Action',
        sortOrder: 1,
        syncGeneration: generation,
      },
    ],
    { mediaType: 'movie' },
  );
  await writeCatalogItemsBatch([
    {
      providerId: 'p1',
      mediaType: 'movie',
      contentId: 'local-complete',
      categoryId: 'c1',
      title: 'Complete Local',
      description: 'A full local synopsis.',
      streamExtension: 'mp4',
      artworkUrl: 'https://example.test/p.jpg',
      releaseYear: 2024,
      rating: 7.2,
      syncGeneration: generation,
    },
    {
      providerId: 'p1',
      mediaType: 'movie',
      contentId: 'missing-ext',
      categoryId: 'c1',
      title: 'Needs Extension',
      description: 'Has plot but no extension.',
      streamExtension: '',
      syncGeneration: generation,
    },
    {
      providerId: 'p1',
      mediaType: 'movie',
      contentId: 'preview-only',
      categoryId: 'c1',
      title: 'Preview Only',
      streamExtension: 'mkv',
      syncGeneration: generation,
    },
  ]);
  await completeCatalogSync('p1', 'movie', generation, { processedCount: 3 });
  return generation;
}

test('1. SQLite getMovieInfo returns a local MovieDetail immediately', async () => {
  await seedMovies();
  const source = createSqliteMovieDataSource('p1');
  assert.equal(typeof source.getMovieInfo, 'function');
  const detail = await source.getMovieInfo('local-complete');
  assert.ok(detail);
  assert.equal(detail.id, 'local-complete');
  assert.equal(detail.title, 'Complete Local');
  assert.equal(detail.containerExtension, 'mp4');
  assert.equal(detail.synopsis, 'A full local synopsis.');
  assert.equal(detail.mediaType, 'movie');

  const row = await getCatalogMovieItem('p1', 'local-complete');
  assert.ok(row);
  assert.equal(row.contentId, 'local-complete');
  assert.match(catalogRepo, /export async function getCatalogMovieItem/);
});

test('2. Browse and Search use the same getMovieInfo implementation', () => {
  assert.match(sqlite, /async getMovieInfo\(movieId\)/);
  assert.match(smart, /getMovieInfo: base\.getMovieInfo/);
  assert.match(smart, /enrichMovieInfo: base\.enrichMovieInfo/);
  assert.match(model, /resolvedDataSource\?\.getMovieInfo\?\.\(movie\.id\)/);
  assert.match(screen, /loadMovieDetail\(movie, \{ origin: 'browse' \}\)/);
  assert.match(screen, /loadMovieDetail\(movie, \{ origin: 'search' \}\)/);
  assert.doesNotMatch(screen, /searchGetMovieInfo|getSearchMovieInfo/);
  assert.doesNotMatch(model, /searchGetMovieInfo|getSearchMovieInfo/);
});

test('3. Provider enrichment merges without remounting Detail', () => {
  assert.match(model, /enrichMovieInfo\(movie\.id\)/);
  assert.match(model, /setMovieDetail\(enriched\)/);
  assert.match(model, /Progressive enrichment/);
  assert.match(screen, /visible=\{detailOverlayVisible\}/);
  // Overlay stays keyed by selection identity, not enrichment payload.
  assert.doesNotMatch(screen, /key=\{movieDetail/);
  assert.doesNotMatch(screen, /key=\{.*containerExtension/);
});

test('4. Provider container extension overrides missing local extension', async () => {
  await seedMovies();
  let providerCalls = 0;
  const source = createSqliteMovieDataSource('p1', {
    fetchProviderMovieInfo: async (movieId) => {
      providerCalls += 1;
      return {
        id: movieId,
        mediaType: 'movie',
        title: 'Provider Title',
        synopsis: 'Provider plot',
        containerExtension: '.MKV',
        genres: ['Action'],
        cast: [{ name: 'A' }],
        seasons: [],
        episodes: [],
      };
    },
  });

  const local = await source.getMovieInfo('missing-ext');
  assert.equal(local?.containerExtension, undefined);
  const enriched = await source.enrichMovieInfo('missing-ext');
  assert.equal(providerCalls, 1);
  assert.equal(enriched?.id, 'missing-ext');
  assert.equal(enriched?.containerExtension, 'mkv');
  assert.equal(enriched?.title, 'Needs Extension');
  assert.equal(resolveDetailContainerExtension('MKV', null).source, 'provider');
  assert.equal(normalizeDetailContainerExtension('.MP4'), 'mp4');
  assert.equal(normalizeDetailContainerExtension('null'), undefined);
});

test('5. Valid local extension remains when provider enrichment fails', async () => {
  await seedMovies();
  const source = createSqliteMovieDataSource('p1', {
    fetchProviderMovieInfo: async () => {
      throw new Error('network-down');
    },
  });
  const local = await source.getMovieInfo('preview-only');
  assert.equal(local?.containerExtension, 'mkv');
  const after = await source.enrichMovieInfo('preview-only');
  // Missing synopsis → enrichment attempted; failure keeps local extension.
  assert.equal(after?.containerExtension, 'mkv');
  assert.equal(after?.id, 'preview-only');
});

test('6. Provider failure is nonfatal', async () => {
  await seedMovies();
  const lines = [];
  const original = console.info;
  console.info = (message) => {
    lines.push(String(message));
  };
  try {
    const source = createSqliteMovieDataSource('p1', {
      fetchProviderMovieInfo: async () => null,
    });
    await source.getMovieInfo('missing-ext');
    const result = await source.enrichMovieInfo('missing-ext');
    assert.ok(result);
    assert.equal(result.title, 'Needs Extension');
  } finally {
    console.info = original;
  }
  const enrichmentLines = lines.filter((line) =>
    line.startsWith('[NovaCast Movie Detail Enrichment]'),
  );
  assert.ok(enrichmentLines.length >= 1);
  const last = JSON.parse(
    enrichmentLines.at(-1).replace('[NovaCast Movie Detail Enrichment] ', ''),
  );
  assert.equal(last.detailMode, 'preview-fallback');
  assert.equal(last.providerInfoSucceeded, false);
  assert.match(model, /enrichment-nonfatal/);
  assert.match(model, /setDetailError\(null\)/);
});

test('7. Play remains available in preview fallback', () => {
  assert.match(model, /setDetailLoading\(false\)/);
  assert.match(
    screen,
    /onPlay=\{focusHandoffActive \? undefined : selectedMovie \? startPlayback : undefined\}/,
  );
  // Loading clears before enrichment finishes so Play is not blocked.
  assert.match(model, /Clear loading so Play stays available/);
  assert.match(enrichment, /preview-fallback/);
});

test('8. Existing successful Browse playback remains unchanged', () => {
  const startPlayback = screen.slice(
    screen.indexOf('const startPlayback = useCallback'),
    screen.indexOf('const openMovieDetailFromSearch'),
  );
  assert.match(startPlayback, /buildMoviePlaybackUrlResolved/);
  assert.match(startPlayback, /await launchPlayback\(/);
  assert.doesNotMatch(startPlayback, /enrichMovieInfo|getMovieInfo/);
  assert.match(screen, /origin: 'browse-detail'/);
});

test('9. Search-origin playback uses the same enriched record', () => {
  assert.match(screen, /loadMovieDetail\(movie, \{ origin: 'search' \}\)/);
  assert.match(screen, /movieDetailRef\.current\.containerExtension/);
  assert.match(model, /setSelectedMovieSnapshot/);
  assert.match(model, /containerExtension: nextExtension/);
  assert.match(smart, /enrichMovieInfo: base\.enrichMovieInfo/);
});

test('10. No catalog sync/category/focus/loader changes', () => {
  assert.doesNotMatch(sync, /stage3h|getMovieInfo|enrichMovieInfo/);
  assert.match(catalogRepo, /getCatalogMovieItem/);
  // Category visibility / search handoff / detail focus / loader policy untouched by Stage 3H marker.
  assert.doesNotMatch(visible, /stage3h|enrichMovieInfo/);
  assert.doesNotMatch(handoff, /stage3h|enrichMovieInfo/);
  assert.doesNotMatch(focusLifecycle, /stage3h|enrichMovieInfo/);
  assert.doesNotMatch(loaderPolicy, /stage3h|enrichMovieInfo/);
  assert.doesNotMatch(playerHost, /stage3h|enrichMovieInfo/);
  assert.equal(MOVIE_DETAIL_ENRICHMENT_MARKER, 'stage3h-movie-detail-enrichment-v1');
});

test('merge helpers preserve movie id and prefer provider extension', () => {
  const local = buildLocalMovieDetailFromCatalogItem(
    {
      providerId: 'p1',
      mediaType: 'movie',
      contentId: 'm9',
      title: 'Local',
      normalizedTitle: 'local',
      description: 'Local plot',
      streamExtension: null,
      syncGeneration: 1,
      updatedAt: 1,
    },
    'm9',
  );
  const merged = mergeLocalAndProviderMovieDetail(local, {
    id: 'provider-other-id',
    mediaType: 'movie',
    title: 'Provider',
    synopsis: 'Provider plot',
    containerExtension: 'avi',
    genres: ['Drama'],
    cast: [],
    seasons: [],
    episodes: [],
  });
  assert.equal(merged.detail.id, 'm9');
  assert.equal(merged.detail.containerExtension, 'avi');
  assert.equal(merged.resolvedExtensionSource, 'provider');
  assert.equal(merged.detail.synopsis, 'Provider plot');
});

test('provider VOD-info cache avoids repeated network calls', async () => {
  await seedMovies();
  let providerCalls = 0;
  const source = createSqliteMovieDataSource('p1', {
    fetchProviderMovieInfo: async (movieId) => {
      providerCalls += 1;
      return {
        id: movieId,
        mediaType: 'movie',
        title: 'Cached',
        synopsis: 'Cached plot',
        containerExtension: 'mp4',
        genres: [],
        cast: [],
        seasons: [],
        episodes: [],
      };
    },
  });
  await source.getMovieInfo('missing-ext');
  await source.enrichMovieInfo('missing-ext');
  assert.equal(providerCalls, 1);
  await source.enrichMovieInfo('missing-ext');
  assert.equal(providerCalls, 1);

  // Fresh datasource instance still hits module cache.
  const source2 = createSqliteMovieDataSource('p1', {
    fetchProviderMovieInfo: async () => {
      providerCalls += 1;
      return null;
    },
  });
  await source2.getMovieInfo('missing-ext');
  const cachedMerge = await source2.enrichMovieInfo('missing-ext');
  assert.equal(providerCalls, 1);
  assert.equal(cachedMerge?.containerExtension, 'mp4');

  setCachedProviderMovieInfo('p1', 'other', {
    id: 'other',
    mediaType: 'movie',
    title: 'x',
    genres: [],
    cast: [],
    seasons: [],
    episodes: [],
  });
});

test('Smart datasource exposes the same SQLite getMovieInfo', async () => {
  await seedMovies();
  const smartSource = createSmartMovieDataSource(createSqliteMovieDataSource('p1'), 'p1');
  assert.equal(typeof smartSource.getMovieInfo, 'function');
  assert.equal(typeof smartSource.enrichMovieInfo, 'function');
  const detail = await smartSource.getMovieInfo('local-complete');
  assert.equal(detail?.containerExtension, 'mp4');
});
