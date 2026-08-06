import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const seriesScreen = fs.readFileSync('src/features/series/SeriesScreen.tsx', 'utf8');
const seriesOverlay = fs.readFileSync(
  'src/features/series/components/SeriesDetailOverlay.tsx',
  'utf8',
);
const shell = fs.readFileSync('src/features/media-detail/MediaDetailOverlayShell.tsx', 'utf8');
const movieOverlay = fs.readFileSync('src/features/movies/components/MovieDetailOverlay.tsx', 'utf8');
const seriesPlayback = fs.readFileSync('src/features/series/seriesPlayback.ts', 'utf8');

test('1. Shared shell is used by Series', () => {
  assert.match(seriesOverlay, /MediaDetailOverlayShell/);
  assert.match(seriesScreen, /SeriesDetailOverlay/);
  assert.doesNotMatch(seriesScreen, /from '@\/components\/media\/MediaDetailOverlay'/);
});

test('2. Opening does not unmount browse grid or rail', () => {
  assert.match(seriesScreen, /SeriesPosterGrid/);
  assert.match(seriesScreen, /MediaCategoryRail/);
  assert.match(seriesScreen, /styles\.browseLayer/);
  assert.match(seriesScreen, /gridInstanceIdRef|railInstanceIdRef|screenInstanceIdRef/);
});

test('3. Opening does not replace visible items', () => {
  const openBlockStart = seriesScreen.indexOf('const handleSelectSeries = useCallback');
  const openBlockEnd = seriesScreen.indexOf('const handleRegisterPosterRef', openBlockStart);
  const openBlock = seriesScreen.slice(openBlockStart, openBlockEnd);
  assert.match(openBlock, /openDetailOverlayState\(series\)/);
  assert.doesNotMatch(openBlock, /setVisibleItems|visibleItems\s*=/);
});

test('16. Series episode navigation remains intact', () => {
  assert.match(seriesOverlay, /id: 'episodes'/);
  assert.match(seriesOverlay, /onSeasonPress/);
  assert.match(seriesOverlay, /onEpisodePress/);
  assert.match(seriesScreen, /playEpisodeById/);
  assert.match(seriesScreen, /launchSeriesEpisodePlayback/);
  assert.match(seriesPlayback, /launchSeriesEpisodePlayback|launchPlayback/);
});

test('17. Series browse instances remain stable across open/close', () => {
  assert.match(seriesScreen, /screenInstanceIdRef/);
  assert.match(seriesScreen, /gridInstanceIdRef/);
  assert.match(seriesScreen, /railInstanceIdRef/);
  assert.match(seriesScreen, /browseSnapshotOnOpenRef/);
});

test('18. Category and offset remain unchanged on close', () => {
  const closeStart = seriesScreen.indexOf('const closeDetailOverlay = useCallback');
  const closeEnd = seriesScreen.indexOf('const closeDetail = useCallback', closeStart);
  const closeBlock = seriesScreen.slice(closeStart, closeEnd);
  assert.doesNotMatch(closeBlock, /selectCategory\(/);
  assert.doesNotMatch(closeBlock, /setDetailOverlayState\(open/);
});

test('Series and Movies share the same shell component', () => {
  assert.match(movieOverlay, /MediaDetailOverlayShell/);
  assert.match(seriesOverlay, /MediaDetailOverlayShell/);
  assert.match(shell, /export function MediaDetailOverlayShell/);
});

test('Playback keeps Detail logically open', () => {
  assert.match(seriesScreen, /Keep overlay logically open but visually suppressed/);
  assert.match(seriesScreen, /series_detail_revealed_after_playback/);
  assert.doesNotMatch(
    seriesScreen.slice(
      seriesScreen.indexOf('const playEpisodeById'),
      seriesScreen.indexOf('const playFirstEpisode'),
    ),
    /setDetailOverlayState\(createClosedDetailOverlayState/,
  );
});

test('Back consumed only while overlay visible', () => {
  assert.match(seriesScreen, /shouldConsumeDetailOverlayBack/);
  assert.match(seriesScreen, /closeDetailOverlay\('back'\)/);
});

test('No BlurTargetView in Series overlay path', () => {
  assert.doesNotMatch(seriesOverlay, /BlurTargetView|blurTargetId|blurTarget=\{/);
  assert.doesNotMatch(seriesScreen, /BlurTargetView/);
});
