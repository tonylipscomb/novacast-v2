import AsyncStorage from '@react-native-async-storage/async-storage';

import type { TmdbSeriesMatch } from './tmdbClient.ts';

const STORAGE_KEY = '@novacast/series-metadata-cache';

export type SeriesMetadataCacheEntry = {
  providerId: string;
  seriesId: string;
  providerTitle: string;
  normalizedTitle: string;
  status: 'matched' | 'failed';
  tmdbId?: number;
  metadata?: TmdbSeriesMatch;
  failureReason?: string;
  updatedAt: number;
};

type CacheStore = Record<string, SeriesMetadataCacheEntry>;

function cacheKey(providerId: string, seriesId: string) {
  return `${providerId}:${seriesId}`;
}

let cache: CacheStore | null = null;
let loadPromise: Promise<CacheStore> | null = null;

function normalizeEntry(value: unknown): SeriesMetadataCacheEntry | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const entry = value as Partial<SeriesMetadataCacheEntry>;
  if (
    typeof entry.providerId !== 'string' ||
    typeof entry.seriesId !== 'string' ||
    typeof entry.providerTitle !== 'string' ||
    typeof entry.normalizedTitle !== 'string' ||
    (entry.status !== 'matched' && entry.status !== 'failed')
  ) {
    return null;
  }

  return {
    providerId: entry.providerId,
    seriesId: entry.seriesId,
    providerTitle: entry.providerTitle,
    normalizedTitle: entry.normalizedTitle,
    status: entry.status,
    tmdbId: typeof entry.tmdbId === 'number' ? entry.tmdbId : undefined,
    metadata: entry.metadata,
    failureReason: typeof entry.failureReason === 'string' ? entry.failureReason : undefined,
    updatedAt: typeof entry.updatedAt === 'number' ? entry.updatedAt : Date.now(),
  };
}

async function readCache() {
  if (cache) {
    return cache;
  }

  if (typeof AsyncStorage.getItem !== 'function') {
    cache = {};
    return cache;
  }

  if (!loadPromise) {
    loadPromise = AsyncStorage.getItem(STORAGE_KEY).then((raw) => {
      if (!raw) {
        cache = {};
        return cache;
      }

      try {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        const next: CacheStore = {};
        for (const [key, value] of Object.entries(parsed)) {
          const entry = normalizeEntry(value);
          if (entry) {
            next[key] = entry;
          }
        }
        cache = next;
      } catch {
        cache = {};
      }
      return cache;
    });
  }

  return loadPromise;
}

async function writeCache(next: CacheStore) {
  cache = next;
  if (typeof AsyncStorage.setItem === 'function') {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }
}

export async function getSeriesMetadataCacheEntry(providerId: string, seriesId: string) {
  const store = await readCache();
  return store[cacheKey(providerId, seriesId)] ?? null;
}

export async function setSeriesMetadataCacheEntry(entry: SeriesMetadataCacheEntry) {
  const store = await readCache();
  const key = cacheKey(entry.providerId, entry.seriesId);
  await writeCache({ ...store, [key]: { ...entry, updatedAt: Date.now() } });
}

export async function markSeriesMetadataFailed(input: {
  providerId: string;
  seriesId: string;
  providerTitle: string;
  normalizedTitle: string;
  failureReason: string;
}) {
  await setSeriesMetadataCacheEntry({
    providerId: input.providerId,
    seriesId: input.seriesId,
    providerTitle: input.providerTitle,
    normalizedTitle: input.normalizedTitle,
    status: 'failed',
    failureReason: input.failureReason,
    updatedAt: Date.now(),
  });
}

export async function markSeriesMetadataMatched(input: {
  providerId: string;
  seriesId: string;
  providerTitle: string;
  normalizedTitle: string;
  tmdbId: number;
  metadata: TmdbSeriesMatch;
}) {
  await setSeriesMetadataCacheEntry({
    providerId: input.providerId,
    seriesId: input.seriesId,
    providerTitle: input.providerTitle,
    normalizedTitle: input.normalizedTitle,
    status: 'matched',
    tmdbId: input.tmdbId,
    metadata: input.metadata,
    updatedAt: Date.now(),
  });
}

export function clearSeriesMetadataCacheForTests() {
  cache = null;
  loadPromise = null;
}
