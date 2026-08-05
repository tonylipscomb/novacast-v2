import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  buildMovieDetailMetaChips,
  deriveStreamQualityBadges,
  formatCastLine,
  formatMovieRating,
  formatRuntimeDisplay,
  heroBackdropUri,
  joinMetaChips,
  MOVIE_DETAIL_BLUR_MS,
  MOVIE_DETAIL_CAST_LIMIT,
  MOVIE_DETAIL_CLOSE_MS,
  MOVIE_DETAIL_OPEN_MS,
  MOVIE_DETAIL_RELATED_LIMIT,
  MOVIE_DETAIL_SYNOPSIS_MAX_LINES,
  MOVIE_DETAIL_TITLE_MAX_LINES,
  resolveCompactDetailCardSize,
  resolveContinueWatchingLabel,
  resolveContinueWatchingProgress,
  resolveTitleFontSize,
  selectRelatedMovies,
  shouldShowCompactRelatedRow,
} from '../src/features/movies/movieDetailOverlayModel.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const overlay = read('src/features/movies/components/MovieDetailOverlay.tsx');
const screen = read('src/features/movies/MoviesScreen.tsx');
const model = read('src/features/movies/movieDetailOverlayModel.ts');

test('quality badges derive resolution/HDR/audio from known signals only', () => {
  const badges = deriveStreamQualityBadges({
    title: 'Demo 4K HDR Dolby Atmos',
    containerExtension: 'mkv',
    audio: 'English',
  });
  assert.deepEqual(
    badges.map((badge) => badge.label),
    ['4K', 'HDR', 'Atmos', 'MKV'],
  );
  assert.equal(deriveStreamQualityBadges({ title: 'Plain Title' }).length, 0);
});

test('truthful quality badges never invent Atmos/HDR without signals', () => {
  const badges = deriveStreamQualityBadges({
    title: 'Quiet Drama',
    containerExtension: 'mp4',
    synopsis: 'A thoughtful story.',
  });
  assert.deepEqual(
    badges.map((badge) => badge.label),
    ['MP4'],
  );
  assert.ok(!badges.some((badge) => /atmos|hdr|4k/i.test(badge.label)));
});

test('continue watching label and progress stay precise', () => {
  assert.equal(resolveContinueWatchingLabel(42), 'Resume');
  assert.equal(resolveContinueWatchingLabel(0), 'Play');
  assert.equal(resolveContinueWatchingLabel(95), 'Play');
  assert.equal(resolveContinueWatchingProgress(42), 42);
  assert.equal(resolveContinueWatchingProgress(95), null);
});

test('metadata separators never render empty values', () => {
  const chips = buildMovieDetailMetaChips({
    year: '2024',
    runtime: '',
    contentRating: null,
    rating: undefined,
    director: '  ',
    audio: 'English',
  });
  assert.deepEqual(chips, ['2024', 'English']);
  assert.equal(joinMetaChips(chips), '2024  ·  English');
  assert.doesNotMatch(joinMetaChips(chips), /N\/A|undefined|null|·\s*·/);
});

test('runtime and rating formatting stay clean', () => {
  assert.equal(formatRuntimeDisplay(125), '2h 5m');
  assert.equal(formatRuntimeDisplay('90'), '1h 30m');
  assert.equal(formatRuntimeDisplay(''), undefined);
  assert.equal(formatMovieRating(8.26), '8.3');
  assert.equal(formatMovieRating(null), undefined);
});

test('long title and synopsis layout contracts (compact card)', () => {
  assert.equal(MOVIE_DETAIL_TITLE_MAX_LINES, 2);
  assert.equal(MOVIE_DETAIL_SYNOPSIS_MAX_LINES, 3);
  assert.match(overlay, /MOVIE_DETAIL_TITLE_MAX_LINES/);
  assert.match(overlay, /MOVIE_DETAIL_SYNOPSIS_MAX_LINES/);
  assert.match(overlay, /numberOfLines=\{MOVIE_DETAIL_TITLE_MAX_LINES\}/);
  assert.match(overlay, /numberOfLines=\{MOVIE_DETAIL_SYNOPSIS_MAX_LINES\}/);
  assert.match(overlay, /resolveTitleFontSize/);
  assert.ok(resolveTitleFontSize(1920) >= resolveTitleFontSize(720));
});

test('no full-screen movie backdrop image; blur sits behind the card', () => {
  assert.doesNotMatch(overlay, /heroBackdropUri|heroImage|HeroGradients|heroGradientLeft/);
  assert.doesNotMatch(overlay, /styles\.heroImage|backdropUri &&/);
  assert.match(overlay, /BlurView/);
  assert.match(overlay, /backgroundBlur|backgroundScrim/);
  assert.match(overlay, /intensity=\{28\}|intensity=\{2[2-9]\}|intensity=\{3[0-2]\}/);
  assert.match(overlay, /rgba\(4,\s*7,\s*12,\s*0\.(5[5-9]|6\d|7[0])\)/);
  assert.match(overlay, /focusable=\{false\}/);
  assert.match(overlay, /pointerEvents=\"none\"/);
});

test('compact card has bounded responsive width and height; no vertical ScrollView', () => {
  assert.match(model, /resolveCompactDetailCardSize/);
  assert.match(overlay, /resolveCompactDetailCardSize/);
  assert.match(overlay, /compactCard/);
  const size1080 = resolveCompactDetailCardSize(1920, 1080);
  const size720 = resolveCompactDetailCardSize(1280, 720);
  assert.ok(size1080.width / 1920 >= 0.72 && size1080.width / 1920 <= 0.82);
  assert.ok(size1080.height / 1080 >= 0.68 && size1080.height / 1080 <= 0.78);
  assert.ok(size720.width <= 1280 * 0.82);
  assert.ok(size720.height <= 720 * 0.78);
  assert.doesNotMatch(overlay, /ScrollView/);
  assert.doesNotMatch(overlay, /infoScroll/);
});

test('cast is concise, non-focusable text; related capped for compact mode', () => {
  assert.equal(MOVIE_DETAIL_CAST_LIMIT, 3);
  assert.equal(MOVIE_DETAIL_RELATED_LIMIT, 5);
  assert.equal(
    formatCastLine(
      [{ name: 'One' }, { name: 'Two' }, { name: 'Three' }, { name: 'Four' }],
      MOVIE_DETAIL_CAST_LIMIT,
    ),
    'Cast: One • Two • Three',
  );
  assert.match(overlay, /formatCastLine/);
  assert.match(overlay, /styles\.castLine/);
  // Cast is plain Text — never wrapped in a focusable Pressable.
  assert.doesNotMatch(overlay, /Pressable[\s\S]{0,120}castLine|castLine[\s\S]{0,80}Pressable/);
  assert.doesNotMatch(overlay, /CastCarousel|castCard|castAvatar/);
  assert.match(overlay, /RelatedCompactRow|More Like This/);
  assert.match(overlay, /MOVIE_DETAIL_RELATED_LIMIT/);
  assert.match(overlay, /shouldShowCompactRelatedRow/);
  assert.equal(shouldShowCompactRelatedRow(699), false);
  assert.equal(shouldShowCompactRelatedRow(700), true);
});

test('related titles use cached genre/category overlap without network', () => {
  const selected = {
    id: 'a',
    title: 'Alpha',
    genres: ['Action', 'Sci-Fi'],
    categoryId: 'cat-1',
    posterStyleKey: 'orbit',
  };
  const candidates = [
    selected,
    { id: 'b', title: 'Bravo', genres: ['Action'], categoryId: 'cat-1', posterStyleKey: 'orbit' },
    { id: 'c', title: 'Charlie', genres: ['Comedy'], categoryId: 'cat-2', posterStyleKey: 'orbit' },
    { id: 'd', title: 'Delta', genres: ['Sci-Fi', 'Action'], categoryId: 'cat-9', posterStyleKey: 'orbit' },
  ];
  const related = selectRelatedMovies(selected, candidates, 3);
  assert.equal(related[0]?.id, 'd');
  assert.ok(related.every((item) => item.id !== 'a'));
});

test('related titles exclude the selected movie and stay bounded', () => {
  const selected = {
    id: 'self',
    title: 'Self',
    genres: ['Drama'],
    categoryId: 'cat',
    posterStyleKey: 'orbit',
  };
  const candidates = [
    selected,
    ...Array.from({ length: 20 }, (_, index) => ({
      id: `r${index}`,
      title: `Related ${index}`,
      genres: ['Drama'],
      categoryId: 'cat',
      posterStyleKey: 'orbit',
    })),
  ];
  const related = selectRelatedMovies(selected, candidates, MOVIE_DETAIL_RELATED_LIMIT);
  assert.equal(related.length, MOVIE_DETAIL_RELATED_LIMIT);
  assert.ok(related.every((item) => item.id !== 'self'));
});

test('rating formatting and poster-only backdrop helper retained for fallbacks', () => {
  assert.equal(formatMovieRating(8.26), '8.3');
  assert.equal(formatMovieRating('7.1'), '7.1');
  assert.equal(heroBackdropUri({ backdropUrl: 'https://x/b.jpg', posterUrl: 'https://x/p.jpg' }), 'https://x/b.jpg');
  assert.equal(heroBackdropUri({ posterUrl: 'https://x/p.jpg' }), 'https://x/p.jpg');
});

test('MovieDetailOverlay is Reanimated modal shell with TV focus traps', () => {
  assert.match(overlay, /react-native-reanimated/);
  assert.match(overlay, /withTiming/);
  assert.match(overlay, /TVFocusGuideView|FocusBoundaryView/);
  assert.match(overlay, /focusHandoffActive/);
  assert.match(overlay, /closeTargetRef/);
  assert.match(overlay, /deriveStreamQualityBadges/);
  assert.match(overlay, /translateY: interpolate\(progress\.value, \[0, 1\], \[16, 0\]\)/);
  assert.match(overlay, /scale: interpolate\(progress\.value, \[0, 1\], \[0\.97, 1\]\)/);
  assert.doesNotMatch(overlay, /router\.push|href=\{/);
});

test('overlay animation durations remain bounded', () => {
  assert.ok(MOVIE_DETAIL_OPEN_MS >= 140 && MOVIE_DETAIL_OPEN_MS <= 200);
  assert.ok(MOVIE_DETAIL_CLOSE_MS <= 160);
  assert.ok(MOVIE_DETAIL_BLUR_MS >= 120 && MOVIE_DETAIL_BLUR_MS <= 180);
  assert.match(overlay, /MOVIE_DETAIL_OPEN_MS/);
  assert.match(overlay, /MOVIE_DETAIL_CLOSE_MS/);
  assert.match(overlay, /MOVIE_DETAIL_BLUR_MS/);
});

test('loading is non-focusable; focused and selected action states are distinct', () => {
  assert.match(overlay, /Updating details/);
  assert.match(overlay, /detailLoading[\s\S]{0,220}pointerEvents=\"none\"|pointerEvents=\"none\"[\s\S]{0,120}Updating details/);
  assert.match(overlay, /focused && novaTvFocus\.active/);
  assert.match(overlay, /actionSelected/);
  assert.match(overlay, /isFavorite|isWatchlisted/);
});

test('disabled and unavailable actions are not focusable; retry joins graph when available', () => {
  assert.match(overlay, /const focusable = Boolean\(onPress\) && !disabled/);
  assert.match(overlay, /showRetry \? 'retry'/);
  assert.match(overlay, /id === 'retry'/);
  assert.match(overlay, /Boolean\(detailError && onRetry\)|showRetry =/);
});

test('Play/Resume receives preferred initial focus; focus stays trapped', () => {
  assert.match(overlay, /hasTVPreferredFocus=\{preferred && focusable\}/);
  assert.match(overlay, /detail-open-action/);
  assert.match(overlay, /trapFocusLeft:\s*true/);
  assert.match(overlay, /trapFocusUp:\s*true/);
  assert.match(overlay, /trapFocusDown:\s*true/);
  assert.match(overlay, /maxAttempts = Platform\.isTV \? 2 : 4/);
});

test('MoviesScreen keeps grid mounted and blurs it under compact detail', () => {
  assert.match(screen, /MovieDetailOverlay/);
  assert.match(screen, /blurTarget=\{browseLayerRef\}/);
  assert.match(screen, /browseLayerRef/);
  assert.match(screen, /MoviePosterGrid/);
  assert.doesNotMatch(screen, /MediaDetailOverlay/);
  assert.match(screen, /relatedMovies=\{relatedMovies\}/);
  assert.match(screen, /continueWatchingLabel=\{continueWatchingLabel\}/);
  assert.match(screen, /selectRelatedMovies/);
  assert.match(screen, /onSelectRelated/);
  assert.doesNotMatch(screen, /router\.push\(['\"]\/movie/);
});

test('related selection updates detail in place without catalog refetch', () => {
  assert.match(screen, /handleSelectRelatedMovie/);
  assert.match(screen, /handleSelectMovie\(movie\)/);
  assert.doesNotMatch(screen, /onSelectRelated[\s\S]{0,200}loadMovies|refetchAll|reloadCatalog/);
  assert.match(screen, /selectRelatedMovies\(selectedMovie, visibleMovies, MOVIE_DETAIL_RELATED_LIMIT\)/);
});

test('close/back remain lifecycle-driven one-press contracts', () => {
  assert.match(screen, /onClose=\{closeDetail\}/);
  assert.match(overlay, /onClose/);
  assert.match(screen, /moviesDetailFocusLifecycle|detailFocusPhase|focusHandoffActive/);
});

test('Stage 4.2C: Close button is TV-focusable inside the focus trap', () => {
  assert.match(overlay, /closeButtonRef/);
  assert.match(overlay, /ref=\{closeButtonRef\}/);
  assert.match(overlay, /setCloseHandle\(handleFor\(closeButtonRef\)/);
  assert.match(overlay, /focusable=\{closeFocusable\}/);
  assert.match(overlay, /hasTVPreferredFocus=\{false\}/);
  assert.match(overlay, /accessibilityLabel=\"Close movie details\"/);
  // Close is not preferred initial focus — Play remains preferred on Detail open.
  assert.match(overlay, /hasTVPreferredFocus=\{preferred && focusable\}/);
  // Stage 4.2J: preferred focus still targets firstAction when handoff is inactive
  // (!holdCoverActive). During natural Back/X handoff, forceFocusable preserves the
  // current Detail action instead of the obsolete focusHandoffActive preferred expression.
  assert.match(overlay, /preferred=\{!holdCoverActive && id === firstAction\}/);
  assert.match(overlay, /forceFocusable=\{preserveThisAction\}/);
  assert.match(
    overlay,
    /const preserveThisAction =\s*ownerPreservedHandoff && \(focusedTarget === id \|\| \(focusedTarget == null && id === firstAction\)\)/,
  );
  assert.match(overlay, /const ownerPreservedHandoff = preserveCloseButtonFocus && holdCoverActive/);
  assert.match(overlay, /const mountHiddenHandoffTarget = holdCoverActive && !preserveCloseButtonFocus/);
  // Hidden handoff is not required for natural mounted return (owner preserved).
  assert.doesNotMatch(overlay, /preferred=\{!focusHandoffActive && id === firstAction\}/);
  // Action Up → Close; Close Down → Play.
  assert.match(overlay, /nextFocusUp=\{closeHandle \?\? actionHandles\[id\]\}/);
  assert.match(overlay, /nextFocusDown: playFocusHandle/);
  // Related Up stays on actions, not Close.
  assert.match(overlay, /nextFocusUp=\{playFocusHandle\}/);
  // Same external close callback with debounce (no duplicate activate).
  assert.match(overlay, /invokeClose/);
  assert.match(overlay, /lastCloseInvokeAtRef/);
  assert.match(overlay, /onClose\(\)/);
  assert.match(overlay, /now - lastCloseInvokeAtRef\.current < 400/);
  assert.match(overlay, /action: 'close_focus'/);
  assert.match(overlay, /action: 'close_activate'/);
  assert.match(overlay, /closeHintFocused/);
  // Screen wires X and Back through the same closeDetail lifecycle.
  assert.match(screen, /onClose=\{closeDetail\}/);
  assert.match(screen, /pointerEvents=\{[\s\S]{0,220}detailOpen \|\| searchBlocksBrowse/);
});

test('model keeps truthful badge derivation contract documented', () => {
  assert.match(model, /Never invents quality metadata/);
  assert.match(model, /Related titles from already-cached/);
  assert.match(model, /Stage 4\.2B compact card/);
});
