/**
 * Stage 4.2O — durable Series startup snapshot (provider-scoped AsyncStorage).
 * Mirrors `moviesStartupSnapshotStore.ts` for Series-specific data.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  createSeriesStartupDurableSnapshot,
  seriesStartupSnapshotStorageKey,
  parseSeriesStartupDurableSnapshot,
  type SeriesStartupDurableSnapshot,
} from './seriesStartupFastPath.ts';
import type { MediaCategory } from '../media-browser/mediaTypes.ts';

const memoryByProvider = new Map<string, SeriesStartupDurableSnapshot>();

export function getMemorySeriesStartupSnapshot(
  providerId: string,
): SeriesStartupDurableSnapshot | null {
  return memoryByProvider.get(providerId) ?? null;
}

export function setMemorySeriesStartupSnapshot(snapshot: SeriesStartupDurableSnapshot): void {
  memoryByProvider.set(snapshot.providerId, snapshot);
}

export function clearSeriesStartupSnapshotsForTests(): void {
  memoryByProvider.clear();
}

export async function loadSeriesStartupDurableSnapshot(
  providerId: string,
): Promise<SeriesStartupDurableSnapshot | null> {
  const memory = memoryByProvider.get(providerId);
  if (memory) {
    return memory;
  }
  if (typeof AsyncStorage?.getItem !== 'function') {
    return null;
  }
  try {
    const raw = await AsyncStorage.getItem(seriesStartupSnapshotStorageKey(providerId));
    const parsed = parseSeriesStartupDurableSnapshot(raw);
    if (parsed && parsed.providerId === providerId) {
      memoryByProvider.set(providerId, parsed);
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

export async function saveSeriesStartupDurableSnapshot(input: {
  providerId: string;
  generation: number;
  categories: MediaCategory[];
  selectedCategoryId?: string | null;
  savedSeriesId?: string | null;
  savedOffset?: number | null;
  readableRowCount?: number;
}): Promise<SeriesStartupDurableSnapshot> {
  const snapshot = createSeriesStartupDurableSnapshot(input);
  memoryByProvider.set(input.providerId, snapshot);
  if (typeof AsyncStorage?.setItem === 'function') {
    try {
      await AsyncStorage.setItem(
        seriesStartupSnapshotStorageKey(input.providerId),
        JSON.stringify(snapshot),
      );
    } catch {
      // Best-effort durable write — memory cache still accelerates the session.
    }
  }
  return snapshot;
}

export async function clearSeriesStartupDurableSnapshot(providerId: string): Promise<void> {
  memoryByProvider.delete(providerId);
  if (typeof AsyncStorage?.removeItem === 'function') {
    try {
      await AsyncStorage.removeItem(seriesStartupSnapshotStorageKey(providerId));
    } catch {
      // ignore
    }
  }
}
