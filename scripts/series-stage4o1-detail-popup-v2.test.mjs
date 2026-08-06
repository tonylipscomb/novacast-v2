import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript';

const screen = fs.readFileSync('src/features/series/SeriesScreen.tsx', 'utf8');
const popup = fs.readFileSync('src/features/series/components/SeriesDetailPopupV2.tsx', 'utf8');
const helpers = fs.readFileSync('src/features/series/seriesDetailPopupV2.ts', 'utf8');
const focusDiag = fs.readFileSync('src/features/navigation/tvFocusDiagnostics.ts', 'utf8');

function sliceBlock(source, startNeedle, endNeedle) {
  const start = source.indexOf(startNeedle);
  assert.notEqual(start, -1, `missing block start: ${startNeedle}`);
  const end = source.indexOf(endNeedle, start);
  assert.notEqual(end, -1, `missing block end: ${endNeedle}`);
  return source.slice(start, end);
}

const closeBlock = sliceBlock(
  screen,
  'const closeSeriesDetailPopup = useCallback',
  'const closeSearch = useCallback',
);

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
    { filename: 'series-helpers.ts' },
  );
  return module.exports;
}

function loadPopupHelpers() {
  return transpileToModule(helpers);
}

function loadRequestTvFocus() {
  const module = transpileToModule(focusDiag, (request) => {
    if (request.includes('tvPerfStore')) {
      return {
        tvPerfRecordFocusRequest: () => undefined,
        tvPerfSetLatestFocusRequest: () => undefined,
      };
    }
    if (request.includes('appForegroundGate')) {
      return { isAppForegroundActive: () => true };
    }
    if (request.includes('focusRequestAudit')) {
      return { recordFocusAudit: () => undefined };
    }
    return {};
  });
  return module.requestTvFocus;
}

function runNestedNodeTest(file) {
  // node:test refuses to run a nested `--test` invocation in the same process
  // tree (it detects NODE_TEST_CONTEXT and silently skips). Strip it so this
  // spawned child actually executes as its own top-level test run.
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  return spawnSync(process.execPath, ['--experimental-strip-types', '--test', file], {
    encoding: 'utf8',
    env,
  });
}

// 1. SeriesScreen renders SeriesDetailPopupV2.
test('1. SeriesScreen renders SeriesDetailPopupV2', () => {
  assert.match(screen, /import \{ SeriesDetailPopupV2 \} from '\.\/components\/SeriesDetailPopupV2';/);
  assert.match(screen, /<SeriesDetailPopupV2/);
});

// 2. Old SeriesDetailOverlay is not active.
test('2. Old SeriesDetailOverlay is not active', () => {
  assert.doesNotMatch(screen, /<SeriesDetailOverlay/);
  assert.doesNotMatch(screen, /from '\.\/components\/SeriesDetailOverlay'/);
  // Legacy overlay open/close paths remain in source (disconnected) but are
  // guarded — any execution while V2 owns Detail is a logged violation.
  assert.match(screen, /logSeriesDetailLegacyOverlayPathViolation/);
  assert.match(screen, /if \(seriesDetailPopupOpenRef\.current\) \{\s*logSeriesDetailLegacyOverlayPathViolation/);
});

// 3. Popup is compact, not full-screen.
test('3. Popup is compact, not full-screen (~58-64% of screen width)', () => {
  const { computeSeriesDetailPopupV2Layout } = loadPopupHelpers();
  const layout = computeSeriesDetailPopupV2Layout({ screenWidth: 1920, screenHeight: 1080 });
  const ratio = layout.popupWidth / 1920;
  assert.ok(ratio >= 0.55 && ratio <= 0.66, `popup width ratio out of range: ${ratio}`);
  assert.match(popup, /computeSeriesDetailPopupV2Layout/);
  assert.doesNotMatch(popup, /width: '100%'[\s\S]{0,20}card/);
});

// 4. Poster stays in left column.
test('4. Poster stays in left column', () => {
  const { computeSeriesDetailPopupV2Layout } = loadPopupHelpers();
  const layout = computeSeriesDetailPopupV2Layout({ screenWidth: 1920, screenHeight: 1080 });
  const ratio = layout.posterWidth / layout.popupWidth;
  assert.ok(ratio >= 0.24 && ratio <= 0.32, `poster width ratio out of range: ${ratio}`);
  assert.match(popup, /posterPanel:/);
  assert.doesNotMatch(popup, /posterPanel:[\s\S]{0,80}width: '100%'/);
  const rowIdx = popup.indexOf('styles.contentRow');
  const posterIdx = popup.indexOf('posterPanel', rowIdx);
  const copyIdx = popup.indexOf('copyPanel', rowIdx);
  assert.ok(rowIdx > -1 && posterIdx > rowIdx && copyIdx > posterIdx, 'poster column must precede copy column');
});

// 5. Background remains translucent.
test('5. Background remains translucent', () => {
  assert.match(popup, /BlurView intensity=\{\d+\} tint="dark"/);
  assert.match(popup, /rgba\(0, 0, 0, 0\.62\)/);
});

// 6. No BlurTargetView or blurTargetId.
test('6. No BlurTargetView or blurTargetId', () => {
  assert.doesNotMatch(popup, /BlurTargetView/);
  assert.doesNotMatch(popup, /blurTargetId/);
  assert.doesNotMatch(popup, /\bblurTarget\b/);
});

// 7. Play/Resume receives initial focus.
test('7. Play/Resume receives initial focus', () => {
  const { resolveSeriesDetailPopupV2InitialFocusId } = loadPopupHelpers();
  assert.equal(
    resolveSeriesDetailPopupV2InitialFocusId([
      { id: 'play', disabled: false },
      { id: 'episodes', disabled: false },
    ]),
    'play',
  );
  assert.equal(
    resolveSeriesDetailPopupV2InitialFocusId([
      { id: 'play', disabled: true },
      { id: 'episodes', disabled: false },
    ]),
    'episodes',
  );
  assert.equal(resolveSeriesDetailPopupV2InitialFocusId([]), null);
  assert.match(popup, /resolveSeriesDetailPopupV2InitialFocusId/);
  assert.match(popup, /hasTVPreferredFocus=\{preferred && focusable\}/);
});

// 8. Episodes is D-pad reachable.
test('8. Episodes is D-pad reachable', () => {
  const { isSeriesDetailPopupV2EpisodesActionEnabled } = loadPopupHelpers();
  assert.equal(isSeriesDetailPopupV2EpisodesActionEnabled(2), true);
  assert.equal(isSeriesDetailPopupV2EpisodesActionEnabled(0), false);
  assert.match(popup, /id: 'episodes'/);
  assert.match(popup, /focusEpisodesArea/);
  assert.match(popup, /onPress: focusEpisodesArea/);
});

// 9. Focus ring state resets on every open.
test('9. Focus ring state resets on every open', () => {
  assert.match(popup, /wasVisibleRef/);
  assert.match(popup, /const opening = !wasVisibleRef\.current;/);
  assert.match(popup, /setCloseFocused\(false\);/);
  assert.match(popup, /setFocusedActionId\(null\);/);
});

// 10. Back and X use the same close function.
test('10. Back and X use the same close function', () => {
  assert.match(screen, /onClose=\{\(source\) => closeSeriesDetailPopup\(source\)\}/);
  assert.match(screen, /closeSeriesDetailPopup\('back'\)/);
  assert.match(popup, /onPress=\{\(\) => requestClose\('x'\)\}/);
  assert.match(popup, /onClose\(source\);/);
});

// 11. Close is one transition.
test('11. Close is one transition', () => {
  const setCalls = closeBlock.match(/setSeriesDetailPopup\(/g) ?? [];
  assert.equal(setCalls.length, 1);
  for (const phase of [
    'closing-prepare',
    'closing-viewport',
    'closing-focus',
    'closing-confirm',
    'return-focus-requested',
    'return-focus-confirmed',
    'browse-restored',
  ]) {
    assert.doesNotMatch(closeBlock, new RegExp(phase));
  }
});

// 12. Origin Series card is preferred in the close render.
test('12. Origin Series card is preferred in the close render', () => {
  const setTargetIndex = closeBlock.indexOf('setSeriesV2CloseFocusTargetId(originItemId)');
  const rafIndex = closeBlock.indexOf('requestAnimationFrame(');
  assert.ok(setTargetIndex > -1, 'expected setSeriesV2CloseFocusTargetId(originItemId) in close block');
  assert.ok(
    setTargetIndex < rafIndex,
    'seriesV2CloseFocusTargetId must be set synchronously, before the deferred focus request',
  );
  assert.match(screen, /const \[seriesV2CloseFocusTargetId, setSeriesV2CloseFocusTargetId\]/);
  assert.match(screen, /closingFocusSeriesId=\{seriesV2CloseFocusTargetId\}/);
});

// 13. Fallback focus request is at most once.
test('13. Fallback focus request is at most once', () => {
  const requestCount = (closeBlock.match(/requestTvFocus\(\{/g) ?? []).length;
  assert.equal(requestCount, 1);

  const requestTvFocus = loadRequestTvFocus();
  let focused = 0;
  const target = { focus: () => { focused += 1; } };
  const results = [];
  requestTvFocus({
    screen: 'series',
    source: 'test',
    region: 'poster-grid',
    itemId: 'series-1',
    reason: 'stage4o1-unit',
    getTarget: () => target,
    onResult: (result) => results.push(result),
  });
  assert.equal(focused, 1);
  assert.equal(results[0]?.requested, true);
});

// 14. Invalid focus target never throws.
test('14. Invalid focus target never throws', () => {
  const requestTvFocus = loadRequestTvFocus();
  const results = [];
  assert.doesNotThrow(() => {
    requestTvFocus({
      screen: 'series',
      source: 'test',
      region: 'poster-grid',
      reason: 'stage4o1-unit',
      getTarget: () => ({ /* no focus method */ }),
      onResult: (result) => results.push(result),
    });
  });
  assert.equal(results[0]?.requested, false);
});

// 15. Grid remains mounted.
test('15. Grid remains mounted', () => {
  assert.match(screen, /<SeriesPosterGrid/);
  assert.match(screen, /gridInstanceIdRef/);
  assert.doesNotMatch(screen, /seriesDetailPopup\.open[\s\S]{0,80}return null[\s\S]{0,40}SeriesPosterGrid/);
  assert.match(screen, /setOnnSeriesGridMounted\(true, instanceId\)/);
});

// 16. Category and offset remain unchanged.
test('16. Category and offset remain unchanged', () => {
  assert.doesNotMatch(closeBlock, /selectCategory\(/);
  assert.doesNotMatch(closeBlock, /setViewportRestoreCommand/);
  assert.doesNotMatch(closeBlock, /scrollToOffset/);
  const openBlock = sliceBlock(screen, 'const handleSelectSeries = useCallback', 'const handleRegisterPosterRef');
  assert.doesNotMatch(openBlock, /selectCategory\(/);
  assert.doesNotMatch(openBlock, /setVisibleItems|setCategories/);
});

// 17. Enrichment errors stay in popup.
test('17. Enrichment errors stay in popup', () => {
  assert.match(screen, /error=\{detailError\}/);
  assert.match(popup, /errorLine/);
  assert.doesNotMatch(popup, /Something went wrong/);
  // Enrichment failure never closes the popup nor disables Episodes when
  // local season/episode data already exists.
  assert.match(popup, /isSeriesDetailPopupV2EpisodesActionEnabled\(seasons\.length\)/);
});

// 18. Episode errors stay in popup.
test('18. Episode errors stay in popup', () => {
  assert.match(screen, /playbackError=\{episodePlaybackError\}/);
  assert.match(popup, /playbackError/);
  assert.doesNotMatch(
    screen.slice(screen.indexOf('const playEpisodeById'), screen.indexOf('const playFirstEpisode')),
    /router\.replace|router\.push|Something went wrong/,
  );
});

// 19. Episode playback returns to same popup.
test('19. Episode playback returns to same popup', () => {
  assert.match(screen, /series_detail_popup_v2_revealed_after_playback/);
  assert.match(screen, /if \(seriesDetailPopup\.open\) \{/);
  assert.doesNotMatch(
    screen.slice(screen.indexOf('const playEpisodeById'), screen.indexOf('const playFirstEpisode')),
    /setSeriesDetailPopup\(\{ open: false/,
  );
});

// 20. Playback failure restores usable popup focus.
test('20. Playback failure restores usable popup focus', () => {
  const playBlock = sliceBlock(screen, 'const playEpisodeById = useCallback', 'const playFirstEpisode = useCallback');
  assert.match(playBlock, /setLaunchingEpisodePlayback\(true\)/);
  assert.match(playBlock, /finally \{/);
  assert.match(playBlock, /setLaunchingEpisodePlayback\(false\);/);
  assert.match(playBlock, /setEpisodePlaybackError\(/);
  assert.doesNotMatch(playBlock, /router\.replace|router\.push/);
});

// 21. Back order is episode -> popup -> browse.
test('21. Back order is episode -> popup -> browse', () => {
  const backGuardStart = screen.indexOf('if (seriesDetailPopupOpenRef.current) {');
  const backGuardEnd = screen.indexOf('if (guide.visible) {', backGuardStart);
  assert.ok(backGuardStart > -1 && backGuardEnd > backGuardStart);
  const backGuardBlock = screen.slice(backGuardStart, backGuardEnd);
  assert.match(backGuardBlock, /episodesAreaFocusedRef\.current/);
  assert.match(backGuardBlock, /setEpisodesFocusReturnToken\(\(token\) => token \+ 1\)/);
  assert.match(backGuardBlock, /closeSeriesDetailPopup\('back'\)/);
  // Episode-area Back returns focus to the Episodes action; only a second
  // Back (once episodesAreaFocusedRef is false) closes the popup itself.
  const episodeBranchIdx = backGuardBlock.indexOf('episodesAreaFocusedRef.current) {');
  const closeCallIdx = backGuardBlock.indexOf("closeSeriesDetailPopup('back')");
  assert.ok(episodeBranchIdx > -1 && closeCallIdx > episodeBranchIdx);
});

// 22. Stage 4.2O browse tests remain passing (31/31).
test('22. Stage 4.2O browse tests remain passing', () => {
  const result = runNestedNodeTest('scripts/series-stage4o-browse-rebuild.test.mjs');
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  assert.match(output, /# pass 31/);
  assert.doesNotMatch(output, /# fail [1-9]/);
});

// 23. Movies Stage 4.2N tests remain 24/24.
test('23. Movies Stage 4.2N tests remain 24/24', () => {
  const result = runNestedNodeTest('scripts/movies-stage4n-detail-popup-v2.test.mjs');
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  assert.match(output, /# pass 24/);
  assert.doesNotMatch(output, /# fail [1-9]/);
});

test('Stage 4.2O.1 marker present and forbidden legacy-overlay log wired', () => {
  assert.match(helpers, /SERIES_DETAIL_POPUP_V2_MARKER = 'series-detail-popup-v2-adapter'/);
  assert.match(screen, /series_detail_popup_v2_active/);
  assert.match(screen, /logSeriesDetailLegacyOverlayPathViolation/);
});

test('Movies files were not touched by Stage 4.2O.1', () => {
  const result = spawnSync('git', ['status', '--porcelain', '--', 'src/features/movies'], {
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, `git status failed: ${result.stderr}`);
  assert.equal(
    result.stdout.trim(),
    '',
    `Movies files must not change during Stage 4.2O.1, but git reports:\n${result.stdout}`,
  );
});
