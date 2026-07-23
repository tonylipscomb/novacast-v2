import { useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

export const LIBRARY_SUMMARY_SCHEMA_VERSION = 1;

export type ProviderLibrarySummary = {
  providerId: string;
  movieCount: number;
  seriesCount: number;
  liveChannelCount: number;
  movieCategoryCount: number;
  seriesCategoryCount: number;
  lastProviderSyncAt: number;
  lastSmartCategoryBuildAt?: number;
  schemaVersion: number;
};

const STORAGE_PREFIX = '@novacast/library-summary/';

const cache = new Map<string, ProviderLibrarySummary>();
const listeners = new Set<() => void>();

function storageKey(providerId: string) {
  return `${STORAGE_PREFIX}${providerId}`;
}

function emptySummary(providerId: string): ProviderLibrarySummary {
  return {
    providerId,
    movieCount: 0,
    seriesCount: 0,
    liveChannelCount: 0,
    movieCategoryCount: 0,
    seriesCategoryCount: 0,
    lastProviderSyncAt: 0,
    schemaVersion: LIBRARY_SUMMARY_SCHEMA_VERSION,
  };
}

function normalizeSummary(providerId: string, value: Partial<ProviderLibrarySummary> | null | undefined) {
  if (!value || typeof value !== 'object') {
    return emptySummary(providerId);
  }

  return {
    providerId,
    movieCount: Math.max(0, Number(value.movieCount) || 0),
    seriesCount: Math.max(0, Number(value.seriesCount) || 0),
    liveChannelCount: Math.max(0, Number(value.liveChannelCount) || 0),
    movieCategoryCount: Math.max(0, Number(value.movieCategoryCount) || 0),
    seriesCategoryCount: Math.max(0, Number(value.seriesCategoryCount) || 0),
    lastProviderSyncAt: Math.max(0, Number(value.lastProviderSyncAt) || 0),
    lastSmartCategoryBuildAt:
      typeof value.lastSmartCategoryBuildAt === 'number' ? value.lastSmartCategoryBuildAt : undefined,
    schemaVersion: LIBRARY_SUMMARY_SCHEMA_VERSION,
  };
}

function notify() {
  listeners.forEach((listener) => listener());
}

export async function readProviderLibrarySummary(providerId: string) {
  const cached = cache.get(providerId);
  if (cached) {
    return cached;
  }

  try {
    const raw = await AsyncStorage.getItem(storageKey(providerId));
    if (!raw) {
      const next = emptySummary(providerId);
      cache.set(providerId, next);
      return next;
    }

    const parsed = JSON.parse(raw) as Partial<ProviderLibrarySummary>;
    const next = normalizeSummary(providerId, parsed);
    cache.set(providerId, next);
    return next;
  } catch {
    const next = emptySummary(providerId);
    cache.set(providerId, next);
    return next;
  }
}

export function getProviderLibrarySummarySync(providerId: string) {
  return cache.get(providerId) ?? emptySummary(providerId);
}

export async function writeProviderLibrarySummary(
  providerId: string,
  patch: Partial<Omit<ProviderLibrarySummary, 'providerId' | 'schemaVersion'>>,
) {
  const current = await readProviderLibrarySummary(providerId);
  const next = normalizeSummary(providerId, { ...current, ...patch, providerId });
  cache.set(providerId, next);
  if (typeof AsyncStorage.setItem === 'function') {
    await AsyncStorage.setItem(storageKey(providerId), JSON.stringify(next));
  }
  notify();
  return next;
}

export function subscribeProviderLibrarySummary(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function clearProviderLibrarySummaryCacheForTests(providerId?: string) {
  if (providerId) {
    cache.delete(providerId);
    return;
  }
  cache.clear();
}

export function useProviderLibrarySummary(providerId: string) {
  const [summary, setSummary] = useState(() => getProviderLibrarySummarySync(providerId));
  const [ready, setReady] = useState(cache.has(providerId));

  useEffect(() => {
    let active = true;

    void readProviderLibrarySummary(providerId).then((next) => {
      if (!active) {
        return;
      }
      setSummary(next);
      setReady(true);
    });

    const unsubscribe = subscribeProviderLibrarySummary(() => {
      if (!active) {
        return;
      }
      setSummary(getProviderLibrarySummarySync(providerId));
      setReady(true);
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [providerId]);

  return useMemo(() => ({ summary, ready }), [ready, summary]);
}

export function formatLibraryCount(count: number) {
  if (count <= 0) {
    return null;
  }
  return `${count.toLocaleString()} titles`;
}
