import assert from 'node:assert/strict';
import test from 'node:test';
import { canActivateProvider, displayHealthLabel, formatCount, formatInventoryCount, healthTone, isCappedCatalogCount } from './providerHealthDisplay.ts';

test('draft unvalidated providers display as DRAFT', () => {
  assert.equal(displayHealthLabel({ activationStatus: 'draft', healthStatus: 'unvalidated', validationStale: true }), 'DRAFT');
});

test('stale active providers require validation without looking disabled', () => {
  assert.equal(displayHealthLabel({ activationStatus: 'active', healthStatus: 'healthy', validationStale: true }), 'VALIDATION REQUIRED');
  assert.equal(healthTone('VALIDATION REQUIRED'), 'warn');
});

test('failed providers cannot activate', () => {
  assert.equal(canActivateProvider({ healthStatus: 'failed', validationStale: false, activationStatus: 'draft' }), false);
  assert.equal(canActivateProvider({ healthStatus: 'healthy', validationStale: false, activationStatus: 'draft' }), true);
  assert.equal(canActivateProvider({ healthStatus: 'degraded', validationStale: false, activationStatus: 'paused' }), true);
});

test('capped catalog counts are displayed as lower bounds', () => {
  assert.equal(isCappedCatalogCount(12000), true);
  assert.equal(isCappedCatalogCount(12000, false), false);
  assert.equal(isCappedCatalogCount(56527, false, true), false);
  assert.equal(isCappedCatalogCount(12000, true, false), true);
  assert.equal(formatCount(12000, true), '12,000+');
  assert.equal(formatCount(56527, false), '56,527');
});

test('inventory counts take precedence over diagnostic lower bounds', () => {
  assert.equal(formatInventoryCount(87416, 12000, true), '87,416');
  assert.equal(formatInventoryCount(null, 12000, true), '12,000+');
  assert.equal(formatInventoryCount(null, null, false), 'Not counted');
});

test('offline and expired semantics are distinct from generic failed health', () => {
  assert.equal(displayHealthLabel({ activationStatus: 'active', healthStatus: 'failed', validationStale: false, offline: true }), 'OFFLINE');
  assert.equal(displayHealthLabel({ activationStatus: 'active', healthStatus: 'failed', validationStale: false, expired: true }), 'EXPIRED');
  assert.equal(healthTone('OFFLINE'), 'fail');
});
