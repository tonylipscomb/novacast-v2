import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const controls = fs.readFileSync('src/features/playback/unified/UnifiedPlayerControls.tsx', 'utf8');

test('player controls use one high-contrast rounded glass surface', () => {
  const panel = controls.slice(controls.indexOf('panel: {'), controls.indexOf('topBar: {'));
  assert.match(panel, /backgroundColor: 'rgba\(3,7,12,0\.88\)'/);
  assert.match(panel, /borderWidth: 1/);
  assert.match(panel, /borderRadius: NOVA_GLASS\.radius\.base/);
  assert.match(panel, /shadowOpacity: 0\.42/);
  assert.match(panel, /elevation: 12/);
});

test('glass redesign does not add a focusable wrapper', () => {
  const panel = controls.slice(controls.indexOf('panel: {'), controls.indexOf('topBar: {'));
  assert.doesNotMatch(panel, /focusable/);
});
