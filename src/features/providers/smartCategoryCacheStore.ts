import AsyncStorage from '@react-native-async-storage/async-storage';

import type { MediaType } from './categoryCountIndexStore.ts';
import type { CatalogCompletenessMetadata } from './catalogCompleteness.ts';

export const SMART_CATEGORY_CACHE_VERSION = 3;

export type SmartCategoryCacheEntry = {
  categoryKey: string;
  title: string;
  count: number;
  itemIds: string[];
};

export type SmartCategoryCache = {
  providerId: string;
  mediaType: MediaType;
  version: number;
  generatedAt: number;
  entries: Record<string, SmartCategoryCacheEntry>;
  catalogCompleteness?: CatalogCompletenessMetadata;
};

const STORAGE_PREFIX = '@novacast/smart-category-cache/';
const cache = new Map<string, SmartCategoryCache>();
const listeners = new Set<() => void>();

function cacheKey(providerId: string, mediaType: MediaType) {
  return `${providerId}:${mediaType}`;
}

function storageKey(providerId: string, mediaType: MediaType) {
  return `${STORAGE_PREFIX}${providerId}/${mediaType}`;
}

function notify() {
  listeners.forEach((listener) => listener());
}

function emptyCache(providerId: string, mediaType: MediaType): SmartCategoryCache {
  return {
    providerId,
    mediaType,
    version: SMART_CATEGORY_CACHE_VERSION,
    generatedAt: 0,
    entries: {},
  };
}

export async function readSmartCategoryCache(providerId: string, mediaType: MediaType) {
  const key = cacheKey(providerId, mediaType);
  const cached = cache.get(key);
  if (cached) {
    return cached;
  }

  try {
    const raw = await AsyncStorage.getItem(storageKey(providerId, mediaType));
    if (!raw) {
      const next = emptyCache(providerId, mediaType);
      cache.set(key, next);
      return next;
    }

    const parsed = JSON.parse(raw) as SmartCategoryCache;
    if (parsed.version !== SMART_CATEGORY_CACHE_VERSION) {
      const next = emptyCache(providerId, mediaType);
      cache.set(key, next);
      return next;
    }

    cache.set(key, parsed);
    return parsed;
  } catch {
    const next = emptyCache(providerId, mediaType);
    cache.set(key, next);
    return next;
  }
}

export function getSmartCategoryCacheSync(providerId: string, mediaType: MediaType) {
  return cache.get(cacheKey(providerId, mediaType)) ?? emptyCache(providerId, mediaType);
}

export async function writeSmartCategoryCache(next: SmartCategoryCache) {
  const key = cacheKey(next.providerId, next.mediaType);
  cache.set(key, next);
  if (typeof AsyncStorage.setItem === 'function') {
    await AsyncStorage.setItem(storageKey(next.providerId, next.mediaType), JSON.stringify(next));
  }
  notify();
}

export function getSmartCategoryCountSync(providerId: string, mediaType: MediaType, categoryKey: string) {
  const entries = getSmartCategoryCacheSync(providerId, mediaType).entries;
  if (entries[categoryKey]) {
    return entries[categoryKey].count;
  }
  if (categoryKey === 'features' && entries.discover) {
    return entries.discover.count;
  }
  return 0;
}

export function getSmartCategoryEntrySync(providerId: string, mediaType: MediaType, categoryKey: string) {
  const entries = getSmartCategoryCacheSync(providerId, mediaType).entries;
  if (entries[categoryKey]) {
    return entries[categoryKey];
  }
  if (categoryKey === 'features' && entries.discover) {
    return entries.discover;
  }
  return undefined;
}

export function subscribeSmartCategoryCache(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function clearSmartCategoryCacheForTests(providerId?: string) {
  if (!providerId) {
    cache.clear();
    return;
  }

  for (const key of cache.keys()) {
    if (key.startsWith(`${providerId}:`)) {
      cache.delete(key);
    }
  }
}
