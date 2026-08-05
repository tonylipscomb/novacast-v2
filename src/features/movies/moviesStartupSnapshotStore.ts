/**
 * Stage 4.2L — durable Movies startup snapshot (provider-scoped AsyncStorage).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  createMoviesStartupDurableSnapshot,
  moviesStartupSnapshotStorageKey,
  parseMoviesStartupDurableSnapshot,
  type MoviesStartupDurableSnapshot,
} from './moviesStartupFastPath.ts';
import type { MovieCategory } from './movieTypes.ts';

const memoryByProvider = new Map<string, MoviesStartupDurableSnapshot>();

export function getMemoryMoviesStartupSnapshot(
  providerId: string,
): MoviesStartupDurableSnapshot | null {
  return memoryByProvider.get(providerId) ?? null;
}

export function setMemoryMoviesStartupSnapshot(snapshot: MoviesStartupDurableSnapshot): void {
  memoryByProvider.set(snapshot.providerId, snapshot);
}

export function clearMoviesStartupSnapshotsForTests(): void {
  memoryByProvider.clear();
}

export async function loadMoviesStartupDurableSnapshot(
  providerId: string,
): Promise<MoviesStartupDurableSnapshot | null> {
  const memory = memoryByProvider.get(providerId);
  if (memory) {
    return memory;
  }
  if (typeof AsyncStorage?.getItem !== 'function') {
    return null;
  }
  try {
    const raw = await AsyncStorage.getItem(moviesStartupSnapshotStorageKey(providerId));
    const parsed = parseMoviesStartupDurableSnapshot(raw);
    if (parsed && parsed.providerId === providerId) {
      memoryByProvider.set(providerId, parsed);
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

export async function saveMoviesStartupDurableSnapshot(input: {
  providerId: string;
  generation: number;
  categories: MovieCategory[];
  totalMovieCount: number;
  selectedCategoryId?: string | null;
  savedMovieId?: string | null;
  savedOffset?: number | null;
  itemRows?: number;
  categoryRows?: number;
  distinctItemCategoryIds?: number;
}): Promise<MoviesStartupDurableSnapshot> {
  const snapshot = createMoviesStartupDurableSnapshot(input);
  memoryByProvider.set(input.providerId, snapshot);
  if (typeof AsyncStorage?.setItem === 'function') {
    try {
      await AsyncStorage.setItem(
        moviesStartupSnapshotStorageKey(input.providerId),
        JSON.stringify(snapshot),
      );
    } catch {
      // Best-effort durable write — memory cache still accelerates the session.
    }
  }
  return snapshot;
}

export async function clearMoviesStartupDurableSnapshot(providerId: string): Promise<void> {
  memoryByProvider.delete(providerId);
  if (typeof AsyncStorage?.removeItem === 'function') {
    try {
      await AsyncStorage.removeItem(moviesStartupSnapshotStorageKey(providerId));
    } catch {
      // ignore
    }
  }
}
