import AsyncStorage from '@react-native-async-storage/async-storage';

import { normalizeSearchQuery } from './searchQuery.ts';
import { SEARCH_HISTORY_MAX_ENTRIES } from './searchConstants.ts';
import type { SearchHistoryEntry } from './searchTypes.ts';

const STORAGE_KEY = '@novacast/search-history';

let memoryHistory: SearchHistoryEntry[] = [];
let loaded = false;

async function ensureLoaded() {
  if (loaded) {
    return;
  }

  loaded = true;
  if (typeof AsyncStorage.getItem !== 'function') {
    return;
  }

  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return;
    }

    const parsed = JSON.parse(raw) as SearchHistoryEntry[];
    if (!Array.isArray(parsed)) {
      return;
    }

    memoryHistory = parsed
      .filter((entry) => typeof entry?.query === 'string' && typeof entry?.timestamp === 'number')
      .slice(0, SEARCH_HISTORY_MAX_ENTRIES);
  } catch {
    memoryHistory = [];
  }
}

async function persist() {
  if (typeof AsyncStorage.setItem !== 'function') {
    return;
  }

  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(memoryHistory));
  } catch {
    // Ignore persistence failures.
  }
}

export async function readSearchHistory(): Promise<SearchHistoryEntry[]> {
  await ensureLoaded();
  return [...memoryHistory];
}

export function readSearchHistorySync(): SearchHistoryEntry[] {
  return [...memoryHistory];
}

export async function addSearchHistoryEntry(query: string) {
  const normalized = normalizeSearchQuery(query);
  if (!normalized) {
    return readSearchHistory();
  }

  await ensureLoaded();
  memoryHistory = [
    { query: normalized, timestamp: Date.now() },
    ...memoryHistory.filter((entry) => entry.query !== normalized),
  ].slice(0, SEARCH_HISTORY_MAX_ENTRIES);

  await persist();
  return readSearchHistory();
}

export async function clearSearchHistory() {
  memoryHistory = [];
  loaded = true;
  await persist();
}

export function resetSearchHistoryForTests() {
  memoryHistory = [];
  loaded = false;
}
