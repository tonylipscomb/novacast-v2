import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const screen = fs.readFileSync('src/features/series/SeriesScreen.tsx', 'utf8');
const grid = fs.readFileSync('src/features/series/components/SeriesPosterGrid.tsx', 'utf8');
const rail = fs.readFileSync('src/features/movies/components/MovieCategoryRail.tsx', 'utf8');
const popup = fs.readFileSync('src/features/series/components/SeriesDetailPopupV2.tsx', 'utf8');

test('Series poster width is measured from the rendered grid', () => {
  assert.match(grid, /const \[gridWidth, setGridWidth\] = useState\(0\)/);
  assert.match(grid, /onLayout=\{\(event: LayoutChangeEvent\) =>/);
  assert.match(grid, /SERIES_GRID_LEFT_PADDING/);
  assert.match(grid, /SERIES_GRID_RIGHT_PADDING/);
  assert.match(grid, /SERIES_GRID_COLUMN_GAP = 12/);
  assert.match(grid, /isNovaCastTraceLoggingEnabled\(\)/);
  assert.match(grid, /\[Series Native Layout Audit\]/);
  for (const event of [
    'grid-mount', 'grid-unmount', 'flatlist-ref-set', 'flatlist-ref-cleared',
    'fresh-layout', 'stage-layout', 'detail-open', 'playback-open',
    'playback-close', 'detail-restore', 'detail-close', 'browse-restore',
    'origin-poster-focus-restored',
  ]) {
    assert.match(grid, new RegExp(`'${event}'`));
  }
  assert.match(grid, /widthSource/);
  assert.match(grid, /gridMountGeneration/);
  assert.match(grid, /posterGridMounted/);
  assert.match(grid, /listRefPresent/);
  assert.match(grid, /effectiveGridWidth - SERIES_GRID_LEFT_PADDING - SERIES_GRID_RIGHT_PADDING/);
  assert.match(grid, /calculatedRowWidth/);
  assert.doesNotMatch(grid, /width - 320/);
  assert.match(grid, /justifyContent: 'flex-start'/);
  assert.match(grid, /flexGrow: 0/);
  assert.doesNotMatch(grid, /Math\.min\(190/);
  assert.match(grid, /Math\.floor\(measured\)/);
  assert.match(grid, /effectiveCardWidth/);
  assert.match(grid, /lastValidGridWidthRef/);
  assert.match(grid, /lastValidStageLayoutRef/);
  assert.match(grid, /component-last-valid-stage/);
  assert.match(grid, /session-cached-measured-stage/);
  assert.match(grid, /seriesRouteMountId/);
  assert.match(grid, /startup-fallback/);
  assert.match(grid, /if \(nextWidth > 0\) \{\s*lastValidGridWidthRef\.current = nextWidth/);
  assert.match(grid, /paddingLeft: SERIES_GRID_LEFT_PADDING/);
  assert.match(grid, /paddingRight: SERIES_GRID_RIGHT_PADDING/);
  assert.match(grid, /width: columnWidth, flexGrow: 0, flexShrink: 0/);
  assert.match(fs.readFileSync('src/features/series/components/SeriesPosterCard.tsx', 'utf8'), /width: '100%'/);
  assert.match(fs.readFileSync('src/features/series/components/SeriesPosterCard.tsx', 'utf8'), /minWidth: 0/);
  assert.match(fs.readFileSync('src/features/series/components/SeriesPosterCard.tsx', 'utf8'), /toValue: 1\.025/);
});

test('Series geometry retains the last valid width across transient zero layouts', () => {
  const widthForSizing = (current, lastValid) => current > 0 ? current : lastValid;
  const cardWidth = (width) => width > 0
    ? Math.floor((width - 6 - 18 - 12 * 4) / 5)
    : 120;
  let currentWidth = 0;
  let lastValidWidth = 0;

  assert.equal(cardWidth(widthForSizing(currentWidth, lastValidWidth)), 120);

  currentWidth = 580;
  lastValidWidth = currentWidth;
  assert.equal(cardWidth(widthForSizing(currentWidth, lastValidWidth)), 101);
  assert.ok(101 * 5 + 12 * 4 + 6 + 18 <= 580);

  currentWidth = 0;
  assert.equal(widthForSizing(currentWidth, lastValidWidth), 580);
  assert.equal(cardWidth(widthForSizing(currentWidth, lastValidWidth)), 101);

  currentWidth = 700;
  lastValidWidth = currentWidth;
  assert.equal(widthForSizing(currentWidth, lastValidWidth), 700);
  assert.equal(cardWidth(widthForSizing(currentWidth, lastValidWidth)), 125);
});

test('Series route re-entry uses session geometry only for the same viewport', () => {
  const cache = { windowWidth: 960, stageWidth: 580 };
  const cardWidth = (width) => width > 0
    ? Math.floor((width - 6 - 18 - 12 * 4) / 5)
    : 120;
  const effectiveWidth = (current, localLastValid, windowWidth) => {
    if (current > 0) return current;
    if (localLastValid > 0) return localLastValid;
    return cache.windowWidth === windowWidth ? cache.stageWidth : 0;
  };

  assert.equal(effectiveWidth(0, 0, 960), 580);
  assert.equal(cardWidth(effectiveWidth(0, 0, 960)), 101);
  assert.equal(effectiveWidth(0, 0, 1080), 0);
  assert.equal(cardWidth(effectiveWidth(0, 0, 1080)), 120);
  assert.equal(effectiveWidth(700, 0, 1080), 700);
});

test('Series browse is natively locked while detail owns interaction', () => {
  assert.match(screen, /const seriesBrowseLocked = seriesDetailPopupVisible \|\| playbackUiActive \|\| searchBlocksBrowse/);
  assert.match(screen, /interactionLocked=\{seriesBrowseLocked\}/);
  assert.match(grid, /scrollEnabled=\{!interactionLocked\}/);
  assert.match(grid, /focusable=\{!interactionLocked\}/);
  assert.match(grid, /accessible=\{!interactionLocked\}/);
  assert.match(rail, /const effectiveFocusable = focusable && !interactionLocked/);
  assert.match(rail, /scrollEnabled=\{hostProps\.scrollEnabled\}/);
  assert.match(rail, /focusable=\{effectiveFocusable\}/);
  assert.match(grid, /if \(interactionLocked\) \{\s*releasePaginationFocusGuard\('interaction-locked'\)/);
  assert.match(grid, /!interactionLockedRef\.current && paginationRequestRef\.current === pending/);
});

test('Series detail keeps its outer and dropdown focus traps active', () => {
  assert.match(popup, /trapFocusLeft: true/);
  assert.match(popup, /trapFocusRight: true/);
  assert.match(popup, /trapFocusUp: true/);
  assert.match(popup, /trapFocusDown: true/);
  assert.match(popup, /reason: 'season-dropdown-open'/);
  assert.match(popup, /maxFrames: 6/);
  assert.match(popup, /isActive: \(\) => menuOpenRef\.current && menuOpenSessionRef\.current === session/);
});
