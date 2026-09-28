import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

export const NOVA_PULSE_PROVIDER_HEALTH_ENABLED = process.env.EXPO_PUBLIC_NOVAPULSE_PROVIDER_HEALTH_ENABLED === 'true';
export const NOVA_PULSE_PROVIDER_HEALTH_STORAGE_KEY = '@novacast/novapulse-provider-health-v1';
export const PROVIDER_HEALTH_VERSION = 1 as const;
export const PROVIDER_HEALTH_MAX_PROVIDERS = 16;
export const PROVIDER_HEALTH_MAX_OBSERVATIONS = 16;
export const PROVIDER_HEALTH_OBSERVATION_WINDOW_MS = 10 * 60_000;
export const PROVIDER_HEALTH_STATE_RETENTION_MS = 7 * 24 * 60 * 60_000;
export const PROVIDER_HEALTH_ACTIVE_ALERT_MAX_MS = 60 * 60_000;
export const PROVIDER_HEALTH_RECOVERED_MAX_MS = 10 * 60_000;
export const PROVIDER_HEALTH_NOTIFICATION_COOLDOWN_MS = 5 * 60_000;

export type NovaPulseProviderHealthStatus =
  | 'unknown'
  | 'checking'
  | 'healthy'
  | 'degraded'
  | 'authentication_required'
  | 'subscription_expired'
  | 'unavailable'
  | 'recovered'
  | 'device_offline';

export type ProviderHealthObservation = {
  operationId: string;
  generation: number;
  kind: 'failure' | 'success';
  at: number;
  explicit?: 'authentication_required' | 'subscription_expired';
};

export type ProviderHealthEntry = {
  version: typeof PROVIDER_HEALTH_VERSION;
  generation: number;
  status: NovaPulseProviderHealthStatus;
  changedAt: number;
  notificationAt: number | null;
  expiresAt: number | null;
  observations: ProviderHealthObservation[];
};

export type ProviderHealthSnapshot = ProviderHealthEntry & {
  providerId: string;
  enabled: boolean;
};

type PersistedHealth = {
  version: typeof PROVIDER_HEALTH_VERSION;
  providers: Record<string, ProviderHealthEntry>;
};

type HealthStorage = Pick<typeof AsyncStorage, 'getItem' | 'setItem'>;

const memory = new Map<string, ProviderHealthEntry>();
const activeGenerations = new Map<string, number>();
const listeners = new Set<() => void>();
let storageOverride: HealthStorage | null = null;
let hydratePromise: Promise<void> | null = null;
let writePromise: Promise<void> = Promise.resolve();
let loaded = false;
let lastDiagnostic: { loaded: number; pruned: number; writes: number; failures: number } = { loaded: 0, pruned: 0, writes: 0, failures: 0 };

function storage() {
  return storageOverride ?? AsyncStorage;
}

export function setProviderHealthStorageForTests(value: HealthStorage | null) {
  storageOverride = value;
  resetProviderHealthForTests();
}

export function resetProviderHealthForTests() {
  memory.clear();
  activeGenerations.clear();
  hydratePromise = null;
  writePromise = Promise.resolve();
  loaded = false;
  lastDiagnostic = { loaded: 0, pruned: 0, writes: 0, failures: 0 };
}

export async function clearProviderHealth(providerId: string) {
  if (!NOVA_PULSE_PROVIDER_HEALTH_ENABLED || !providerId) return;
  memory.delete(providerId);
  activeGenerations.delete(providerId);
  await queueWrite(Date.now());
  notify();
}

function finiteTimestamp(value: unknown, nowMs = Date.now()) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= nowMs + 24 * 60 * 60_000 ? value : null;
}

function validStatus(value: unknown): value is NovaPulseProviderHealthStatus {
  return value === 'unknown' || value === 'checking' || value === 'healthy' || value === 'degraded' ||
    value === 'authentication_required' || value === 'subscription_expired' || value === 'unavailable' ||
    value === 'recovered' || value === 'device_offline';
}

function normalizeObservation(value: unknown, nowMs: number): ProviderHealthObservation | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const operationId = typeof input.operationId === 'string' ? input.operationId.trim() : '';
  const generation = input.generation;
  const at = finiteTimestamp(input.at, nowMs);
  const kind = input.kind;
  const explicit = input.explicit;
  if (!operationId || operationId.length > 160 || !Number.isInteger(generation) || !at || (kind !== 'failure' && kind !== 'success')) return null;
  if (explicit !== undefined && explicit !== 'authentication_required' && explicit !== 'subscription_expired') return null;
  return { operationId, generation: generation as number, at, kind, ...(explicit ? { explicit } : {}) };
}

function normalizeEntry(value: unknown, nowMs: number): ProviderHealthEntry | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (input.version !== PROVIDER_HEALTH_VERSION || !Number.isInteger(input.generation)) return null;
  const changedAt = finiteTimestamp(input.changedAt, nowMs);
  if (!changedAt || !validStatus(input.status)) return null;
  const observations = Array.isArray(input.observations)
    ? input.observations.map((item) => normalizeObservation(item, nowMs)).filter((item): item is ProviderHealthObservation => Boolean(item)).slice(-PROVIDER_HEALTH_MAX_OBSERVATIONS)
    : [];
  const notificationAt = input.notificationAt === null ? null : finiteTimestamp(input.notificationAt, nowMs);
  const expiresAt = input.expiresAt === null ? null : finiteTimestamp(input.expiresAt, nowMs);
  if (changedAt < nowMs - PROVIDER_HEALTH_STATE_RETENTION_MS) return null;
  return {
    version: PROVIDER_HEALTH_VERSION,
    generation: input.generation as number,
    status: input.status,
    changedAt,
    notificationAt,
    expiresAt,
    observations,
  };
}

function sanitizeEntry(entry: ProviderHealthEntry, nowMs: number): ProviderHealthEntry {
  const observations = entry.observations
    .filter((item) => item.at >= nowMs - PROVIDER_HEALTH_OBSERVATION_WINDOW_MS)
    .slice(-PROVIDER_HEALTH_MAX_OBSERVATIONS);
  return { ...entry, observations };
}

function notify() {
  listeners.forEach((listener) => listener());
}

export function subscribeProviderHealth(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setProviderHealthGeneration(providerId: string, generation: number) {
  if (!providerId || !Number.isInteger(generation) || generation < 1) return;
  activeGenerations.set(providerId, generation);
}

export async function hydrateProviderHealth(nowMs = Date.now()): Promise<void> {
  if (!NOVA_PULSE_PROVIDER_HEALTH_ENABLED || loaded) return;
  if (hydratePromise) return hydratePromise;
  hydratePromise = (async () => {
    try {
      const raw = await storage().getItem(NOVA_PULSE_PROVIDER_HEALTH_STORAGE_KEY);
      if (!raw) { loaded = true; return; }
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) { loaded = true; return; }
      const input = parsed as Record<string, unknown>;
      if (input.version !== PROVIDER_HEALTH_VERSION || !input.providers || typeof input.providers !== 'object' || Array.isArray(input.providers)) { loaded = true; return; }
      const entries = Object.entries(input.providers as Record<string, unknown>).slice(-PROVIDER_HEALTH_MAX_PROVIDERS);
      for (const [providerId, value] of entries) {
        if (!providerId || providerId.length > 160) continue;
        const entry = normalizeEntry(value, nowMs);
        if (entry) memory.set(providerId, sanitizeEntry(entry, nowMs));
      }
      lastDiagnostic.loaded = memory.size;
      loaded = true;
    } catch {
      loaded = true;
      lastDiagnostic.failures += 1;
    } finally {
      hydratePromise = null;
      notify();
    }
  })();
  return hydratePromise;
}

function queueWrite(nowMs: number) {
  const payload: PersistedHealth = {
    version: PROVIDER_HEALTH_VERSION,
    providers: Object.fromEntries([...memory.entries()].slice(-PROVIDER_HEALTH_MAX_PROVIDERS).map(([id, entry]) => [id, sanitizeEntry(entry, nowMs)])),
  };
  writePromise = writePromise.then(async () => {
    try {
      await storage().setItem(NOVA_PULSE_PROVIDER_HEALTH_STORAGE_KEY, JSON.stringify(payload));
      lastDiagnostic.writes += 1;
    } catch {
      lastDiagnostic.failures += 1;
    }
  });
  return writePromise;
}

function baseEntry(generation: number, nowMs: number): ProviderHealthEntry {
  return { version: PROVIDER_HEALTH_VERSION, generation, status: 'unknown', changedAt: nowMs, notificationAt: null, expiresAt: null, observations: [] };
}

function deriveStatus(entry: ProviderHealthEntry, nowMs: number): NovaPulseProviderHealthStatus {
  const observations = entry.observations.filter((item) => item.generation === entry.generation && item.at >= nowMs - PROVIDER_HEALTH_OBSERVATION_WINDOW_MS);
  const latestExplicit = [...observations].reverse().find((item) => item.explicit);
  const failures = observations.filter((item) => item.kind === 'failure').length;
  const successes = observations.filter((item) => item.kind === 'success').length;
  const latestSuccessAt = [...observations].reverse().find((item) => item.kind === 'success')?.at ?? 0;
  if (successes >= 2 && (entry.status === 'degraded' || entry.status === 'unavailable' || entry.status === 'authentication_required' || entry.status === 'subscription_expired') && latestSuccessAt > (latestExplicit?.at ?? 0)) return 'recovered';
  if (latestExplicit) return latestExplicit.explicit!;
  if (failures >= 5) return 'unavailable';
  if (failures >= 3) return 'degraded';
  if (successes > 0) return 'healthy';
  return entry.status === 'checking' ? 'checking' : 'unknown';
}

function effectiveExpiry(status: NovaPulseProviderHealthStatus, nowMs: number) {
  if (status === 'recovered') return nowMs + PROVIDER_HEALTH_RECOVERED_MAX_MS;
  if (status === 'degraded' || status === 'unavailable' || status === 'authentication_required' || status === 'subscription_expired') return nowMs + PROVIDER_HEALTH_ACTIVE_ALERT_MAX_MS;
  return null;
}

export async function recordProviderHealthSignal(input: {
  providerId: string;
  generation: number;
  operationId: string;
  kind: 'failure' | 'success';
  nowMs?: number;
  explicit?: 'authentication_required' | 'subscription_expired';
  cancelled?: boolean;
  offline?: boolean;
}) {
  if (!NOVA_PULSE_PROVIDER_HEALTH_ENABLED || input.cancelled || input.offline || !input.providerId || !Number.isInteger(input.generation) || !input.operationId.trim()) return false;
  const nowMs = input.nowMs ?? Date.now();
  const activeGeneration = activeGenerations.get(input.providerId);
  if (activeGeneration != null && activeGeneration !== input.generation) return false;
  await hydrateProviderHealth(nowMs);
  const current = sanitizeEntry(memory.get(input.providerId) ?? baseEntry(input.generation, nowMs), nowMs);
  if (current.generation !== input.generation) return false;
  if (current.observations.some((item) => item.operationId === input.operationId.trim())) return false;
  const observation: ProviderHealthObservation = {
    operationId: input.operationId.trim().slice(0, 160), generation: input.generation, kind: input.kind, at: nowMs,
    ...(input.kind === 'failure' && input.explicit ? { explicit: input.explicit } : {}),
  };
  const observations = [...current.observations, observation].slice(-PROVIDER_HEALTH_MAX_OBSERVATIONS);
  const nextBase = { ...current, observations, changedAt: nowMs };
  const status = deriveStatus(nextBase, nowMs);
  const changed = status !== current.status;
  const notificationAt = changed && (!current.notificationAt || nowMs - current.notificationAt >= PROVIDER_HEALTH_NOTIFICATION_COOLDOWN_MS) ? nowMs : current.notificationAt;
  const next = { ...nextBase, status, notificationAt, expiresAt: effectiveExpiry(status, nowMs) };
  memory.set(input.providerId, next);
  await queueWrite(nowMs);
  notify();
  return true;
}

export function getProviderHealthSnapshot(providerId: string, generation?: number, nowMs = Date.now()): ProviderHealthSnapshot {
  if (!NOVA_PULSE_PROVIDER_HEALTH_ENABLED) return { ...baseEntry(generation ?? 0, nowMs), providerId, enabled: false };
  const stored = memory.get(providerId);
  if (!stored || (generation != null && stored.generation !== generation)) return { ...baseEntry(generation ?? stored?.generation ?? 0, nowMs), providerId, enabled: true };
  const entry = sanitizeEntry(stored, nowMs);
  if (entry.expiresAt != null && entry.expiresAt <= nowMs && entry.status !== 'healthy') return { ...baseEntry(entry.generation, nowMs), providerId, enabled: true };
  return { ...entry, providerId, enabled: true };
}

export function getProviderHealthDiagnostics() {
  return { ...lastDiagnostic, providers: memory.size };
}

export function useNovaPulseProviderHealth(providerId: string, generation: number) {
  const [snapshot, setSnapshot] = useState(() => getProviderHealthSnapshot(providerId, generation));
  useEffect(() => {
    if (!NOVA_PULSE_PROVIDER_HEALTH_ENABLED) return;
    setProviderHealthGeneration(providerId, generation);
    let active = true;
    const refresh = () => { if (active) setSnapshot(getProviderHealthSnapshot(providerId, generation)); };
    const unsubscribe = subscribeProviderHealth(refresh);
    void hydrateProviderHealth().then(refresh);
    return () => { active = false; unsubscribe(); };
  }, [generation, providerId]);
  return snapshot;
}
