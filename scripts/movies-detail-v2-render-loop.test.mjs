import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript';

const popup = fs.readFileSync('src/features/movies/components/MovieDetailPopupV2.tsx', 'utf8');
const helpers = fs.readFileSync('src/features/movies/moviesDetailPopupV2.ts', 'utf8');
const hostFocus = fs.readFileSync('src/features/movies/moviesBrowseListHostFocus.ts', 'utf8');
const categoryRail = fs.readFileSync('src/features/movies/components/MovieCategoryRail.tsx', 'utf8');
const posterGrid = fs.readFileSync('src/features/movies/components/MoviePosterGrid.tsx', 'utf8');
const recovery = fs.readFileSync('src/features/movies/moviesPageCommit.ts', 'utf8');
const model = fs.readFileSync('src/features/movies/useMoviesScreenModel.ts', 'utf8');

function transpileToModule(source) {
  const output = transpileModule(source, {
    compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(
    output,
    { module, exports: module.exports, require: () => ({}), console, process, __DEV__: true },
    { filename: 'helpers.ts' },
  );
  return module.exports;
}

function loadHelpers() {
  return transpileToModule(helpers);
}

test('1. MovieDetailPopupV2 initial mount does not create render/update loop', () => {
  assert.doesNotMatch(popup, /syncGuideDestinations/);
  assert.match(popup, /getActionButtonRef\(action\.id\)/);
  assert.match(popup, /if \(sameHandle\) \{\s*return;/);
  assert.match(popup, /destinationsPublishedRef/);
});

test('2. ActionButton callback ref with same native node is idempotent', () => {
  const { shouldPublishMovieDetailDestinations } = loadHelpers();
  assert.equal(
    shouldPublishMovieDetailDestinations({
      alreadyPublished: false,
      actionId: 'play',
      initialFocusActionId: 'play',
      instancePresent: true,
      sameHandle: true,
    }),
    false,
  );
  assert.match(popup, /const sameHandle = previous === instance/);
});

test('3. ref rerender does not repeatedly set React state', () => {
  const { shouldPublishMovieDetailDestinations } = loadHelpers();
  assert.equal(
    shouldPublishMovieDetailDestinations({
      alreadyPublished: true,
      actionId: 'play',
      initialFocusActionId: 'play',
      instancePresent: true,
      sameHandle: false,
    }),
    false,
  );
  assert.doesNotMatch(popup, /buttonRef=\{\(instance\) => \{/);
  assert.match(popup, /actionButtonRefs/);
});

test('4. initial focus request fires exactly once per Detail open', () => {
  const { shouldRequestMovieDetailPopupV2InitialFocus } = loadHelpers();
  assert.equal(
    shouldRequestMovieDetailPopupV2InitialFocus({
      detailOpen: true,
      hasPrimaryAction: true,
      alreadyIssued: true,
    }),
    false,
  );
  assert.match(popup, /if \(initialFocusIssuedForMovieRef\.current === movieId\)/);
  const requestCount = (popup.match(/requestTvFocus\(\{/g) ?? []).length;
  assert.equal(requestCount, 1);
});

test('5. CTA onFocus confirmation fires exactly once', () => {
  const { shouldConfirmMovieDetailInitialFocus } = loadHelpers();
  assert.equal(
    shouldConfirmMovieDetailInitialFocus({
      actionId: 'play',
      initialFocusActionId: 'play',
      alreadyConfirmed: false,
      visible: true,
    }),
    true,
  );
  assert.equal(
    shouldConfirmMovieDetailInitialFocus({
      actionId: 'play',
      initialFocusActionId: 'play',
      alreadyConfirmed: true,
      visible: true,
    }),
    false,
  );
  assert.match(popup, /initialFocusConfirmedRef\.current = true/);
});

test('6. preferred focus clears exactly once', () => {
  assert.match(popup, /setCtaFocusConsumed\(true\)/);
  assert.match(popup, /event: 'preferred-focus-change'/);
  const consumeCount = (popup.match(/setCtaFocusConsumed\(true\)/g) ?? []).length;
  assert.equal(consumeCount, 1);
});

test('7. rerender with identical props does not re-arm preferred focus', () => {
  const { shouldReArmMovieDetailPreferredFocus } = loadHelpers();
  assert.equal(
    shouldReArmMovieDetailPreferredFocus({
      openSession: 'movie-1',
      previousSession: 'movie-1',
    }),
    false,
  );
  assert.equal(
    shouldReArmMovieDetailPreferredFocus({
      openSession: 'movie-1',
      previousSession: null,
    }),
    true,
  );
  assert.match(popup, /shouldReArmMovieDetailPreferredFocus/);
});

test('8. destinations\/native handle state only changes when handle changes', () => {
  const { shouldPublishMovieDetailDestinations } = loadHelpers();
  assert.equal(
    shouldPublishMovieDetailDestinations({
      alreadyPublished: false,
      actionId: 'play',
      initialFocusActionId: 'play',
      instancePresent: true,
      sameHandle: false,
    }),
    true,
  );
  assert.equal(
    shouldPublishMovieDetailDestinations({
      alreadyPublished: false,
      actionId: 'favorite',
      initialFocusActionId: 'play',
      instancePresent: true,
      sameHandle: false,
    }),
    false,
  );
  assert.match(popup, /shouldPublishMovieDetailDestinations/);
  assert.match(popup, /destinations: guideDestinations/);
});

test('9. Detail close \+ reopen starts a fresh focus session exactly once', () => {
  const { shouldReArmMovieDetailPreferredFocus } = loadHelpers();
  assert.equal(
    shouldReArmMovieDetailPreferredFocus({
      openSession: 'movie-1',
      previousSession: null,
    }),
    true,
  );
  assert.match(popup, /initialFocusIssuedForMovieRef\.current = null/);
  assert.match(popup, /destinationsPublishedRef\.current = false/);
});

test('10. different movie open starts a fresh session', () => {
  const { shouldReArmMovieDetailPreferredFocus } = loadHelpers();
  assert.equal(
    shouldReArmMovieDetailPreferredFocus({
      openSession: 'movie-2',
      previousSession: 'movie-1',
    }),
    true,
  );
});

test('11. category\/poster host focus disabling remains intact', () => {
  assert.match(hostFocus, /applyMoviesBrowseListHostNativeFocus/);
  assert.match(hostFocus, /getNativeScrollRef/);
  assert.match(categoryRail, /applyMoviesBrowseListHostNativeFocus/);
  assert.match(posterGrid, /applyMoviesBrowseListHostNativeFocus/);
  assert.match(categoryRail, /scrollEnabled=\{hostProps\.scrollEnabled\}/);
  assert.match(posterGrid, /scrollEnabled=\{hostProps\.scrollEnabled\}/);
});

test('12. existing Detail focus ownership contracts remain in source', () => {
  assert.match(popup, /reason: 'detail-v2-initial-cta'/);
  assert.match(popup, /claimInitialCtaFocus/);
  assert.match(popup, /pinDetailCtaLeftEdge/);
  assert.match(popup, /trapFocusLeft: true/);
  assert.doesNotMatch(popup, /Platform\.isTV \? 90/);
});

test('13. Movies recovery contracts remain in source', () => {
  assert.match(recovery, /resolveMoviesPageCommitDecision/);
  assert.match(recovery, /resetMoviesPageCommitForTests|shouldRehydrateMoviesAfterInteractiveRemount/);
  assert.match(model, /resetMoviesBrowsePresentationLatches/);
  assert.match(model, /phase: 'commit-accepted'/);
});

test('focused action setter is idempotent', () => {
  const { shouldUpdateMovieDetailFocusedActionId } = loadHelpers();
  assert.equal(shouldUpdateMovieDetailFocusedActionId('play', 'play'), false);
  assert.equal(shouldUpdateMovieDetailFocusedActionId('play', 'favorite'), true);
  assert.equal(shouldUpdateMovieDetailFocusedActionId(null, 'play'), true);
  assert.match(popup, /shouldUpdateMovieDetailFocusedActionId/);
});
