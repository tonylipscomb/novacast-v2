import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useMemo, useState } from 'react';

import type { ProviderLiveChannel } from '../providers/providerRepositories.ts';
import { removeContinueWatching as removeEpisodeContinueWatching } from '../media-browser/mediaLibraryStore.ts';
import { removeContinueWatching as removeMovieContinueWatching } from '../movies/smart/movieLibraryStore.ts';

import { dedupeRecentItems, type FavoriteRecord, type RecentItemRecord } from './personalizationModel.ts';

type ProviderPersonalizationState = {
  liveFavorites: FavoriteRecord[];
  recentItems: RecentItemRecord[];
};

const STORAGE_PREFIX = '@novacast/personalization:';
const MAX_RECENT_ITEMS = 20;

function emptyState(): ProviderPersonalizationState {
  return { liveFavorites: [], recentItems: [] };
}

function storageKey(providerId: string) {
  return `${STORAGE_PREFIX}${providerId}`;
}

function normalizeFavorite(value: unknown, providerId: string): FavoriteRecord | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const entry = value as Partial<FavoriteRecord>;
  if (entry.mediaType !== 'live' || typeof entry.contentId !== 'string' || typeof entry.title !== 'string') {
    return null;
  }

  return {
    providerId,
    mediaType: 'live',
    contentId: entry.contentId,
    title: entry.title,
    artworkUrl: typeof entry.artworkUrl === 'string' ? entry.artworkUrl : undefined,
    categoryId: typeof entry.categoryId === 'string' ? entry.categoryId : undefined,
    streamId: typeof entry.streamId === 'string' ? entry.streamId : undefined,
    extension: typeof entry.extension === 'string' ? entry.extension : undefined,
    createdAt: typeof entry.createdAt === 'number' ? entry.createdAt : Date.now(),
  };
}

function normalizeRecent(value: unknown, providerId: string): RecentItemRecord | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const entry = value as Partial<RecentItemRecord>;
  if (
    (entry.mediaType !== 'live' && entry.mediaType !== 'movie' && entry.mediaType !== 'series' && entry.mediaType !== 'episode') ||
    typeof entry.contentId !== 'string' ||
    typeof entry.title !== 'string'
  ) {
    return null;
  }

  return {
    providerId,
    mediaType: entry.mediaType,
    contentId: entry.contentId,
    title: entry.title,
    artworkUrl: typeof entry.artworkUrl === 'string' ? entry.artworkUrl : undefined,
    categoryId: typeof entry.categoryId === 'string' ? entry.categoryId : undefined,
    parentSeriesId: typeof entry.parentSeriesId === 'string' ? entry.parentSeriesId : undefined,
    seasonNumber: typeof entry.seasonNumber === 'string' ? entry.seasonNumber : undefined,
    episodeNumber: typeof entry.episodeNumber === 'string' ? entry.episodeNumber : undefined,
    lastOpenedAt: typeof entry.lastOpenedAt === 'number' ? entry.lastOpenedAt : Date.now(),
  };
}

function normalizeState(value: unknown, providerId: string): ProviderPersonalizationState {
  if (!value || typeof value !== 'object') {
    return emptyState();
  }

  const raw = value as Partial<ProviderPersonalizationState>;
  return {
    liveFavorites: Array.isArray(raw.liveFavorites)
      ? raw.liveFavorites.map((item) => normalizeFavorite(item, providerId)).filter((item): item is FavoriteRecord => Boolean(item))
      : [],
    recentItems: Array.isArray(raw.recentItems)
      ? dedupeRecentItems(
          raw.recentItems.map((item) => normalizeRecent(item, providerId)).filter((item): item is RecentItemRecord => Boolean(item)),
          MAX_RECENT_ITEMS,
        )
      : [],
  };
}

const cache = new Map<string, ProviderPersonalizationState>();
const loadPromises = new Map<string, Promise<ProviderPersonalizationState>>();
const listeners = new Set<() => void>();

async function readProviderState(providerId: string) {
  const cached = cache.get(providerId);
  if (cached) {
    return cached;
  }

  const inFlight = loadPromises.get(providerId);
  if (inFlight) {
    return inFlight;
  }

  const promise = (async () => {
    let parsed: unknown = null;
    if (typeof AsyncStorage.getItem === 'function') {
      const raw = await AsyncStorage.getItem(storageKey(providerId));
      if (raw) {
        try {
          parsed = JSON.parse(raw);
        } catch {
          parsed = null;
        }
      }
    }

    const next = normalizeState(parsed, providerId);
    cache.set(providerId, next);
    return next;
  })();

  loadPromises.set(providerId, promise);
  try {
    return await promise;
  } finally {
    loadPromises.delete(providerId);
  }
}

async function writeProviderState(providerId: string, state: ProviderPersonalizationState) {
  cache.set(providerId, state);
  if (typeof AsyncStorage.setItem === 'function') {
    await AsyncStorage.setItem(storageKey(providerId), JSON.stringify(state));
  }
  listeners.forEach((listener) => listener());
}

export async function getPersonalizationState(providerId: string) {
  return readProviderState(providerId);
}

export async function toggleLiveFavorite(providerId: string, channel: ProviderLiveChannel) {
  const current = await readProviderState(providerId);
  const exists = current.liveFavorites.some((item) => item.contentId === channel.id);
  const liveFavorites = exists
    ? current.liveFavorites.filter((item) => item.contentId !== channel.id)
    : [
        ...current.liveFavorites,
        {
          providerId,
          mediaType: 'live' as const,
          contentId: channel.id,
          title: channel.name,
          artworkUrl: channel.logoUrl,
          categoryId: channel.categoryId,
          streamId: channel.id,
          extension: channel.containerExtension,
          createdAt: Date.now(),
        },
      ];

  await writeProviderState(providerId, { ...current, liveFavorites });
  return !exists;
}

export async function getLiveFavoriteEntries(providerId: string) {
  return (await readProviderState(providerId)).liveFavorites;
}

export async function isLiveFavorite(providerId: string, channelId: string) {
  return (await readProviderState(providerId)).liveFavorites.some((item) => item.contentId === channelId);
}

export async function recordRecentItem(input: Omit<RecentItemRecord, 'lastOpenedAt'> & { lastOpenedAt?: number }) {
  const current = await readProviderState(input.providerId);
  const nextItem: RecentItemRecord = { ...input, lastOpenedAt: input.lastOpenedAt ?? Date.now() };
  const recentItems = dedupeRecentItems(
    [nextItem, ...current.recentItems.filter((item) => !(item.mediaType === input.mediaType && item.contentId === input.contentId))],
    MAX_RECENT_ITEMS,
  );

  await writeProviderState(input.providerId, { ...current, recentItems });
}

export async function getRecentItems(providerId: string, limit = MAX_RECENT_ITEMS) {
  return dedupeRecentItems((await readProviderState(providerId)).recentItems, limit);
}

export async function removeContinueWatchingItem(providerId: string, mediaType: 'movie' | 'episode', contentId: string) {
  if (mediaType === 'movie') {
    await removeMovieContinueWatching(providerId, contentId);
    return;
  }

  await removeEpisodeContinueWatching(providerId, contentId);
}

export function clearPersonalizationCacheForTests() {
  cache.clear();
  loadPromises.clear();
}

export function subscribePersonalization(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function usePersonalizationStore(providerId: string) {
  const [state, setState] = useState<ProviderPersonalizationState>(emptyState());
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    void readProviderState(providerId).then((next) => {
      if (!active) {
        return;
      }
      setState(next);
      setReady(true);
    });

    const unsubscribe = subscribePersonalization(() => {
      if (!active) {
        return;
      }
      const next = cache.get(providerId);
      if (next) {
        setState(next);
      }
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [providerId]);

  return useMemo(() => ({ state, ready }), [ready, state]);
}

export function personalizationStorageKeyForTests(providerId: string) {
  return storageKey(providerId);
}
