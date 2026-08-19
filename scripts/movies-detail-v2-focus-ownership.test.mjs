import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript';

const screen = fs.readFileSync('src/features/movies/MoviesScreen.tsx', 'utf8');
const popup = fs.readFileSync('src/features/movies/components/MovieDetailPopupV2.tsx', 'utf8');
const helpers = fs.readFileSync('src/features/movies/moviesDetailPopupV2.ts', 'utf8');
const hostFocus = fs.readFileSync('src/features/movies/moviesBrowseListHostFocus.ts', 'utf8');
const categoryRail = fs.readFileSync('src/features/movies/components/MovieCategoryRail.tsx', 'utf8');
const posterGrid = fs.readFileSync('src/features/movies/components/MoviePosterGrid.tsx', 'utf8');
const toolbar = fs.readFileSync('src/features/movies/components/MovieToolbar.tsx', 'utf8');
const resumeDialog = fs.readFileSync('src/features/playback/continuity/PlaybackResumeDialog.tsx', 'utf8');
const resumeFocus = fs.readFileSync('src/features/playback/continuity/playbackResumeFocus.ts', 'utf8');

function transpileToModule(source, requireImpl) {
  const output = transpileModule(source, {
    compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(
    output,
    {
      module,
      exports: module.exports,
      require: requireImpl ?? (() => ({})),
      console,
      process,
      __DEV__: true,
    },
    { filename: 'helpers.ts' },
  );
  return module.exports;
}

function loadPopupHelpers() {
  return transpileToModule(helpers);
}

function loadHostHelpers() {
  return transpileToModule(hostFocus);
}

function sliceBlock(source, startNeedle, endNeedle) {
  const start = source.indexOf(startNeedle);
  assert.notEqual(start, -1, `missing block start: ${startNeedle}`);
  const end = source.indexOf(endNeedle, start);
  assert.notEqual(end, -1, `missing block end: ${endNeedle}`);
  return source.slice(start, end);
}

const closeBlock = sliceBlock(
  screen,
  'const closeMovieDetailPopupV2 = useCallback',
  "// Stage 4.2G natural: return-focus-requested",
);

test('1. ANY movie Detail initial open requests CTA focus', () => {
  const { shouldRequestMovieDetailPopupV2InitialFocus, resolveMovieDetailPopupV2InitialFocusId } =
    loadPopupHelpers();
  assert.equal(
    shouldRequestMovieDetailPopupV2InitialFocus({
      detailOpen: true,
      hasPrimaryAction: true,
      alreadyIssued: false,
    }),
    true,
  );
  assert.equal(
    resolveMovieDetailPopupV2InitialFocusId([{ id: 'play', disabled: false }]),
    'play',
  );
  assert.match(popup, /reason: 'detail-v2-initial-cta'/);
  assert.match(popup, /requestTvFocus\(/);
  assert.match(popup, /claimInitialCtaFocus/);
  assert.doesNotMatch(popup, /setTimeout\(/);
  assert.doesNotMatch(popup, /Platform\.isTV \? 90/);
});

test('2. resumable movie Detail initial open still requests CTA focus', () => {
  const { shouldRequestMovieDetailPopupV2InitialFocus, resolveMovieDetailPopupV2InitialFocusId } =
    loadPopupHelpers();
  assert.equal(
    resolveMovieDetailPopupV2InitialFocusId([{ id: 'play', disabled: false }]),
    'play',
  );
  assert.equal(
    shouldRequestMovieDetailPopupV2InitialFocus({
      detailOpen: true,
      hasPrimaryAction: true,
      alreadyIssued: false,
    }),
    true,
  );
  assert.match(screen, /playLabel=\{continueWatchingLabel\}/);
  assert.doesNotMatch(popup, /resumeEligible/);
  assert.doesNotMatch(popup, /hasResumeHistory/);
});

test('3. non-resumable movie Detail initial open still requests CTA focus', () => {
  const { shouldRequestMovieDetailPopupV2InitialFocus } = loadPopupHelpers();
  assert.equal(
    shouldRequestMovieDetailPopupV2InitialFocus({
      detailOpen: true,
      hasPrimaryAction: true,
      alreadyIssued: false,
    }),
    true,
  );
  assert.match(popup, /shouldRequestMovieDetailPopupV2InitialFocus\(\{[\s\S]*detailOpen: true/);
  assert.doesNotMatch(popup, /playLabel[\s\S]{0,40}Resume[\s\S]{0,40}requestTvFocus/);
});

test('4. focus request occurs once', () => {
  const { shouldRequestMovieDetailPopupV2InitialFocus } = loadPopupHelpers();
  assert.equal(
    shouldRequestMovieDetailPopupV2InitialFocus({
      detailOpen: true,
      hasPrimaryAction: true,
      alreadyIssued: true,
    }),
    false,
  );
  assert.match(popup, /initialFocusIssuedForMovieRef/);
  assert.match(popup, /if \(initialFocusIssuedForMovieRef\.current === movieId\)/);
  const requestCount = (popup.match(/requestTvFocus\(\{/g) ?? []).length;
  assert.equal(requestCount, 1);
});

test('5. category ROWS disabled while Detail open', () => {
  assert.match(categoryRail, /if \(!focusable\) \{/);
  assert.match(categoryRail, /<View[\s\S]{0,80}focusable=\{false\}/);
  assert.match(screen, /<MovieCategoryRail/);
  assert.match(screen, /focusable=\{chromeFocusable && !searchBlocksBrowse && backgroundTvFocusEnabled\}/);
  assert.match(screen, /!detailOpen &&/);
});

test('6. category FlatList\/ScrollView HOST disabled while Detail open', () => {
  const { resolveMoviesBrowseListHostProps, shouldMoviesBrowseListHostBeEnabled } = {
    ...loadHostHelpers(),
    ...loadPopupHelpers(),
  };
  assert.equal(
    shouldMoviesBrowseListHostBeEnabled({ detailPopupOpen: true, playbackUiActive: false }),
    false,
  );
  const disabled = resolveMoviesBrowseListHostProps({ hostEnabled: false });
  assert.equal(disabled.hostFocusable, false);
  assert.equal(disabled.scrollEnabled, false);
  assert.match(categoryRail, /applyMoviesBrowseListHostNativeFocus/);
  assert.match(categoryRail, /scrollEnabled=\{hostProps\.scrollEnabled\}/);
  assert.match(categoryRail, /focusable=\{hostProps\.hostFocusable\}/);
  assert.match(hostFocus, /getNativeScrollRef/);
  assert.match(hostFocus, /setNativeProps/);
  assert.match(categoryRail, /unexpected-background-focus/);
  assert.match(categoryRail, /focusedRegion: 'category-list-host'/);
});

test('7. poster rows disabled while Detail open', () => {
  assert.match(posterGrid, /postersFocusable \|\| \(closingFocusMovieId/);
  assert.match(screen, /areMoviesPostersNormallyFocusable\(detailFocusPhase\)/);
  const lifecycle = fs.readFileSync('src/features/movies/moviesDetailFocusLifecycle.ts', 'utf8');
  assert.match(
    lifecycle,
    /export function areMoviesPostersNormallyFocusable[\s\S]{0,80}phase === 'browse' \|\| phase === 'browse-restored'/,
  );
});

test('8. poster FlatList HOST disabled while Detail open', () => {
  const { resolveMoviesBrowseListHostProps } = loadHostHelpers();
  const disabled = resolveMoviesBrowseListHostProps({ hostEnabled: false });
  assert.equal(disabled.hostFocusable, false);
  assert.equal(disabled.scrollEnabled, false);
  assert.match(posterGrid, /applyMoviesBrowseListHostNativeFocus/);
  assert.match(posterGrid, /scrollEnabled=\{hostProps\.scrollEnabled\}/);
  assert.match(posterGrid, /focusable=\{hostProps\.hostFocusable\}/);
  assert.match(posterGrid, /focusedRegion: 'poster-list-host'/);
});

test('9. toolbar\/Search\/navbar disabled while Detail open', () => {
  assert.match(screen, /navigationFocusable=\{chromeFocusable && !searchBlocksBrowse && backgroundTvFocusEnabled\}/);
  assert.match(
    screen,
    /<MovieToolbar[\s\S]{0,80}focusable=\{chromeFocusable && !searchBlocksBrowse && backgroundTvFocusEnabled\}/,
  );
  assert.match(screen, /const chromeFocusable =[\s\S]{0,160}!detailOpen &&/);
  assert.match(toolbar, /focusable \? \(/);
  assert.match(toolbar, /<View focusable=\{false\} accessible=\{false\} pointerEvents="none"/);
});

test('10. LEFT from Detail CTA cannot reach Categories', () => {
  assert.match(popup, /pinDetailCtaLeftEdge/);
  assert.match(popup, /nextFocusLeft: handle/);
  assert.match(popup, /trapFocusLeft: true/);
  assert.match(popup, /destinations: guideDestinations/);
});

test('11. UP\/DOWN cannot scroll Categories behind Detail', () => {
  const { resolveMoviesBrowseListHostProps } = loadHostHelpers();
  assert.equal(resolveMoviesBrowseListHostProps({ hostEnabled: false }).scrollEnabled, false);
  assert.match(categoryRail, /scrollEnabled=\{hostProps\.scrollEnabled\}/);
  assert.doesNotMatch(
    categoryRail,
    /scrollEnabled=\{hostProps\.scrollEnabled\}[\s\S]{0,40}pointerEvents="none"/,
  );
});

test('12. Detail close restores origin poster', () => {
  assert.match(closeBlock, /reason: 'stage4n-restore-origin-poster'/);
  assert.match(closeBlock, /setDetailPopup\(\{ open: false/);
  assert.match(closeBlock, /phase: 'origin-focus-restored'/);
  const closeIndex = closeBlock.indexOf('setDetailPopup({ open: false');
  const focusIndex = closeBlock.indexOf("reason: 'stage4n-restore-origin-poster'");
  assert.ok(closeIndex > -1 && focusIndex > -1 && closeIndex < focusIndex);
});

test('13. origin poster restore never fires while Detail remains open', () => {
  assert.match(closeBlock, /isActive: \(\) => !detailPopupOpenRef\.current/);
  assert.match(closeBlock, /if \(detailPopupOpenRef\.current\) \{/);
  assert.match(closeBlock, /origin-restore-while-open/);
  const flipIndex = closeBlock.indexOf('detailPopupOpenRef.current = false');
  const restoreIndex = closeBlock.indexOf("reason: 'stage4n-restore-origin-poster'");
  assert.ok(flipIndex > -1 && restoreIndex > -1 && flipIndex < restoreIndex);
});

test('14. playback Back restores Detail CTA', () => {
  assert.match(screen, /visible=\{detailPopup\.open && !playbackUiActive\}/);
  assert.match(screen, /detailFocusTarget: 'play'/);
  assert.match(popup, /reason: 'detail-v2-initial-cta'/);
  assert.match(popup, /if \(!visible\) \{[\s\S]{0,180}initialFocusIssuedForMovieRef\.current = null/);
});

test('15. Resume dialog behavior remains unchanged', () => {
  assert.match(resumeFocus, /export function getResumeDialogInitialAction/);
  assert.match(resumeDialog, /hasTVPreferredFocus=\{preferResumeFocus\}/);
  assert.doesNotMatch(popup, /PlaybackResumeDialog/);
  assert.doesNotMatch(helpers, /PlaybackResumeDialog/);
});

test('host native apply reaches ScrollView, not only FlatList', () => {
  const { applyMoviesBrowseListHostNativeFocus, resolveMoviesBrowseListHostProps } = loadHostHelpers();
  const calls = [];
  const scroll = {
    setNativeProps: (props) => calls.push({ target: 'scroll', props }),
  };
  const list = {
    setNativeProps: (props) => calls.push({ target: 'list', props }),
    getNativeScrollRef: () => scroll,
  };
  applyMoviesBrowseListHostNativeFocus(list, false);
  assert.equal(calls.length, 2);
  assert.equal(calls[0]?.target, 'list');
  assert.equal(calls[0]?.props?.focusable, false);
  assert.equal(calls[0]?.props?.accessible, false);
  assert.equal(calls[1]?.target, 'scroll');
  assert.equal(calls[1]?.props?.focusable, false);
  assert.equal(calls[1]?.props?.accessible, false);
  assert.equal(resolveMoviesBrowseListHostProps({ hostEnabled: true }).hostFocusable, false);
  assert.equal(resolveMoviesBrowseListHostProps({ hostEnabled: true }).scrollEnabled, true);
});

test('ownership logger emits required phases and fields', () => {
  const { logMoviesDetailV2FocusOwnership } = loadPopupHelpers();
  const lines = [];
  const original = console.info;
  console.info = (message) => lines.push(String(message));
  try {
    logMoviesDetailV2FocusOwnership({
      phase: 'initial-focus-requested',
      movieId: 'movie-1',
      detailOpen: true,
      focusIssued: true,
      detailCtaHandlePresent: true,
      focusedRegion: 'detail-cta',
      categoryHostFocusable: false,
      posterHostFocusable: false,
    });
  } finally {
    console.info = original;
  }
  assert.match(lines[0] ?? '', /\[NovaCast Movies Detail Focus Lifecycle\]/);
  const payload = JSON.parse(String(lines[0]).replace('[NovaCast Movies Detail Focus Lifecycle] ', ''));
  assert.equal(payload.phase, 'initial-focus-requested');
  assert.equal(payload.movieId, 'movie-1');
  assert.equal(payload.detailOpen, true);
  assert.equal(payload.focusIssued, true);
  assert.equal(payload.detailCtaHandlePresent, true);
  assert.equal(payload.focusedRegion, 'detail-cta');
  assert.equal(payload.categoryHostFocusable, false);
  assert.equal(payload.posterHostFocusable, false);
  for (const phase of [
    'detail-open',
    'cta-ref-ready',
    'initial-focus-requested',
    'initial-focus-confirmed',
    'background-focus-disabled',
    'unexpected-background-focus',
    'detail-close',
    'origin-focus-restored',
  ]) {
    assert.match(helpers, new RegExp(`'${phase}'`));
  }
});
