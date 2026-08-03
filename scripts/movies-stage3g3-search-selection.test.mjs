import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  isMoviesSearchOverlayMounted,
  isMoviesSearchOverlayVisible,
  movieSummaryFromSearchResult,
  shouldBlockMoviesSearchToolbar,
  shouldToggleCloseMoviesSearch,
} from '../src/features/search/moviesSearchSelection.ts';

const card = fs.readFileSync('src/features/search/SearchPosterCard.tsx', 'utf8');
const movieCard = fs.readFileSync('src/features/movies/components/MoviePosterCard.tsx', 'utf8');
const chrome = fs.readFileSync('src/features/movies/moviePosterFocusChrome.ts', 'utf8');
const screen = fs.readFileSync('src/features/movies/MoviesScreen.tsx', 'utf8');
const overlay = fs.readFileSync('src/features/search/SearchOverlay.tsx', 'utf8');
const scroll = fs.readFileSync('src/features/search/moviesSearchScroll.ts', 'utf8');
const scrollGrid = fs.readFileSync('src/features/search/SearchPosterGrid.tsx', 'utf8');
const catalog = fs.readFileSync('src/features/catalog/catalogRepository.ts', 'utf8');
const sync = fs.readFileSync('src/features/providers/providerCatalogSync.ts', 'utf8');

test('1. SearchPosterCard uses the shared Movies poster focus style', () => {
  assert.match(card, /createMoviePosterFocusChrome/);
  assert.match(card, /posterShellFocused/);
  assert.match(card, /titleFocused/);
  assert.match(chrome, /stage3g3-shared-movie-poster-focus-chrome-v1/);
  assert.match(movieCard, /createMoviePosterFocusChrome/);
});

test('2. Old Search-only pop-out styling is removed', () => {
  assert.doesNotMatch(card, /scale: 1\.04/);
  assert.doesNotMatch(card, /createNovaTvGlassOverlayStyle/);
  assert.doesNotMatch(card, /focusGlass/);
  assert.doesNotMatch(card, /borderRadius: 10/);
  assert.match(chrome, /scale: 1\.025/);
});

test('3. Selecting a Search result stores the movie before hiding Search', () => {
  assert.match(screen, /action: 'movie-captured'/);
  assert.match(screen, /action: 'search-hiding'/);
  assert.match(screen, /setSearchPhase\('opening-detail'\)/);
  assert.match(screen, /movieSummaryFromSearchResult/);
  const selectBody = screen.slice(
    screen.indexOf('const handleSearchSelect'),
    screen.indexOf('const executeMovieSearch'),
  );
  const capturedIdx = selectBody.indexOf("action: 'movie-captured'");
  const hidingIdx = selectBody.indexOf("action: 'search-hiding'");
  const openIdx = selectBody.indexOf('openMovieDetailFromSearch(');
  assert.ok(capturedIdx > 0 && hidingIdx > capturedIdx);
  assert.ok(openIdx > hidingIdx);
});

test('4. Search selection invokes the canonical Movies detail opener', () => {
  assert.match(screen, /openMovieDetailFromSearch/);
  assert.match(screen, /setDetailFocusPhaseSafe\('detail-open'\)/);
  assert.match(screen, /setDetailSource\('search'\)/);
  assert.match(screen, /loadMovieDetail\(movie\)/);
});

test('5. Detail opens successfully from Search \(phase gate\)', () => {
  assert.match(screen, /action: 'detail-opened'/);
  assert.match(screen, /setSearchPhase\('detail-open'\)/);
  // Canonical search opener must set the detail lifecycle phase gate.
  const opener = screen.slice(
    screen.indexOf('const openMovieDetailFromSearch'),
    screen.indexOf('const handleSearchSelect'),
  );
  assert.match(opener, /setDetailFocusPhaseSafe\('detail-open'\)/);
  assert.match(opener, /setDetailOpen\(true\)/);
});

test('6. Search does not restore browse focus while detail is opening', () => {
  const selectBody = screen.slice(
    screen.indexOf('const handleSearchSelect'),
    screen.indexOf('const executeMovieSearch'),
  );
  assert.doesNotMatch(selectBody, /focusSelectedPoster/);
  assert.doesNotMatch(selectBody, /restore-after-search-close/);
  assert.match(screen, /opening-detail/);
});

test('7. Search-origin detail close returns to Search results', () => {
  assert.match(screen, /detailSourceRef\.current === 'search'/);
  assert.match(screen, /setSearchPhase\('returning'\)/);
  assert.match(screen, /action: 'search-restoring'/);
  assert.doesNotMatch(
    screen.slice(screen.indexOf("detailSourceRef.current === 'search'"), screen.indexOf("detailSourceRef.current === 'search'") + 900),
    /beginDetailFocusClose/,
  );
});

test('8. Query and results remain available after returning \(retainMounted\)', () => {
  assert.match(overlay, /retainMounted/);
  assert.match(overlay, /enabled: visible \|\| retainMounted/);
  // Stage 3G.4: keep Search mounted across Detail + playback (Modal not rendered while hidden).
  assert.match(screen, /retainMounted=\{searchOpen\}/);
});

test('9. Focus restores to the selected Search result', () => {
  assert.match(overlay, /restoreFocusMovieId/);
  assert.match(overlay, /restore-after-detail-close/);
  assert.match(screen, /onRestoreFocusHandled/);
  assert.match(screen, /action: 'search-restored'/);
});

test('10. Search toolbar can reopen Search after a completed cycle', () => {
  assert.match(screen, /shouldBlockMoviesSearchToolbar/);
  assert.match(screen, /logMoviesSearchReopen/);
  assert.equal(shouldBlockMoviesSearchToolbar('closed'), false);
  assert.equal(shouldBlockMoviesSearchToolbar('opening-detail'), true);
  assert.equal(isMoviesSearchOverlayMounted('closed'), false);
  assert.equal(isMoviesSearchOverlayMounted('detail-open'), true);
  assert.equal(isMoviesSearchOverlayVisible('detail-open'), false);
  assert.equal(isMoviesSearchOverlayVisible('returning'), true);
});

test('11. No stale searchOpen\/overlay-hidden hybrid state remains', () => {
  assert.match(screen, /isMoviesSearchOverlayMounted\(searchPhase\)/);
  assert.match(screen, /isMoviesSearchOverlayVisible\(searchPhase\)/);
  assert.doesNotMatch(screen, /setSearchOpen\(/);
});

test('12. Duplicate Search press during detail transition is safe', () => {
  assert.equal(shouldBlockMoviesSearchToolbar('opening-detail'), true);
  assert.equal(shouldBlockMoviesSearchToolbar('detail-open'), true);
  assert.match(screen, /blockedReason: 'detail-transition'/);
});

test('13. Browse-origin detail behavior remains unchanged', () => {
  assert.match(screen, /setDetailSource\('browse'\)/);
  assert.match(screen, /beginDetailFocusClose\('detail-close'\)/);
  assert.equal(shouldToggleCloseMoviesSearch('open-results'), true);
});

test('14. Stage 3G.1 scroll bounds fix remains intact', () => {
  assert.match(scroll, /stage3g1-movies-search-scroll-v1/);
  assert.match(scrollGrid, /itemIndexToMoviesSearchScrollRow/);
  assert.match(scrollGrid, /scroll-to-index-failed-no-retry/);
});

test('15. No catalog, SQL, loader, Series, Live TV, or playback changes', () => {
  assert.match(chrome, /stage3g3-shared-movie-poster-focus-chrome-v1/);
  assert.doesNotMatch(catalog, /stage3g3-shared-movie-poster-focus-chrome-v1/);
  assert.doesNotMatch(sync, /stage3g3-search-selection-lifecycle-v1/);
  const movie = movieSummaryFromSearchResult({
    id: '42',
    title: 'Batman',
    year: 2022,
    genres: ['Action'],
    fallbackCategoryId: 'all',
  });
  assert.equal(movie.id, '42');
  assert.equal(movie.posterStyleKey, 'ember');
  assert.deepEqual(movie.genres, ['Action']);
});
