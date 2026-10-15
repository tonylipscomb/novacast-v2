import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const policy = fs.readFileSync('src/features/diagnostics/novacastLogPolicy.ts', 'utf8');
const wake = fs.readFileSync('src/features/playback/unified/playerChromeWake.ts', 'utf8');
const remote = fs.readFileSync('src/features/playback/unified/unifiedRemoteDebug.ts', 'utf8');
const seek = fs.readFileSync('src/features/playback/unified/vodSeek.ts', 'utf8');

test('player focus diagnostics are opt-in and separate from general tracing', () => {
  assert.match(policy, /EXPO_PUBLIC_NOVACAST_PLAYER_FOCUS_DIAGNOSTICS/);
  assert.match(policy, /player-focus-diagnostics-enabled/);
  assert.match(policy, /export function isNovaCastPlayerFocusDiagnosticsEnabled/);
  assert.match(wake, /isNovaCastPlayerFocusDiagnosticsEnabled/);
  assert.match(remote, /isNovaCastPlayerFocusDiagnosticsEnabled/);
  assert.match(seek, /isNovaCastPlayerFocusDiagnosticsEnabled/);
});

test('player diagnostics keep identifiers out of the opt-in focus log path', () => {
  assert.match(seek, /contentId: traceEnabled \? fields\.contentId \?\? null : null/);
  assert.match(seek, /contentIdPresent: Boolean\(fields\.contentId\)/);
});
