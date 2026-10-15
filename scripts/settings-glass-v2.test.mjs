import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const rail = readFileSync(new URL('../src/features/settings/components/SettingsRail.tsx', import.meta.url), 'utf8');
const screen = readFileSync(new URL('../src/features/settings/SettingsScreen.tsx', import.meta.url), 'utf8');
const panel = readFileSync(new URL('../src/features/settings/components/SettingsDetailPanel.tsx', import.meta.url), 'utf8');
const store = readFileSync(new URL('../src/features/settings/appSettingsStore.ts', import.meta.url), 'utf8');

test('Settings exposes supported Glass V2 sections and real navigation entries', () => {
  for (const section of ['playback', 'appearance', 'parental', 'smart-categories', 'notifications', 'updates', 'diagnostics', 'about']) {
    assert.match(screen, new RegExp(`id: '${section}'`));
  }
  assert.match(screen, /router\.push\('\/notifications'\)/);
  assert.match(screen, /router\.push\('\/upgrade'\)/);
  assert.match(rail, /nextFocusRight/);
});

test('Settings uses persisted, normalized preferences', () => {
  assert.match(store, /normalizeSettings/);
  assert.match(store, /patchAppSettings\(\{ appearanceTheme \}\)/);
  assert.match(store, /patchAppSettings\(\{ playbackAudio \}\)/);
  assert.match(store, /patchAppSettings\(\{ resumePlayback \}\)/);
  assert.match(store, /value\?\.playbackAudio === 'surround'/);
});

test('Audio preference is presented truthfully without claiming unsupported player control', () => {
  assert.match(panel, /player does not apply them yet/);
  assert.doesNotMatch(panel, /Audio output applied to ExoPlayer/);
});

test('Settings retains TV focus routing and Glass surfaces', () => {
  assert.match(panel, /nextFocusLeftHandle/);
  assert.match(panel, /focusable/);
  assert.match(panel, /rgba\(5,10,24,0\.88\)/);
  assert.match(rail, /rgba\(5,10,24,0\.88\)/);
});

test('Upgrade and Notification destinations remain explicit, not automatic installers', () => {
  assert.match(panel, /Downloads remain explicit/);
  assert.match(panel, /Open Notification Center/);
  assert.match(panel, /Open Upgrade Center/);
});
