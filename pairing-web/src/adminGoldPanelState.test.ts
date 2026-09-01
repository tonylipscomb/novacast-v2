import assert from 'node:assert/strict';
import test from 'node:test';
import { canSubmitGoldAccount, canSubmitGoldCreation, GOLD_ALL_PACKAGES, GOLD_DEMO_SUBSCRIPTION, paidGoldCreditWarning, resolveGoldCreationRequest, resolveGoldPackageState } from './adminGoldPanelState.ts';

test('empty Gold packages preserve the dashboard state', () => {
  assert.deepEqual(resolveGoldPackageState({ success: true, packages: [], emptyReason: 'no_custom_bouquets' }), {
    packages: [],
    emptyReason: 'no_custom_bouquets',
  });
});

test('Gold account creation requires a real package', () => {
  assert.equal(canSubmitGoldAccount([], ''), false);
  assert.equal(canSubmitGoldAccount([{ id: '1', name: 'Package' }], ''), false);
  assert.equal(canSubmitGoldAccount([{ id: '1', name: 'Package' }], '1'), true);
});

test('demo creation permits the all-bouquets package without custom bouquets', () => {
  assert.equal(GOLD_DEMO_SUBSCRIPTION, '99');
  assert.equal(canSubmitGoldCreation('demo', [], GOLD_ALL_PACKAGES), true);
  assert.equal(canSubmitGoldCreation('demo', [], ''), false);
});

test('paid creation still requires a selected package', () => {
  assert.equal(canSubmitGoldCreation('paid', [], ''), false);
  assert.equal(canSubmitGoldCreation('paid', [{ id: '132', name: 'Package' }], '132'), true);
});

test('demo creation uses sub=99 and all bouquets without custom packages', () => {
  assert.deepEqual(resolveGoldCreationRequest('demo', '1', GOLD_ALL_PACKAGES), { sub: '99', pack: 'all' });
  assert.notEqual(resolveGoldCreationRequest('demo', '1', GOLD_ALL_PACKAGES).sub, '1');
});

test('paid creation preserves month subscription mapping and warning', () => {
  assert.deepEqual(resolveGoldCreationRequest('paid', '1', '132'), { sub: '1', pack: '132' });
  assert.equal(paidGoldCreditWarning('paid'), 'This will use Gold reseller credits. Continue?');
  assert.equal(paidGoldCreditWarning('demo'), '');
});
