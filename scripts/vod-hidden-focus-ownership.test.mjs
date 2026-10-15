import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => readFileSync(join(root, relativePath), 'utf8').replace(/\r\n/g, '\n');
const router = read('src/features/playback/unified/UnifiedPlayerHiddenChromeCapture.tsx');
const controls = read('src/features/playback/unified/UnifiedPlayerControls.tsx');

test('hidden chrome has one anchor and four explicit directional wake routes', () => {
  assert.match(router, /focusable=\{!chromeVisible\}/);
  assert.match(router, /nextFocusLeft: handles\.left/);
  assert.match(router, /nextFocusRight: handles\.right/);
  assert.match(router, /nextFocusUp: wakeHandles\.up/);
  assert.match(router, /nextFocusDown: wakeHandles\.down/);
  assert.match(router, /style=\{styles\.anchor\}/);
  assert.match(router, /leftSentinel: \{ \.\.\.sentinelBase, left: 0, top: 1 \}/);
  assert.match(router, /rightSentinel: \{ \.\.\.sentinelBase, left: 2, top: 1 \}/);
  assert.match(router, /upSentinel: \{ \.\.\.sentinelBase, left: 1, top: 0 \}/);
  assert.match(router, /downSentinel: \{ \.\.\.sentinelBase, left: 1, top: 2 \}/);
});

test('hidden wake sentinels cannot chain into competing hidden targets', () => {
  const hiddenRouting = /!chromeVisible && handles\.anchor != null[\s\S]{0,240}nextFocusDown: handles\.anchor/g;
  assert.equal([...router.matchAll(hiddenRouting)].length, 4);
  assert.match(router, /focusable\n\s+accessible=\{false\}[\s\S]{0,220}onFocus=\{\(\) => handleSentinelNativeFocus\(-1\)\}/);
});

test('stale hidden controls route every direction to the wake anchor', () => {
  assert.match(controls, /hiddenWakeHandle\?: number \| null/);
  assert.match(controls, /if \(hiddenWakeHandle != null\) \{[\s\S]{0,220}nextFocusDown: hiddenWakeHandle/);
  assert.match(controls, /const hiddenWakeHandle = visible \? null : sentinelHandles\.anchor/);
  assert.match(controls, /setSentinelHandles\(\(current\) => \{[\s\S]{0,260}anchor: next\.anchor/);
});

test('hidden Select is wake-only even if stale native control focus remains', () => {
  const pressHandler = controls.slice(
    controls.indexOf('const handleControlPress'),
    controls.indexOf('const handleControlPress') + 1500,
  );
  assert.match(pressHandler, /if \(!visibleRef\.current\)/);
  assert.match(pressHandler, /key: 'select'/);
  assert.match(pressHandler, /onRevealRef\.current\('hidden-focus-sentinel'\)/);
  assert.match(pressHandler, /return;[\s\S]{0,240}if \(controlId !== 'back'/);
});

test('visible controls retain normal seek sentinel routing', () => {
  const seekFocus = controls.slice(controls.indexOf("case 'seek':"), controls.indexOf("case 'seek':") + 700);
  assert.match(seekFocus, /nextFocusLeft: leftSentinel/);
  assert.match(seekFocus, /nextFocusRight: rightSentinel/);
  assert.match(controls, /chromeVisible=\{visible\}/);
  assert.match(controls, /onVodDirectionalSeek\(direction, 'hidden-focus-sentinel'\)/);
});

test('hidden-to-visible transition still requests Play focus without a timer loop', () => {
  assert.match(controls, /previousVisibleRef\.current = visible/);
  assert.match(controls, /requestDefaultChromeFocus\(\)/);
  assert.match(controls, /requestAnimationFrame\(attempt\)/);
  assert.doesNotMatch(controls, /setInterval\(/);
});
