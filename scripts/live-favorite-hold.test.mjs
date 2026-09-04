import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript';

const root = path.resolve(import.meta.dirname, '..');
const source = fs.readFileSync(path.join(root, 'src/features/live/liveFavoriteHold.ts'), 'utf8');
const rowSource = fs.readFileSync(path.join(root, 'src/features/live/LiveTvChannelRow.tsx'), 'utf8');
const screenSource = fs.readFileSync(path.join(root, 'src/features/live/LiveTvScreen.tsx'), 'utf8');
const pluginSource = fs.readFileSync(path.join(root, 'plugins/withNovacastNativeTvKeyEvents.js'), 'utf8');
const compiled = transpileModule(source, { compilerOptions: { module: ModuleKind.ESNext, target: ScriptTarget.ES2022 } }).outputText;
const { createFavoriteHoldDetector } = await import(`data:text/javascript,${encodeURIComponent(compiled)}`);

assert.match(source, /LIVE_FAVORITE_HOLD_THRESHOLD_MS = 425/);
assert.match(source, /keyCode === 23[\s\S]*keyCode === 66[\s\S]*keyCode === 160/);
assert.match(screenSource, /DeviceEventEmitter\.addListener\('onNovaCastNativeTvKey'/);
assert.doesNotMatch(rowSource, /DeviceEventEmitter\.addListener\('onNovaCastNativeTvKey'/);
assert.doesNotMatch(source, /NovaCast Favorite Hold Audit/);
assert.doesNotMatch(pluginSource, /NovaCastTvKeyBridge|Log\.(?:i|e)\(/);
assert.match(pluginSource, /KEYCODE_DPAD_CENTER/);
assert.match(pluginSource, /onNovaCastNativeTvKey/);

function harness() {
  let clock = 0;
  let nextTimer = 1;
  const timers = new Map();
  let favorites = 0;
  const detector = createFavoriteHoldDetector({ now: () => clock, schedule: (callback) => { const id = nextTimer++; timers.set(id, callback); return id; }, cancelSchedule: (id) => timers.delete(id), onTriggered: () => { favorites += 1; } });
  return { detector, get favorites() { return favorites; }, advance(ms) { clock += ms; }, fire() { for (const callback of timers.values()) callback(); timers.clear(); } };
}

for (const keyCode of [23, 66, 160]) {
  const test = harness();
  test.detector.handleEvent({ keyCode, eventKeyAction: 0 });
  test.advance(424);
  test.detector.handleEvent({ keyCode, eventKeyAction: 1 });
  assert.equal(test.favorites, 0);
  assert.equal(test.detector.consumeSuppressedPress(), false);
}

for (const keyCode of [23, 66, 160]) {
  const test = harness();
  test.detector.handleEvent({ keyCode, eventKeyAction: 0 });
  test.advance(425);
  test.fire();
  test.detector.handleEvent({ keyCode, eventKeyAction: 1 });
  assert.equal(test.favorites, 1);
  assert.equal(test.detector.consumeSuppressedPress(), true);
  assert.equal(test.detector.consumeSuppressedPress(), false);
}

{
  const test = harness();
  // ONN can deliver DOWN -> UP before the scheduled threshold callback runs.
  test.detector.handleEvent({ keyCode: 23, eventKeyAction: 0 });
  test.advance(425);
  test.detector.handleEvent({ keyCode: 23, eventKeyAction: 1 });
  assert.equal(test.favorites, 1);
  assert.equal(test.detector.consumeSuppressedPress(), true);
}

{
  const test = harness();
  test.detector.handleEvent({ keyCode: 23, eventKeyAction: 0 });
  test.advance(425);
  test.fire();
  test.detector.handleEvent({ keyCode: 23, eventKeyAction: 1 });
  test.detector.handleEvent({ keyCode: 23, eventKeyAction: 0 });
  test.advance(50);
  test.detector.handleEvent({ keyCode: 23, eventKeyAction: 1 });
  assert.equal(test.favorites, 1);
  assert.equal(test.detector.consumeSuppressedPress(), false);
}

{
  const test = harness();
  test.detector.handleEvent({ keyCode: 23, eventKeyAction: 0 });
  test.advance(200);
  test.detector.cancel('blur');
  test.advance(400);
  test.fire();
  assert.equal(test.favorites, 0);
}

console.log('live favorite hold test passed');
