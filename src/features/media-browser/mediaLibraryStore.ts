import { useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

import type { ContinueWatchingEntry, WatchHistoryEntry } from './mediaTypes';
import type { FavoriteRecord } from '../personalization/personalizationModel.ts';

const STORAGE_KEY = '@novacast/media-library';
const LEGACY_MOVIE_KEY = '@novacast/movie-library';
const WATCHED_THRESHOLD_PERCENT = 90;
const MAX_HISTORY = 300;

export type ProviderMediaLibraryState = {
  favorites: string[];
  favoriteRecords: FavoriteRecord[];
  watchlist: string[];
  watchHistory: WatchHistoryEntry[];
  continueWatching: ContinueWatchingEntry[];
};

type LibraryStore = Record<string, ProviderMediaLibraryState>;

function emptyProviderState(): ProviderMediaLibraryState {
  return { favorites: [], favoriteRecords: [], watchlist: [], watchHistory: [], continueWatching: [] };
}

let cache: LibraryStore | null = null;
let loadPromise: Promise<LibraryStore> | null = null;
const listeners = new Set<() => void>();

function normalizeWatchEntry(value: unknown): WatchHistoryEntry | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const entry = value as Partial<WatchHistoryEntry>;
  if (typeof entry.mediaId !== 'string' || typeof entry.title !== 'string') {
    return null;
  }

  return {
    mediaKind: entry.mediaKind === 'episode' ? 'episode' : 'movie',
    mediaId: entry.mediaId,
    seriesId: typeof entry.seriesId === 'string' ? entry.seriesId : undefined,
    seasonNumber: typeof entry.seasonNumber === 'string' ? entry.seasonNumber : undefined,
    episodeNumber: typeof entry.episodeNumber === 'string' ? entry.episodeNumber : undefined,
    title: entry.title,
    seriesTitle: typeof entry.seriesTitle === 'string' ? entry.seriesTitle : undefined,
    artworkUrl: typeof entry.artworkUrl === 'string' ? entry.artworkUrl : undefined,
    categoryId: typeof entry.categoryId === 'string' ? entry.categoryId : undefined,
    watchedAt: typeof entry.watchedAt === 'number' ? entry.watchedAt : Date.now(),
    progressPercent: typeof entry.progressPercent === 'number' ? entry.progressPercent : undefined,
    durationMs: typeof entry.durationMs === 'number' ? entry.durationMs : undefined,
  };
}

function normalizeContinueEntry(value: unknown): ContinueWatchingEntry | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const entry = value as Partial<ContinueWatchingEntry>;
  if (typeof entry.mediaId !== 'string' || typeof entry.title !== 'string' || typeof entry.providerId !== 'string') {
    return null;
  }

  return {
    mediaKind: entry.mediaKind === 'episode' ? 'episode' : 'movie',
    providerId: entry.providerId,
    mediaId: entry.mediaId,
    seriesId: typeof entry.seriesId === 'string' ? entry.seriesId : undefined,
    seasonNumber: typeof entry.seasonNumber === 'string' ? entry.seasonNumber : undefined,
    episodeNumber: typeof entry.episodeNumber === 'string' ? entry.episodeNumber : undefined,
    episodeId: typeof entry.episodeId === 'string' ? entry.episodeId : undefined,
    title: entry.title,
    seriesTitle: typeof entry.seriesTitle === 'string' ? entry.seriesTitle : undefined,
    artworkUrl: typeof entry.artworkUrl === 'string' ? entry.artworkUrl : undefined,
    categoryId: typeof entry.categoryId === 'string' ? entry.categoryId : undefined,
    positionMs: typeof entry.positionMs === 'number' ? entry.positionMs : 0,
    durationMs: typeof entry.durationMs === 'number' ? entry.durationMs : 0,
    progressPercent: typeof entry.progressPercent === 'number' ? entry.progressPercent : 0,
    lastWatchedAt: typeof entry.lastWatchedAt === 'number' ? entry.lastWatchedAt : Date.now(),
  };
}

function normalizeProviderState(value: Partial<ProviderMediaLibraryState> | undefined): ProviderMediaLibraryState {
  return {
    favorites: Array.isArray(value?.favorites) ? value.favorites.filter((id) => typeof id === 'string') : [],
    favoriteRecords: Array.isArray(value?.favoriteRecords)
      ? value.favoriteRecords.filter(
          (entry): entry is FavoriteRecord =>
            (entry?.mediaType === 'movie' || entry?.mediaType === 'series') &&
            typeof entry.contentId === 'string' &&
            typeof entry.title === 'string',
        )
      : [],
    watchlist: Array.isArray(value?.watchlist) ? value.watchlist.filter((id) => typeof id === 'string') : [],
    watchHistory: Array.isArray(value?.watchHistory)
      ? value.watchHistory.map(normalizeWatchEntry).filter((entry): entry is WatchHistoryEntry => Boolean(entry))
      : [],
    continueWatching: Array.isArray(value?.continueWatching)
      ? value.continueWatching.map(normalizeContinueEntry).filter((entry): entry is ContinueWatchingEntry => Boolean(entry))
      : [],
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

function migrateLegacyMovieStore(legacy: unknown, providerId: string): ProviderMediaLibraryState {
  if (!legacy || typeof legacy !== 'object') {
    return emptyProviderState();
  }

  const state = legacy as {
    favorites?: string[];
    watchlist?: string[];
    watchHistory?: { movieId: string; title: string; watchedAt: number; progressPercent?: number; durationMs?: number }[];
  };

  return {
    favorites: Array.isArray(state.favorites) ? state.favorites.filter((id) => typeof id === 'string') : [],
    favoriteRecords: [],
    watchlist: Array.isArray(state.watchlist) ? state.watchlist.filter((id) => typeof id === 'string') : [],
    watchHistory: Array.isArray(state.watchHistory)
      ? state.watchHistory
          .filter((entry) => typeof entry?.movieId === 'string' && typeof entry?.title === 'string')
          .map((entry) => ({
            mediaKind: 'movie' as const,
            mediaId: entry.movieId,
            title: entry.title,
            watchedAt: entry.watchedAt ?? Date.now(),
            progressPercent: entry.progressPercent,
            durationMs: entry.durationMs,
          }))
      : [],
    continueWatching: Array.isArray(state.watchHistory)
      ? state.watchHistory
          .filter((entry) => (entry.progressPercent ?? 100) < WATCHED_THRESHOLD_PERCENT)
          .map((entry) => ({
            mediaKind: 'movie' as const,
            providerId,
            mediaId: entry.movieId,
            title: entry.title,
            positionMs: 0,
            durationMs: entry.durationMs ?? 0,
            progressPercent: entry.progressPercent ?? 0,
            lastWatchedAt: entry.watchedAt ?? Date.now(),
          }))
      : [],
  };
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
    loadPromise = (async () => {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      let parsed: Partial<LibraryStore> | null = null;
      if (raw) {
        try {
          parsed = JSON.parse(raw) as Partial<LibraryStore>;
        } catch {
          parsed = null;
        }
      }

      const store = normalizeStore(parsed);

      const legacyRaw = await AsyncStorage.getItem(LEGACY_MOVIE_KEY);
      if (legacyRaw) {
        try {
          const legacyParsed = JSON.parse(legacyRaw) as Record<string, unknown>;
          for (const [providerId, legacyState] of Object.entries(legacyParsed)) {
            if (!store[providerId]) {
              store[providerId] = migrateLegacyMovieStore(legacyState, providerId);
            }
          }
        } catch {
          // ignore legacy parse errors
        }
      }

      cache = store;
      return cache;
    })();
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

function computeProgressPercent(positionMs: number, durationMs: number) {
  if (!durationMs || durationMs <= 0) {
    return 0;
  }
  return Math.min(100, Math.round((positionMs / durationMs) * 100));
}

function buildEpisodeMediaId(seriesId: string, seasonNumber: string, episodeNumber: string) {
  return `${seriesId}:${seasonNumber}:${episodeNumber}`;
}

export async function getMediaLibraryState(providerId: string) {
  const store = await readStore();
  return getProviderState(store, providerId);
}

export async function toggleMediaFavorite(
  providerId: string,
  mediaId: string,
  mediaType: 'series' | 'movie' = 'series',
  metadata?: Pick<FavoriteRecord, 'title' | 'artworkUrl' | 'categoryId'>,
) {
  const store = await readStore();
  const current = getProviderState(store, providerId);
  const records = current.favoriteRecords.filter((item) => item.mediaType === mediaType);
  const exists = records.some((item) => item.contentId === mediaId);
  const nextRecords = exists
    ? records.filter((item) => item.contentId !== mediaId)
    : [
        ...records,
        {
          providerId,
          mediaType,
          contentId: mediaId,
          title: metadata?.title ?? mediaId,
          artworkUrl: metadata?.artworkUrl,
          categoryId: metadata?.categoryId,
          createdAt: Date.now(),
        },
      ];
  const favorites = exists
    ? current.favorites.filter((id) => id !== mediaId)
    : [...new Set([...current.favorites, mediaId])];

  await writeStore({ ...store, [providerId]: { ...current, favorites, favoriteRecords: [...current.favoriteRecords.filter((item) => item.mediaType !== mediaType), ...nextRecords] } });
  return !exists;
}

export async function toggleMediaWatchlist(providerId: string, mediaId: string) {
  const store = await readStore();
  const current = getProviderState(store, providerId);
  const watchlist = current.watchlist.includes(mediaId)
    ? current.watchlist.filter((id) => id !== mediaId)
    : [...current.watchlist, mediaId];

  await writeStore({ ...store, [providerId]: { ...current, watchlist } });
  return watchlist.includes(mediaId);
}

export async function recordMediaWatch(
  providerId: string,
  entry: Omit<WatchHistoryEntry, 'watchedAt'> & { watchedAt?: number },
) {
  const store = await readStore();
  const current = getProviderState(store, providerId);
  const watchedAt = entry.watchedAt ?? Date.now();
  const watchHistory = [
    { ...entry, watchedAt },
    ...current.watchHistory.filter((item) => item.mediaId !== entry.mediaId),
  ].slice(0, MAX_HISTORY);

  await writeStore({ ...store, [providerId]: { ...current, watchHistory } });
}

export async function updateContinueWatching(
  providerId: string,
  entry: Omit<ContinueWatchingEntry, 'lastWatchedAt' | 'progressPercent'> & {
    lastWatchedAt?: number;
    progressPercent?: number;
  },
) {
  const store = await readStore();
  const current = getProviderState(store, providerId);
  const progressPercent = entry.progressPercent ?? computeProgressPercent(entry.positionMs, entry.durationMs);
  const lastWatchedAt = entry.lastWatchedAt ?? Date.now();

  if (progressPercent >= WATCHED_THRESHOLD_PERCENT) {
    const continueWatching = current.continueWatching.filter((item) => item.mediaId !== entry.mediaId);
    await writeStore({ ...store, [providerId]: { ...current, continueWatching } });
    return null;
  }

  const nextEntry: ContinueWatchingEntry = { ...entry, providerId, progressPercent, lastWatchedAt };
  const continueWatching = [
    nextEntry,
    ...current.continueWatching.filter((item) => item.mediaId !== entry.mediaId),
  ].slice(0, 50);

  await writeStore({ ...store, [providerId]: { ...current, continueWatching } });
  return nextEntry;
}

export async function getContinueWatchingEntries(providerId: string, mediaKind?: 'movie' | 'episode') {
  const { continueWatching } = await getMediaLibraryState(providerId);
  return continueWatching
    .filter((entry) => (mediaKind ? entry.mediaKind === mediaKind : true))
    .sort((left, right) => right.lastWatchedAt - left.lastWatchedAt);
}

export async function getSeriesContinueWatching(providerId: string, seriesId: string) {
  const entries = await getContinueWatchingEntries(providerId, 'episode');
  return entries.find((entry) => entry.seriesId === seriesId) ?? null;
}

export async function recordEpisodeProgress(input: {
  providerId: string;
  seriesId: string;
  seasonNumber: string;
  episodeNumber: string;
  episodeId: string;
  title: string;
  seriesTitle?: string;
  artworkUrl?: string;
  categoryId?: string;
  positionMs: number;
  durationMs: number;
}) {
  const mediaId = buildEpisodeMediaId(input.seriesId, input.seasonNumber, input.episodeNumber);
  await recordMediaWatch(input.providerId, {
    mediaKind: 'episode',
    mediaId,
    seriesId: input.seriesId,
    seasonNumber: input.seasonNumber,
    episodeNumber: input.episodeNumber,
    title: input.title,
    seriesTitle: input.seriesTitle,
    artworkUrl: input.artworkUrl,
    categoryId: input.categoryId,
    progressPercent: computeProgressPercent(input.positionMs, input.durationMs),
    durationMs: input.durationMs,
  });

  return updateContinueWatching(input.providerId, {
    mediaKind: 'episode',
    mediaId,
    providerId: input.providerId,
    seriesId: input.seriesId,
    seasonNumber: input.seasonNumber,
    episodeNumber: input.episodeNumber,
    episodeId: input.episodeId,
    title: input.title,
    seriesTitle: input.seriesTitle,
    artworkUrl: input.artworkUrl,
    categoryId: input.categoryId,
    positionMs: input.positionMs,
    durationMs: input.durationMs,
  });
}

export async function getFavoriteIds(providerId: string) {
  const { favorites } = await getMediaLibraryState(providerId);
  return favorites;
}

export async function getTypedFavoriteIds(providerId: string, mediaType: 'movie' | 'series') {
  const state = await getMediaLibraryState(providerId);
  const typed = state.favoriteRecords.filter((item) => item.mediaType === mediaType).map((item) => item.contentId);
  return [...new Set([...typed, ...state.favorites])];
}

export async function removeContinueWatching(providerId: string, mediaId: string) {
  const store = await readStore();
  const current = getProviderState(store, providerId);
  const continueWatching = current.continueWatching.filter((item) => item.mediaId !== mediaId && item.episodeId !== mediaId);
  await writeStore({ ...store, [providerId]: { ...current, continueWatching } });
}

export async function resetEpisodeProgress(providerId: string, mediaId: string) {
  const store = await readStore();
  const current = getProviderState(store, providerId);
  const continueWatching = current.continueWatching.map((item) =>
    item.mediaId === mediaId || item.episodeId === mediaId ? { ...item, positionMs: 0, progressPercent: 0, lastWatchedAt: Date.now() } : item,
  );
  await writeStore({ ...store, [providerId]: { ...current, continueWatching } });
}

export async function getWatchlistIds(providerId: string) {
  const { watchlist } = await getMediaLibraryState(providerId);
  return watchlist;
}

export async function getRecentlyWatchedIds(providerId: string, limit = 50) {
  const { watchHistory } = await getMediaLibraryState(providerId);
  return watchHistory
    .sort((left, right) => right.watchedAt - left.watchedAt)
    .slice(0, limit)
    .map((entry) => entry.mediaId);
}

export function clearMediaLibraryCacheForTests() {
  cache = null;
  loadPromise = null;
}

export function subscribeMediaLibrary(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useMediaLibraryStore(providerId: string) {
  const [state, setState] = useState<ProviderMediaLibraryState>(emptyProviderState());
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

    const unsubscribe = subscribeMediaLibrary(() => {
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
      isFavorite: (mediaId: string) => state.favorites.includes(mediaId) || state.favoriteRecords.some((item) => item.contentId === mediaId),
      isWatchlisted: (mediaId: string) => state.watchlist.includes(mediaId),
      seriesContinueWatching: (seriesId: string) =>
        state.continueWatching.find((entry) => entry.mediaKind === 'episode' && entry.seriesId === seriesId) ?? null,
    }),
    [ready, state],
  );
}
