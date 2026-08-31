import assert from 'node:assert/strict';
import test from 'node:test';
import { canSubmitGoldAccount, resolveGoldPackageState } from './adminGoldPanelState.ts';

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
