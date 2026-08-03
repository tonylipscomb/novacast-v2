import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  movieSummaryFromSearchResultForPlayback,
  validateSearchPlaybackMovie,
} from '../src/features/search/moviesSearchPlayback.ts';
import { movieSummaryFromSearchResult } from '../src/features/search/moviesSearchSelection.ts';

const playbackHelper = fs.readFileSync('src/features/search/moviesSearchPlayback.ts', 'utf8');
const selection = fs.readFileSync('src/features/search/moviesSearchSelection.ts', 'utf8');
const screen = fs.readFileSync('src/features/movies/MoviesScreen.tsx', 'utf8');
const overlay = fs.readFileSync('src/features/search/SearchOverlay.tsx', 'utf8');
const repo = fs.readFileSync('src/features/search/repositories/movieSearchRepository.ts', 'utf8');
const sqlite = fs.readFileSync('src/features/movies/data/SqliteMovieDataSource.ts', 'utf8');
const model = fs.readFileSync('src/features/movies/useMoviesScreenModel.ts', 'utf8');
const catalog = fs.readFileSync('src/features/catalog/catalogRepository.ts', 'utf8');
const sync = fs.readFileSync('src/features/providers/providerCatalogSync.ts', 'utf8');
const handoff = fs.readFileSync('src/features/search/moviesSearchInputHandoff.ts', 'utf8');
const types = fs.readFileSync('src/features/search/searchTypes.ts', 'utf8');

test('1. Search result maps to a playback-complete Movie object', () => {
  const movie = movieSummaryFromSearchResultForPlayback({
    id: 'stream-99',
    title: 'Example',
    year: 2024,
    rating: '7.1',
    genres: ['Action'],
    posterUrl: 'https://example.test/p.jpg',
    categoryId: 'cat-1',
    containerExtension: 'mkv',
    providerId: 'prov',
    fallbackCategoryId: 'all',
  });
  assert.equal(movie.id, 'stream-99');
  assert.equal(movie.containerExtension, 'mkv');
  assert.equal(movie.categoryId, 'cat-1');
  assert.equal(movie.posterStyleKey, 'ember');
  assert.match(types, /containerExtension\?: string/);
  assert.match(repo, /containerExtension: movie\.containerExtension/);
  assert.match(sqlite, /containerExtension: item\.streamExtension/);
});

test('2. Search Detail uses the canonical browse playback function', () => {
  assert.match(screen, /onPlay=\{focusHandoffActive \? undefined : selectedMovie \? startPlayback : undefined\}/);
  assert.doesNotMatch(screen, /startSearchPlayback|playSearchMovie/);
  assert.match(screen, /buildMoviePlaybackUrlResolved/);
  assert.match(screen, /await launchPlayback\(/);
});

test('3. Pressing Play invokes the resolver exactly once', () => {
  const startPlayback = screen.slice(
    screen.indexOf('const startPlayback = useCallback'),
    screen.indexOf('const openMovieDetailFromSearch'),
  );
  const resolverCalls = startPlayback.match(/buildMoviePlaybackUrlResolved\(/g) ?? [];
  assert.equal(resolverCalls.length, 1);
  assert.match(startPlayback, /action: 'resolver-invoked'/);
});

test('4. Search overlay hiding does not clear selected movie', () => {
  assert.match(model, /pinnedSelectedMovieIdRef/);
  assert.match(model, /pinnedSelectedMovieIdRef\.current === current/);
  assert.match(overlay, /while Detail\/playback owns the screen/);
  assert.match(overlay, /if \(!visible\) \{\s*return null;/);
  assert.match(screen, /retainMounted=\{searchOpen\}/);
  assert.match(selection, /containerExtension: input\.containerExtension/);
});

test('5. Missing stream ID blocks safely with an explicit error', () => {
  const invalid = validateSearchPlaybackMovie({
    id: '',
    categoryId: 'c',
    title: 'X',
    genres: ['Movies'],
    posterStyleKey: 'ember',
  });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.failureReason, 'missing-stream-id');
  assert.match(screen, /missing-stream-id/);
  assert.match(screen, /missing a stream id/);
});

test('6. Valid Search result starts playback', () => {
  const movie = movieSummaryFromSearchResult({
    id: 'ok-1',
    title: 'Ok',
    containerExtension: 'mp4',
    fallbackCategoryId: 'cat',
  });
  const validated = validateSearchPlaybackMovie(movie);
  assert.equal(validated.ok, true);
  assert.match(screen, /action: 'playback-started'/);
  assert.match(playbackHelper, /stage3g4-search-playback-v1/);
});

test('7. Playback close returns to Search-origin Detail', () => {
  assert.match(screen, /detailSourceRef\.current === 'search'/);
  assert.match(screen, /action: 'playback-returned'/);
  assert.match(screen, /setSearchPhase\('detail-open'\)/);
  const didJustCloseStart = screen.indexOf('if (!didJustClose)');
  const didJustClose = screen.slice(didJustCloseStart, didJustCloseStart + 1800);
  assert.match(didJustClose, /playback-returned/);
  assert.match(didJustClose, /setDetailFocusPhaseSafe\('detail-open'\)/);
  assert.doesNotMatch(
    didJustClose.slice(0, didJustClose.indexOf("beginDetailFocusClose('playback-close')")),
    /beginDetailFocusClose\('playback-close'\)/,
  );
});

test('8. Closing Detail returns to preserved Search results', () => {
  assert.match(screen, /action: 'search-restoring'/);
  assert.match(screen, /setSearchPhase\('returning'\)/);
  assert.match(screen, /retainMounted=\{searchOpen\}/);
  assert.match(selection, /stage3g3-search-selection-lifecycle-v1/);
});

test('9. Browse-origin playback remains unchanged', () => {
  assert.match(screen, /beginDetailFocusClose\('playback-close'\)/);
  assert.match(screen, /detailSourceRef\.current = 'browse'/);
  const didJustCloseStart = screen.indexOf('if (!didJustClose)');
  const didJustClose = screen.slice(didJustCloseStart, didJustCloseStart + 1800);
  assert.match(didJustClose, /beginDetailFocusClose\('playback-close'\)/);
});

test('10. No catalog sync, loader, category, or Search focus changes', () => {
  assert.doesNotMatch(playbackHelper, /startCatalogSync|getCatalogCategoryCounts/);
  assert.doesNotMatch(catalog, /stage3g4-search-playback/);
  assert.doesNotMatch(sync, /stage3g4-search-playback/);
  assert.match(handoff, /stage3g2-search-input-handoff-v1/);
  assert.match(sqlite, /stage3g-sqlite-movies-search-v1/);
});
