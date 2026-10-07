import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const root = process.cwd();
const home = readFileSync(join(root, 'src/features/hub/MainMenuScreen.tsx'), 'utf8');
const live = readFileSync(join(root, 'src/features/live/LiveTvScreen.tsx'), 'utf8');
const unified = readFileSync(join(root, 'src/features/playback/unified/useUnifiedPlayer.ts'), 'utf8');
const diagnostics = readFileSync(join(root, 'src/features/live/livePlaybackLaunchDiagnostics.ts'), 'utf8');

test('Home/NovaPulse Live rail launches enter the modern Live route', () => {
  const liveRailLauncher = home.match(/const playLiveChannelFullscreen[\s\S]*?\n  \};/u)?.[0] ?? '';
  assert.ok(liveRailLauncher, 'Home Live rail launcher should exist');
  assert.match(home, /pathname: '\/live'/);
  assert.match(home, /directPlay: '1'/);
  assert.match(home, /openRecentItem\([\s\S]*'favorites'/);
  assert.match(home, /playbackSurface: 'modern_live'/);
  assert.doesNotMatch(liveRailLauncher, /launchPlayback/);
});

test('Live direct-play route uses the existing LiveTvScreen fullscreen path', () => {
  assert.match(live, /directPlayRequested/);
  assert.match(live, /tuneChannel\(routeChannelId\)/);
  assert.match(live, /playbackSurface: 'modern_live'/);
});

test('Movie and Series playback remain on the unified player contract', () => {
  assert.match(unified, /launchUnifiedPlayback\(item, options\)/);
  assert.match(home, /mediaType: 'movie'/);
  assert.match(home, /launchSeriesEpisodePlayback/);
});

test('launch diagnostics expose only sanitized surface metadata', () => {
  assert.match(diagnostics, /contentKind: 'live_channel'/);
  assert.match(diagnostics, /controlOverlayVersion/);
  assert.doesNotMatch(diagnostics, /streamUrl|password|username|token|credential/i);
});
