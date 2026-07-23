import type { ProviderAccountMetadata, ProviderConnectionRecord, ProviderCredentialRecord, ProviderRecord } from './providerModel.ts';
import { isProviderConnectionReady } from './providerModel.ts';
import { createSmartMovieDataSource } from '../movies/smart/SmartMovieDataSource.ts';
import { createProviderSeriesDataSource } from '../series/data/ProviderSeriesDataSource.ts';
import { createSmartSeriesDataSource } from '../series/smart/SmartSeriesDataSource.ts';
import type { SeriesDataSource } from '../series/data/SeriesDataSource.ts';
import {
  createMockProviderRepositories,
  createXtreamProviderRepositories,
  type ProviderRepositories,
} from './providerRepositories.ts';
import { XtreamClient, normalizeXtreamAccountMetadata } from './xtreamClient.ts';
import { cancelProviderCatalogSync } from './providerCatalogSync.ts';

export type ProviderRepositoryBundle = ProviderRepositories & {
  providerId: string;
  providerName: string;
  connectionType: ProviderConnectionRecord['type'];
  generation: number;
  createdAt: number;
  accountMetadata: ProviderAccountMetadata | null;
  seriesDataSource: SeriesDataSource;
  syncCatalog: () => Promise<void>;
  ready: Promise<void>;
  invalidate(): void;
};

let activeBundle: ProviderRepositoryBundle | null = null;
let bundleGeneration = 0;
const listeners = new Set<() => void>();
let repositoryBundleFactoryOverride: ((provider: ProviderRecord, credentials?: ProviderCredentialRecord) => ProviderRepositoryBundle) | null = null;
let activationObserverForTests: ((bundle: ProviderRepositoryBundle) => void) | null = null;

function notify() {
  listeners.forEach((listener) => listener());
}

function buildRepositories(provider: ProviderRecord, credentials?: ProviderCredentialRecord): ProviderRepositories & {
  seriesDataSource: SeriesDataSource;
  syncCatalog: () => Promise<void>;
} {
  const base =
    provider.connection?.type === 'xtream'
      ? createXtreamProviderRepositories(new XtreamClient(credentials!))
      : createMockProviderRepositories(provider.id);

  const seriesDataSource = createSmartSeriesDataSource(
    createProviderSeriesDataSource(base.series, base.mediaBaseUrl),
    provider.id,
  );

  const bundleBase = {
    ...base,
    movies: createSmartMovieDataSource(base.movies, provider.id),
    seriesDataSource,
  };

  return {
    ...bundleBase,
    syncCatalog: () =>
      import('./providerCatalogSync.ts').then(({ scheduleProviderCatalogSync }) =>
        scheduleProviderCatalogSync({
          providerId: provider.id,
          movies: base.movies,
          series: base.series,
          live: base.live,
        }),
      ),
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
  const nextGeneration = bundleGeneration + 1;
  let cancelled = false;
  let accountMetadata: ProviderAccountMetadata | null = provider.account ?? null;

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

      const client = new XtreamClient(credentials!);
      const response = await client.getAccountInfo();
      if (cancelled) {
        throw new Error('Provider initialization was cancelled.');
      }

      accountMetadata = normalizeXtreamAccountMetadata(response);
      bundle.accountMetadata = accountMetadata;
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
  if (previousBundle && previousBundle !== bundle) {
    cancelProviderCatalogSync(previousBundle.providerId);
    previousBundle.invalidate();
  }

  activeBundle = bundle;
  bundleGeneration = bundle.generation;
  notify();

  void import('./providerCatalogSync.ts').then(({ hydrateProviderLibraryCaches }) => {
    void hydrateProviderLibraryCaches(bundle.providerId).then(() => {
      if (activeBundle !== bundle || bundleGeneration !== bundle.generation) {
        return;
      }
      void bundle.syncCatalog();
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
  cancelProviderCatalogSync();
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
