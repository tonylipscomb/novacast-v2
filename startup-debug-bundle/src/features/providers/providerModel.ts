export type ProviderStatus = 'active' | 'expired' | 'offline' | 'unknown';

export type ProviderConnectionType = 'mock' | 'xtream';

/** Public provider metadata. Secrets are stored by providerCredentialStore. */
export type ProviderConnectionRecord = {
  type: ProviderConnectionType;
  serverId?: string;
  credentialKey?: string;
};

export type ProviderCredentialRecord = {
  type: ProviderConnectionType;
  baseUrl: string;
  username: string;
  password: string;
};

export type ProviderAccountMetadata = {
  status?: string;
  expiresAt?: number | null;
  createdAt?: number | null;
  updatedAt?: number | null;
  preferredOutputFormat?: string | null;
};

export type ProviderRecord = {
  id: string;
  name: string;
  status: ProviderStatus;
  expirationAt?: number | null;
  selected: boolean;
  connection?: ProviderConnectionRecord;
  account?: ProviderAccountMetadata;
  createdAt?: number;
  updatedAt?: number;
};

export type ProviderState = {
  version: 1;
  providers: ProviderRecord[];
  selectedProviderId: string;
};

export const PROVIDER_STATE_VERSION = 1 as const;

let demoModeOverride: boolean | null = null;

function isRuntimeDevelopmentBuild() {
  return typeof __DEV__ !== 'undefined' && __DEV__;
}

export function isDemoModeEnabled() {
  if (demoModeOverride !== null) {
    return demoModeOverride;
  }

  return isRuntimeDevelopmentBuild() && process.env.EXPO_PUBLIC_NOVACAST_DEMO_MODE === 'true';
}

/** Test-only override; production code can only enable demo mode through an explicit dev env flag. */
export function setDemoModeForTests(enabled: boolean | null) {
  demoModeOverride = enabled;
}

const DEFAULT_DEMO_PROVIDERS: ProviderRecord[] = [
  {
    id: 'demo-provider',
    name: 'Demo Provider',
    status: 'active',
    expirationAt: Date.UTC(2026, 6, 30),
    selected: true,
    connection: { type: 'mock', serverId: 'demo-provider', credentialKey: 'demo-provider' },
  },
  {
    id: 'family-tv',
    name: 'Family TV',
    status: 'active',
    expirationAt: Date.UTC(2026, 7, 15),
    selected: false,
    connection: { type: 'mock', serverId: 'family-tv', credentialKey: 'family-tv' },
  },
  {
    id: 'backup-iptv',
    name: 'Backup IPTV',
    status: 'expired',
    expirationAt: Date.UTC(2026, 4, 10),
    selected: false,
    connection: { type: 'mock', serverId: 'backup-iptv', credentialKey: 'backup-iptv' },
  },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function toFiniteTimestamp(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value;
  }

  return null;
}

function toEpochMilliseconds(value: unknown) {
  const timestamp = toFiniteTimestamp(value);
  if (timestamp === null) {
    return null;
  }

  return timestamp < 100000000000 ? timestamp * 1000 : timestamp;
}

function normalizeStatus(value: unknown): ProviderStatus {
  if (value === 'active' || value === 'expired' || value === 'offline' || value === 'unknown') {
    return value;
  }

  return 'unknown';
}

function normalizeServerIdentifier(baseUrl: string) {
  const value = baseUrl.trim().replace(/\/+$/, '');
  if (!value) {
    return null;
  }

  try {
    const parsed = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    return `${parsed.protocol.toLowerCase()}//${parsed.host.toLowerCase()}${parsed.pathname.replace(/\/+$/, '')}`;
  } catch {
    return null;
  }
}

export function getProviderServerId(baseUrl: string) {
  return normalizeServerIdentifier(baseUrl);
}

function normalizeConnection(value: unknown, providerId: string): ProviderConnectionRecord | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const type = value.type === 'xtream' || value.type === 'mock' ? value.type : null;
  if (!type || (type === 'mock' && !isDemoModeEnabled())) {
    return undefined;
  }

  const legacyBaseUrl = typeof value.baseUrl === 'string' ? value.baseUrl : '';
  const serverId = typeof value.serverId === 'string' ? value.serverId : normalizeServerIdentifier(legacyBaseUrl);
  if (type === 'xtream' && !serverId) {
    return undefined;
  }

  return {
    type,
    serverId: serverId ?? providerId,
    credentialKey: typeof value.credentialKey === 'string' ? value.credentialKey : providerId,
  };
}

function normalizeAccount(value: unknown): ProviderAccountMetadata | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  return {
    status: typeof value.status === 'string' ? value.status : undefined,
    expiresAt: toEpochMilliseconds(value.expiresAt),
    createdAt: toEpochMilliseconds(value.createdAt),
    updatedAt: toEpochMilliseconds(value.updatedAt),
    preferredOutputFormat: typeof value.preferredOutputFormat === 'string' ? value.preferredOutputFormat : undefined,
  };
}

export function createEmptyProviderState(): ProviderState {
  return {
    version: PROVIDER_STATE_VERSION,
    selectedProviderId: '',
    providers: [],
  };
}

export function createDefaultProviderState(): ProviderState {
  if (!isDemoModeEnabled()) {
    return createEmptyProviderState();
  }

  const now = Date.now();
  return {
    version: PROVIDER_STATE_VERSION,
    selectedProviderId: 'demo-provider',
    providers: DEFAULT_DEMO_PROVIDERS.map((provider) => ({
      ...provider,
      account: undefined,
      createdAt: now,
      updatedAt: now,
    })),
  };
}

export function normalizeProviderState(next: unknown): ProviderState {
  if (!isRecord(next) || next.version !== PROVIDER_STATE_VERSION || !Array.isArray(next.providers)) {
    return createEmptyProviderState();
  }

  const providers = next.providers
    .filter(isRecord)
    .filter((provider) => typeof provider.id === 'string' && typeof provider.name === 'string')
    .map((provider) => {
      const id = provider.id as string;
      const connection = normalizeConnection(provider.connection, id);
      const account = normalizeAccount(provider.account);
      const expirationAt = toEpochMilliseconds(provider.expirationAt) ?? account?.expiresAt ?? null;

      return {
        id,
        name: (provider.name as string).trim() || 'Unnamed Provider',
        status: normalizeStatus(provider.status),
        expirationAt,
        selected: false,
        ...(connection ? { connection } : {}),
        ...(account ? { account } : {}),
        createdAt: toEpochMilliseconds(provider.createdAt) ?? Date.now(),
        updatedAt: toEpochMilliseconds(provider.updatedAt) ?? Date.now(),
      } satisfies ProviderRecord;
    });

  if (!providers.length) {
    return createEmptyProviderState();
  }

  const selectedProviderId =
    typeof next.selectedProviderId === 'string' &&
    providers.some((provider) => provider.id === next.selectedProviderId && isProviderConnectionReady(provider))
      ? next.selectedProviderId
      : providers.find(isProviderConnectionReady)?.id ?? '';

  return {
    version: PROVIDER_STATE_VERSION,
    providers: providers.map((provider) => ({
      ...provider,
      selected: provider.id === selectedProviderId,
    })),
    selectedProviderId,
  };
}

export function serializeProviderState(state: ProviderState) {
  return JSON.stringify(normalizeProviderState(state));
}

export function selectProviderState(state: ProviderState, providerId: string): ProviderState {
  if (!state.providers.some((provider) => provider.id === providerId && isProviderConnectionReady(provider))) {
    return state;
  }

  return {
    ...state,
    selectedProviderId: providerId,
    providers: state.providers.map((provider) => ({
      ...provider,
      selected: provider.id === providerId,
    })),
  };
}

export function getSelectedProvider(state: ProviderState) {
  return state.providers.find((provider) => provider.id === state.selectedProviderId) ?? state.providers[0] ?? null;
}

export function isProviderConnectionReady(provider: ProviderRecord | null | undefined) {
  const connection = provider?.connection;
  if (!connection) {
    return false;
  }

  if (connection.type === 'mock') {
    return isDemoModeEnabled() && Boolean(connection.serverId);
  }

  return Boolean(connection.serverId && connection.credentialKey);
}

export function hasSavedProvider(state: ProviderState) {
  return state.providers.some((provider) => isProviderConnectionReady(provider));
}

export function isXtreamProvider(provider: ProviderRecord | null | undefined) {
  return provider?.connection?.type === 'xtream';
}

export function deriveProviderStatus(account: ProviderAccountMetadata | null | undefined): ProviderStatus {
  const expiresAt = account?.expiresAt;
  if (typeof expiresAt === 'number' && Number.isFinite(expiresAt) && expiresAt > 0 && expiresAt <= Date.now()) {
    return 'expired';
  }

  const normalizedStatus = account?.status?.trim().toLowerCase();
  if (normalizedStatus === 'active' || normalizedStatus === 'authorized' || normalizedStatus === 'enabled') {
    return 'active';
  }

  if (normalizedStatus === 'expired' || normalizedStatus === 'disabled' || normalizedStatus === 'banned' || normalizedStatus === 'offline') {
    return normalizedStatus === 'expired' ? 'expired' : 'offline';
  }

  return 'unknown';
}
