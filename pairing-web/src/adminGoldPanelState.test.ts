import assert from 'node:assert/strict';
import test from 'node:test';
import { canSubmitGoldImport, canSubmitPaidGoldCreation, paidGoldCreditWarning, resolveGoldImportRequest, resolveGoldPackageState, resolvePaidGoldCreationRequest } from './adminGoldPanelState.ts';

test('empty bouquets still allow Gold demo import', () => {
  assert.deepEqual(resolveGoldPackageState({ success: true, packages: [], emptyReason: 'no_custom_bouquets' }), { packages: [], emptyReason: 'no_custom_bouquets' });
  assert.equal(canSubmitGoldImport('https://gold.example/get.php?username=u&password=p'), true);
});

test('import request uses import_account and no create parameters', () => {
  const request = resolveGoldImportRequest({ m3uUrl: ' https://gold.example/get.php?username=u&password=p ', displayName: 'Demo', notes: 'test', runDiagnostics: true, activateIfHealthy: false });
  assert.deepEqual(request, { action: 'import_account', m3uUrl: 'https://gold.example/get.php?username=u&password=p', displayName: 'Demo', notes: 'test', runDiagnostics: true, activateIfHealthy: false });
  assert.equal('sub' in request, false); assert.equal('pack' in request, false); assert.equal('packageId' in request, false); assert.equal('accountType' in request, false);
});

test('import requires a non-empty M3U URL', () => {
  assert.equal(canSubmitGoldImport(''), false); assert.equal(canSubmitGoldImport('   '), false); assert.equal(canSubmitGoldImport('https://gold.example/get.php?username=u&password=p'), true);
});

test('paid creation only permits documented subscriptions and real packages', () => {
  assert.equal(canSubmitPaidGoldCreation([], '132', '1'), false); assert.equal(canSubmitPaidGoldCreation([{ id: '132', name: 'Package' }], 'all', '1'), false); assert.equal(canSubmitPaidGoldCreation([{ id: '132', name: 'Package' }], '132', '99'), false); assert.equal(canSubmitPaidGoldCreation([{ id: '132', name: 'Package' }], '132', '1'), true);
  assert.deepEqual(resolvePaidGoldCreationRequest({ subscription: '12', packageId: '132', country: 'all', displayName: 'Paid', notes: '', runDiagnostics: true, activateIfHealthy: false }), { action: 'create_account', accountType: 'paid', sub: '12', packageId: '132', country: 'ALL', displayName: 'Paid', notes: '', runDiagnostics: true, activateIfHealthy: false });
  assert.equal(paidGoldCreditWarning('paid'), 'This will use Gold reseller credits. Continue?'); assert.equal(paidGoldCreditWarning('import'), '');
});
