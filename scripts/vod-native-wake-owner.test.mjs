import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const plugin = fs.readFileSync(path.join(root, 'plugins/withNovacastNativeTvKeyEvents.js'), 'utf8');
const moduleConfig = fs.readFileSync(path.join(root, 'modules/novacast-catalog-decode/expo-module.config.json'), 'utf8');
const native = fs.readFileSync(path.join(root, 'modules/novacast-catalog-decode/android/src/main/java/expo/modules/novacastcatalogdecode/NovacastVodWakeModule.kt'), 'utf8');
const wrapper = fs.readFileSync(path.join(root, 'src/features/playback/unified/vodWakeNative.ts'), 'utf8');
const handlers = fs.readFileSync(path.join(root, 'src/features/playback/unified/useUnifiedPlayerRemoteHandlers.tsx'), 'utf8');
const controls = fs.readFileSync(path.join(root, 'src/features/playback/unified/UnifiedPlayerControls.tsx'), 'utf8');

assert.match(moduleConfig, /NovacastVodWakeModule/);
assert.match(plugin, /NovacastVodWakeModule\.dispatchKeyEvent/);
assert.match(native, /KEYCODE_DPAD_LEFT/);
assert.match(native, /KEYCODE_DPAD_RIGHT/);
assert.match(native, /KEYCODE_DPAD_UP/);
assert.match(native, /KEYCODE_DPAD_DOWN/);
assert.match(native, /KEYCODE_DPAD_CENTER/);
assert.match(native, /KEYCODE_ENTER/);
assert.match(native, /repeatCount/);
assert.match(native, /focusedView/);
assert.match(native, /eventKeyAction/);
assert.match(native, /return true/);
assert.match(wrapper, /setVodWakeEnabled/);
assert.match(wrapper, /subscribeVodWakeKeys/);
assert.match(handlers, /!controlsVisible/);
assert.match(handlers, /isVodSeekMediaType\(mediaType\)/);
assert.match(handlers, /native-vod-wake/);
assert.match(handlers, /subscription\?\.remove/);
assert.match(handlers, /nativeEventTime/);
assert.match(controls, /controls-render-committed/);

console.log('vod native wake owner test passed');
