import type { ProviderLiveChannel } from '@/features/providers/providerRepositories';

import { buildSearchHaystack, compareSearchCandidates, matchesSearchQuery } from './searchRanking.ts';
import { normalizeSearchQuery } from './searchQuery.ts';
import type { LiveSearchResult } from './searchTypes.ts';

export type LiveChannelIndexEntry = {
  id: string;
  providerId: string;
  categoryId: string;
  name: string;
  number: number;
  current?: string;
  tone?: string;
  logoUrl?: string;
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

export function ingestLiveChannels(providerId: string, channels: ProviderLiveChannel[]) {
  const map = providerMap(providerId);
  for (const channel of channels) {
    map.set(channel.id, {
      id: channel.id,
      providerId,
      categoryId: channel.categoryId,
      name: channel.name,
      number: channel.number,
      current: channel.current,
      tone: channel.tone,
      logoUrl: channel.logoUrl,
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
): { items: LiveSearchResult[]; totalCount: number; hasMore: boolean } {
  const map = indexes.get(providerId);
  if (!map?.size) {
    return { items: [], totalCount: 0, hasMore: false };
  }

  const normalizedQuery = normalizeSearchQuery(query);
  const matches: LiveSearchResult[] = [];

  for (const entry of map.values()) {
    const haystack = buildSearchHaystack([entry.name, entry.number, entry.current, entry.categoryId]);
    const nameMatch = matchesSearchQuery(query, { title: entry.name, metadata: haystack });
    const haystackMatch = haystack.includes(normalizedQuery);
    const numberMatch = String(entry.number) === normalizedQuery;

    if (!nameMatch && !haystackMatch && !numberMatch) {
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

  matches.sort((left, right) =>
    compareSearchCandidates(query, { title: left.title, metadata: left.subtitle }, { title: right.title, metadata: right.subtitle }),
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
