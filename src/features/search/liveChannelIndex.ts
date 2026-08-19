import type { ProviderLiveCategory, ProviderLiveChannel } from '@/features/providers/providerRepositories';

import {
  compareLiveSearchCandidates,
  liveSearchCandidateMatches,
  tokenizeLiveSearchText,
} from './liveSearchMatching.ts';
import { normalizeSearchQuery } from './searchQuery.ts';
import type { LiveSearchResult } from './searchTypes.ts';

export type LiveSearchMatchMode = 'global' | 'live';

export type LiveChannelIndexEntry = {
  id: string;
  providerId: string;
  categoryId: string;
  categoryName?: string;
  name: string;
  number: number;
  current?: string;
  tone?: string;
  logoUrl?: string;
  containerExtension?: string;
  // search-live-s1-cached-index
  // Cache normalized fields once during ingestion instead of rebuilding a haystack per keystroke.
  normalizedName: string;
  normalizedCurrent: string;
  normalizedCategory: string;
  numberText: string;
  nameTokens: string[];
  currentTokens: string[];
};

const indexes = new Map<string, Map<string, LiveChannelIndexEntry>>();
const categoryNames = new Map<string, Map<string, string>>();

function providerMap(providerId: string) {
  const existing = indexes.get(providerId);
  if (existing) {
    return existing;
  }

  const next = new Map<string, LiveChannelIndexEntry>();
  indexes.set(providerId, next);
  return next;
}

function providerCategoryMap(providerId: string) {
  const existing = categoryNames.get(providerId);
  if (existing) {
    return existing;
  }

  const next = new Map<string, string>();
  categoryNames.set(providerId, next);
  return next;
}

export function ingestLiveSearchCategories(
  providerId: string,
  categories: readonly Pick<ProviderLiveCategory, 'id' | 'name'>[],
) {
  const map = providerCategoryMap(providerId);
  for (const category of categories) {
    const id = category.id?.trim();
    const name = category.name?.trim();
    if (!id || !name || id === 'all' || id === 'favorites' || id === 'recent') {
      continue;
    }
    map.set(id, name);
  }
}

export function findMatchingLiveCategoryIds(providerId: string, query: string) {
  const map = categoryNames.get(providerId);
  if (!map?.size) {
    return [] as string[];
  }

  const normalizedQuery = normalizeSearchQuery(query);
  if (!normalizedQuery) {
    return [] as string[];
  }

  const matches: string[] = [];
  for (const [categoryId, name] of map) {
    const normalizedName = normalizeSearchQuery(name);
    if (normalizedName && normalizedName.includes(normalizedQuery)) {
      matches.push(categoryId);
    }
  }
  return matches;
}

export function ingestLiveChannels(providerId: string, channels: ProviderLiveChannel[]) {
  const map = providerMap(providerId);
  const categories = providerCategoryMap(providerId);
  for (const channel of channels) {
    const normalizedName = normalizeSearchQuery(channel.name);
    const normalizedCurrent = normalizeSearchQuery(channel.current ?? '');
    const categoryName = categories.get(channel.categoryId) ?? '';
    const numberText = String(channel.number);

    map.set(channel.id, {
      id: channel.id,
      providerId,
      categoryId: channel.categoryId,
      categoryName: categoryName || undefined,
      name: channel.name,
      number: channel.number,
      current: channel.current,
      tone: channel.tone,
      logoUrl: channel.logoUrl,
      containerExtension: channel.containerExtension,
      normalizedName,
      normalizedCurrent,
      normalizedCategory: normalizeSearchQuery(categoryName),
      numberText,
      nameTokens: tokenizeLiveSearchText(normalizedName),
      currentTokens: tokenizeLiveSearchText(normalizedCurrent),
    });
  }
}

export function getLiveChannelIndexEntry(providerId: string, channelId: string) {
  return indexes.get(providerId)?.get(channelId);
}

export function resetLiveChannelIndex(providerId?: string) {
  if (providerId) {
    indexes.delete(providerId);
    categoryNames.delete(providerId);
    return;
  }

  indexes.clear();
  categoryNames.clear();
}

function toLiveSearchResult(providerId: string, entry: LiveChannelIndexEntry): LiveSearchResult {
  return {
    type: 'live',
    id: entry.id,
    providerId,
    title: entry.name,
    subtitle: entry.current,
    channelNumber: entry.number,
    logoUrl: entry.logoUrl,
    tone: entry.tone,
    categoryId: entry.categoryId,
    categoryName: entry.categoryName,
    currentProgram: entry.current,
    containerExtension: entry.containerExtension,
  };
}

export function searchLiveChannelIndex(
  providerId: string,
  query: string,
  offset: number,
  limit: number,
  matchMode: LiveSearchMatchMode = 'live',
): { items: LiveSearchResult[]; totalCount: number; hasMore: boolean } {
  const map = indexes.get(providerId);
  if (!map?.size) {
    return { items: [], totalCount: 0, hasMore: false };
  }

  const allowProgram = matchMode === 'live';
  const allowCategory = matchMode === 'live';
  const matches: LiveSearchResult[] = [];

  for (const entry of map.values()) {
    if (
      !liveSearchCandidateMatches(
        query,
        {
          id: entry.id,
          name: entry.name,
          number: entry.number,
          currentProgram: entry.current,
          categoryName: entry.categoryName,
        },
        { allowProgram, allowCategory },
      )
    ) {
      continue;
    }

    matches.push(toLiveSearchResult(providerId, entry));
  }

  matches.sort((left, right) =>
    compareLiveSearchCandidates(
      query,
      {
        id: left.id,
        name: left.title,
        number: left.channelNumber,
        currentProgram: allowProgram ? left.currentProgram : undefined,
        categoryName: allowCategory ? left.categoryName : undefined,
      },
      {
        id: right.id,
        name: right.title,
        number: right.channelNumber,
        currentProgram: allowProgram ? right.currentProgram : undefined,
        categoryName: allowCategory ? right.categoryName : undefined,
      },
      { allowProgram, allowCategory },
    ),
  );

  const items = matches.slice(offset, offset + limit);
  return {
    items,
    totalCount: matches.length,
    hasMore: offset + limit < matches.length,
  };
}

export function liveChannelIndexSize(providerId: string) {
  return indexes.get(providerId)?.size ?? 0;
}
