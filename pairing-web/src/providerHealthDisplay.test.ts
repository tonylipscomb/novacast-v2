import assert from 'node:assert/strict';
import test from 'node:test';
import { canActivateProvider, displayHealthLabel, healthTone } from './providerHealthDisplay.ts';

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
