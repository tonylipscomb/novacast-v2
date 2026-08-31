import type { ProviderAccountMetadata, ProviderConnectionRecord, ProviderCredentialRecord, ProviderRecord } from './providerModel.ts';
import { isProviderConnectionReady } from './providerModel.ts';
import { createSmartMovieDataSource } from '../movies/smart/SmartMovieDataSource.ts';
import { createProviderSeriesDataSource } from '../series/data/ProviderSeriesDataSource.ts';
import { createSmartSeriesDataSource } from '../series/smart/SmartSeriesDataSource.ts';
import { createSqliteFirstSeriesDataSource } from '../series/data/SqliteSeriesDataSource.ts';
import { logSeriesDataSourceAudit } from '../series/seriesDataSourceAudit.ts';
import type { SeriesDataSource } from '../series/data/SeriesDataSource.ts';
import {
  createMockProviderRepositories,
  createXtreamProviderRepositories,
  type ProviderRepositories,
} from './providerRepositories.ts';
import { XtreamClient, normalizeXtreamAccountMetadata } from './xtreamClient.ts';
import {
  getRememberedAccountOutputFormats,
  mergeAccountOutputFormats,
  rememberAccountOutputFormats,
} from './accountOutputFormats.ts';
import { cancelProviderCatalogSync } from './providerCatalogSync.ts';
import { invalidateCatalogSyncForProvider, isCatalogSyncRunning } from '../catalog/catalogSyncCoordinator.ts';
import {
  shouldResumeInterruptedCatalogSync,
  shouldSkipBootstrapBecauseSyncing,
} from '../catalog/catalogReadableGenerationRestore.ts';
import { logProviderBoundary, safeProviderRuntimeFlags } from './providerBoundaryDiagnostics.ts';
import { summarizeXtreamAccountEntitlements } from './providerEntitlementAudit.ts';
import { novacastTrace } from '../diagnostics/novacastLogPolicy.ts';

/** Stage 4.2O.2 — Series SQLite Parity. Mirrors Movies' build-time kill switch. */
const SERIES_SQLITE_READS_ENABLED = process.env.EXPO_PUBLIC_SERIES_SQLITE_READS === 'true';

export type ProviderRepositoryBundle = ProviderRepositories & {
  providerId: string;
  providerName: string;
  connectionType: ProviderConnectionRecord['type'];
  generation: number;
  createdAt: number;
  accountMetadata: ProviderAccountMetadata | null;
  seriesDataSource: SeriesDataSource;
  syncCatalog: (requestSource?: string) => Promise<void>;
  ready: Promise<void>;
  invalidate(): void;
};

let activeBundle: ProviderRepositoryBundle | null = null;
let bundleGeneration = 0;
const listeners = new Set<() => void>();
const catalogBootstrapRequested = new WeakSet<ProviderRepositoryBundle>();
let repositoryBundleFactoryOverride: ((provider: ProviderRecord, credentials?: ProviderCredentialRecord) => ProviderRepositoryBundle) | null = null;
let activationObserverForTests: ((bundle: ProviderRepositoryBundle) => void) | null = null;

function logFreshProviderBootstrap(phase: string, fields: Record<string, unknown> = {}) {
  novacastTrace('[NovaCast Fresh Provider Bootstrap]', JSON.stringify({ phase, ...fields }));
}

function logCatalogBootstrapDispatch(phase: string, fields: Record<string, unknown> = {}) {
  novacastTrace('[NovaCast Catalog Bootstrap Dispatch]', JSON.stringify({ phase, ...fields }));
}

async function requestCatalogBootstrap(bundle: ProviderRepositoryBundle) {
  const { getCatalogBootstrapState } = await import('../catalog/catalogRepository.ts');
  const coordinatorInFlight = isCatalogSyncRunning(bundle.providerId, 'movie');
  let state = await getCatalogBootstrapState(bundle.providerId, 'movie');
  logFreshProviderBootstrap('durable-state-read', {
    providerId: bundle.providerId,
    providerCatalogGeneration: state.providerCatalogGeneration,
    currentAttemptGeneration: state.currentAttemptGeneration,
    currentStatus: state.currentStatus,
    durableReadyGeneration: state.durableReadyGeneration,
    decisionReason: state.durableReadyLifecycleState === 'ready' ? 'ready-generation-present' : null,
  });

  if (shouldSkipBootstrapBecauseSyncing({
    currentStatus: state.currentStatus,
    coordinatorInFlight,
  })) {
    logFreshProviderBootstrap('bootstrap-skipped-syncing', {
      providerId: bundle.providerId,
      providerCatalogGeneration: state.providerCatalogGeneration,
      currentAttemptGeneration: state.currentAttemptGeneration,
      currentStatus: state.currentStatus,
      durableReadyGeneration: state.durableReadyGeneration,
      decisionReason: 'current-movie-sync-already-in-progress',
    });
    return;
  }

  const { reconcileOrphanedCatalogSyncs } = await import('../catalog/catalogOrphanedSyncRecovery.ts');
  const abandonedOrphans = await reconcileOrphanedCatalogSyncs();
  if (abandonedOrphans > 0) {
    state = await getCatalogBootstrapState(bundle.providerId, 'movie');
    logFreshProviderBootstrap('orphaned-sync-abandoned', {
      providerId: bundle.providerId,
      abandonedOrphans,
      providerCatalogGeneration: state.providerCatalogGeneration,
      currentAttemptGeneration: state.currentAttemptGeneration,
      currentStatus: state.currentStatus,
      durableReadyGeneration: state.durableReadyGeneration,
      decisionReason: 'durable-syncing-without-active-writer',
    });
  }

  const interruptedSync = shouldResumeInterruptedCatalogSync({
    currentStatus: state.currentStatus,
    coordinatorInFlight,
  });
  if (interruptedSync) {
    logFreshProviderBootstrap('bootstrap-resume-interrupted-sync', {
      providerId: bundle.providerId,
      providerCatalogGeneration: state.providerCatalogGeneration,
      currentAttemptGeneration: state.currentAttemptGeneration,
      currentStatus: state.currentStatus,
      durableReadyGeneration: state.durableReadyGeneration,
      priorReadyRestoredOnBoot: state.durableReadyGeneration > 0 && state.durableReadyLifecycleState === 'ready',
      decisionReason: 'sqlite-syncing-without-live-writer',
    });
  }

  if (!interruptedSync && state.durableReadyGeneration > 0 && state.durableReadyLifecycleState === 'ready') {
    const { shouldRequestSortMetadataUpgrade } = await import('../catalog/catalogSortMetadataUpgrade.ts');
    const movieUpgrade = await shouldRequestSortMetadataUpgrade(bundle.providerId, 'movie');
    const seriesUpgrade = await shouldRequestSortMetadataUpgrade(bundle.providerId, 'series');
    if (!movieUpgrade && !seriesUpgrade) {
      logFreshProviderBootstrap('bootstrap-skipped-ready', {
        providerId: bundle.providerId,
        providerCatalogGeneration: state.providerCatalogGeneration,
        currentAttemptGeneration: state.currentAttemptGeneration,
        currentStatus: state.currentStatus,
        durableReadyGeneration: state.durableReadyGeneration,
        decisionReason: 'durable-movie-ready-generation-present',
      });
      return;
    }
    logFreshProviderBootstrap('sort-metadata-upgrade-requested', {
      providerId: bundle.providerId,
      providerCatalogGeneration: state.providerCatalogGeneration,
      movieUpgrade,
      seriesUpgrade,
      decisionReason: 'v4-sort-metadata-missing-on-ready-generation',
    });
  }

  logFreshProviderBootstrap('bootstrap-required', {
    providerId: bundle.providerId,
    providerCatalogGeneration: state.providerCatalogGeneration,
    currentAttemptGeneration: state.currentAttemptGeneration,
    currentStatus: state.currentStatus,
    durableReadyGeneration: state.durableReadyGeneration,
    decisionReason: 'no-ready-movie-generation-and-no-syncing-attempt',
  });
  logFreshProviderBootstrap('catalog-bootstrap-request', {
    providerId: bundle.providerId,
    providerBundleGeneration: bundle.generation,
    requestSource: 'provider-bundle-activation',
  });
  logFreshProviderBootstrap('movie-sync-requested', { providerId: bundle.providerId });
  logFreshProviderBootstrap('series-sync-requested', { providerId: bundle.providerId });
  logCatalogBootstrapDispatch('dispatch-requested', {
    providerId: bundle.providerId,
    providerBundleGeneration: bundle.generation,
    coordinatorState: 'not-started',
    pendingInputPresent: false,
    currentAttemptGeneration: state.currentAttemptGeneration,
    currentStatus: state.currentStatus,
  });
  await bundle.syncCatalog('provider-bundle-activation');
}

function notify() {
  listeners.forEach((listener) => listener());
}

function buildRepositories(provider: ProviderRecord, credentials?: ProviderCredentialRecord): ProviderRepositories & {
  seriesDataSource: SeriesDataSource;
  syncCatalog: (requestSource?: string) => Promise<void>;
} {
  const base =
    provider.connection?.type === 'xtream'
      ? createXtreamProviderRepositories(new XtreamClient(credentials!, { providerId: provider.id }))
      : createMockProviderRepositories(provider.id);

  // Stage 4.2O.2: insert the SQLite-first composite *below* the smart
  // wrapper so smart sections (Discover, Continue Watching, Favorites, the
  // Uncategorized fallback) are unaffected — createSmartSeriesDataSource
  // calls base.getCategories()/getSeriesPage() for the flat provider rail,
  // and that "base" now prefers a readable local generation, falling back
  // to the real provider network call only when none exists.
  const rawSeriesDataSource = createProviderSeriesDataSource(base.series, base.mediaBaseUrl);
  const seriesSqliteSelected = SERIES_SQLITE_READS_ENABLED;
  logSeriesDataSourceAudit({
    event: 'data-source-selection',
    providerId: provider.id,
    selectedSource: seriesSqliteSelected ? 'sqlite' : 'repository',
    sourceClass: seriesSqliteSelected ? 'SqliteSeriesDataSource' : 'ProviderSeriesDataSource',
    sqliteEnabled: seriesSqliteSelected,
    generationStatus: 'bundle-factory',
    fallbackReason: seriesSqliteSelected ? null : 'EXPO_PUBLIC_SERIES_SQLITE_READS!==true',
  });
  const seriesDataSource = createSmartSeriesDataSource(
    seriesSqliteSelected
      ? createSqliteFirstSeriesDataSource(provider.id, rawSeriesDataSource)
      : rawSeriesDataSource,
    provider.id,
  );

  const bundleBase = {
    ...base,
    movies: createSmartMovieDataSource(base.movies, provider.id),
    seriesDataSource,
  };

  return {
    ...bundleBase,
    syncCatalog: async (requestSource = 'provider-bundle-activation') => {
      logCatalogBootstrapDispatch('bundle-syncCatalog-enter', {
        providerId: provider.id,
        requestSource,
        coordinatorState: 'importing-provider-sync',
        pendingInputPresent: false,
      });
      try {
        const { scheduleProviderCatalogSync } = await import('./providerCatalogSync.ts');
        logCatalogBootstrapDispatch('coordinator-enter', {
          providerId: provider.id,
          requestSource,
          coordinatorState: 'module-ready',
          pendingInputPresent: false,
        });
        await scheduleProviderCatalogSync({
          providerId: provider.id,
          providerType: provider.connection?.type ?? 'unknown',
          displayName: provider.name,
          requestSource,
          movies: base.movies,
          series: base.series,
          live: base.live,
        });
        logCatalogBootstrapDispatch('bundle-syncCatalog-return', {
          providerId: provider.id,
          requestSource,
          coordinatorState: 'resolved',
          pendingInputPresent: false,
          timestamp: Date.now(),
        });
      } catch (error) {
        logCatalogBootstrapDispatch('dispatch-failed', {
          providerId: provider.id,
          requestSource,
          coordinatorState: 'rejected',
          pendingInputPresent: false,
          skipReason: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    },
  };
}

export function createRepositoryBundle(provider: ProviderRecord, credentials?: ProviderCredentialRecord): ProviderRepositoryBundle {
  if (repositoryBundleFactoryOverride) {
    return repositoryBundleFactoryOverride(provider, credentials);
  }

  const connection = provider.connection;

  if (!connection || !isProviderConnectionReady(provider)) {
    throw new Error(`Provider "${provider.name}" is missing connection details.`);
  }

  if (connection.type === 'xtream' && !credentials) {
    throw new Error(`Provider "${provider.name}" is missing secure credentials.`);
  }

  const repositories = buildRepositories(provider, credentials);
  logProviderBoundary('[NovaCast Provider Runtime]', safeProviderRuntimeFlags({
    managedProviderId: provider.id,
    providerRecord: provider,
    credentials,
    providerBase: provider.connection?.type === 'xtream' ? credentials?.baseUrl : provider.connection?.serverId,
    assignmentSource: 'active-provider-bundle',
  }));
  const nextGeneration = bundleGeneration + 1;
  let cancelled = false;
  let accountMetadata: ProviderAccountMetadata | null =
    mergeAccountOutputFormats(provider.account, getRememberedAccountOutputFormats(provider.id)) ??
    provider.account ??
    null;

  const bundle = {
    ...repositories,
    providerId: provider.id,
    providerName: provider.name,
    connectionType: connection.type,
    generation: nextGeneration,
    createdAt: Date.now(),
    accountMetadata,
    ready: Promise.resolve().then(async () => {
      if (connection.type !== 'xtream') {
        return;
      }

      const client = new XtreamClient(credentials!, { providerId: provider.id });
      const response = await client.getAccountInfo();
      if (cancelled) {
        throw new Error('Provider initialization was cancelled.');
      }

      accountMetadata = normalizeXtreamAccountMetadata(response);
      bundle.accountMetadata = accountMetadata;
      rememberAccountOutputFormats(provider.id, accountMetadata);
      const entitlement = summarizeXtreamAccountEntitlements(response, credentials?.baseUrl);
      logProviderBoundary('[NovaCast Provider Runtime]', {
        event: 'account-state',
        accountStatus: entitlement.status,
        activeConnections: entitlement.activeConnections,
        maxConnections: entitlement.maxConnections,
        allowedOutputFormats: entitlement.allowedOutputFormats,
      });
    }),
    invalidate() {
      cancelled = true;
    },
  } satisfies ProviderRepositoryBundle;

  return bundle;
}

export function setRepositoryBundleFactoryForTests(
  factory: ((provider: ProviderRecord, credentials?: ProviderCredentialRecord) => ProviderRepositoryBundle) | null,
) {
  repositoryBundleFactoryOverride = factory;
}

export function setRepositoryBundleActivationObserverForTests(observer: ((bundle: ProviderRepositoryBundle) => void) | null) {
  activationObserverForTests = observer;
}

export function activateRepositoryBundle(bundle: ProviderRepositoryBundle) {
  activationObserverForTests?.(bundle);
  const previousBundle = activeBundle;
  logCatalogBootstrapDispatch('activation-enter', {
    providerId: bundle.providerId,
    providerBundleGeneration: bundle.generation,
    previousProviderBundleGeneration: previousBundle?.generation ?? null,
    previousProviderId: previousBundle?.providerId ?? null,
    sameProviderActivation: previousBundle?.providerId === bundle.providerId,
    coordinatorState: 'activation',
    pendingInputPresent: false,
  });
  if (previousBundle && previousBundle !== bundle) {
    if (previousBundle.providerId !== bundle.providerId) {
      cancelProviderCatalogSync(previousBundle.providerId, {
        cancelSource: 'provider-replaced',
        cancelCaller: 'activateRepositoryBundle',
      });
      invalidateCatalogSyncForProvider(previousBundle.providerId, {
        cancelSource: 'provider-replaced',
        cancelCaller: 'activateRepositoryBundle',
      });
    }
    previousBundle.invalidate();
  }

  activeBundle = bundle;
  bundleGeneration = bundle.generation;
  notify();

  logFreshProviderBootstrap('provider-ready', {
    providerId: bundle.providerId,
    providerBundleGeneration: bundle.generation,
  });

  if (!catalogBootstrapRequested.has(bundle)) {
    catalogBootstrapRequested.add(bundle);
    void requestCatalogBootstrap(bundle).catch((error) => {
      logFreshProviderBootstrap('catalog-bootstrap-failed', {
        providerId: bundle.providerId,
        errorCode: error instanceof Error ? error.message : 'catalog_bootstrap_failed',
      });
    });
  } else {
    logFreshProviderBootstrap('catalog-bootstrap-skipped', {
      providerId: bundle.providerId,
      reason: 'bundle-already-requested',
    });
  }

  void import('./providerCatalogSync.ts').then(({ hydrateProviderLibraryCaches }) => {
    void hydrateProviderLibraryCaches(bundle.providerId).catch((error) => {
      logFreshProviderBootstrap('cache-hydration-failed', {
        providerId: bundle.providerId,
        errorCode: error instanceof Error ? error.message : 'cache_hydration_failed',
      });
    });
  }).catch((error) => {
    logFreshProviderBootstrap('catalog-module-load-failed', {
      providerId: bundle.providerId,
      errorCode: error instanceof Error ? error.message : 'catalog_module_load_failed',
    });
  });
}

export function getActiveRepositoryBundle() {
  return activeBundle;
}

export function getRepositoryBundleGeneration() {
  return bundleGeneration;
}

export function invalidateRepositoryBundle() {
  cancelProviderCatalogSync(undefined, {
    cancelSource: 'bundle-invalidated',
    cancelCaller: 'invalidateRepositoryBundle',
  });
  const previousBundle = activeBundle;
  previousBundle?.invalidate();
  activeBundle = null;
  if (previousBundle) {
    bundleGeneration += 1;
    notify();
  }
}

export function subscribeRepositoryBundle(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
