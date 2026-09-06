import type { FavoriteRecord } from '../personalization/personalizationModel.ts';
import type { ProviderLiveChannel } from '../providers/providerRepositories.ts';
import type { LiveChannelIndexEntry } from '../search/liveChannelIndex.ts';

import { logLiveFavorites, logLiveStallAudit } from './liveTvDiagnostics.ts';

export type HydrateFavoriteLiveChannelsResult = {
  channels: ProviderLiveChannel[];
  unresolvedIds: string[];
  savedFavoriteCount: number;
  scannedLoadedCount: number;
  indexLookupCount: number;
  hydrationElapsedMs: number;
};

function isNumericTitle(title: string, id: string) {
  const trimmed = title.trim();
  return !trimmed || trimmed === id || /^\d+$/.test(trimmed);
}

export function liveChannelFromIndexEntry(entry: LiveChannelIndexEntry): ProviderLiveChannel {
  return {
    id: entry.id,
    categoryId: entry.categoryId,
    number: entry.number,
    name: entry.name,
    shortName: entry.name.slice(0, 2) || 'TV',
    current: entry.current ?? '',
    next: '',
    following: '',
    description: '',
    resolution: '',
    audio: '',
    remaining: '',
    progress: 0,
    tone: entry.tone ?? '#173B67',
    currentStart: '',
    currentEnd: '',
    logoUrl: entry.logoUrl,
    containerExtension: entry.containerExtension,
    streamUrl: entry.streamUrl,
  };
}

export function liveChannelFromFavoriteRecord(record: FavoriteRecord): ProviderLiveChannel | null {
  const id = String(record.contentId ?? '').trim();
  if (!id) {
    return null;
  }

  const title = String(record.title ?? '').trim();
  const name = isNumericTitle(title, id) ? 'Favorite channel' : title;

  return {
    id,
    categoryId: String(record.categoryId ?? '').trim(),
    number: 0,
    name,
    shortName: name.slice(0, 2) || 'TV',
    current: '',
    next: '',
    following: '',
    description: '',
    resolution: '',
    audio: '',
    remaining: '',
    progress: 0,
    tone: '#173B67',
    currentStart: '',
    currentEnd: '',
    logoUrl: record.artworkUrl,
    containerExtension: record.extension,
  };
}

export function hydrateFavoriteLiveChannels(input: {
  favoriteIds: readonly string[];
  loadedChannels?: readonly ProviderLiveChannel[];
  getIndexEntry?: (id: string) => LiveChannelIndexEntry | undefined;
  favoriteRecords?: readonly FavoriteRecord[];
}): HydrateFavoriteLiveChannelsResult {
  const startedAt = Date.now();
  const favoriteIds = [...new Set(input.favoriteIds.map((id) => String(id ?? '').trim()).filter(Boolean))];
  const loadedById = new Map((input.loadedChannels ?? []).map((channel) => [channel.id, channel]));
  const recordsById = new Map((input.favoriteRecords ?? []).map((record) => [record.contentId, record]));
  const channels: ProviderLiveChannel[] = [];
  const unresolvedIds: string[] = [];
  let indexLookupCount = 0;

  for (const id of favoriteIds) {
    const loaded = loadedById.get(id);
    if (loaded) {
      channels.push(loaded);
      continue;
    }

    const indexEntry = input.getIndexEntry?.(id);
    indexLookupCount += 1;
    if (indexEntry) {
      channels.push(liveChannelFromIndexEntry(indexEntry));
      continue;
    }

    const record = recordsById.get(id);
    const fromRecord = record ? liveChannelFromFavoriteRecord(record) : null;
    if (fromRecord) {
      channels.push(fromRecord);
      continue;
    }

    unresolvedIds.push(id);
  }

  const hydrationElapsedMs = logLiveStallAudit('hydrateFavoriteLiveChannels', favoriteIds.length, startedAt) ?? Date.now() - startedAt;
  const result: HydrateFavoriteLiveChannelsResult = {
    channels,
    unresolvedIds,
    savedFavoriteCount: favoriteIds.length,
    scannedLoadedCount: input.loadedChannels?.length ?? 0,
    indexLookupCount,
    hydrationElapsedMs,
  };

  logLiveFavorites({
    savedFavoriteCount: result.savedFavoriteCount,
    canonicalResolvedCount: channels.length,
    unresolvedCount: unresolvedIds.length,
    hydrationElapsedMs,
    surfQueueCount: channels.length,
    scannedLoadedCount: result.scannedLoadedCount,
    indexLookupCount,
  });

  return result;
}

export function favoriteSurfQueueIds(favoriteIds: readonly string[], resolvedChannels: readonly ProviderLiveChannel[]): string[] {
  const resolved = new Set(resolvedChannels.map((channel) => channel.id));
  return [...new Set(favoriteIds.map((id) => String(id ?? '').trim()).filter((id) => resolved.has(id)))];
}
