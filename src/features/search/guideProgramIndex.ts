import type { NormalizedGuideRow } from '@/features/guide/guideTimeline';

import { buildSearchHaystack, compareSearchCandidates, matchesSearchQuery } from './searchRanking.ts';
import { normalizeSearchQuery } from './searchQuery.ts';
import type { GuideSearchResult } from './searchTypes.ts';

export type GuideProgramIndexEntry = {
  providerId: string;
  channelId: string;
  channelName: string;
  programId: string;
  title: string;
  description?: string;
  startsAt?: number;
  endsAt?: number;
};

const indexes = new Map<string, Map<string, GuideProgramIndexEntry>>();

function entryKey(channelId: string, programId: string) {
  return `${channelId}:${programId}`;
}

function providerMap(providerId: string) {
  const existing = indexes.get(providerId);
  if (existing) {
    return existing;
  }

  const next = new Map<string, GuideProgramIndexEntry>();
  indexes.set(providerId, next);
  return next;
}

export function ingestGuideRows(providerId: string, rows: NormalizedGuideRow[]) {
  const map = providerMap(providerId);
  for (const row of rows) {
    for (const program of row.programs) {
      map.set(entryKey(row.channel.id, program.id), {
        providerId,
        channelId: row.channel.id,
        channelName: row.channel.name,
        programId: program.id,
        title: program.title,
        description: program.description,
        startsAt: program.startAt,
        endsAt: program.endAt,
      });
    }
  }
}

export function resetGuideProgramIndex(providerId?: string) {
  if (providerId) {
    indexes.delete(providerId);
    return;
  }

  indexes.clear();
}

function resolveGuideProgramStatus(startsAt?: number, endsAt?: number, now = Date.now()) {
  if (startsAt !== undefined && endsAt !== undefined) {
    if (now >= startsAt && now < endsAt) {
      return 'live' as const;
    }

    if (now < startsAt) {
      return 'upcoming' as const;
    }

    return 'ended' as const;
  }

  return undefined;
}

export function searchGuideProgramIndex(
  providerId: string,
  query: string,
  offset: number,
  limit: number,
): { items: GuideSearchResult[]; totalCount: number; hasMore: boolean } {
  const map = indexes.get(providerId);
  if (!map?.size) {
    return { items: [], totalCount: 0, hasMore: false };
  }

  const normalizedQuery = normalizeSearchQuery(query);
  const matches: GuideSearchResult[] = [];

  for (const entry of map.values()) {
    const haystack = buildSearchHaystack([entry.channelName, entry.title, entry.description]);
    const titleMatch = matchesSearchQuery(query, { title: entry.title, metadata: haystack });
    const channelMatch = normalizeSearchQuery(entry.channelName).includes(normalizedQuery);
    const metadataMatch = haystack.includes(normalizedQuery);

    if (!titleMatch && !channelMatch && !metadataMatch) {
      continue;
    }

    matches.push({
      type: 'guide',
      id: entry.channelId,
      providerId,
      title: entry.title,
      channelId: entry.channelId,
      channelName: entry.channelName,
      programId: entry.programId,
      startsAt: entry.startsAt,
      endsAt: entry.endsAt,
      description: entry.description,
      status: resolveGuideProgramStatus(entry.startsAt, entry.endsAt),
    });
  }

  matches.sort((left, right) =>
    compareSearchCandidates(
      query,
      { title: left.title, metadata: `${left.channelName} ${left.description ?? ''}` },
      { title: right.title, metadata: `${right.channelName} ${right.description ?? ''}` },
    ),
  );

  const items = matches.slice(offset, offset + limit);
  return {
    items,
    totalCount: matches.length,
    hasMore: offset + limit < matches.length,
  };
}

export function guideProgramIndexSize(providerId: string) {
  return indexes.get(providerId)?.size ?? 0;
}
