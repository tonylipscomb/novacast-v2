/**
 * Stage 4.2P #3/#6 — bounded offline/local-library bootstrap eligibility.
 *
 * Pure-ish decision function (its only side effects are read-only lookups)
 * deciding whether `StartupGate` may activate the provider bundle with
 * `validateAccount: false` instead of requiring a live Xtream handshake.
 * Every fail-closed condition from the spec is a distinct, explicit
 * `reason` below — when in doubt this returns `eligible: false`, which
 * always falls through to the existing (unchanged) online bootstrap path.
 */

import { resolveReadableCatalogGeneration } from '../catalog/catalogRepository.ts';
import {
  computeProviderCredentialIdentity,
  getProviderAuthTrustMarker,
  isProviderAuthTrustMarkerFresh,
} from './providerAuthTrustStore.ts';
import { getProviderServerId, isProviderConnectionReady } from './providerModel.ts';
import type { ProviderCredentialRecord, ProviderRecord } from './providerModel.ts';

export type LocalLibraryBootstrapIneligibleReason =
  | 'not-xtream-provider'
  | 'missing-credentials'
  | 'invalid-provider-state'
  | 'no-trust-marker'
  | 'trust-marker-expired'
  | 'provider-mismatch'
  | 'identity-mismatch'
  | 'no-readable-local-generation';

export type LocalLibraryBootstrapEligibility =
  | {
      eligible: true;
      readableGeneration: { movie: number; series: number };
    }
  | {
      eligible: false;
      reason: LocalLibraryBootstrapIneligibleReason;
    };

/**
 * All conditions below must hold; any single failure fails closed to the
 * existing online bootstrap. Never treats readable SQLite alone as
 * authentication — credentials + identity + a fresh trust marker are all
 * required in addition to a readable local generation.
 */
export async function resolveLocalLibraryBootstrapEligibility(
  provider: ProviderRecord,
  credentials: ProviderCredentialRecord | null | undefined,
): Promise<LocalLibraryBootstrapEligibility> {
  if (provider.connection?.type !== 'xtream') {
    return { eligible: false, reason: 'not-xtream-provider' };
  }
  if (!credentials) {
    return { eligible: false, reason: 'missing-credentials' };
  }
  if (!isProviderConnectionReady(provider)) {
    return { eligible: false, reason: 'invalid-provider-state' };
  }

  // No explicit "logout/revocation" flag exists in this codebase — instead,
  // clearProvidersForPairing()/resetProviderState() (the only two "explicit
  // logout" call sites) delete the trust marker outright, so its absence
  // here already covers that fail-closed condition and first-time-ever
  // onboarding (never validated) as the same case.
  const marker = await getProviderAuthTrustMarker(provider.id);
  if (!marker) {
    return { eligible: false, reason: 'no-trust-marker' };
  }
  if (!isProviderAuthTrustMarkerFresh(marker)) {
    return { eligible: false, reason: 'trust-marker-expired' };
  }
  if (marker.providerId !== provider.id) {
    return { eligible: false, reason: 'provider-mismatch' };
  }

  const expectedEndpointIdentity = getProviderServerId(credentials.baseUrl) ?? '';
  const expectedCredentialIdentity = computeProviderCredentialIdentity(credentials);
  if (
    marker.providerEndpointIdentity !== expectedEndpointIdentity ||
    marker.credentialIdentity !== expectedCredentialIdentity
  ) {
    return { eligible: false, reason: 'identity-mismatch' };
  }

  const [movieGeneration, seriesGeneration] = await Promise.all([
    resolveReadableCatalogGeneration(provider.id, 'movie').catch(() => 0),
    resolveReadableCatalogGeneration(provider.id, 'series').catch(() => 0),
  ]);
  if (movieGeneration <= 0 && seriesGeneration <= 0) {
    return { eligible: false, reason: 'no-readable-local-generation' };
  }

  return {
    eligible: true,
    readableGeneration: { movie: movieGeneration, series: seriesGeneration },
  };
}
