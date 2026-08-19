import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(
  new URL('../src/features/playback/unified/UnifiedPlayerControls.tsx', import.meta.url),
  'utf8',
);

test('seek preview does not commit native seek while scrubbing', () => {
  const applyStart = source.indexOf('const applySeekDelta');
  const applyEnd = source.indexOf('const focusControl', applyStart);
  const applyBlock = source.slice(applyStart, applyEnd);

  assert.match(applyBlock, /setSeekTargetMs\(result\.previewPositionMs\)/);
  assert.doesNotMatch(applyBlock, /onSeek\(/);
  assert.match(applyBlock, /eventType: 'seek-preview'/);
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
  assert.match(source, /handleControlPress\('seek', 'commit-seek'/);
  assert.match(source, /commitSeekPreview\('ok'\)/);
  const commitStart = source.indexOf('const commitSeekPreview');
  const commitEnd = source.indexOf('const scheduleIdleCommit', commitStart);
  const commitBlock = source.slice(commitStart, commitEnd);
  assert.equal((commitBlock.match(/onSeekRef\.current\(nextPositionMs\)/g) ?? []).length, 1);
  assert.match(commitBlock, /eventType: 'seek-commit'/);
});
