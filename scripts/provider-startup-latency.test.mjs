import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFileSync(join(root, file), 'utf8');
const access = read('src/features/providers/providerAccess.ts');
const gate = read('src/features/providers/ProviderAccessGate.tsx');
const store = read('src/features/providers/providerStore.ts');
const reconcile = read('src/features/device/deviceAssignmentReconcile.ts');
const managedDownload = read('src/features/device/managedProviderDownload.ts');
const heartbeat = read('src/features/device/deviceHeartbeat.ts');
const diagnostics = read('src/features/providers/providerStartupDiagnostics.ts');

test('provider access has a bounded loading deadline', () => {
  assert.match(gate, /PROVIDER_ACCESS_LOADING_DEADLINE_MS = 12_000/);
  assert.match(gate, /setTimeout\(\(\) => \{/);
});

test('pending initialization remains loading before the deadline', () => {
  assert.match(access, /if \(!providerInitialized\) \{/);
  assert.match(access, /return \{ state: 'loading', provider \};/);
});

test('deadline with no usable cache exposes recovery', () => {
  assert.match(access, /loadingTimedOut && !cachedProviderUsable/);
  assert.match(access, /state: 'recovery_available'/);
});

test('deadline with a usable cached provider keeps the shell available', () => {
  assert.match(access, /loadingTimedOut && cachedProviderUsable/);
  assert.match(access, /state: 'allowed'/);
  assert.match(gate, /cachedProviderUsable = providerState\.isRealProviderActive/);
});

test('timeout does not convert provider health into an expired state', () => {
  assert.match(access, /providerHealth\?\.status === 'subscription_expired'/);
  assert.match(access, /loadingTimedOut/);
  assert.ok(access.indexOf("providerHealth?.status === 'subscription_expired'") < access.indexOf('if \(!providerInitialized\)'));
});

test('startup diagnostics include elapsed and bounded provider fields', () => {
  assert.match(diagnostics, /elapsedMs/);
  for (const field of ['providerPresent', 'cachedProviderUsable', 'providerInitInFlight', 'deadlineExceeded', 'managedRefreshInFlight', 'retryBackoffActive']) {
    assert.match(diagnostics, new RegExp(field));
  }
  assert.match(gate, /provider-init-start/);
  assert.match(gate, /recovery-visible/);
});

test('managed provider refresh has a bounded request timeout', () => {
  assert.match(managedDownload, /MANAGED_PROVIDER_DOWNLOAD_TIMEOUT_MS = 12_000/);
  assert.match(managedDownload, /controller\.abort\(\)/);
  assert.match(managedDownload, /signal: controller\.signal/);
});

test('managed provider logs the HTTP category before parsing the body', () => {
  const responseLog = managedDownload.indexOf("event: 'response'");
  const parse = managedDownload.indexOf('response.json()');
  assert.ok(responseLog >= 0 && responseLog < parse);
});

test('managed provider distinguishes pre-response failure from response parsing', () => {
  assert.match(managedDownload, /event: timeoutFailure \? 'timeout' : 'network-failure'/);
  assert.match(managedDownload, /const payload = await response\.json\(\)\.catch\(\(\) => \(\{\}\)\)/);
  assert.match(managedDownload, /statusCategory/);
});

test('retry initialization participates in the shared runtime promise', () => {
  assert.match(store, /const trackedPromise = promise\.finally/);
  assert.match(store, /runtimeLoadPromise = trackedPromise/);
  assert.match(store, /if \(runtime\.isSwitching && runtimeLoadPromise\) return runtimeLoadPromise/);
});

test('managed download reuses an existing provider operation', () => {
  assert.match(store, /if \(runtime\.isSwitching\) \{[\s\S]*?return runtimeLoadPromise;/);
});

test('shared provider operation is cleared after completion', () => {
  assert.match(store, /if \(runtimeLoadPromise === trackedPromise\) runtimeLoadPromise = null/);
  assert.match(store, /finally \{\s*runtimeLoadPromise = null;/);
});

test('assignment retry delays are bounded at 15, 30, and 60 seconds', () => {
  assert.match(reconcile, /ASSIGNMENT_RETRY_DELAYS_MS = \[15_000, 30_000, 60_000\]/);
});

test('assignment backoff suppresses repeated automatic refreshes', () => {
  assert.match(reconcile, /retry-backoff-active/);
  assert.match(reconcile, /Date\.now\(\) < assignmentRetryBackoff\.retryAt/);
  assert.match(reconcile, /return pendingAssignmentResult/);
});

test('explicit recovery retry can bypass assignment backoff', () => {
  assert.match(reconcile, /force\?: boolean/);
  assert.match(reconcile, /!input\.force/);
  assert.match(read('src/features/providers/ProviderAccessRecoveryScreen.tsx'), /clearAssignmentRetryBackoff\(\)/);
});

test('assignment target changes clear the old retry backoff', () => {
  assert.match(reconcile, /assignmentRetryBackoff && token !== assignmentRetryBackoff\.token/);
  assert.match(reconcile, /assignmentRetryBackoff = null/);
});

test('successful or unchanged assignment clears retry backoff', () => {
  assert.match(reconcile, /if \(result\.refreshed \|\| result\.decision === 'unchanged' \|\| result\.decision === 'pending'\)/);
});

test('failed assignment remains pending instead of being marked applied', () => {
  assert.match(reconcile, /catch \(error\) \{/);
  assert.match(reconcile, /retry-backoff-scheduled/);
  assert.match(reconcile, /return pendingAssignmentResult/);
  assert.doesNotMatch(reconcile.slice(reconcile.indexOf('catch (error)'), reconcile.indexOf('catch (error)') + 900), /markDeviceAssignmentApplied\(/);
});

test('heartbeat remains the authoritative reconciliation fallback', () => {
  assert.match(heartbeat, /source: 'heartbeat'/);
  assert.match(heartbeat, /assignmentFromHeartbeat\(payload\)/);
  assert.match(heartbeat, /provider-assignment-reconciled/);
});

test('heartbeat reconciliation errors do not create an unbounded retry loop', () => {
  assert.match(heartbeat, /reconcileDeviceAssignment\(/);
  assert.match(reconcile, /downloadInflight/);
  assert.match(reconcile, /reconcileInflight/);
});

test('diagnostics exclude secrets and raw provider details', () => {
  assert.doesNotMatch(diagnostics, /deviceSecret|password|username|bearer|apikey|rawResponse/i);
  assert.match(managedDownload, /privateCredentialPresent: Boolean/);
  assert.match(managedDownload, /statusCategory/);
  assert.doesNotMatch(managedDownload, /console\.info\([^)]*api\.anonKey/is);
});

test('closed-beta access bypass remains intact', () => {
  assert.match(gate, /if \(isClosedBetaManagedFlow\(\) \|\| deviceFeatureFlags\.closedBetaMode\) return/);
});
