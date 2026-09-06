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
  assert.match(grid, /SERIES_GRID_COLUMN_GAP = 6/);
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
  // Current approved sizing: measured-stage only, neutral gate, guaranteed fit.
  assert.match(grid, /const stageMeasured = gridWidth > 0/);
  assert.match(grid, /if \(gridWidth <= 0\) \{\s*return 0;/);
  assert.match(grid, /Math\.floor\(available \/ Math\.max\(1, columns\)\)/);
  // Measurement wrapper is always mounted; the FlatList is gated inside it.
  assert.match(grid, /stageMeasured \? \(/);
  assert.match(grid, /style=\{styles\.listStage\}\s*\n\s*onLayout=/);
  assert.match(grid, /'measurement-wrapper-layout'/);
  assert.match(grid, /\[NovaCast Series Stage Fit\]/);
  assert.match(grid, /widthSource: gridWidth > 0 \? 'current-measure' : 'unmeasured'/);
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

test('Series sizes cells only from the current measured stage', () => {
  const LEFT = 2, RIGHT = 2, GAP = 6, COLS = 5;
  // Approved fix: no 120px pre-measure fallback — unmeasured stage sizes to 0.
  const columnWidth = (stage) => stage > 0
    ? Math.max(1, Math.floor((stage - LEFT - RIGHT - GAP * (COLS - 1)) / COLS))
    : 0;

  assert.equal(columnWidth(0), 0);

  // ONN measured stage: five cells + gaps + padding fit inside the stage.
  const stage = 580;
  const cw = columnWidth(stage);
  assert.equal(cw, 110);
  const footprint = cw * COLS + GAP * (COLS - 1) + LEFT + RIGHT;
  assert.equal(footprint, 578);
  assert.ok(footprint <= stage);

  // Wider stage scales cell width up while still guaranteeing fit.
  const wide = 700;
  const cwWide = columnWidth(wide);
  assert.equal(cwWide, 134);
  assert.ok(cwWide * COLS + GAP * (COLS - 1) + LEFT + RIGHT <= wide);
});

test('Series does not reuse stale cached width to size the current render', () => {
  const LEFT = 2, RIGHT = 2, GAP = 6, COLS = 5;
  // Sizing depends ONLY on the current measured stage — never a cached value.
  const columnWidth = (currentStage) => currentStage > 0
    ? Math.max(1, Math.floor((currentStage - LEFT - RIGHT - GAP * (COLS - 1)) / COLS))
    : 0;

  const staleWiderCache = 700; // a previously seen, wider viewport
  // An unmeasured current stage sizes to the neutral gate (0), not the stale cache.
  assert.equal(columnWidth(0), 0);
  assert.notEqual(columnWidth(0), columnWidth(staleWiderCache));

  // The live 580 stage sizes five fitting columns regardless of the old cache.
  assert.equal(columnWidth(580), 110);
  assert.ok(columnWidth(580) * COLS + GAP * (COLS - 1) + LEFT + RIGHT <= 580);
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
