import { useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = '@novacast/movie-library';

export type WatchHistoryEntry = {
  movieId: string;
  title: string;
  artworkUrl?: string;
  categoryId?: string;
  watchedAt: number;
  progressPercent?: number;
  durationMs?: number;
};

export type ProviderLibraryState = {
  favorites: string[];
  watchHistory: WatchHistoryEntry[];
  watchlist: string[];
};

type LibraryStore = Record<string, ProviderLibraryState>;

function emptyProviderState(): ProviderLibraryState {
  return { favorites: [], watchHistory: [], watchlist: [] };
}

let cache: LibraryStore | null = null;
let loadPromise: Promise<LibraryStore> | null = null;
const listeners = new Set<() => void>();

function normalizeProviderState(value: Partial<ProviderLibraryState> | undefined): ProviderLibraryState {
  return {
    favorites: Array.isArray(value?.favorites) ? value.favorites.filter((id) => typeof id === 'string') : [],
    watchHistory: Array.isArray(value?.watchHistory)
      ? value.watchHistory.filter((entry) => typeof entry?.movieId === 'string' && typeof entry?.title === 'string')
          .map((entry) => ({
            ...entry,
            artworkUrl: typeof entry.artworkUrl === 'string' ? entry.artworkUrl : undefined,
            categoryId: typeof entry.categoryId === 'string' ? entry.categoryId : undefined,
          }))
      : [],
    watchlist: Array.isArray(value?.watchlist) ? value.watchlist.filter((id) => typeof id === 'string') : [],
  };
}

function normalizeStore(value: Partial<LibraryStore> | null): LibraryStore {
  if (!value || typeof value !== 'object') {
    return {};
  }

  const next: LibraryStore = {};
  for (const [providerId, state] of Object.entries(value)) {
    next[providerId] = normalizeProviderState(state);
  }
  return next;
}

async function readStore() {
  if (cache) {
    return cache;
  }

  if (typeof AsyncStorage.getItem !== 'function') {
    cache = {};
    return cache;
  }

  if (!loadPromise) {
    loadPromise = AsyncStorage.getItem(STORAGE_KEY).then((value) => {
      let parsed: Partial<LibraryStore> | null = null;
      if (value) {
        try {
          parsed = JSON.parse(value) as Partial<LibraryStore>;
        } catch {
          parsed = null;
        }
      }
      cache = normalizeStore(parsed);
      return cache;
    });
  }

  return loadPromise;
}

async function writeStore(next: LibraryStore) {
  cache = next;
  if (typeof AsyncStorage.setItem === 'function') {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }
  listeners.forEach((listener) => listener());
}

function getProviderState(store: LibraryStore, providerId: string) {
  return store[providerId] ?? emptyProviderState();
}

export async function getMovieLibraryState(providerId: string) {
  const store = await readStore();
  return getProviderState(store, providerId);
}

export async function toggleFavorite(providerId: string, movieId: string) {
  const store = await readStore();
  const current = getProviderState(store, providerId);
  const favorites = current.favorites.includes(movieId)
    ? current.favorites.filter((id) => id !== movieId)
    : [...current.favorites, movieId];

  await writeStore({
    ...store,
    [providerId]: { ...current, favorites },
  });

  return favorites.includes(movieId);
}

export async function toggleWatchlist(providerId: string, movieId: string) {
  const store = await readStore();
  const current = getProviderState(store, providerId);
  const watchlist = current.watchlist.includes(movieId)
    ? current.watchlist.filter((id) => id !== movieId)
    : [...current.watchlist, movieId];

  await writeStore({
    ...store,
    [providerId]: { ...current, watchlist },
  });

  return watchlist.includes(movieId);
}

export async function recordWatch(
  providerId: string,
  entry: Omit<WatchHistoryEntry, 'watchedAt'> & { watchedAt?: number },
) {
  const store = await readStore();
  const current = getProviderState(store, providerId);
  const watchedAt = entry.watchedAt ?? Date.now();
  const watchHistory = [
    { ...entry, watchedAt },
    ...current.watchHistory.filter((item) => item.movieId !== entry.movieId),
  ].slice(0, 200);

  await writeStore({
    ...store,
    [providerId]: { ...current, watchHistory },
  });
}

export async function getContinueWatchingIds(providerId: string) {
  const { watchHistory } = await getMovieLibraryState(providerId);
  return watchHistory
    .filter((entry) => (entry.progressPercent ?? 100) < 90)
    .sort((left, right) => right.watchedAt - left.watchedAt)
    .map((entry) => entry.movieId);
}

export async function getRecentlyWatchedIds(providerId: string, limit = 50) {
  const { watchHistory } = await getMovieLibraryState(providerId);
  return watchHistory
    .sort((left, right) => right.watchedAt - left.watchedAt)
    .slice(0, limit)
    .map((entry) => entry.movieId);
}

export async function getWatchlistIds(providerId: string) {
  const { watchlist } = await getMovieLibraryState(providerId);
  return watchlist;
}

export async function getFavoriteIds(providerId: string) {
  const { favorites } = await getMovieLibraryState(providerId);
  return favorites;
}

export async function getLastWatchedMovie(providerId: string) {
  const { watchHistory } = await getMovieLibraryState(providerId);
  return watchHistory.sort((left, right) => right.watchedAt - left.watchedAt)[0] ?? null;
}

export async function removeContinueWatching(providerId: string, movieId: string) {
  const store = await readStore();
  const current = getProviderState(store, providerId);
  await writeStore({
    ...store,
    [providerId]: {
      ...current,
      watchHistory: current.watchHistory.map((entry) =>
        entry.movieId === movieId ? { ...entry, progressPercent: 100, watchedAt: Date.now() } : entry,
      ),
    },
  });
}

export async function resetMovieProgress(providerId: string, movieId: string) {
  const store = await readStore();
  const current = getProviderState(store, providerId);
  await writeStore({
    ...store,
    [providerId]: {
      ...current,
      watchHistory: current.watchHistory.map((entry) =>
        entry.movieId === movieId ? { ...entry, progressPercent: 0, watchedAt: Date.now() } : entry,
      ),
    },
  });
}

export function clearMovieLibraryCacheForTests() {
  cache = null;
  loadPromise = null;
}

export function subscribeMovieLibrary(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useMovieLibraryStore(providerId: string) {
  const [state, setState] = useState<ProviderLibraryState>(emptyProviderState());
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;

    void readStore().then((store) => {
      if (!active) {
        return;
      }
      setState(getProviderState(store, providerId));
      setReady(true);
    });

    const unsubscribe = subscribeMovieLibrary(() => {
      if (!active || !cache) {
        return;
      }
      setState(getProviderState(cache, providerId));
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [providerId]);

  return useMemo(
    () => ({
      state,
      ready,
      isFavorite: (movieId: string) => state.favorites.includes(movieId),
      isWatchlisted: (movieId: string) => state.watchlist.includes(movieId),
    }),
    [ready, state],
  );
}
