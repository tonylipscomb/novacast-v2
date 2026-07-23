import AsyncStorage from '@react-native-async-storage/async-storage';

export type MediaType = 'movie' | 'series' | 'live';

export type CategoryCountIndex = {
  providerId: string;
  mediaType: MediaType;
  counts: Record<string, number>;
  updatedAt: number;
};

const STORAGE_PREFIX = '@novacast/category-counts/';
const cache = new Map<string, CategoryCountIndex>();
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

function emptyIndex(providerId: string, mediaType: MediaType): CategoryCountIndex {
  return {
    providerId,
    mediaType,
    counts: {},
    updatedAt: 0,
  };
}

export function buildCategoryCountIndex(
  providerId: string,
  mediaType: MediaType,
  items: { categoryId: string }[],
) {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const categoryId = typeof item.categoryId === 'string' ? item.categoryId.trim() : '';
    if (!categoryId) {
      continue;
    }
    counts[categoryId] = (counts[categoryId] ?? 0) + 1;
  }

  return {
    providerId,
    mediaType,
    counts,
    updatedAt: Date.now(),
  };
}

function normalizeStoredCounts(value: unknown) {
  const counts: Record<string, number> = {};
  let changed = !value || typeof value !== 'object';

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { counts, changed };
  }

  for (const [rawKey, rawValue] of Object.entries(value)) {
    const key = rawKey.trim();
    const numericString = typeof rawValue === 'string' && rawValue.trim() !== '';
    const count = typeof rawValue === 'number' || numericString ? Number(rawValue) : NaN;
    if (!key || !Number.isFinite(count) || count < 0) {
      changed = true;
      continue;
    }

    const normalizedCount = Math.floor(count);
    if (key !== rawKey || normalizedCount !== count) {
      changed = true;
    }
    counts[key] = normalizedCount;
  }

  return { counts, changed };
}

export function sanitizeCategoryCountIndex(
  providerId: string,
  mediaType: MediaType,
  value: Partial<CategoryCountIndex> | null | undefined,
) {
  const normalizedCounts = normalizeStoredCounts(value?.counts);
  const updatedAt = typeof value?.updatedAt === 'number' && Number.isFinite(value.updatedAt) ? value.updatedAt : 0;
  return {
    index: {
      providerId,
      mediaType,
      counts: normalizedCounts.counts,
      updatedAt,
    } satisfies CategoryCountIndex,
    changed: normalizedCounts.changed || updatedAt !== (value?.updatedAt ?? 0),
  };
}

export async function readCategoryCountIndex(providerId: string, mediaType: MediaType) {
  const key = cacheKey(providerId, mediaType);
  const cached = cache.get(key);
  if (cached) {
    return cached;
  }

  try {
    const raw = await AsyncStorage.getItem(storageKey(providerId, mediaType));
    if (!raw) {
      const next = emptyIndex(providerId, mediaType);
      cache.set(key, next);
      return next;
    }

    const parsed = JSON.parse(raw) as Partial<CategoryCountIndex>;
    const sanitized = sanitizeCategoryCountIndex(providerId, mediaType, parsed);
    const next = sanitized.index;
    cache.set(key, next);
    if (sanitized.changed && typeof AsyncStorage.setItem === 'function') {
      await AsyncStorage.setItem(storageKey(providerId, mediaType), JSON.stringify(next)).catch(() => undefined);
    }
    return next;
  } catch {
    const next = emptyIndex(providerId, mediaType);
    cache.set(key, next);
    return next;
  }
}

export function getCategoryCountIndexSync(providerId: string, mediaType: MediaType) {
  return cache.get(cacheKey(providerId, mediaType)) ?? emptyIndex(providerId, mediaType);
}

export async function writeCategoryCountIndex(index: CategoryCountIndex) {
  const key = cacheKey(index.providerId, index.mediaType);
  cache.set(key, index);
  if (typeof AsyncStorage.setItem === 'function') {
    await AsyncStorage.setItem(storageKey(index.providerId, index.mediaType), JSON.stringify(index));
  }
  notify();
}

export async function mergeCategoryCountIndex(
  providerId: string,
  mediaType: MediaType,
  counts: Record<string, number>,
) {
  const current = await readCategoryCountIndex(providerId, mediaType);
  const normalizedCounts: Record<string, number> = {};
  for (const [rawKey, rawValue] of Object.entries(counts)) {
    const key = rawKey.trim();
    if (!key || !Number.isFinite(rawValue) || rawValue < 0) {
      continue;
    }
    normalizedCounts[key] = Math.floor(rawValue);
  }
  const next: CategoryCountIndex = {
    providerId,
    mediaType,
    counts: { ...current.counts, ...normalizedCounts },
    updatedAt: Date.now(),
  };
  await writeCategoryCountIndex(next);
  return next;
}

export function getCategoryCountFromIndex(providerId: string, mediaType: MediaType, categoryId: string) {
  return getCategoryCountIndexSync(providerId, mediaType).counts[categoryId];
}

export function sumCategoryCounts(index: CategoryCountIndex) {
  return Object.values(index.counts).reduce((total, count) => total + count, 0);
}

export function subscribeCategoryCountIndex(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function clearCategoryCountIndexCacheForTests(providerId?: string) {
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
