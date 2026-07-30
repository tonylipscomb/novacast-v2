import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(
  new URL('../src/features/playback/unified/UnifiedPlayerControls.tsx', import.meta.url),
  'utf8',
);

test('seek preview does not commit native seek while scrubbing', () => {
  const adjustStart = source.indexOf('const adjustSeekTarget');
  const applyStart = source.indexOf('const applySeekDelta', adjustStart);
  const adjustBlock = source.slice(adjustStart, applyStart);

  assert.match(adjustBlock, /setSeekTargetMs\(nextPositionMs\)/);
  assert.doesNotMatch(adjustBlock, /onSeek\(nextPositionMs\)/);
  assert.match(adjustBlock, /eventType: 'seek-preview'/);
});

test('TV seek listener synchronizes React seek focus state', () => {
  assert.match(
    source,
    /onFocusSeek=\{\(\) => handleControlFocus\('seek'\)\}/,
  );
});

test('seek key handling uses the synchronous focus ref', () => {
  assert.match(source, /focusedControlRef\.current !== 'seek'/);
  assert.doesNotMatch(source, /if \(focusedControl !== 'seek'\)/);
});

test('seek commits exactly once on Enter or OK', () => {
  const pressStart = source.indexOf("handleControlPress('seek', 'commit-seek'");
  const pressEnd = source.indexOf('onFocus={() => handleControlFocus', pressStart);
  const pressBlock = source.slice(pressStart, pressEnd);

  assert.equal((pressBlock.match(/onSeek\(nextPositionMs\)/g) ?? []).length, 1);
  assert.match(pressBlock, /eventType: 'seek-commit'/);
});