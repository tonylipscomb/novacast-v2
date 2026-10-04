import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(path, 'utf8');
const hook = read('src/features/pairing/useMockPairing.ts');
const service = read('src/features/pairing/pairingService.ts');
const screen = read('src/features/pairing/PairingScreen.tsx');
const diagnostics = read('src/features/pairing/pairingDiagnostics.ts');

test('pairing-create exposes an absolute millisecond expiration', () => {
  const edgeFunction = read('supabase/functions/pairing-create/index.ts');
  assert.match(edgeFunction, /expiresAt:\s*Date\.parse\(data\.expires_at\)/);
  assert.match(service, /typeof value\.expiresAt !== 'number'/);
});

test('refresh installs a new generation before polling it', () => {
  assert.match(hook, /sessionGenerationRef = useRef\(0\)/);
  assert.match(hook, /sessionRef\.current = nextSession/);
  assert.match(hook, /const sessionGeneration = installSession\(nextSession, 'refresh-created'\)/);
  assert.match(hook, /void pollOnce\(sessionGeneration\)/);
  assert.match(hook, /invalidateSession\('refresh-started'\)/);
});

test('late polling and countdown callbacks are ignored by generation and identity', () => {
  assert.match(hook, /expectedGeneration !== sessionGenerationRef\.current/);
  assert.match(hook, /sessionRef\.current\?\.id !== activeSession\.id/);
  assert.match(hook, /stale-status-ignored/);
  assert.match(hook, /poll-error-generation-mismatch/);
  assert.match(hook, /stale-timer-ignored/);
  assert.match(hook, /pollingGenerationRef\.current === expectedGeneration/);
});

test('refresh resets the old countdown and polling timer before creating a session', () => {
  assert.match(hook, /pollTimerRef\.current\) \{\s*clearTimeout\(pollTimerRef\.current\)/s);
  assert.match(hook, /setSession\(null\)/);
  assert.match(hook, /setSecondsRemaining\(0\)/);
  assert.match(hook, /session-invalidated/);
  assert.match(hook, /countdown-started/);
  assert.match(hook, /countdown-expired/);
});

test('pairing focus graph is explicit and expiry does not steal Close focus', () => {
  assert.match(screen, /nextFocusDown=\{\(retryVisible \? focusTargets\.retry : focusTargets\.close\)/);
  assert.match(screen, /nextFocusUp=\{\(retryVisible \? focusTargets\.retry : focusTargets\.primary\)/);
  assert.match(screen, /focusedPairingControlRef\.current === 'close'/);
  assert.match(screen, /codeExpired && focusedPairingControlRef\.current === 'close'/);
  assert.match(screen, /neighbor-ready/);
  assert.match(screen, /return cancelFocus/);
});

test('pairing buttons use native focus styling rather than permanent focused colors', () => {
  assert.match(screen, /primaryButton:\s*\{\s*borderRadius:/s);
  assert.match(screen, /retryButton:\s*\{\s*borderRadius:/s);
  assert.doesNotMatch(screen, /primaryButton:[\s\S]*?backgroundColor:\s*NOVA_GLASS\.active\.backgroundColor/);
  assert.doesNotMatch(screen, /retryButton:[\s\S]*?backgroundColor:\s*NOVA_GLASS\.activeFocused\.backgroundColor/);
});

test('release pairing diagnostics expose only sanitized lifecycle metadata', () => {
  assert.match(diagnostics, /sessionGeneration\?: number/);
  assert.match(diagnostics, /expiresInMs\?: number/);
  assert.match(diagnostics, /reason\?: string \| null/);
  assert.doesNotMatch(diagnostics, /pairingCode|pairUrl|username|password|authorization|deviceSecret|token|supabase/i);
  assert.match(hook, /logPairingReleaseDiagnostic\('session-created'|logPairingReleaseDiagnostic\('session-installed'/);
  assert.match(hook, /logPairingReleaseDiagnostic\('poll-started'/);
  assert.match(hook, /logPairingReleaseDiagnostic\('poll-stopped'/);
});
