import AsyncStorage from '@react-native-async-storage/async-storage';

import { isTrustworthySeriesCategoryName } from './seriesCategoryNameResolution.ts';

const STORAGE_KEY = '@novacast/series-category-names';

type CacheStore = Record<string, Record<string, string>>;

let cache: CacheStore | null = null;
let loadPromise: Promise<CacheStore> | null = null;

async function readCache(): Promise<CacheStore> {
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
        const parsed = JSON.parse(raw) as CacheStore;
        cache = parsed && typeof parsed === 'object' ? parsed : {};
      } catch {
        cache = {};
      }
      return cache;
    });
  }
  return loadPromise;
}

async function writeCache(next: CacheStore): Promise<void> {
  cache = next;
  if (typeof AsyncStorage.setItem === 'function') {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }
}

export async function getCachedSeriesCategoryNames(providerId: string): Promise<Map<string, string>> {
  const store = await readCache();
  const names = new Map<string, string>();
  const entry = store[providerId] ?? {};
  for (const [categoryId, name] of Object.entries(entry)) {
    if (isTrustworthySeriesCategoryName(name, categoryId)) {
      names.set(categoryId, name.trim());
    }
  }
  return names;
}

export async function rememberSeriesCategoryNames(
  providerId: string,
  names: Iterable<{ categoryId: string; name: string }>,
): Promise<void> {
  const store = await readCache();
  const nextForProvider = { ...(store[providerId] ?? {}) };
  let changed = false;
  for (const entry of names) {
    const categoryId = String(entry.categoryId ?? '').trim();
    const name = String(entry.name ?? '').trim();
    if (!isTrustworthySeriesCategoryName(name, categoryId)) {
      continue;
    }
    if (nextForProvider[categoryId] === name) {
      continue;
    }
    nextForProvider[categoryId] = name;
    changed = true;
  }
  if (!changed) {
    return;
  }
  await writeCache({ ...store, [providerId]: nextForProvider });
}

export function clearSeriesCategoryNameCacheForTests(): void {
  cache = null;
  loadPromise = null;
}
