import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

const root = new URL('..', import.meta.url);
const read = (path) => fs.readFile(new URL(path, root), 'utf8');

test('NovaView uses two distinct player instances and keeps normal Live player as A', async () => {
  const source = await read('src/features/live/NovaViewProbe.tsx');
  const screen = await read('src/features/live/LiveTvScreen.tsx');
  assert.match(source, /createVideoPlayer\(null\)/);
  assert.match(source, /playerA === playerB/);
  assert.match(screen, /playerA=\{liveStreamPlayer\}/);
  assert.match(source, /playerB/);
  assert.match(source, /flexDirection: 'row'/);
  assert.match(source, /width: '100%'/);
  assert.match(source, /height: '100%'/);
  assert.match(source, /surfaceType="textureView"/g);
  assert.doesNotMatch(source, /absoluteFillObject|StyleSheet\.absoluteFill/);
  assert.doesNotMatch(source, /liveTimeshift|NovaShift|m3u8/i);
});

test('NovaView mutes B before source load and play', async () => {
  const source = await read('src/features/live/NovaViewProbe.tsx');
  assert.ok(source.indexOf('playerB.muted = true') < source.indexOf('playerB.replaceAsync'));
  assert.ok(source.indexOf('playerB.volume = 0') < source.indexOf('playerB.replaceAsync'));
  assert.ok(source.indexOf('playerB.replaceAsync') < source.indexOf('playerB.play()'));
});

test('NovaView is opt-in and preserves the normal fullscreen branch when disabled', async () => {
  const screen = await read('src/features/live/LiveTvScreen.tsx');
  assert.match(screen, /EXPO_PUBLIC_NOVAVIEW_PROBE === 'true'/);
  assert.match(screen, /novaViewProbeActive && bundle && novaViewProbeChannel/);
  assert.match(screen, /NovaStreamSurface/);
  assert.match(screen, /FullscreenSurfInput/);
  assert.match(screen, /LiveTvFocusRouter/);
});

test('NovaView cleanup releases B and ignores late callbacks', async () => {
  const source = await read('src/features/live/NovaViewProbe.tsx');
  assert.match(source, /disposedRef\.current = true/);
  assert.match(source, /if \(disposedRef\.current\) return/);
  assert.match(source, /playerB\.release\(\)/);
  assert.match(source, /stageTimersRef/);
});

test('NovaView diagnostics are bounded and redact URL-bearing errors', async () => {
  const source = await read('src/features/live/NovaViewProbe.tsx');
  assert.match(source, /JSON\.stringify\(payload\)/);
  assert.ok(source.includes('replace(/[a-z][a-z0-9+.-]*:\\/\\/\\S+/gi'));
  assert.doesNotMatch(source, /username|password|authorization|token/i);
  assert.match(source, /PROVIDER_CONNECTION_LIMIT/);
  assert.match(source, /DEVICE_DECODER_LIMIT/);
});
