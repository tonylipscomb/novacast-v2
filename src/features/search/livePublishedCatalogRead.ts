import { derivedLiveCategoryName, LIVE_UNKNOWN_CATEGORY_ID } from '../providers/liveCatalogCompletion.ts';
import { logSampledLiveStreamRow } from '../providers/liveStreamRowDiagnostics.ts';
import type { ProviderLiveCategory, ProviderLiveChannel } from '../providers/providerRepositories.ts';
import { sortLiveCategoriesUsFirst } from '../providers/usAmericanSort.ts';
import { getLiveSearchCategoryName } from './liveChannelIndex.ts';

export type PublishedLiveCatalogRow = {
  channel_id: string;
  category_id: string | null;
  title: string;
  current_program: string | null;
  logo_url: string | null;
  channel_number: number | string | null;
  stream_extension: string | null;
  direct_source?: string | null;
  tone: string | null;
};

function asNumber(value: unknown, fallback = 0) {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function normalizePublishedCategoryCounts(counts: Record<string, number>): Record<string, number> {
  const next: Record<string, number> = {};
  for (const [rawId, total] of Object.entries(counts)) {
    const id = String(rawId ?? '').trim() || LIVE_UNKNOWN_CATEGORY_ID;
    const amount = typeof total === 'number' && Number.isFinite(total) ? total : asNumber(total);
    next[id] = (next[id] ?? 0) + amount;
  }
  return next;
}

export function resolvePublishedLiveCategoryName(providerId: string, categoryId: string): string {
  return getLiveSearchCategoryName(providerId, categoryId) ?? derivedLiveCategoryName(categoryId);
}

export function buildPublishedLiveCategories(
  counts: Record<string, number>,
  resolveName: (categoryId: string) => string,
): ProviderLiveCategory[] {
  const normalized = normalizePublishedCategoryCounts(counts);
  const categories = Object.entries(normalized).map(([id, count], index) => {
    const name = resolveName(id);
    return {
      id,
      renderKey: `${id}::${index}`,
      name,
      rawName: name,
      count,
      icon: 'flag-outline' as const,
    };
  });
  return sortLiveCategoriesUsFirst(categories);
}

export function countPersistedLiveDirectSources(
  rows: readonly Pick<PublishedLiveCatalogRow, 'direct_source'>[],
): { fetchedRowCount: number; directSourceNonemptyInFetchedRows: number } {
  let nonempty = 0;
  for (const row of rows) {
    if (String(row.direct_source ?? '').trim()) {
      nonempty += 1;
    }
  }
  return {
    fetchedRowCount: rows.length,
    directSourceNonemptyInFetchedRows: nonempty,
  };
}

export function publishedLiveRowToChannel(
  row: PublishedLiveCatalogRow,
  index: number,
  extras: Record<string, unknown> = {},
): ProviderLiveChannel {
  const name = row.title?.trim() || `Channel ${row.channel_id}`;
  const number = row.channel_number == null ? index + 1 : asNumber(row.channel_number, index + 1);
  const categoryId = String(row.category_id ?? '').trim() || LIVE_UNKNOWN_CATEGORY_ID;
  const channel = {
    id: row.channel_id,
    categoryId,
    number,
    name,
    shortName: name.slice(0, 2).toUpperCase() || name,
    current: row.current_program?.trim() || '',
    next: 'Next program unavailable',
    following: 'Following program unavailable',
    description: 'No program information available.',
    resolution: row.stream_extension === 'm3u8' ? 'FHD' : 'HD',
    audio: 'Stereo',
    remaining: 'Live',
    progress: 0,
    tone: row.tone || '#173B67',
    currentStart: 'Now',
    currentEnd: 'Later',
    logoUrl: row.logo_url || undefined,
    containerExtension: row.stream_extension || undefined,
    streamUrl: row.direct_source?.trim() || undefined,
  };
  const storedDirectSource = String(row.direct_source ?? '').trim();
  logSampledLiveStreamRow('hydrated-playback', {
    stream_id: channel.id,
    category_id: channel.categoryId,
    ...(channel.containerExtension ? { container_extension: channel.containerExtension } : {}),
    ...(row.stream_extension ? { stream_extension: row.stream_extension } : {}),
    ...(storedDirectSource ? { direct_source: storedDirectSource, streamUrl: storedDirectSource } : {}),
  }, {
    directSourceHydrated: Boolean(storedDirectSource),
    sqliteDirectSourceColumnSelected: Object.prototype.hasOwnProperty.call(row, 'direct_source'),
    sqliteDirectSourceValuePresent: Boolean(storedDirectSource),
    ...extras,
  });
  return channel;
}
