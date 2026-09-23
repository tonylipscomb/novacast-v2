import AsyncStorage from '@react-native-async-storage/async-storage';

import type { NovaPulseItem } from './novaPulseTypes';

export const NOVA_PULSE_HISTORY_SCHEMA_VERSION = 1;
export const NOVA_PULSE_HISTORY_MAX_ENTRIES = 96;
export const NOVA_PULSE_HISTORY_RETENTION_MS = 7 * 24 * 60 * 60_000;
const NOVA_PULSE_HISTORY_KEY = '@novacast/novapulse-history-v1';

export type NovaPulseHistoryMediaType = 'movie' | 'series';
export type NovaPulseHistoryEntry = {
  mediaType: NovaPulseHistoryMediaType;
  contentId: string;
  lastSelectedAt: number;
};

type StoredProviderHistory = { providerFingerprint: string; entries: NovaPulseHistoryEntry[] };
type StoredHistory = { schemaVersion: number; providers: Record<string, StoredProviderHistory> };
type StorageLike = { getItem(key: string): Promise<string | null>; setItem(key: string, value: string): Promise<void> };

let storageOverride: StorageLike | null = null;
const cache = new Map<string, NovaPulseHistoryEntry[]>();
const loadPromises = new Map<string, Promise<NovaPulseHistoryLoad>>();

export type NovaPulseHistoryLoad = {
  entries: NovaPulseHistoryEntry[];
  loadedCount: number;
  expiredRemoved: number;
  storageFailed: boolean;
};

function storage() {
  return storageOverride ?? AsyncStorage;
}

export function setNovaPulseHistoryStorageForTests(value: StorageLike | null) {
  storageOverride = value;
  cache.clear();
  loadPromises.clear();
}

export function providerFingerprint(providerId: string) {
  let hash = 2166136261;
  for (const character of providerId.trim()) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function entryKey(entry: Pick<NovaPulseHistoryEntry, 'mediaType' | 'contentId'>) {
  return `${entry.mediaType}:${entry.contentId}`;
}

function sanitizeEntry(value: unknown): NovaPulseHistoryEntry | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<NovaPulseHistoryEntry>;
  if ((candidate.mediaType !== 'movie' && candidate.mediaType !== 'series') || typeof candidate.contentId !== 'string') return null;
  const contentId = candidate.contentId.trim();
  if (!contentId || contentId.length > 256 || typeof candidate.lastSelectedAt !== 'number' || !Number.isFinite(candidate.lastSelectedAt) || candidate.lastSelectedAt <= 0) return null;
  return { mediaType: candidate.mediaType, contentId, lastSelectedAt: candidate.lastSelectedAt };
}

function pruneEntries(entries: readonly NovaPulseHistoryEntry[], nowMs: number) {
  const seen = new Map<string, NovaPulseHistoryEntry>();
  let expiredRemoved = 0;
  for (const entry of entries) {
    if (nowMs - entry.lastSelectedAt >= NOVA_PULSE_HISTORY_RETENTION_MS) {
      expiredRemoved += 1;
      continue;
    }
    const key = entryKey(entry);
    const prior = seen.get(key);
    if (!prior || entry.lastSelectedAt > prior.lastSelectedAt) seen.set(key, entry);
  }
  return {
    entries: [...seen.values()].sort((left, right) => right.lastSelectedAt - left.lastSelectedAt).slice(0, NOVA_PULSE_HISTORY_MAX_ENTRIES),
    expiredRemoved,
  };
}

function parseStoredHistory(raw: string | null, providerId: string, nowMs: number) {
  if (!raw) return { entries: [], expiredRemoved: 0 };
  try {
    const parsed = JSON.parse(raw) as Partial<StoredHistory>;
    if (parsed.schemaVersion !== NOVA_PULSE_HISTORY_SCHEMA_VERSION || !parsed.providers || typeof parsed.providers !== 'object') return { entries: [], expiredRemoved: 0 };
    const bucket = parsed.providers[providerFingerprint(providerId)];
    const rawEntries = bucket && Array.isArray(bucket.entries) ? bucket.entries : [];
    return pruneEntries(rawEntries.map(sanitizeEntry).filter((entry): entry is NovaPulseHistoryEntry => Boolean(entry)), nowMs);
  } catch {
    return { entries: [], expiredRemoved: 0 };
  }
}

export function getCachedNovaPulseHistory(providerId: string) {
  return cache.get(providerFingerprint(providerId))?.slice() ?? [];
}

export function hasCachedNovaPulseHistory(providerId: string) {
  return cache.has(providerFingerprint(providerId));
}

export function createNovaPulseHistoryWriteGate() {
  let written = false;
  return () => {
    if (written) return false;
    written = true;
    return true;
  };
}

export function novaPulseHistoryPenalty(entry: NovaPulseHistoryEntry, nowMs: number) {
  const age = Math.max(0, nowMs - entry.lastSelectedAt);
  if (age < 24 * 60 * 60_000) return -30;
  if (age < 72 * 60 * 60_000) return -12;
  if (age < NOVA_PULSE_HISTORY_RETENTION_MS) return -3;
  return 0;
}

export async function loadNovaPulseHistory(providerId: string, nowMs = Date.now()): Promise<NovaPulseHistoryLoad> {
  const fingerprint = providerFingerprint(providerId);
  const cached = cache.get(fingerprint);
  if (cached) return { entries: cached.slice(), loadedCount: cached.length, expiredRemoved: 0, storageFailed: false };
  const existing = loadPromises.get(fingerprint);
  if (existing) return existing;
  const promise = (async () => {
    try {
      const parsed = parseStoredHistory(await storage().getItem(NOVA_PULSE_HISTORY_KEY), providerId, nowMs);
      cache.set(fingerprint, parsed.entries);
      return { entries: parsed.entries.slice(), loadedCount: parsed.entries.length, expiredRemoved: parsed.expiredRemoved, storageFailed: false };
    } catch {
      cache.set(fingerprint, []);
      return { entries: [], loadedCount: 0, expiredRemoved: 0, storageFailed: true };
    } finally {
      loadPromises.delete(fingerprint);
    }
  })();
  loadPromises.set(fingerprint, promise);
  return promise;
}

export async function recordNovaPulseSelection(providerId: string, items: readonly NovaPulseItem[], selectedAt = Date.now()) {
  const fingerprint = providerFingerprint(providerId);
  const current = await loadNovaPulseHistory(providerId, selectedAt);
  const additions = items
    .filter((item): item is NovaPulseItem & { type: NovaPulseHistoryMediaType; sourceItemId: string } =>
      (item.type === 'movie' || item.type === 'series') && Boolean(item.sourceItemId?.trim()))
    .map((item) => ({ mediaType: item.type, contentId: item.sourceItemId.trim(), lastSelectedAt: selectedAt }));
  const next = pruneEntries([...current.entries, ...additions], selectedAt).entries;
  cache.set(fingerprint, next);
  try {
    const raw = await storage().getItem(NOVA_PULSE_HISTORY_KEY);
    let parsed: Partial<StoredHistory> = {};
    try { parsed = raw ? JSON.parse(raw) as Partial<StoredHistory> : {}; } catch { parsed = {}; }
    const providers = parsed.providers && typeof parsed.providers === 'object' ? parsed.providers : {};
    providers[fingerprint] = { providerFingerprint: fingerprint, entries: next };
    await storage().setItem(NOVA_PULSE_HISTORY_KEY, JSON.stringify({ schemaVersion: NOVA_PULSE_HISTORY_SCHEMA_VERSION, providers }));
    return { success: true, writtenCount: additions.length };
  } catch {
    return { success: false, writtenCount: additions.length };
  }
}
