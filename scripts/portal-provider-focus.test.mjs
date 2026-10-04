import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../src/features/portal/NovaPortalScreen.tsx', import.meta.url), 'utf8');
const diagnostics = fs.readFileSync(new URL('../src/features/portal/portalProviderFocusDiagnostics.ts', import.meta.url), 'utf8');

test('actionable provider card remains a focusable Pressable with existing activation path', () => {
  assert.match(source, /<Pressable[\s\S]*?focusable[\s\S]*?onPress=\{\(\) => \{[\s\S]*?onLaunch\(\)/);
  assert.match(source, /accessibilityLabel=\{`Continue with/);
});

test('blocked provider states remain display-only', () => {
  assert.match(source, /if \(!launchable\) \{[\s\S]*?return <View/);
  assert.match(source, /const canEnterApp = providerAccess\.state === 'allowed' \|\| providerAccess\.state === 'temporarily_unavailable'/);
});

test('provider card and right rail have an explicit horizontal focus graph', () => {
  assert.match(source, /nextFocusRight=\{portalFocusTargets\.firstMenu/);
  assert.match(source, /nextFocusLeft=\{canEnterApp \? portalFocusTargets\.provider/);
  assert.match(source, /nextFocusUp=\{index > 0/);
  assert.match(source, /nextFocusDown=\{index < menuItems\.length - 1/);
});

test('portal focus handles are refreshed across bounded animation frames', () => {
  assert.match(source, /requestAnimationFrame\(refresh\)/);
  assert.match(source, /cancelAnimationFrame\(frame\)/);
  assert.match(source, /findNodeHandle\(providerCardRef\.current\)/);
});

test('provider focus diagnostics are sanitized and do not expose sensitive fields', () => {
  assert.match(diagnostics, /NOVACAST_PORTAL_PROVIDER_FOCUS/);
  assert.match(diagnostics, /providerState|launchable|nativeHandlePresent|neighborHandlePresent|elapsedMs|reason/);
  assert.doesNotMatch(diagnostics, /password|username|providerUrl|providerId|token|secret|credential|rawError/i);
  for (const event of ['card-mounted', 'focus-requested', 'focus-received', 'focus-lost', 'action-pressed', 'focus-neighbor-ready', 'state-changed']) {
    assert.match(source, new RegExp(event));
  }
});

test('portal focus restore remains bounded and does not add a navigation shortcut', () => {
  assert.match(source, /focusNativeViewWhenReady\(\(\) => providerCardRef\.current/);
  assert.doesNotMatch(source, /router\.replace\(['"]\/main-menu['"]\).*focus/);
});
