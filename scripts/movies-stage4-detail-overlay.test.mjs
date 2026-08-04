import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  deriveStreamQualityBadges,
  formatMovieRating,
  heroBackdropUri,
  resolveContinueWatchingLabel,
  resolveContinueWatchingProgress,
  selectRelatedMovies,
} from '../src/features/movies/movieDetailOverlayModel.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const overlay = read('src/features/movies/components/MovieDetailOverlay.tsx');
const screen = read('src/features/movies/MoviesScreen.tsx');

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

test('continue watching label and progress stay precise', () => {
  assert.equal(resolveContinueWatchingLabel(42), 'Resume');
  assert.equal(resolveContinueWatchingLabel(0), 'Play');
  assert.equal(resolveContinueWatchingLabel(95), 'Play');
  assert.equal(resolveContinueWatchingProgress(42), 42);
  assert.equal(resolveContinueWatchingProgress(95), null);
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
  assert.ok(!related.some((item) => item.id === 'c') || related.length === 3);
});

test('rating formatting and backdrop preference', () => {
  assert.equal(formatMovieRating(8.26), '8.3');
  assert.equal(formatMovieRating('7.1'), '7.1');
  assert.equal(heroBackdropUri({ backdropUrl: 'https://x/b.jpg', posterUrl: 'https://x/p.jpg' }), 'https://x/b.jpg');
  assert.equal(heroBackdropUri({ posterUrl: 'https://x/p.jpg' }), 'https://x/p.jpg');
});

test('MovieDetailOverlay is Reanimated cinematic shell with TV focus traps', () => {
  assert.match(overlay, /react-native-reanimated/);
  assert.match(overlay, /withTiming/);
  assert.match(overlay, /TVFocusGuideView|FocusBoundaryView/);
  assert.match(overlay, /focusHandoffActive/);
  assert.match(overlay, /closeTargetRef/);
  assert.match(overlay, /Related Titles/);
  assert.match(overlay, /glassCard/);
  assert.match(overlay, /deriveStreamQualityBadges/);
  assert.doesNotMatch(overlay, /router\.push|href=\{/);
});

test('MoviesScreen mounts MovieDetailOverlay above the grid (no route navigation)', () => {
  assert.match(screen, /MovieDetailOverlay/);
  assert.doesNotMatch(screen, /MediaDetailOverlay/);
  assert.match(screen, /relatedMovies=\{relatedMovies\}/);
  assert.match(screen, /continueWatchingLabel=\{continueWatchingLabel\}/);
  assert.match(screen, /selectRelatedMovies/);
  assert.match(screen, /onSelectRelated/);
});
