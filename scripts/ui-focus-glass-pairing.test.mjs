import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(path, 'utf8');
const recovery = read('src/features/providers/ProviderAccessRecoveryScreen.tsx');
const pairing = read('src/features/pairing/PairingScreen.tsx');
const diagnostics = read('src/features/pairing/pairingDiagnostics.ts');
const service = read('src/features/pairing/pairingService.ts');
const hub = read('src/features/hub/ContentHubOverlayScreen.tsx');
const button = read('src/components/nova/NovaButton.tsx');

assert.match(recovery, /hasTVPreferredFocus/);
assert.match(recovery, /nextFocusRight/);
assert.match(recovery, /nextFocusLeft/);
assert.match(recovery, /NOVA_GLASS/);
assert.match(recovery, /label="Pair Provider"/);
assert.match(recovery, /label="Open Settings"/);
assert.match(recovery, /label="Retry"/);

assert.match(button, /novaTvFocus\.active/);
assert.match(pairing, /label=\{!isAvailable \? 'Retry Pairing' : codeExpired \? 'Refresh Code' : 'Generate New Code'\}/);
assert.match(pairing, /label="Retry Same Code"/);
assert.match(pairing, /label="Close"/);
assert.match(pairing, /qrCard/);
assert.match(pairing, /Pairing unavailable/);
assert.match(pairing, /Generate a new code to retry/);

assert.match(hub, /TVFocusGuideView/);
assert.match(hub, /trapFocusLeft/);
assert.match(hub, /trapFocusRight/);
assert.match(hub, /trapFocusUp/);
assert.match(hub, /trapFocusDown/);
assert.match(hub, /providerCardDisabled/);
assert.match(hub, /accessibilityState=\{\{ disabled:/);
assert.match(hub, /NOVA_GLASS\.activeFocused/);

assert.match(read('src/features/settings/SettingsScreen.tsx'), /PROVIDER RECOVERY/);

assert.match(diagnostics, /NovaCast Pairing Diagnostics/);
assert.match(diagnostics, /network_error/);
assert.match(diagnostics, /client_error/);
assert.match(diagnostics, /server_error/);
assert.match(diagnostics, /responseSchemaValid/);
assert.match(service, /logPairingReleaseDiagnostic\('request-start'/);
assert.match(service, /classifyPairingHttpStatus/);
assert.doesNotMatch(diagnostics, /console\.(log|info)\([^\n]*(apiUrl|password|token|authorization)/i);

console.log('ui focus/glass/pairing diagnostics: passed');
