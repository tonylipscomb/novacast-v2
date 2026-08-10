import type { ProviderLiveChannel } from '@/features/providers/providerRepositories';

import { compareSearchCandidates } from './searchRanking.ts';
import { normalizeSearchQuery } from './searchQuery.ts';
import type { LiveSearchResult } from './searchTypes.ts';

export type LiveSearchMatchMode = 'global' | 'live';

export type LiveChannelIndexEntry = {
  id: string;
  providerId: string;
  categoryId: string;
  name: string;
  number: number;
  current?: string;
  tone?: string;
  logoUrl?: string;
  // search-live-s1-cached-index
  // Cache normalized fields once during ingestion instead of rebuilding a haystack per keystroke.
  normalizedName: string;
  normalizedCurrent: string;
  numberText: string;
  nameTokens: string[];
  currentTokens: string[];
};

const indexes = new Map<string, Map<string, LiveChannelIndexEntry>>();

function providerMap(providerId: string) {
  const existing = indexes.get(providerId);
  if (existing) {
    return existing;
  }

  const next = new Map<string, LiveChannelIndexEntry>();
  indexes.set(providerId, next);
  return next;
}

function tokenizeNormalized(value: string) {
  return value.split(' ').filter(Boolean);
}

function matchesCachedText(
  normalizedQuery: string,
  queryTokens: string[],
  normalizedText: string,
  textTokens: string[],
) {
  if (!normalizedQuery || !normalizedText) {
    return false;
  }

  if (normalizedText.includes(normalizedQuery)) {
    return true;
  }

  return (
    queryTokens.length > 0 &&
    queryTokens.every((queryToken) => textTokens.some((textToken) => textToken.startsWith(queryToken)))
  );
}

export function ingestLiveChannels(providerId: string, channels: ProviderLiveChannel[]) {
  const map = providerMap(providerId);
  for (const channel of channels) {
    const normalizedName = normalizeSearchQuery(channel.name);
    const normalizedCurrent = normalizeSearchQuery(channel.current ?? '');
    const numberText = String(channel.number);

    map.set(channel.id, {
      id: channel.id,
      providerId,
      categoryId: channel.categoryId,
      name: channel.name,
      number: channel.number,
      current: channel.current,
      tone: channel.tone,
      logoUrl: channel.logoUrl,
      normalizedName,
      normalizedCurrent,
      numberText,
      nameTokens: tokenizeNormalized(normalizedName),
      currentTokens: tokenizeNormalized(normalizedCurrent),
    });
  }
}

export function getLiveChannelIndexEntry(providerId: string, channelId: string) {
  return indexes.get(providerId)?.get(channelId);
}

export function resetLiveChannelIndex(providerId?: string) {
  if (providerId) {
    indexes.delete(providerId);
    return;
  }

  indexes.clear();
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

  const normalizedQuery = normalizeSearchQuery(query);
  const queryTokens = tokenizeNormalized(normalizedQuery);
  const matches: LiveSearchResult[] = [];

  for (const entry of map.values()) {
    const nameMatch = matchesCachedText(
      normalizedQuery,
      queryTokens,
      entry.normalizedName,
      entry.nameTokens,
    );
    const numberMatch = entry.numberText === normalizedQuery;
    const currentProgramMatch =
      matchMode === 'live' &&
      matchesCachedText(
        normalizedQuery,
        queryTokens,
        entry.normalizedCurrent,
        entry.currentTokens,
      );

    // Global search intentionally ignores current-program/category metadata.
    // Dedicated Live scope keeps current-program matching for richer channel discovery.
    if (!nameMatch && !numberMatch && !currentProgramMatch) {
      continue;
    }

    matches.push({
      type: 'live',
      id: entry.id,
      providerId,
      title: entry.name,
      subtitle: entry.current,
      channelNumber: entry.number,
      logoUrl: entry.logoUrl,
      tone: entry.tone,
      categoryId: entry.categoryId,
      currentProgram: entry.current,
    });
  }

  matches.sort((left, right) => {
    const leftNumberExact = String(left.channelNumber ?? '') === normalizedQuery;
    const rightNumberExact = String(right.channelNumber ?? '') === normalizedQuery;
    if (leftNumberExact !== rightNumberExact) {
      return leftNumberExact ? -1 : 1;
    }

    return compareSearchCandidates(
      query,
      { title: left.title, metadata: matchMode === 'live' ? left.subtitle : undefined },
      { title: right.title, metadata: matchMode === 'live' ? right.subtitle : undefined },
    );
  });

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