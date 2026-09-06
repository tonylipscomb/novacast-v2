import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const liveScreen = readFileSync('src/features/live/LiveTvScreen.tsx', 'utf8').replace(/\r\n/g, '\n');
const analytics = readFileSync('src/features/analytics/playbackAnalytics.ts', 'utf8').replace(/\r\n/g, '\n');

test('fullscreen surf waits for the matching source before tracking a channel', () => {
  assert.match(liveScreen, /livePlaybackItem\.id !== currentId/);
  assert.match(liveScreen, /previousAnalyticsFullscreenIdRef\.current = currentId/);
  assert.match(liveScreen, /playbackAnalyticsTracker\.stop\('channel_change'\)/);
  assert.match(analytics, /'channel_change'/);
});

test('Channel B play attempt carries the B live identity and title', () => {
  assert.match(analytics, /eventType,\s*sessionId: input\.sessionId,[\s\S]*contentType: input\.contentType,[\s\S]*contentId: input\.contentId,[\s\S]*contentTitle: input\.contentTitle/);
  assert.match(liveScreen, /livePlaybackItem\.id !== currentId/);
});

test('fullscreen surf sequence cannot duplicate a destination after source re-renders', () => {
  const effect = liveScreen.slice(liveScreen.indexOf('const previousAnalyticsFullscreenIdRef'));
  assert.doesNotMatch(effect, /previousAnalyticsFullscreenIdRef\.current = currentId;\n\s*}\n\s*return;/);
  assert.match(effect, /if \(currentId !== trackedId\)/);
  assert.match(effect, /playbackAnalyticsTracker\.request\(livePlaybackItem, 'channel'\)/);
});
