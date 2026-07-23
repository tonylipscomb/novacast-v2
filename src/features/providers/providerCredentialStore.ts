import type { ProviderCredentialRecord } from './providerModel.ts';

export type CredentialStore = {
  get(providerId: string): Promise<ProviderCredentialRecord | null>;
  set(providerId: string, credentials: ProviderCredentialRecord): Promise<void>;
  remove(providerId: string): Promise<void>;
};

export type SecureValueStore = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  deleteItem(key: string): Promise<void>;
};

const PROVIDER_CREDENTIAL_PREFIX = 'novacast.provider.credentials.';
const PENDING_PAIRING_KEY = 'novacast.pending.pairing';

let secureValueStoreOverride: SecureValueStore | null = null;
let credentialStoreOverride: CredentialStore | null = null;

function keyPart(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_');
}

export function providerCredentialKey(providerId: string) {
  return `${PROVIDER_CREDENTIAL_PREFIX}${keyPart(providerId)}`;
}

export function pendingPairingKey() {
  return PENDING_PAIRING_KEY;
}

async function getSecureValueStore(): Promise<SecureValueStore> {
  if (secureValueStoreOverride) {
    return secureValueStoreOverride;
  }

  const SecureStore = await import('expo-secure-store');
  return {
    getItem: (key) => SecureStore.getItemAsync(key),
    setItem: (key, value) => SecureStore.setItemAsync(key, value),
    deleteItem: (key) => SecureStore.deleteItemAsync(key),
  };
}

function normalizeCredentials(value: unknown): ProviderCredentialRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
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

const nativeCredentialStore: CredentialStore = {
  async get(providerId) {
    const store = await getSecureValueStore();
    const value = await store.getItem(providerCredentialKey(providerId));
    if (!value) {
      return null;
    }

    try {
      return normalizeCredentials(JSON.parse(value));
    } catch {
      return null;
    }
  },
  async set(providerId, credentials) {
    const normalized = normalizeCredentials(credentials);
    if (!normalized) {
      throw new Error('Provider credentials are incomplete.');
    }

    const store = await getSecureValueStore();
    await store.setItem(providerCredentialKey(providerId), JSON.stringify(normalized));
  },
  async remove(providerId) {
    const store = await getSecureValueStore();
    await store.deleteItem(providerCredentialKey(providerId));
  },
};

function getCredentialStore() {
  return credentialStoreOverride ?? nativeCredentialStore;
}

export function getProviderCredentials(providerId: string) {
  return getCredentialStore().get(providerId);
}

export function setProviderCredentials(providerId: string, credentials: ProviderCredentialRecord) {
  return getCredentialStore().set(providerId, credentials);
}

export function removeProviderCredentials(providerId: string) {
  return getCredentialStore().remove(providerId);
}

export async function getSecureValue(key: string) {
  return (await getSecureValueStore()).getItem(key);
}

export async function setSecureValue(key: string, value: string) {
  await (await getSecureValueStore()).setItem(key, value);
}

export async function removeSecureValue(key: string) {
  await (await getSecureValueStore()).deleteItem(key);
}

export function createMemoryCredentialStore(initial: Record<string, ProviderCredentialRecord> = {}): CredentialStore {
  const values = new Map(Object.entries(initial));
  return {
    async get(providerId) {
      return values.get(providerId) ?? null;
    },
    async set(providerId, credentials) {
      values.set(providerId, { ...credentials });
    },
    async remove(providerId) {
      values.delete(providerId);
    },
  };
}

export function setCredentialStoreForTests(store: CredentialStore | null) {
  credentialStoreOverride = store;
}

export function setSecureValueStoreForTests(store: SecureValueStore | null) {
  secureValueStoreOverride = store;
}
