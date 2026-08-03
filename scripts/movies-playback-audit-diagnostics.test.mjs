import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  beginMoviePlaybackLifecycle,
  getMoviePlaybackAuditMarker,
  logMoviePlaybackShape,
  markMoviePlaybackLifecycle,
} from '../src/features/movies/moviesPlaybackAudit.ts';

const audit = fs.readFileSync('src/features/movies/moviesPlaybackAudit.ts', 'utf8');
const screen = fs.readFileSync('src/features/movies/MoviesScreen.tsx', 'utf8');
const host = fs.readFileSync('src/features/playback/unified/UnifiedPlayerHost.tsx', 'utf8');
const controller = fs.readFileSync('src/features/playback/unified/UnifiedPlayerController.tsx', 'utf8');
const playback = fs.readFileSync('src/features/providers/providerPlayback.ts', 'utf8');

test('1. Browse and Search emit comparable playback shape logs', () => {
  assert.match(audit, /\[NovaCast Movie Playback Shape\]/);
  assert.match(screen, /origin: 'browse-detail'/);
  assert.match(screen, /origin: 'search-detail'/);
  assert.match(screen, /logMoviePlaybackShape/);
  assert.equal(getMoviePlaybackAuditMarker(), 'movies-playback-audit-diagnostics-v1');
});

test('2. lifecycle stages are recorded', () => {
  const lines = [];
  const original = console.info;
  console.info = (message) => {
    lines.push(String(message));
  };
  try {
    beginMoviePlaybackLifecycle({
      origin: 'browse-detail',
      movieId: 'm1',
      detailOpen: true,
    });
    markMoviePlaybackLifecycle('movie-resolved', { movieId: 'm1' });
    markMoviePlaybackLifecycle('source-resolution-started', { movieId: 'm1' });
    markMoviePlaybackLifecycle('source-resolved', { movieId: 'm1' });
    markMoviePlaybackLifecycle('launcher-called', { movieId: 'm1' });
    markMoviePlaybackLifecycle('player-requested', { movieId: 'm1' });
    markMoviePlaybackLifecycle('player-mounted', { movieId: 'm1' });
    markMoviePlaybackLifecycle('playback-started', { movieId: 'm1' });
  } finally {
    console.info = original;
  }

  const lifecycle = lines.filter((line) => line.startsWith('[NovaCast Movie Playback Lifecycle]'));
  assert.ok(lifecycle.length >= 8);
  const last = JSON.parse(lifecycle.at(-1).replace('[NovaCast Movie Playback Lifecycle] ', ''));
  assert.equal(last.playPressed, true);
  assert.equal(last.canonicalMovieResolved, true);
  assert.equal(last.launcherCalled, true);
  assert.equal(last.sourceResolverCalled, true);
  assert.equal(last.sourceResolved, true);
  assert.equal(last.playerRouteRequested, true);
  assert.equal(last.playerMounted, true);
  assert.equal(last.playbackStarted, true);
  assert.equal(last.failureStage, null);

  assert.match(screen, /beginMoviePlaybackLifecycle/);
  assert.match(screen, /markMoviePlaybackLifecycle\('source-resolution-started'/);
  assert.match(host, /noteMoviePlaybackPlayerMounted/);
  assert.match(controller, /noteMoviePlaybackStarted/);
});

test('3. no credentials are logged', () => {
  assert.doesNotMatch(audit, /password|username|token|streamUrl|credential/i);
  const shapeLines = [];
  const original = console.info;
  console.info = (message) => shapeLines.push(String(message));
  try {
    logMoviePlaybackShape({
      origin: 'browse-detail',
      movieId: 'm1',
      providerId: 'prov',
      mediaType: 'movie',
      containerExtension: 'mp4',
      title: 'Secret Title',
      posterUrl: 'https://example.test/p.jpg',
      playbackSource: 'resolved',
    });
  } finally {
    console.info = original;
  }
  const payload = shapeLines.join('\n');
  assert.match(payload, /hasTitle":true/);
  assert.doesNotMatch(payload, /Secret Title|example\.test|password|username|token/i);
});

test('4. no playback behavior changes were made', () => {
  // Canonical path remains the same functions.
  assert.match(screen, /const startPlayback = useCallback/);
  assert.match(screen, /buildMoviePlaybackUrlResolved\(/);
  assert.match(screen, /await launchPlayback\(/);
  assert.match(playback, /export function buildMoviePlaybackUrlResolved/);
  assert.match(host, /UnifiedPlayerController/);
  // Audit helpers are observe-only.
  assert.match(audit, /Diagnostics-only|Observe-only|diagnostics only/i);
  assert.doesNotMatch(audit, /launchUnifiedPlayback|buildVodStreamUrl|closeUnifiedPlayback/);
});
