import type { FavoriteRecord, RecentItemRecord } from '../personalization/personalizationModel.ts';
import {
  LIVE_MY_CHANNELS_CATEGORY_ID,
  LIVE_RECENTS_CATEGORY_ID,
} from '../providers/liveCategoryIdSafety.ts';
import type { ProviderLiveCategory, ProviderLiveChannel } from '../providers/providerRepositories.ts';
import type { LiveChannelIndexEntry } from '../search/liveChannelIndex.ts';

import { hydrateFavoriteLiveChannels } from './liveFavoriteHydration.ts';

export const LIVE_MY_CHANNELS_CATEGORY_NAME = 'My Channels';
export const LIVE_RECENTS_CATEGORY_NAME = 'Recents';
export const LIVE_MY_CHANNELS_EMPTY_MESSAGE = 'No saved channels yet';
export const LIVE_RECENTS_EMPTY_MESSAGE = 'No recent channels yet';

export type SyntheticLiveCategoryCounts = {
  myChannelsCount: number;
  recentsCount: number;
};

type ResolveDeps = {
  loadedChannels?: readonly ProviderLiveChannel[];
  getIndexEntry?: (id: string) => LiveChannelIndexEntry | undefined;
};

/** The two UI-only synthetic categories, always pinned to the top of the rail. */
export function buildSyntheticLiveCategories(counts: SyntheticLiveCategoryCounts): ProviderLiveCategory[] {
  return [
    {
      id: LIVE_MY_CHANNELS_CATEGORY_ID,
      renderKey: `synthetic:${LIVE_MY_CHANNELS_CATEGORY_ID}`,
      name: LIVE_MY_CHANNELS_CATEGORY_NAME,
      count: counts.myChannelsCount,
      icon: 'star-outline',
    },
    {
      id: LIVE_RECENTS_CATEGORY_ID,
      renderKey: `synthetic:${LIVE_RECENTS_CATEGORY_ID}`,
      name: LIVE_RECENTS_CATEGORY_NAME,
      count: counts.recentsCount,
      icon: 'history',
    },
  ];
}

/**
 * Final Live rail composition: My Channels, Recents, then the already US-first
 * sorted provider categories. Synthetic categories are prepended AFTER the
 * provider sort so they never enter the regional sorter.
 */
export function composeLiveCategoryRail(
  providerCategories: readonly ProviderLiveCategory[],
  counts: SyntheticLiveCategoryCounts,
): ProviderLiveCategory[] {
  return [...buildSyntheticLiveCategories(counts), ...providerCategories];
}

/** Resolve saved live favorites back into playable Live channel models. */
export function resolveMyChannelsLiveChannels(
  favorites: readonly FavoriteRecord[],
  deps: ResolveDeps = {},
): ProviderLiveChannel[] {
  const liveFavorites = favorites.filter((record) => record.mediaType === 'live');
  return hydrateFavoriteLiveChannels({
    favoriteIds: liveFavorites.map((record) => record.contentId),
    loadedChannels: deps.loadedChannels,
    getIndexEntry: deps.getIndexEntry,
    favoriteRecords: liveFavorites,
  }).channels;
}

/**
 * Resolve recent live items (already newest-first + deduped by the personalization
 * model) back into playable Live channel models, preserving newest-first order.
 */
export function resolveRecentLiveChannels(
  recentItems: readonly RecentItemRecord[],
  deps: ResolveDeps = {},
): ProviderLiveChannel[] {
  const liveRecents = recentItems.filter((item) => item.mediaType === 'live');
  const recordShaped: FavoriteRecord[] = liveRecents.map((item) => ({
    providerId: item.providerId,
    mediaType: 'live',
    contentId: item.contentId,
    title: item.title,
    artworkUrl: item.artworkUrl,
    categoryId: item.categoryId,
    createdAt: item.lastOpenedAt,
  }));
  return hydrateFavoriteLiveChannels({
    favoriteIds: liveRecents.map((item) => item.contentId),
    loadedChannels: deps.loadedChannels,
    getIndexEntry: deps.getIndexEntry,
    favoriteRecords: recordShaped,
  }).channels;
}
