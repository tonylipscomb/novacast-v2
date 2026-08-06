import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  DEPRECATED_DETAIL_CLOSE_PHASES,
  MEDIA_DETAIL_OVERLAY_STAGE4M_MARKER,
  assertBrowseInstancesStable,
  canBeginDetailOverlayClose,
  planCloseDetailOverlay,
  shouldConsumeDetailOverlayBack,
} from '../src/features/media-detail/mediaDetailOverlayLogic.ts';
import {
  closeDetailOverlayState,
  createClosedDetailOverlayState,
  openDetailOverlayState,
} from '../src/features/media-detail/mediaDetailOverlayTypes.ts';
import { adaptMediaDetailToOverlayModel } from '../src/features/media-detail/adaptMediaDetailModel.ts';

const shell = fs.readFileSync('src/features/media-detail/MediaDetailOverlayShell.tsx', 'utf8');
const movieOverlay = fs.readFileSync('src/features/movies/components/MovieDetailOverlay.tsx', 'utf8');
const seriesOverlay = fs.readFileSync(
  'src/features/series/components/SeriesDetailOverlay.tsx',
  'utf8',
);
const moviesScreen = fs.readFileSync('src/features/movies/MoviesScreen.tsx', 'utf8');
const seriesScreen = fs.readFileSync('src/features/series/SeriesScreen.tsx', 'utf8');

test('Stage 4.2M marker present', () => {
  assert.equal(MEDIA_DETAIL_OVERLAY_STAGE4M_MARKER, 'stage4m-shared-media-detail-overlay-v1');
  assert.match(shell, /MEDIA_DETAIL_OVERLAY_STAGE4M_MARKER|stage4m-shared-media-detail-overlay/);
});

test('1. Shared shell is used by both Movies and Series', () => {
  assert.match(movieOverlay, /MediaDetailOverlayShell/);
  assert.match(seriesOverlay, /MediaDetailOverlayShell/);
  assert.match(movieOverlay, /adaptMediaDetailToOverlayModel/);
  assert.match(seriesOverlay, /adaptMediaDetailToOverlayModel/);
});

test('4. Back and X invoke the same close function', () => {
  assert.match(moviesScreen, /closeDetailOverlay\('back'\)/);
  assert.match(moviesScreen, /closeDetailOverlay\('x'\)/);
  assert.match(seriesScreen, /closeDetailOverlay\('back'\)/);
  assert.match(seriesScreen, /closeDetailOverlay\('x'\)/);
});

test('5. Back closes the popup with one state transition', () => {
  const plan = planCloseDetailOverlay({
    state: openDetailOverlayState({ id: 'm1' }),
    source: 'back',
  });
  assert.equal(plan.nextState.open, false);
  assert.equal(plan.nextState.item, null);
  assert.equal(plan.originItemId, 'm1');
  assert.equal(plan.requestOriginFocus, true);
});

test('6. No multi-phase close state is used by the new path', () => {
  assert.match(moviesScreen, /MOVIES_SIMPLE_DETAIL_OVERLAY_ENABLED/);
  assert.match(moviesScreen, /closeDetailOverlay/);
  // Active close path must not call beginDetailFocusClose.
  const closeFnStart = moviesScreen.indexOf('const closeDetailOverlay = useCallback');
  const closeFnEnd = moviesScreen.indexOf('const closeDetail = useCallback', closeFnStart);
  const closeBlock = moviesScreen.slice(closeFnStart, closeFnEnd);
  assert.doesNotMatch(closeBlock, /beginDetailFocusClose/);
  for (const phase of DEPRECATED_DETAIL_CLOSE_PHASES) {
    assert.doesNotMatch(closeBlock, new RegExp(phase));
  }
});

test('7. Origin focus is requested at most once', () => {
  const closeFnStart = moviesScreen.indexOf('const closeDetailOverlay = useCallback');
  const closeFnEnd = moviesScreen.indexOf('const closeDetail = useCallback', closeFnStart);
  const closeBlock = moviesScreen.slice(closeFnStart, closeFnEnd);
  const matches = closeBlock.match(/requestTvFocus\(/g) ?? [];
  assert.equal(matches.length, 1);
});

test('8. Invalid origin target never throws', () => {
  assert.match(shell, /target\?\.focus/);
  assert.match(shell, /Never crash the overlay for focus/);
  assert.match(moviesScreen, /getValidatedPosterTarget\(originItemId\)/);
  assert.match(seriesScreen, /posterRefs\.current\.get\(originItemId\)/);
});

test('10. Search is never used as a focus bridge', () => {
  const closeFnStart = moviesScreen.indexOf('const closeDetailOverlay = useCallback');
  const closeFnEnd = moviesScreen.indexOf('const closeDetail = useCallback', closeFnStart);
  const closeBlock = moviesScreen.slice(closeFnStart, closeFnEnd);
  assert.doesNotMatch(closeBlock, /MovieToolbar\.Search|search-steal|requestTvFocus\(\{[\s\S]*region: 'search'/);
});

test('11. No BlurTargetView/blurTargetId on Android TV', () => {
  assert.doesNotMatch(shell, /\bBlurTargetView\b/);
  assert.doesNotMatch(shell, /blurTargetId\s*=/);
  assert.doesNotMatch(shell, /blurTarget=\{/);
  assert.doesNotMatch(movieOverlay, /\bBlurTargetView\b/);
  assert.doesNotMatch(seriesOverlay, /\bBlurTargetView\b/);
});

test('12. Blur fallback uses scrim only', () => {
  assert.match(shell, /intensity=\{28\}/);
  assert.match(shell, /styles\.scrim/);
  assert.match(shell, /Scrim always present/);
});

test('19. Physical Back is consumed only while overlay is open', () => {
  assert.equal(
    shouldConsumeDetailOverlayBack({ overlayOpen: true, overlayVisible: true }),
    true,
  );
  assert.equal(
    shouldConsumeDetailOverlayBack({ overlayOpen: true, overlayVisible: false }),
    false,
  );
  assert.equal(
    shouldConsumeDetailOverlayBack({ overlayOpen: false, overlayVisible: false }),
    false,
  );
  assert.match(moviesScreen, /shouldConsumeDetailOverlayBack/);
  assert.match(seriesScreen, /shouldConsumeDetailOverlayBack/);
});

test('20. The next Back after close reaches normal browse navigation', () => {
  assert.equal(
    canBeginDetailOverlayClose({ open: false, closeInFlight: false }),
    false,
  );
  const closed = closeDetailOverlayState();
  assert.equal(closed.open, false);
  assert.equal(createClosedDetailOverlayState().open, false);
});

test('Browse instance stability helper', () => {
  const snap = {
    screenInstanceId: 's1',
    gridInstanceId: 'g1',
    railInstanceId: 'r1',
    categoryId: 'c1',
    listOffset: 120,
    visibleItemCount: 40,
  };
  assert.equal(assertBrowseInstancesStable({ before: snap, after: snap }).ok, true);
  assert.equal(
    assertBrowseInstancesStable({
      before: snap,
      after: { ...snap, visibleItemCount: 0 },
    }).ok,
    false,
  );
});

test('adaptMediaDetailToOverlayModel maps MediaDetail', () => {
  const model = adaptMediaDetailToOverlayModel({
    id: 'movie-1',
    mediaType: 'movie',
    title: 'Example',
    synopsis: 'A plot',
    posterUrl: 'https://example/p.jpg',
    backdropUrl: 'https://example/b.jpg',
    year: '2024',
    rating: 8.2,
    runtime: '1h 40m',
    genres: ['Action', 'Drama'],
    cast: [],
    seasons: [],
    episodes: [],
  });
  assert.equal(model.mediaType, 'movie');
  assert.equal(model.description, 'A plot');
  assert.equal(model.durationLabel, '1h 40m');
});
