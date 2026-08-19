import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  areMoviesBackgroundFocusablesEnabled,
  buildResumeDialogNativeFocusProps,
  getResumeDialogInitialAction,
  getResumeDialogNextAction,
  isMoviesRemoteEventActionable,
  resolveResumeLayerBackAction,
  shouldIgnoreMoviesRemoteInput,
  shouldResumeDialogOwnFocus,
} from '../src/features/playback/continuity/playbackResumeFocus.ts';
import {
  createMoviesBrowsePlaybackReturnTarget,
  createMoviesDetailPlaybackReturnTarget,
  isMoviesPlaybackReturnToDetail,
  shouldMoviesCloseDetailOnBack,
} from '../src/features/movies/moviesPlaybackReturnTarget.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dialog = readFileSync(join(root, 'src/features/playback/continuity/PlaybackResumeDialog.tsx'), 'utf8');
const movies = readFileSync(join(root, 'src/features/movies/MoviesScreen.tsx'), 'utf8');
const categoryRail = readFileSync(join(root, 'src/features/movies/components/MovieCategoryRail.tsx'), 'utf8');
const posterGrid = readFileSync(join(root, 'src/features/movies/components/MoviePosterGrid.tsx'), 'utf8');
const toolbar = readFileSync(join(root, 'src/features/movies/components/MovieToolbar.tsx'), 'utf8');
const hub = readFileSync(join(root, 'src/features/hub/MainMenuScreen.tsx'), 'utf8');
const gate = readFileSync(join(root, 'src/features/playback/continuity/playbackResumeGate.ts'), 'utf8');

test('dialog initial action is Resume', () => {
  assert.equal(getResumeDialogInitialAction(), 'resume');
  assert.match(dialog, /hasTVPreferredFocus=\{preferResumeFocus\}/);
  assert.match(dialog, /setFocusedAction\('resume'\)/);
});

test('Resume LEFT stays Resume', () => {
  assert.equal(getResumeDialogNextAction('resume', 'left'), 'resume');
  assert.equal(buildResumeDialogNativeFocusProps('resume', { resume: 11, restart: 22 }).nextFocusLeft, 11);
});

test('Resume UP stays Resume', () => {
  assert.equal(getResumeDialogNextAction('resume', 'up'), 'resume');
  assert.equal(buildResumeDialogNativeFocusProps('resume', { resume: 11, restart: 22 }).nextFocusUp, 11);
});

test('Resume RIGHT goes Restart', () => {
  assert.equal(getResumeDialogNextAction('resume', 'right'), 'restart');
  assert.equal(buildResumeDialogNativeFocusProps('resume', { resume: 11, restart: 22 }).nextFocusRight, 22);
});

test('Resume DOWN goes Restart', () => {
  assert.equal(getResumeDialogNextAction('resume', 'down'), 'restart');
  assert.equal(buildResumeDialogNativeFocusProps('resume', { resume: 11, restart: 22 }).nextFocusDown, 22);
});

test('Restart LEFT/UP goes Resume', () => {
  assert.equal(getResumeDialogNextAction('restart', 'left'), 'resume');
  assert.equal(getResumeDialogNextAction('restart', 'up'), 'resume');
  const props = buildResumeDialogNativeFocusProps('restart', { resume: 11, restart: 22 });
  assert.equal(props.nextFocusLeft, 11);
  assert.equal(props.nextFocusUp, 11);
});

test('Restart RIGHT/DOWN stays Restart', () => {
  assert.equal(getResumeDialogNextAction('restart', 'right'), 'restart');
  assert.equal(getResumeDialogNextAction('restart', 'down'), 'restart');
  const props = buildResumeDialogNativeFocusProps('restart', { resume: 11, restart: 22 });
  assert.equal(props.nextFocusRight, 22);
  assert.equal(props.nextFocusDown, 22);
});

test('containment is valid before the other button is measured', () => {
  const beforeRestart = buildResumeDialogNativeFocusProps('resume', { resume: 11, restart: null });
  assert.equal(beforeRestart.nextFocusLeft, 11);
  assert.equal(beforeRestart.nextFocusUp, 11);
  assert.equal(beforeRestart.nextFocusRight, 11);
  assert.equal(beforeRestart.nextFocusDown, 11);
  assert.match(dialog, /setNativeProps/);
  assert.match(dialog, /findNodeHandle\(instance\)/);
  assert.doesNotMatch(dialog, /onLayout=\{\(\) => \{/);
});

test('prompt owns focus and traps directionals away from the background', () => {
  assert.equal(shouldResumeDialogOwnFocus(true), true);
  assert.equal(shouldResumeDialogOwnFocus(false), false);
  assert.match(dialog, /trapFocusLeft: true/);
  assert.match(dialog, /trapFocusRight: true/);
  assert.match(dialog, /trapFocusUp: true/);
  assert.match(dialog, /trapFocusDown: true/);
  assert.match(dialog, /destinations/);
  assert.match(dialog, /accessibilityViewIsModal/);
  assert.match(movies, /resumePromptOpen/);
});

test('visual focused action follows native onFocus', () => {
  assert.match(dialog, /onFocus=\{\(\) => \{\s*setFocusedAction\('resume'\)/s);
  assert.match(dialog, /onFocus=\{\(\) => \{\s*setFocusedAction\('restart'\)/s);
  assert.match(dialog, /focusedAction === 'resume'/);
  assert.match(dialog, /focusedAction === 'restart'/);
});

test('resume prompt open makes Movies categories non-focusable', () => {
  assert.equal(areMoviesBackgroundFocusablesEnabled(true), false);
  assert.equal(areMoviesBackgroundFocusablesEnabled(false), true);
  assert.match(movies, /areMoviesBackgroundFocusablesEnabled\(resumePromptOpen\)/);
  assert.match(movies, /focusable=\{chromeFocusable && !searchBlocksBrowse && backgroundTvFocusEnabled\}/);
  assert.match(categoryRail, /extraData=\{`\$\{focusable\}/);
  assert.match(categoryRail, /if \(!focusable\)/);
});

test('movie posters are non-focusable while the prompt is open', () => {
  assert.match(movies, /backgroundTvFocusEnabled/);
  assert.match(movies, /postersFocusable/);
  assert.match(posterGrid, /extraData=\{`\$\{postersFocusable\}/);
});

test('detail controls are non-focusable while the prompt is open', () => {
  assert.match(movies, /visible=\{detailPopup\.open && !playbackUiActive\}/);
  assert.match(movies, /playbackUiActive = playbackActive \|\| playbackClosing \|\| launchingPlayback \|\| resumePromptOpen/);
});

test('toolbar and navbar cannot receive modal focus', () => {
  assert.match(movies, /navigationFocusable=\{chromeFocusable && !searchBlocksBrowse && backgroundTvFocusEnabled\}/);
  assert.match(movies, /focusable=\{chromeFocusable && !searchBlocksBrowse && backgroundTvFocusEnabled\}/);
  assert.match(toolbar, /focusable \? \(/);
});

test('closing the prompt restores background focusability', () => {
  assert.equal(areMoviesBackgroundFocusablesEnabled(false), true);
  assert.match(movies, /background-focus-restored/);
  assert.match(movies, /background-focus-disabled/);
});

test('Back on the prompt closes the prompt only', () => {
  assert.equal(
    resolveResumeLayerBackAction({ resumeDialogOpen: true, playerOpen: false, movieDetailOpen: true }),
    'resume-dialog',
  );
  assert.match(dialog, /back-consumed/);
  assert.match(dialog, /resolvePlaybackResumePrompt\('cancel'\)/);
  assert.equal(
    shouldMoviesCloseDetailOnBack({
      resumeDialogOpen: true,
      playbackActive: false,
      playbackClosing: false,
      launchingPlayback: true,
      detailPopupOpen: true,
    }),
    false,
  );
});

test('prompt cancel preserves Movie Detail', () => {
  assert.equal(
    shouldMoviesCloseDetailOnBack({
      resumeDialogOpen: false,
      playbackActive: false,
      playbackClosing: false,
      launchingPlayback: false,
      detailPopupOpen: true,
    }),
    true,
  );
  assert.match(movies, /isPlaybackResumePromptOpen\(\)/);
  assert.match(movies, /shouldMoviesCloseDetailOnBack/);
});

test('Movie Detail playback Back restores the same detail', () => {
  const target = createMoviesDetailPlaybackReturnTarget({
    movieId: 'movie-1',
    categoryId: 'cat-1',
    detailFocusTarget: 'play',
  });
  assert.equal(isMoviesPlaybackReturnToDetail(target), true);
  assert.match(movies, /setDetailPopup\(\{ open: true, movie: restoredMovie/);
  assert.match(movies, /logMoviesPlaybackReturn/);
  assert.match(movies, /detailRestored/);
});

test('selectedMovieId is preserved through player restore', () => {
  assert.match(movies, /restoredMovie\.id === returnTarget\.movieId/);
  assert.match(movies, /selectedMovieRef\.current/);
});

test('Home Continue Watching remains silent and does not open the prompt', () => {
  const target = createMoviesBrowsePlaybackReturnTarget({
    movieId: 'movie-cw',
    categoryId: 'smart:continue-watching',
  });
  assert.equal(target.kind, 'browse');
  assert.equal(isMoviesPlaybackReturnToDetail(target), false);
  assert.match(hub, /resumePolicy: 'silent'/);
  assert.match(gate, /policy === 'silent'/);
  assert.equal(
    resolveResumeLayerBackAction({ resumeDialogOpen: false, playerOpen: false, movieDetailOpen: false }),
    'screen',
  );
});

test('no double-Back propagation across layers', () => {
  assert.equal(
    resolveResumeLayerBackAction({ resumeDialogOpen: true, playerOpen: true, movieDetailOpen: true }),
    'resume-dialog',
  );
  assert.equal(
    resolveResumeLayerBackAction({ resumeDialogOpen: false, playerOpen: true, movieDetailOpen: true }),
    'player',
  );
  assert.equal(
    resolveResumeLayerBackAction({ resumeDialogOpen: false, playerOpen: false, movieDetailOpen: true }),
    'movie-detail',
  );
  assert.equal(
    shouldMoviesCloseDetailOnBack({
      resumeDialogOpen: false,
      playbackActive: true,
      playbackClosing: false,
      launchingPlayback: false,
      detailPopupOpen: true,
    }),
    false,
  );
  assert.equal(
    shouldMoviesCloseDetailOnBack({
      resumeDialogOpen: false,
      playbackActive: false,
      playbackClosing: false,
      launchingPlayback: false,
      detailPopupOpen: true,
      didJustClose: true,
    }),
    false,
  );
});

test('prompt open UP/DOWN/LEFT/RIGHT/SELECT are not actionable on Movies', () => {
  assert.equal(shouldIgnoreMoviesRemoteInput(true), true);
  assert.equal(isMoviesRemoteEventActionable(true, 'up'), false);
  assert.equal(isMoviesRemoteEventActionable(true, 'down'), false);
  assert.equal(isMoviesRemoteEventActionable(true, 'left'), false);
  assert.equal(isMoviesRemoteEventActionable(true, 'right'), false);
  assert.equal(isMoviesRemoteEventActionable(true, 'select'), false);
  assert.match(movies, /shouldIgnoreMoviesRemoteInput\(resumePromptOpenNow\)/);
  assert.match(categoryRail, /if \(!focusable\)/);
  assert.match(categoryRail, /pointerEvents="none"/);
});

test('Movies TVEventHandler ignores input while the prompt is open', () => {
  assert.match(movies, /shouldIgnoreMoviesRemoteInput/);
  assert.match(movies, /logResumeInputAudit/);
  assert.match(movies, /moviesRemoteHandlerReceived: true/);
});

test('category selection stays unchanged while the prompt is open', () => {
  assert.match(movies, /if \(isPlaybackResumePromptOpen\(\)\) \{/);
  assert.match(movies, /categoryIndexAfter: selectedCategoryId/);
  assert.match(categoryRail, /<View\s+focusable=\{false\}/s);
});

test('prompt close restores Movies remote handling', () => {
  assert.equal(shouldIgnoreMoviesRemoteInput(false), false);
  assert.equal(isMoviesRemoteEventActionable(false, 'down'), true);
  assert.equal(areMoviesBackgroundFocusablesEnabled(false), true);
});
