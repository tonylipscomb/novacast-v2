import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createDefaultProviderState,
  getSelectedProvider,
  normalizeProviderState,
  isProviderConnectionReady,
  selectProviderState,
  setDemoModeForTests,
} from '../src/features/providers/providerModel.ts';
import { getMoviesScreenMemory, rememberMoviesScreenMemory, resetMoviesScreenMemory } from '../src/features/movies/moviesScreenMemory.ts';
import { getLiveTvMemory, rememberLiveTvMemory, resetLiveTvMemory } from '../src/features/live/liveTvMemory.ts';
import { getGuideMemory, rememberGuideMemory, resetGuideMemory } from '../src/features/guide/guideMemory.ts';

test.before(() => setDemoModeForTests(true));
test.after(() => setDemoModeForTests(null));

test('Provider state starts with a selected active provider', () => {
  const state = createDefaultProviderState();

  assert.equal(state.providers.length >= 3, true);
  assert.equal(getSelectedProvider(state)?.name, 'Demo Provider');
  assert.equal(getSelectedProvider(state)?.selected, true);
  assert.equal(isProviderConnectionReady(getSelectedProvider(state)), true);
});

test('Selecting a provider updates the selected id and card flags', () => {
  const next = selectProviderState(createDefaultProviderState(), 'family-tv');

  assert.equal(next.selectedProviderId, 'family-tv');
  assert.equal(getSelectedProvider(next)?.name, 'Family TV');
  assert.equal(next.providers.find((provider) => provider.id === 'family-tv')?.selected, true);
  assert.equal(next.providers.find((provider) => provider.id === 'demo-provider')?.selected, false);
});

test('Provider state normalization repairs invalid payloads', () => {
  const normalized = normalizeProviderState({
    version: 1,
    selectedProviderId: 'missing',
    providers: [{ id: 'broken', name: 'Broken', status: 'bogus', expirationLabel: 'Unknown', selected: false, connection: {
      type: 'mock',
      baseUrl: 'https://broken.example',
      username: 'broken',
      password: 'broken',
    } }],
  });

  assert.equal(normalized.providers[0].status, 'unknown');
  assert.equal(normalized.providers[0].selected, true);
});

test('Provider-scoped memories stay isolated between providers', () => {
  resetMoviesScreenMemory();
  resetLiveTvMemory();
  resetGuideMemory();

  rememberMoviesScreenMemory('demo-provider', {
    selectedCategoryId: 'top',
    focusedMovieId: 'movie-a',
  });
  rememberMoviesScreenMemory('family-tv', {
    selectedCategoryId: 'family',
    focusedMovieId: 'movie-b',
  });

  rememberLiveTvMemory('demo-provider', {
    selectedCategoryId: 'news',
    selectedChannelId: 'demo-channel',
  });
  rememberLiveTvMemory('family-tv', {
    selectedCategoryId: 'sports',
    selectedChannelId: 'family-channel',
  });

  rememberGuideMemory('demo-provider', {
    focusedChannelId: 'n1',
    focusedProgramId: 'n1-0',
  });
  rememberGuideMemory('family-tv', {
    focusedChannelId: 'm8',
    focusedProgramId: 'm8-1',
  });

  assert.equal(getMoviesScreenMemory('demo-provider').selectedCategoryId, 'top');
  assert.equal(getMoviesScreenMemory('family-tv').selectedCategoryId, 'family');
  assert.equal(getLiveTvMemory('demo-provider').selectedChannelId, 'demo-channel');
  assert.equal(getLiveTvMemory('family-tv').selectedChannelId, 'family-channel');
  assert.equal(getGuideMemory('demo-provider').focusedProgramId, 'n1-0');
  assert.equal(getGuideMemory('family-tv').focusedProgramId, 'm8-1');
});
