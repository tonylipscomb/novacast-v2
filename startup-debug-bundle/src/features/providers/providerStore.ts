import { useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { getDevPairingPayload, type PairingConnectionPayload } from '../pairing/pairingBridge.ts';
import { markPairingCompleted } from '../pairing/pairingState.ts';
import { closeUnifiedPlayback, getUnifiedPlayerState } from '../playback/unified/unifiedPlayerStore.ts';

import {
  createDefaultProviderState,
  createEmptyProviderState,
  deriveProviderStatus,
  getProviderServerId,
  getSelectedProvider,
  hasSavedProvider,
  isProviderConnectionReady,
  isXtreamProvider,
  normalizeProviderState,
  serializeProviderState,
  selectProviderState,
  type ProviderAccountMetadata,
  type ProviderCredentialRecord,
  type ProviderRecord,
  type ProviderState,
} from './providerModel.ts';
import { formatProviderExpirationLabel } from './providerExpiration.ts';
import {
  activateRepositoryBundle,
  createRepositoryBundle,
  getActiveRepositoryBundle,
  getRepositoryBundleGeneration,
  invalidateRepositoryBundle,
  subscribeRepositoryBundle,
  type ProviderRepositoryBundle,
} from './providerBundle.ts';
import { withStartupInitRetries } from './providerInitRetry.ts';
import {
  getProviderCredentials,
  removeProviderCredentials,
  setProviderCredentials,
} from './providerCredentialStore.ts';
import { cancelProviderCatalogSync } from './providerCatalogSync.ts';

const STORAGE_KEY = '@novacast/provider-state';

type ProviderStateStorage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
};

let providerStateStorageOverride: ProviderStateStorage | null = null;

function getProviderStateStorage(): ProviderStateStorage {
  return providerStateStorageOverride ?? AsyncStorage;
}

export function setProviderStateStorageForTests(storage: ProviderStateStorage | null) {
  providerStateStorageOverride = storage;
}

let cache: ProviderState | null = null;
let loadPromise: Promise<ProviderState> | null = null;
let startupInitPromise: Promise<void> | null = null;
const listeners = new Set<() => void>();
let persistenceError: string | null = null;

type ProviderRuntimeState = {
  generation: number;
  isSwitching: boolean;
  switchingProviderId: string | null;
  lastError: string | null;
};

let runtime: ProviderRuntimeState = {
  generation: 0,
  isSwitching: false,
  switchingProviderId: null,
  lastError: null,
};

let runtimeLoadPromise: Promise<ProviderState> | null = null;
const runtimeListeners = new Set<() => void>();

function emitRuntimeChange() {
  runtimeListeners.forEach((listener) => listener());
}

function setRuntime(next: ProviderRuntimeState) {
  runtime = next;
  emitRuntimeChange();
}

function describeSwitchFailure(error: unknown, providerId: string) {
  if (error instanceof Error && /secure credentials|missing connection details|incomplete/i.test(error.message)) {
    return 'This provider is missing secure connection details. Pair it again and try again.';
  }

  return `Unable to connect to provider "${providerId}".`;
}

function getLegacyCredentials(value: unknown): ProviderCredentialRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const connection = (value as Record<string, unknown>).connection;
  if (!connection || typeof connection !== 'object' || Array.isArray(connection)) {
    return null;
  }

  const record = connection as Record<string, unknown>;
  if (
    record.type !== 'xtream' ||
    typeof record.baseUrl !== 'string' ||
    typeof record.username !== 'string' ||
    typeof record.password !== 'string'
  ) {
    return null;
  }

  const baseUrl = record.baseUrl.trim().replace(/\/+$/, '');
  const username = record.username.trim();
  const password = record.password.trim();
  if (!baseUrl || !username || !password) {
    return null;
  }

  return { type: 'xtream', baseUrl, username, password };
}

async function migrateStoredProviderState(parsed: unknown) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return createEmptyProviderState();
  }

  const rawProviders = Array.isArray((parsed as Record<string, unknown>).providers)
    ? ((parsed as Record<string, unknown>).providers as unknown[])
    : [];

  for (const rawProvider of rawProviders) {
    if (!rawProvider || typeof rawProvider !== 'object' || Array.isArray(rawProvider)) {
      continue;
    }

    const providerId = (rawProvider as Record<string, unknown>).id;
    const credentials = getLegacyCredentials(rawProvider);
    if (typeof providerId === 'string' && credentials) {
      await setProviderCredentials(providerId, credentials);
    }
  }

  const normalized = normalizeProviderState(parsed);
  const serialized = serializeProviderState(normalized);
  const previousSerialized = JSON.stringify(parsed);
  if (serialized !== previousSerialized) {
    await getProviderStateStorage().setItem(STORAGE_KEY, serialized);
  }

  return normalized;
}

function validatedProviderMetadata(provider: ProviderRecord, accountMetadata: ProviderAccountMetadata | null) {
  if (provider.connection?.type !== 'xtream') {
    return provider;
  }

  return {
    ...provider,
    account: accountMetadata ?? undefined,
    expirationAt: accountMetadata?.expiresAt ?? null,
    status: deriveProviderStatus(accountMetadata),
    updatedAt: Date.now(),
  } satisfies ProviderRecord;
}

async function resolveProviderCredentials(provider: ProviderRecord) {
  if (provider.connection?.type !== 'xtream') {
    return undefined;
  }

  const credentials = await getProviderCredentials(provider.connection.credentialKey ?? provider.id);
  if (!credentials) {
    throw new Error(`Provider "${provider.name}" is missing secure credentials.`);
  }

  return credentials;
}

async function prepareProviderBundle(provider: ProviderRecord, credentialsOverride?: ProviderCredentialRecord) {
  const credentials = credentialsOverride ?? (await resolveProviderCredentials(provider));
  const bundle = createRepositoryBundle(provider, credentials);
  try {
    await bundle.ready;
  } catch (error) {
    bundle.invalidate();
    throw error;
  }
  const nextProvider = validatedProviderMetadata(provider, bundle.accountMetadata);
  return { bundle, provider: nextProvider };
}

function closeActivePlayback() {
  if (getUnifiedPlayerState().item) {
    closeUnifiedPlayback();
  }
}

async function initializeSavedProviderOnStartup(provider: NonNullable<ReturnType<typeof getSelectedProvider>>) {
  return withStartupInitRetries(async () => {
    const prepared = await prepareProviderBundle(provider);
    activateRepositoryBundle(prepared.bundle);
    if (prepared.provider !== provider) {
      const current = await readState();
      await writeState({
        ...current,
        providers: current.providers.map((item) => (item.id === prepared.provider.id ? prepared.provider : item)),
      });
    }
    setRuntime({ ...runtime, generation: getRepositoryBundleGeneration() });
    return prepared.bundle;
  });
}

async function ensureSavedProviderInitialized(state: ProviderState) {
  const selected = getSelectedProvider(state);
  if (!selected || selected.id === getActiveRepositoryBundle()?.providerId) {
    return;
  }

  if (startupInitPromise) {
    await startupInitPromise;
    return;
  }

  startupInitPromise = (async () => {
    try {
      // Cold launch can beat emulator DNS/network readiness by several seconds.
      await new Promise((resolve) => setTimeout(resolve, 2000));
      await initializeSavedProviderOnStartup(selected);
      clearProviderSwitchError();
    } catch (error) {
      setRuntime({
        ...runtime,
        lastError: describeSwitchFailure(error, selected.id),
      });
    } finally {
      startupInitPromise = null;
    }
  })();

  await startupInitPromise;
}

function normalizeDevBaseUrl(baseUrl: string) {
  return baseUrl.trim().replace(/\/+$/, '');
}

async function devXtreamMatchesSavedProvider(payload: PairingConnectionPayload, provider: ProviderRecord | null) {
  if (!provider || !isXtreamProvider(provider) || !provider.connection) {
    return false;
  }

  const credentials = await getProviderCredentials(provider.connection.credentialKey ?? provider.id);
  if (!credentials) {
    return false;
  }

  return (
    normalizeDevBaseUrl(credentials.baseUrl) === normalizeDevBaseUrl(payload.baseUrl) &&
    credentials.username.trim() === payload.username.trim() &&
    credentials.password.trim() === payload.password.trim()
  );
}

/** Connect EXPO_PUBLIC_NOVACAST_XTREAM_* from the build env when no matching Xtream is saved. */
async function bootstrapProviderFromEnv(state: ProviderState): Promise<ProviderState> {
  const payload = getDevPairingPayload();
  if (!payload) {
    return state;
  }

  const selected = getSelectedProvider(state);
  if (await devXtreamMatchesSavedProvider(payload, selected)) {
    return state;
  }

  const connected = await connectXtreamProvider(payload);
  markPairingCompleted();
  return connected;
}

async function loadStorageState() {
  if (cache) {
    return cache;
  }

  if (loadPromise) {
    return loadPromise;
  }

  loadPromise = getProviderStateStorage().getItem(STORAGE_KEY).then(async (value) => {
    let parsed: Partial<ProviderState> | null = null;

    if (value) {
      try {
        parsed = JSON.parse(value) as Partial<ProviderState>;
      } catch {
        parsed = null;
      }
    }

    try {
      persistenceError = null;
      cache = await migrateStoredProviderState(parsed);
    } catch {
      persistenceError = 'Unable to migrate saved provider credentials securely.';
      cache = normalizeProviderState(parsed);
      setRuntime({ ...runtime, lastError: persistenceError });
    }
    return cache;
  });

  return loadPromise;
}

async function readState() {
  return loadStorageState();
}

async function writeState(next: ProviderState) {
  const sanitized = normalizeProviderState(next);
  cache = sanitized;
  await getProviderStateStorage().setItem(STORAGE_KEY, serializeProviderState(sanitized));
  listeners.forEach((listener) => listener());
}

export async function getProviderState() {
  return readState();
}

export async function selectProvider(providerId: string) {
  return switchActiveProvider(providerId);
}

function normalizeXtreamInput(input: { name: string; baseUrl: string; username: string; password: string }) {
  const baseUrl = input.baseUrl.trim().replace(/\/+$/, '');
  const username = input.username.trim();
  const password = input.password.trim();
  const serverId = getProviderServerId(baseUrl);

  if (!baseUrl || !username || !password || !serverId) {
    throw new Error('Provider connection details are incomplete.');
  }

  return {
    name: input.name.trim() || 'My Provider',
    serverId,
    credentials: { type: 'xtream', baseUrl, username, password } satisfies ProviderCredentialRecord,
  };
}

async function findMatchingProvider(providers: ProviderRecord[], credentials: ProviderCredentialRecord) {
  const serverId = getProviderServerId(credentials.baseUrl);
  if (!serverId) {
    return null;
  }

  for (const provider of providers) {
    if (!isXtreamProvider(provider)) {
      continue;
    }

    const saved = await getProviderCredentials(provider.connection?.credentialKey ?? provider.id);
    if (
      saved &&
      getProviderServerId(saved.baseUrl) === serverId &&
      saved.username.trim() === credentials.username.trim()
    ) {
      return { provider, credentials: saved };
    }
  }

  return null;
}

export async function switchActiveProvider(providerId: string) {
  const current = await readState();
  const selectedProvider = current.providers.find((provider) => provider.id === providerId);

  if (!selectedProvider) {
    throw new Error(`Provider "${providerId}" was not found.`);
  }

  if (!isProviderConnectionReady(selectedProvider)) {
    throw new Error(`Provider "${selectedProvider.name}" is missing connection details.`);
  }

  if (runtime.isSwitching) {
    if (runtime.switchingProviderId === providerId) {
      return runtimeLoadPromise ?? Promise.resolve(current);
    }

    throw new Error('Another provider switch is already in progress.');
  }

  const previousRuntime = runtime;
  setRuntime({
    ...runtime,
    isSwitching: true,
    switchingProviderId: providerId,
    lastError: null,
  });

  runtimeLoadPromise = (async () => {
    let candidateBundle: ProviderRepositoryBundle | null = null;
    let stateCommitted = false;

    try {
      const prepared = await prepareProviderBundle(selectedProvider);
      candidateBundle = prepared.bundle;
      const currentWithValidation = {
        ...current,
        providers: current.providers.map((provider) =>
          provider.id === prepared.provider.id ? prepared.provider : provider,
        ),
      };
      const next = selectProviderState(currentWithValidation, providerId);

      // Keep the old bundle untouched until candidate validation succeeds.
      closeActivePlayback();
      cancelProviderCatalogSync(current.selectedProviderId || undefined);
      await writeState(next);
      stateCommitted = true;
      activateRepositoryBundle(candidateBundle);
      setRuntime({
        generation: getRepositoryBundleGeneration(),
        isSwitching: false,
        switchingProviderId: null,
        lastError: null,
      });
      return next;
    } catch (error) {
      candidateBundle?.invalidate();
      if (stateCommitted) {
        await writeState(current).catch(() => undefined);
      }
      setRuntime({
        generation: previousRuntime.generation,
        isSwitching: false,
        switchingProviderId: null,
        lastError: describeSwitchFailure(error, providerId),
      });
      throw new Error(describeSwitchFailure(error, providerId));
    } finally {
      runtimeLoadPromise = null;
    }
  })();

  return runtimeLoadPromise;
}

export async function connectXtreamProvider(input: {
  name: string;
  baseUrl: string;
  username: string;
  password: string;
}, options: { activate?: boolean } = {}) {
  if (runtime.isSwitching) {
    throw new Error('Another provider operation is already in progress.');
  }

  const normalized = normalizeXtreamInput(input);
  const activate = options.activate ?? true;
  const previousRuntime = runtime;
  const transactionId = `xtream-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const stagedCredentialId = `pending-${transactionId}`;
  setRuntime({
    ...runtime,
    isSwitching: true,
    switchingProviderId: transactionId,
    lastError: null,
  });

  runtimeLoadPromise = (async () => {
    let current: ProviderState = createEmptyProviderState();
    let matching: Awaited<ReturnType<typeof findMatchingProvider>> = null;
    let providerId = transactionId;
    let previousCredentials: ProviderCredentialRecord | null = null;
    let candidateBundle: ProviderRepositoryBundle | null = null;
    let stateCommitted = false;
    let credentialsCommitted = false;
    let credentialCommitAttempted = false;
    let stagedCredentials = false;

    try {
      current = await readState();
      matching = await findMatchingProvider(current.providers, normalized.credentials);
      providerId = matching?.provider.id ?? transactionId;
      previousCredentials = matching?.credentials ?? null;
      const now = Date.now();
      const draft: ProviderRecord = {
        ...(matching?.provider ?? {}),
        id: providerId,
        name: normalized.name,
        status: 'unknown',
        expirationAt: null,
        selected: activate ? true : Boolean(matching?.provider.selected),
        connection: {
          type: 'xtream',
          serverId: normalized.serverId,
          credentialKey: providerId,
        },
        createdAt: matching?.provider.createdAt ?? now,
        updatedAt: now,
      };
      // Validate the candidate directly; the prior provider credential remains untouched until commit.
      await setProviderCredentials(stagedCredentialId, normalized.credentials);
      stagedCredentials = true;
      const prepared = await prepareProviderBundle(draft, normalized.credentials);
      candidateBundle = prepared.bundle;
      const mergedProviders = matching
        ? current.providers.map((provider) => (provider.id === providerId ? prepared.provider : provider))
        : [...current.providers, prepared.provider];
      const mergedState: ProviderState = {
        ...current,
        providers: mergedProviders,
        selectedProviderId: activate ? providerId : current.selectedProviderId,
      };
      const next = activate ? selectProviderState(mergedState, providerId) : mergedState;

      if (activate) {
        closeActivePlayback();
        cancelProviderCatalogSync(current.selectedProviderId || undefined);
      }
      await writeState(next);
      stateCommitted = true;
      credentialCommitAttempted = true;
      await setProviderCredentials(providerId, normalized.credentials);
      credentialsCommitted = true;
      await removeProviderCredentials(stagedCredentialId);
      stagedCredentials = false;

      if (activate) {
        activateRepositoryBundle(candidateBundle);
      } else {
        candidateBundle.invalidate();
      }

      setRuntime({
        generation: activate ? getRepositoryBundleGeneration() : previousRuntime.generation,
        isSwitching: false,
        switchingProviderId: null,
        lastError: null,
      });
      return next;
    } catch (error) {
      candidateBundle?.invalidate();
      if (stateCommitted) {
        await writeState(current).catch(() => undefined);
      }
      if (stagedCredentials) {
        await removeProviderCredentials(stagedCredentialId).catch(() => undefined);
      }
      if (credentialCommitAttempted || credentialsCommitted) {
        if (previousCredentials) {
          await setProviderCredentials(providerId, previousCredentials).catch(() => undefined);
        } else {
          await removeProviderCredentials(providerId).catch(() => undefined);
        }
      }
      const message = describeSwitchFailure(error, providerId);
      setRuntime({
        generation: previousRuntime.generation,
        isSwitching: false,
        switchingProviderId: null,
        lastError: message,
      });
      throw new Error(message);
    } finally {
      runtimeLoadPromise = null;
    }
  })();

  return runtimeLoadPromise;
}

export async function retryProviderInitialization() {
  const current = await readState();
  const selected = getSelectedProvider(current);

  if (!selected || !isProviderConnectionReady(selected)) {
    throw new Error('No saved provider is available to initialize.');
  }

  const previousRuntime = runtime;
  setRuntime({
    ...runtime,
    isSwitching: true,
    switchingProviderId: selected.id,
    lastError: null,
  });

  let candidateBundle: ProviderRepositoryBundle | null = null;
  let stateCommitted = false;
  try {
    const prepared = await prepareProviderBundle(selected);
    candidateBundle = prepared.bundle;
    const nextState: ProviderState = {
      ...current,
      providers: current.providers.map((provider) =>
        provider.id === selected.id
          ? prepared.provider
          : provider,
      ),
    };

    closeActivePlayback();
    cancelProviderCatalogSync(current.selectedProviderId || undefined);
    await writeState(nextState);
    stateCommitted = true;
    activateRepositoryBundle(candidateBundle);
    setRuntime({
      generation: getRepositoryBundleGeneration(),
      isSwitching: false,
      switchingProviderId: null,
      lastError: null,
    });
    return nextState;
  } catch (error) {
    candidateBundle?.invalidate();
    if (stateCommitted) {
      await writeState(current).catch(() => undefined);
    }
    const message = describeSwitchFailure(error, selected.id);
    setRuntime({
      generation: previousRuntime.generation,
      isSwitching: false,
      switchingProviderId: null,
      lastError: message,
    });
    throw new Error(message);
  }
}

export async function clearProvidersForPairing() {
  const current = await readState();
  loadPromise = null;
  startupInitPromise = null;
  invalidateRepositoryBundle();
  setRuntime({
    generation: runtime.generation + 1,
    isSwitching: false,
    switchingProviderId: null,
    lastError: null,
  });
  const result = await writeState(createEmptyProviderState());
  await Promise.all(current.providers.map((provider) => removeProviderCredentials(provider.id).catch(() => undefined)));
  return result;
}

export async function resetProviderState() {
  const current = await readState();
  loadPromise = null;
  startupInitPromise = null;
  invalidateRepositoryBundle();
  setRuntime({
    generation: 0,
    isSwitching: false,
    switchingProviderId: null,
    lastError: null,
  });
  const result = await writeState(createDefaultProviderState());
  await Promise.all(current.providers.map((provider) => removeProviderCredentials(provider.id).catch(() => undefined)));
  return result;
}

export function clearProviderCacheForTests() {
  cache = null;
  loadPromise = null;
  startupInitPromise = null;
  runtimeLoadPromise = null;
  persistenceError = null;
  invalidateRepositoryBundle();
  runtime = {
    generation: 0,
    isSwitching: false,
    switchingProviderId: null,
    lastError: null,
  };
}

export function subscribeProviderState(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function subscribeProviderRuntime(listener: () => void) {
  runtimeListeners.add(listener);
  return () => runtimeListeners.delete(listener);
}

export function getProviderRuntime() {
  return runtime;
}

export function clearProviderSwitchError() {
  if (!runtime.lastError) {
    return;
  }

  setRuntime({
    ...runtime,
    lastError: null,
  });
}

export function useProviderStore() {
  const [state, setState] = useState<ProviderState>(cache ?? createEmptyProviderState());
  const [ready, setReady] = useState(false);
  const [runtimeState, setRuntimeState] = useState<ProviderRuntimeState>(runtime);
  const [bundleGeneration, setBundleGeneration] = useState(() => getRepositoryBundleGeneration());

  useEffect(() => {
    let active = true;

    void loadStorageState().then(async (loaded) => {
      if (!active) {
        return;
      }

      let next = loaded;
      try {
        next = await bootstrapProviderFromEnv(loaded);
      } catch {
        // Keep the loaded provider list intact; the transaction records a sanitized runtime error.
        next = loaded;
      }

      if (!active) {
        return;
      }

      setState(next);

      await ensureSavedProviderInitialized(next);

      if (!active) {
        return;
      }

      setRuntimeState({ ...getProviderRuntime(), lastError: persistenceError ?? getProviderRuntime().lastError });
      setBundleGeneration(getRepositoryBundleGeneration());
      setReady(true);
    });

    const unsubscribe = subscribeProviderState(() => {
      if (!active) {
        return;
      }

      setState(cache ?? createEmptyProviderState());
    });

    const unsubscribeRuntime = subscribeProviderRuntime(() => {
      if (!active) {
        return;
      }

      setRuntimeState(runtime);
    });

    const unsubscribeBundle = subscribeRepositoryBundle(() => {
      if (!active) {
        return;
      }

      setBundleGeneration(getRepositoryBundleGeneration());
    });

    return () => {
      active = false;
      unsubscribe();
      unsubscribeRuntime();
      unsubscribeBundle();
    };
  }, []);

  const selectedProvider = getSelectedProvider(state);
  const expirationLabel = formatProviderExpirationLabel(
    selectedProvider,
    getActiveRepositoryBundle()?.accountMetadata ?? selectedProvider?.account ?? null,
  );

  return useMemo(
    () => {
      const activeBundle = getActiveRepositoryBundle();

      return {
        state,
        ready,
        providers: state.providers,
        selectedProvider,
        selectedProviderLabel: selectedProvider?.name ?? 'No provider',
        selectedProviderExpiration: expirationLabel,
        hasSavedProvider: hasSavedProvider(state),
        isRealProviderActive: isXtreamProvider(selectedProvider) && Boolean(activeBundle),
        providerGeneration: runtimeState.generation,
        bundleGeneration,
        isSwitchingProvider: runtimeState.isSwitching,
        switchingProviderId: runtimeState.switchingProviderId,
        providerSwitchError: runtimeState.lastError,
        providerInitialized: Boolean(activeBundle) && !runtimeState.lastError,
      };
    },
    [bundleGeneration, expirationLabel, ready, runtimeState, selectedProvider, state],
  );
}
