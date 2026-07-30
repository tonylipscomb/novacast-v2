import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const controls = fs.readFileSync(
  new URL('../src/features/playback/unified/UnifiedPlayerControls.tsx', import.meta.url),
  'utf8',
);
const interaction = fs.readFileSync(
  new URL('../src/features/playback/unified/UnifiedPlayerInteractionLayer.tsx', import.meta.url),
  'utf8',
);
const host = fs.readFileSync(
  new URL('../src/features/playback/unified/UnifiedPlayerHost.tsx', import.meta.url),
  'utf8',
);

test('hidden controls reveal from D-pad focus sentinels', () => {
  assert.match(interaction, /reveal-player-controls-via-focus-sentinel/);
  assert.match(interaction, /nextFocusLeft/);
  assert.match(interaction, /nextFocusRight/);
  assert.match(interaction, /nextFocusUp/);
  assert.match(interaction, /nextFocusDown/);
});

test('seek bar has native left and right step sentinels', () => {
  assert.match(controls, /assignSeekLeftStepRef/);
  assert.match(controls, /assignSeekRightStepRef/);
  assert.match(controls, /handleSeekStepFocus\('left'\)/);
  assert.match(controls, /handleSeekStepFocus\('right'\)/);
  assert.match(controls, /nextFocusLeft: seekStepHandles\.left/);
  assert.match(controls, /nextFocusRight: seekStepHandles\.right/);
});

test('native Modal playback host remains intact', () => {
  assert.match(host, /<Modal/);
  assert.match(host, /presentationStyle="overFullScreen"/);
});
