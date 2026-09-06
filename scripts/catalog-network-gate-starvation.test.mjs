import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const {
  resetProviderCatalogNetworkGateForTests,
  getProviderCatalogNetworkGateSnapshotForTests,
  reevaluateProviderCatalogNetworkGateSurface,
  withProviderCatalogNetworkGate,
} = await import('../src/features/providers/providerCatalogNetworkGate.ts');

const gate = fs.readFileSync(new URL('../src/features/providers/providerCatalogNetworkGate.ts', import.meta.url), 'utf8');
const sync = fs.readFileSync(new URL('../src/features/providers/providerCatalogSync.ts', import.meta.url), 'utf8');
const decodeTypes = fs.readFileSync(new URL('../src/features/catalog/nativeCatalogDecodeTypes.ts', import.meta.url), 'utf8');

test('foreground Movies starvation policy is explicit and bounded', () => {
  assert.match(gate, /FOREGROUND_MOVIE_STARVATION_THRESHOLD_MS\s*=\s*1500/);
  assert.match(gate, /waiter\.mediaType === 'movie'/);
  assert.match(gate, /waiter\.activeSurface === 'movies'/);
  assert.match(gate, /!waiter\.readableGenerationPresent/);
  assert.match(gate, /owner\.mediaType === 'series'/);
  assert.match(gate, /owner\.operation === 'get_series'/);
  assert.match(gate, /owner\.background/);
  assert.match(gate, /owner\.cancellable/);
  assert.match(gate, /reevaluateProviderCatalogNetworkGateSurface/);
  assert.match(gate, /remainingMs/);
});

test('gate preemption is cooperative and release remains in finally', () => {
  assert.match(gate, /const requested = waiter\.onPreemptionRequested\?\.\(\) \?\? false/);
  assert.match(gate, /finally \{\s*releaseProviderCatalogNetworkGate/s);
  assert.match(gate, /gate-owner-released-after-preemption/);
  assert.match(gate, /foreground-acquired-after-preemption/);
});

test('Series retry is delayed and de-duplicated', () => {
  assert.match(sync, /SERIES_PREEMPTION_RETRY_DELAY_MS\s*=\s*750/);
  assert.match(sync, /pendingSeriesRetryLatches\.has\(key\)/);
  assert.match(sync, /series-preemption-latched/);
  assert.match(sync, /series-retry-deferred/);
  assert.match(sync, /series-retry-release-condition/);
  assert.match(sync, /series-retry-scheduled/);
  assert.match(sync, /scheduleCatalogSync\(\s*latch\.coordinatorKey/s);
});

test('retry latch has event-driven release and stale identity guards', () => {
  assert.match(sync, /subscribeCatalogUiSurface/);
  assert.match(sync, /movies-readable-generation/);
  assert.match(sync, /movies-surface-exited/);
  assert.match(sync, /movies-terminal-failure-or-cancellation/);
  assert.match(sync, /coordinatorEpoch/);
  assert.match(sync, /series-retry-stale-discarded/);
  assert.doesNotMatch(sync, /pendingSeriesPreemptionRetries/);
});

test('preemption remains restricted to background full Series dumps', () => {
  assert.match(gate, /owner\.mediaType === 'series'/);
  assert.match(gate, /owner\.operation === 'get_series'/);
  assert.match(gate, /owner\.background/);
  assert.match(gate, /owner\.cancellable/);
  assert.doesNotMatch(gate, /operation === 'get_series:filter-probe'/);
});

test('network metadata carries source, cancellation, surface, and readable-generation state', () => {
  for (const field of [
    'catalogNetworkRequestSource',
    'catalogNetworkBackground',
    'catalogNetworkCancellable',
    'catalogNetworkForeground',
    'catalogNetworkActiveSurface',
    'catalogNetworkReadableGenerationPresent',
  ]) {
    assert.match(decodeTypes, new RegExp(field));
  }
});

test('integrity and checkpoint source files remain policy owners', () => {
  const validation = fs.readFileSync(new URL('../src/features/catalog/moviesCategoryDistributionValidation.ts', import.meta.url), 'utf8');
  const readiness = fs.readFileSync(new URL('../src/features/movies/moviesCatalogReadiness.ts', import.meta.url), 'utf8');
  const checkpoint = fs.readFileSync(new URL('../src/features/providers/catalogSyncCheckpointResume.ts', import.meta.url), 'utf8');
  assert.match(validation, /sparse-partial-dump/);
  assert.match(readiness, /waiting-fresh-sync/);
  assert.match(checkpoint, /readableMovieGeneration/);
});

test('runtime: foreground first-run Movies preempts only after the threshold and acquires after release', async () => {
  resetProviderCatalogNetworkGateForTests();
  let releaseSeries;
  let preemptionRequests = 0;
  let movieAcquired = false;
  const series = withProviderCatalogNetworkGate(
    'provider-runtime-test',
    'series',
    'get_series',
    () => new Promise((resolve) => { releaseSeries = resolve; }),
    {
      requestSource: 'provider-bundle-activation',
      background: true,
      cancellable: true,
      foreground: false,
      activeSurface: 'movies',
    },
  );
  await new Promise((resolve) => setTimeout(resolve, 20));
  const movies = withProviderCatalogNetworkGate(
    'provider-runtime-test',
    'movie',
    'get_vod_streams:category',
    async () => { movieAcquired = true; },
    {
      requestSource: 'provider-bundle-activation',
      background: true,
      cancellable: false,
      foreground: true,
      activeSurface: 'movies',
      readableGenerationPresent: false,
      onPreemptionRequested: () => {
        preemptionRequests += 1;
        releaseSeries();
        return true;
      },
    },
  );
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(preemptionRequests, 0);
  assert.equal(movieAcquired, false);
  await new Promise((resolve) => setTimeout(resolve, 1450));
  await Promise.all([series, movies]);
  assert.equal(preemptionRequests, 1);
  assert.equal(movieAcquired, true);
  resetProviderCatalogNetworkGateForTests();
});

async function createHomeToMoviesScenario({ readableGenerationPresent = false, cancelled = false } = {}) {
  resetProviderCatalogNetworkGateForTests();
  let releaseSeries;
  let preemptionRequests = 0;
  const series = withProviderCatalogNetworkGate(
    'surface-transition-test',
    'series',
    'get_series',
    () => new Promise((resolve) => { releaseSeries = resolve; }),
    { background: true, cancellable: true, activeSurface: 'other' },
  );
  await new Promise((resolve) => setTimeout(resolve, 20));
  const moviesPromise = withProviderCatalogNetworkGate(
    'surface-transition-test',
    'movie',
    'get_vod_streams:category',
    async () => {},
    {
      background: true,
      cancellable: false,
      foreground: false,
      activeSurface: 'other',
      readableGenerationPresent,
      isCancelled: () => cancelled,
      onPreemptionRequested: () => {
        preemptionRequests += 1;
        releaseSeries();
        return true;
      },
    },
  );
  const movies = moviesPromise.catch(() => undefined);
  return { series, movies, releaseSeries, getPreemptionRequests: () => preemptionRequests };
}

test('runtime: Home to Movies transition immediately re-evaluates an already-starved waiter', async () => {
  const scenario = await createHomeToMoviesScenario();
  await new Promise((resolve) => setTimeout(resolve, 1650));
  assert.equal(scenario.getPreemptionRequests(), 0);
  reevaluateProviderCatalogNetworkGateSurface('movies');
  await Promise.all([scenario.series, scenario.movies]);
  assert.equal(scenario.getPreemptionRequests(), 1);
  resetProviderCatalogNetworkGateForTests();
});

test('runtime: Home to Movies transition arms only the remaining starvation delay', async () => {
  const scenario = await createHomeToMoviesScenario();
  await new Promise((resolve) => setTimeout(resolve, 900));
  reevaluateProviderCatalogNetworkGateSurface('movies');
  await new Promise((resolve) => setTimeout(resolve, 350));
  assert.equal(scenario.getPreemptionRequests(), 0);
  await Promise.all([scenario.series, scenario.movies]);
  assert.equal(scenario.getPreemptionRequests(), 1);
  resetProviderCatalogNetworkGateForTests();
});

test('runtime: leaving Movies cancels the pending transition starvation attempt', async () => {
  const scenario = await createHomeToMoviesScenario();
  await new Promise((resolve) => setTimeout(resolve, 500));
  reevaluateProviderCatalogNetworkGateSurface('movies');
  await new Promise((resolve) => setTimeout(resolve, 300));
  reevaluateProviderCatalogNetworkGateSurface('other');
  await new Promise((resolve) => setTimeout(resolve, 1100));
  assert.equal(scenario.getPreemptionRequests(), 0);
  const snapshot = getProviderCatalogNetworkGateSnapshotForTests('surface-transition-test');
  assert.equal(snapshot.owner?.mediaType, 'series');
  scenario.releaseSeries();
  await scenario.series;
  resetProviderCatalogNetworkGateForTests();
  await scenario.movies;
});

test('runtime: duplicate Movies transitions create one effective cancellation', async () => {
  const scenario = await createHomeToMoviesScenario();
  reevaluateProviderCatalogNetworkGateSurface('movies');
  reevaluateProviderCatalogNetworkGateSurface('movies');
  reevaluateProviderCatalogNetworkGateSurface('movies');
  await new Promise((resolve) => setTimeout(resolve, 1650));
  await Promise.all([scenario.series, scenario.movies]);
  assert.equal(scenario.getPreemptionRequests(), 1);
  resetProviderCatalogNetworkGateForTests();
});

test('runtime: readable Movies generation and stale waiter suppress transition preemption', async () => {
  const readable = await createHomeToMoviesScenario({ readableGenerationPresent: true });
  reevaluateProviderCatalogNetworkGateSurface('movies');
  await new Promise((resolve) => setTimeout(resolve, 1650));
  assert.equal(readable.getPreemptionRequests(), 0);
  readable.releaseSeries();
  await readable.series;
  resetProviderCatalogNetworkGateForTests();
  await readable.movies;

  const stale = await createHomeToMoviesScenario({ cancelled: true });
  reevaluateProviderCatalogNetworkGateSurface('movies');
  await new Promise((resolve) => setTimeout(resolve, 1650));
  assert.equal(stale.getPreemptionRequests(), 0);
  stale.releaseSeries();
  await stale.series;
  resetProviderCatalogNetworkGateForTests();
  await stale.movies.catch(() => undefined);
});
