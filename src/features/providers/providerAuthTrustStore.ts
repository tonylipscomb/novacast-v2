/**
 * Stage 4.2P #4 — provider auth trust marker.
 *
 * A lightweight, non-secret "was this provider successfully validated
 * recently enough to trust for one offline cold boot" record. This is
 * deliberately NOT a credential store: no password (or any secret) is ever
 * written here, only identity fields that are already safe to keep in plain
 * AsyncStorage (mirrors `seriesStartupSnapshotStore.ts`'s durable-snapshot
 * storage pattern for non-secret operational data).
 *
 * Freshness period: 14 days. Rationale — long enough that a user who travels
 * or leaves the device powered off for a week or two is not forced back onto
 * the (potentially unreachable) online handshake before they can browse
 * their already-downloaded local library, but short enough that a lapsed
 * Xtream subscription or revoked account cannot be relied upon indefinitely
 * via a single stale successful validation. This sits inside the product
 * owner's suggested 7-30 day range; 14 days was chosen as the midpoint
 * balancing offline resilience against staleness risk.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import type { ProviderCredentialRecord } from './providerModel.ts';
import { getProviderServerId } from './providerModel.ts';

export const PROVIDER_AUTH_TRUST_SCHEMA_VERSION = 1;
export const PROVIDER_AUTH_TRUST_FRESHNESS_MS = 14 * 24 * 60 * 60 * 1000;
const PROVIDER_AUTH_TRUST_KEY_PREFIX = '@novacast/provider-auth-trust/v1/';

export type ProviderAuthTrustMarker = {
  schemaVersion: number;
  providerId: string;
  /** Normalized Xtream server host identity — never the raw credentials. */
  providerEndpointIdentity: string;
  /** Non-secret identity descriptor (endpoint + username) — never a password or password hash. */
  credentialIdentity: string;
  lastSuccessfulAccountValidationAt: number;
};

const memoryByProvider = new Map<string, ProviderAuthTrustMarker>();

function storageKey(providerId: string): string {
  return `${PROVIDER_AUTH_TRUST_KEY_PREFIX}${providerId}`;
}

/**
 * Non-secret identity descriptor used to detect "the same account
 * reconnected" vs. "different credentials now stored under this provider
 * id". Deliberately reuses existing non-secret fields (normalized server id
 * + username) rather than inventing new credential hashing.
 */
export function computeProviderCredentialIdentity(credentials: ProviderCredentialRecord): string {
  const endpoint = getProviderServerId(credentials.baseUrl) ?? '';
  return `${endpoint}::${credentials.username.trim().toLowerCase()}`;
}

function isStructurallyValid(value: unknown): value is ProviderAuthTrustMarker {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    record.schemaVersion === PROVIDER_AUTH_TRUST_SCHEMA_VERSION &&
    typeof record.providerId === 'string' &&
    Boolean(record.providerId) &&
    typeof record.providerEndpointIdentity === 'string' &&
    typeof record.credentialIdentity === 'string' &&
    typeof record.lastSuccessfulAccountValidationAt === 'number' &&
    record.lastSuccessfulAccountValidationAt > 0
  );
}

export function isProviderAuthTrustMarkerFresh(
  marker: ProviderAuthTrustMarker | null,
  now: number = Date.now(),
): boolean {
  if (!marker) {
    return false;
  }
  const age = now - marker.lastSuccessfulAccountValidationAt;
  return age >= 0 && age <= PROVIDER_AUTH_TRUST_FRESHNESS_MS;
}

export async function getProviderAuthTrustMarker(providerId: string): Promise<ProviderAuthTrustMarker | null> {
  const memory = memoryByProvider.get(providerId);
  if (memory) {
    return memory;
  }
  if (typeof AsyncStorage?.getItem !== 'function') {
    return null;
  }
  try {
    const raw = await AsyncStorage.getItem(storageKey(providerId));
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw);
    if (!isStructurallyValid(parsed) || parsed.providerId !== providerId) {
      return null;
    }
    memoryByProvider.set(providerId, parsed);
    return parsed;
  } catch {
    return null;
  }
}

export async function saveProviderAuthTrustMarker(input: {
  providerId: string;
  providerEndpointIdentity: string;
  credentialIdentity: string;
  lastSuccessfulAccountValidationAt?: number;
}): Promise<ProviderAuthTrustMarker> {
  const marker: ProviderAuthTrustMarker = {
    schemaVersion: PROVIDER_AUTH_TRUST_SCHEMA_VERSION,
    providerId: input.providerId,
    providerEndpointIdentity: input.providerEndpointIdentity,
    credentialIdentity: input.credentialIdentity,
    lastSuccessfulAccountValidationAt: input.lastSuccessfulAccountValidationAt ?? Date.now(),
  };
  memoryByProvider.set(input.providerId, marker);
  if (typeof AsyncStorage?.setItem === 'function') {
    try {
      await AsyncStorage.setItem(storageKey(input.providerId), JSON.stringify(marker));
    } catch {
      // Best-effort durable write — memory cache still accelerates this session;
      // a future cold boot simply falls back to the existing online path.
    }
  }
  console.info(
    '[NovaCast Provider Auth Trust] ' +
      JSON.stringify({
        event: 'trust_marker_saved',
        providerId: marker.providerId,
        lastSuccessfulAccountValidationAt: marker.lastSuccessfulAccountValidationAt,
      }),
  );
  return marker;
}

export async function clearProviderAuthTrustMarker(providerId: string): Promise<void> {
  memoryByProvider.delete(providerId);
  if (typeof AsyncStorage?.removeItem === 'function') {
    try {
      await AsyncStorage.removeItem(storageKey(providerId));
    } catch {
      // ignore
    }
  }
}

export async function clearAllProviderAuthTrustMarkers(providerIds: string[]): Promise<void> {
  await Promise.all(providerIds.map((providerId) => clearProviderAuthTrustMarker(providerId)));
}

export function clearProviderAuthTrustStoreForTests(): void {
  memoryByProvider.clear();
}
