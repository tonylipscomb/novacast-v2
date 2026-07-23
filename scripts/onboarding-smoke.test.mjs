import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createDefaultOnboardingState,
  guideKeyLabelMap,
  markGuideSeen,
  normalizeOnboardingState,
  resetOnboardingState,
  setSuppressAllGuides,
  shouldAutoShowGuide,
} from '../src/features/onboarding/onboardingModel.ts';

test('Onboarding starts with all guides available', () => {
  const state = createDefaultOnboardingState();

  assert.equal(state.version, 1);
  assert.equal(state.hubGuideSeen, false);
  assert.equal(state.pairingGuideSeen, false);
  assert.equal(state.suppressAllGuides, false);
  assert.equal(shouldAutoShowGuide(state, 'hubGuideSeen'), true);
});

test('Stored onboarding state normalizes invalid payloads', () => {
  const normalized = normalizeOnboardingState({ version: 99, hubGuideSeen: true });

  assert.deepEqual(normalized, createDefaultOnboardingState());
});

test('Marking one guide seen leaves the others untouched', () => {
  const next = markGuideSeen(createDefaultOnboardingState(), 'moviesGuideSeen');

  assert.equal(next.moviesGuideSeen, true);
  assert.equal(next.seriesGuideSeen, false);
  assert.equal(shouldAutoShowGuide(next, 'moviesGuideSeen'), false);
  assert.equal(shouldAutoShowGuide(next, 'settingsGuideSeen'), true);
});

test('Global suppression disables walkthrough auto-showing', () => {
  const suppressed = setSuppressAllGuides(createDefaultOnboardingState(), true);

  assert.equal(suppressed.suppressAllGuides, true);
  assert.equal(shouldAutoShowGuide(suppressed, 'guideScreenGuideSeen'), false);
});

test('Reset onboarding returns all guides to their initial state', () => {
  const reset = resetOnboardingState();

  assert.deepEqual(reset, createDefaultOnboardingState());
  assert.equal(guideKeyLabelMap.settingsGuideSeen, 'Settings');
});
