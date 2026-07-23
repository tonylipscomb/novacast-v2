import type { MovieCategory, MovieSummary } from '../movies/movieTypes.ts';
import {
  buildContentSortPageMetadata,
  categoryHasValidRatings,
  normalizeAddedTimestamp,
  normalizeRating,
  sortAuditField,
  type ContentSortOption,
  sortContentItems,
} from '../media-browser/contentSorting.ts';
import { logContentSortAuditPayload } from '../media-browser/contentSortAudit.ts';
import type { MovieDataSource } from '../movies/data/MovieDataSource.ts';
import { MOCK_ALL_MOVIES, matchesMovie, normalizeQuery } from '../movies/movieMockData.ts';
import { MockMovieDataSource } from '../movies/data/MockMovieDataSource.ts';
import { inferGenreTags, parseAddedTimestamp, parseYearFromStreamFields } from '../movies/smart/movieMetadata.ts';
import {
  parseProviderCategoryLabel,
  stripProviderStreamTitlePrefix,
} from '../series/metadata/titleNormalization.ts';
import {
  classifyProviderCategoryType,
  fallbackProviderCategoryId,
  normalizeProviderCategory,
  normalizeProviderCategoryId,
  type ProviderCategoryType,
} from './categoryNormalization.ts';

import {
  XTREAM_MAX_ITEMS_PER_RESPONSE,
  type XtreamCategoryResponse,
  type XtreamClient,
  type XtreamLiveStreamResponse,
  type XtreamSeriesInfoResponse,
  type XtreamSeriesResponse,
  type XtreamShortEpgResponse,
  type XtreamVodInfoResponse,
  type XtreamVodStreamResponse,
} from './xtreamClient.ts';
import type { MediaDetail } from '../media-browser/mediaTypes.ts';
import { normalizeCast, normalizeStringList, normalizeTrailerUrl } from '../media-browser/mediaDetail.ts';
const POSTER_STYLE_KEYS = ['ember', 'signal', 'glacier', 'orbit', 'midnight', 'onyx', 'aurora', 'dune'] as const;

/** Xtream has no portable pagination contract; keep fallback indexing bounded. */
export const XTREAM_MAX_ITEMS_PER_CATEGORY = XTREAM_MAX_ITEMS_PER_RESPONSE;
/** In-memory cache cap for a single VOD/series category catalog used for global sorting. */
const MAX_VOD_CATEGORY_CACHE_ITEMS = 100_000;
const XTREAM_MAX_SEARCH_CATEGORIES = 100;
export const XTREAM_GUIDE_CHANNEL_PAGE_SIZE = 40;
const XTREAM_GUIDE_EPG_CONCURRENCY = 6;
export const XTREAM_GUIDE_EPG_LIMIT = 24;

export type ProviderLiveCategory = {
  id: string;
  /** Deterministic unique key for list rendering; use `id` for repository/API queries. */
  renderKey: string;
  name: string;
  /** Null means the provider has not supplied or loaded a category count yet. */
  count: number | null;
  countryCode?: string;
  regionMarker?: 'multi';
  icon:
    | 'star-outline'
    | 'history'
    | 'flag-outline'
    | 'newspaper-variant-outline'
    | 'soccer'
    | 'movie-open-outline'
    | 'baby-face-outline'
    | 'earth'
    | 'music';
};

export type ProviderLiveChannel = {
  id: string;
  categoryId: string;
  number: number;
  name: string;
  shortName: string;
  current: string;
  next: string;
  following: string;
  description: string;
  resolution: string;
  audio: string;
  remaining: string;
  progress: number;
  tone: string;
  currentStart: string;
  currentEnd: string;
  streamUrl?: string;
  logoUrl?: string;
  epgChannelId?: string;
  containerExtension?: string;
};

export type ProviderGuideProgram = {
  id: string;
  title: string;
  meta: string;
  description?: string;
  start?: string;
  end?: string;
  startAt?: number;
  endAt?: number;
  genre?: string;
  rating?: string;
};

export type ProviderGuideRow = {
  channel: ProviderLiveChannel;
  programs: ProviderGuideProgram[];
};

export type ProviderSeriesCategory = MovieCategory;

export type ProviderSeriesPoster = {
  id: string;
  title: string;
  year?: string;
  rating?: string;
  tone: string;
  seriesId: string;
  posterUrl?: string;
  addedAt?: number;
  latestEpisodeDate?: string | number;
  popularity?: number;
};

export type ProviderSearchHit =
  | (MovieSummary & { kind: 'movie' })
  | ({ kind: 'live'; id: string; title: string; subtitle: string; tone: string })
  | ({ kind: 'series'; id: string; title: string; subtitle: string; tone: string });

export interface ProviderLiveRepository {
  getCategories(signal?: AbortSignal): Promise<ProviderLiveCategory[]>;
  /** Optional full live index used to populate category counts without opening each category. */
  getCategoryCounts?(signal?: AbortSignal): Promise<Record<string, number>>;
  getChannels(categoryId: string, signal?: AbortSignal): Promise<ProviderLiveChannel[]>;
  getChannel(channelId: string, signal?: AbortSignal): Promise<ProviderLiveChannel | null>;
  getShortEpg(
    channelId: string,
    limit?: number,
    signal?: AbortSignal,
    epgChannelId?: string,
  ): Promise<ProviderGuideProgram[]>;
}

export interface ProviderSeriesRepository {
  getCategories(signal?: AbortSignal): Promise<ProviderSeriesCategory[]>;
  getSeries(categoryId: string, signal?: AbortSignal): Promise<ProviderSeriesPoster[]>;
  getSeriesInfo(seriesId: string, signal?: AbortSignal): Promise<XtreamSeriesInfoResponse | null>;
}

export interface ProviderGuideRepository {
  getRows(signal?: AbortSignal, options?: ProviderGuideQuery): Promise<ProviderGuideRow[]>;
  /** Total channel count for a category (or the whole provider when omitted), used for paging hints. */
  getChannelCount?(categoryId?: string, signal?: AbortSignal): Promise<number>;
}

export type ProviderGuideQuery = {
  /** Scopes paging to a single provider category. Omitted or `'all'` pages across every channel. */
  categoryId?: string;
  channelOffset?: number;
  channelLimit?: number;
  epgLimit?: number;
};

export interface ProviderSearchRepository {
  search(query: string, signal?: AbortSignal): Promise<ProviderSearchHit[]>;
}

export type ProviderRepositories = {
  movies: MovieDataSource;
  live: ProviderLiveRepository;
  series: ProviderSeriesRepository;
  guide: ProviderGuideRepository;
  search: ProviderSearchRepository;
  streamUrlBuilder: ProviderStreamUrlBuilder;
  mediaBaseUrl?: string;
};

export type ProviderStreamUrlBuilder = {
  buildLiveStreamUrl(streamId: string | number, extension?: string): string;
  buildVodStreamUrl(streamId: string | number, extension?: string): string;
  buildSeriesStreamUrl(streamId: string | number, extension?: string): string;
};

function toneForIndex(index: number) {
  return ['#173B67', '#4C2B5F', '#1D5B49', '#234A78', '#664477', '#6A3B2A', '#3E326B', '#28554C'][index % 8];
}

function shortNameForTitle(title: string) {
  return title
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')
    .slice(0, 2) || 'TV';
}

function toSafeNumber(value: unknown, fallback: number) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return fallback;
}

function normalizeCategoryId(value: unknown, fallback = 'all') {
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }

  return fallback;
}

/**
 * Real-world Xtream providers frequently return multiple categories sharing the
 * same `category_id` (including `0`/`"0"` used as a placeholder). `id` stays the
 * real provider category ID for repository/API queries; `renderKey` combines it
 * with its position to guarantee uniqueness for list rendering without dropping
 * any category or reordering the provider's list.
 */
function buildCategoryRenderKey(id: string, index: number) {
  return `${id}::${index}`;
}

function removeExactProviderCategoryDuplicates<T extends { id: string; name: string }>(categories: T[]) {
  const seen = new Set<string>();
  return categories.filter((category) => {
    const key = `${category.id}\u0000${category.name}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function logCategoryNormalization(
  contentType: 'live' | 'movie' | 'series',
  rawId: unknown,
  rawName: unknown,
  normalized: ReturnType<typeof normalizeProviderCategory>,
) {
  if (typeof __DEV__ === 'undefined' || !__DEV__ || (!normalized.usedFallbackName && normalized.hasProviderId)) {
    return;
  }

  console.warn('[NovaCast Category]', {
    contentType,
    rawId: typeof rawId === 'object' ? '[object]' : rawId,
    rawName: typeof rawName === 'object' ? '[object]' : rawName,
    normalizedId: normalized.id,
    normalizedName: normalized.name,
    reason: normalized.reason ?? 'missing-provider-id',
  });
}

function resolveProviderStreamCategoryId(
  value: unknown,
  contentType: 'live' | 'movie' | 'series',
  knownCategoryIds: Set<string>,
) {
  const categoryId = normalizeProviderCategoryId(value);
  return categoryId && (!knownCategoryIds.size || knownCategoryIds.has(categoryId))
    ? categoryId
    : fallbackProviderCategoryId(contentType);
}

const CATEGORY_TYPE_ICONS: Partial<Record<ProviderCategoryType, ProviderLiveCategory['icon']>> = {
  sports: 'soccer',
  news: 'newspaper-variant-outline',
  movies: 'movie-open-outline',
  kids: 'baby-face-outline',
  music: 'music',
  international: 'earth',
};

function mapXtreamCategory(category: XtreamCategoryResponse, index: number): ProviderLiveCategory {
  const normalized = normalizeProviderCategory({
    contentType: 'live',
    id: category.category_id,
    name: category.category_name,
  });
  const parsed = parseProviderCategoryLabel(normalized.name);
  logCategoryNormalization('live', category.category_id, category.category_name, normalized);
  const categoryType = classifyProviderCategoryType(parsed.title);
  return {
    id: normalized.id,
    renderKey: buildCategoryRenderKey(normalized.id, index),
    name: normalized.name,
    countryCode: parsed.countryCode,
    regionMarker: parsed.regionMarker,
    count: readXtreamCategoryCount(category),
    icon: CATEGORY_TYPE_ICONS[categoryType] ?? (index % 2 === 0 ? 'flag-outline' : 'history'),
  };
}

const XTREAM_CATEGORY_COUNT_KEYS = ['channel_count', 'stream_count', 'channels_count', 'count'] as const;

function readXtreamCategoryCount(category: XtreamCategoryResponse): number | null {
  for (const key of XTREAM_CATEGORY_COUNT_KEYS) {
    const value = category[key];
    const count = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
    if (Number.isFinite(count) && count >= 0) {
      return Math.floor(count);
    }
  }

  return null;
}

function mapXtreamSeriesPoster(
  categoryId: string,
  stream: XtreamSeriesResponse,
  index: number,
  baseUrl: string,
): ProviderSeriesPoster {
  const rawTitle = stream.name?.trim() || `Series ${index + 1}`;
  const title = stripProviderStreamTitlePrefix(rawTitle) || rawTitle;
  const yearValue = parseYearFromStreamFields(title, stream);
  const coverCandidate =
    (typeof stream.cover === 'string' ? stream.cover : undefined) ??
    (typeof stream.stream_icon === 'string' ? stream.stream_icon : undefined);

  return {
    id: String(stream.series_id ?? `${categoryId}-${index}`),
    seriesId: String(stream.series_id ?? `${categoryId}-${index}`),
    title,
    year: yearValue ? String(yearValue) : undefined,
    rating: typeof stream.rating === 'number' ? String(stream.rating) : typeof stream.rating === 'string' ? stream.rating : undefined,
    tone: toneForIndex(index),
    posterUrl: resolveMediaUrl(baseUrl, coverCandidate),
    addedAt: normalizeAddedTimestamp(stream.added),
    latestEpisodeDate: stream.last_modified ?? stream.releasedate ?? stream.added,
    popularity: normalizeRating(stream.popularity) || undefined,
  };
}

function decodeXtreamEpgTitle(raw?: string) {
  const trimmed = raw?.trim();
  if (!trimmed) {
    return '';
  }

  if (/^[A-Za-z0-9+/=]+$/.test(trimmed) && trimmed.length % 4 === 0) {
    try {
      const decoded = globalThis.atob(trimmed);
      if (decoded && !/[\u0000-\u0008\u000e-\u001f]/.test(decoded)) {
        return decoded.trim();
      }
    } catch {
      // Fall back to the raw title when Xtream did not base64-encode it.
    }
  }

  return trimmed;
}

function decodeXtreamEpgDescription(raw?: string) {
  const decoded = decodeXtreamEpgTitle(raw);
  if (!decoded) {
    return undefined;
  }

  const cleaned = decoded
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();

  return cleaned || undefined;
}

function mapXtreamEpg(response: XtreamShortEpgResponse | null | undefined) {
  const listings = [...(response?.epg_listings ?? [])].sort((left, right) => {
    const leftNow = Number(left.now_playing ?? 0);
    const rightNow = Number(right.now_playing ?? 0);
    return rightNow - leftNow;
  });

  return listings.map((item, index) => {
    const rawTitle = decodeXtreamEpgTitle(item.title) || `Program ${index + 1}`;
    const title = stripProviderStreamTitlePrefix(rawTitle) || rawTitle;
    const startAt = Number(item.start_timestamp) > 0 ? Number(item.start_timestamp) * 1000 : Date.parse(String(item.start ?? ''));
    const endAt = Number(item.stop_timestamp) > 0 ? Number(item.stop_timestamp) * 1000 : Date.parse(String(item.end ?? ''));
    const start = item.start ? String(item.start) : item.start_timestamp ? new Date(Number(item.start_timestamp) * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
    const end = item.end ? String(item.end) : item.stop_timestamp ? new Date(Number(item.stop_timestamp) * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';

    return {
      id: String(item.id ?? index),
      title,
      meta: start && end ? `${start} - ${end}` : start || end || 'Now playing',
      description: decodeXtreamEpgDescription(item.description),
      start,
      end,
      startAt: Number.isFinite(startAt) ? startAt : undefined,
      endAt: Number.isFinite(endAt) ? endAt : undefined,
    } satisfies ProviderGuideProgram;
  });
}

type ShortEpgFetchResult = {
  programs: ProviderGuideProgram[];
  usedEpgChannelIdFallback: boolean;
  primaryRawCount: number;
  primaryMappedCount: number;
  fallbackAttempted: boolean;
  fallbackRawCount: number;
};

/**
 * Xtream providers commonly key EPG data by `epg_channel_id` rather than the
 * raw `stream_id`. This tries the mapped EPG channel id first (when present)
 * and falls back to the stream id when the primary lookup returns nothing, so
 * a channel is never marked "no EPG" just because it was queried by the wrong
 * id. Shared by `live.getShortEpg` and `guide.getRows` so bulk Guide EPG
 * fetches benefit from the same match strategy as the Live TV screen.
 */
async function fetchShortEpgWithFallback(
  client: XtreamClient,
  channelId: string,
  epgChannelId: string | undefined,
  limit: number,
  signal?: AbortSignal,
): Promise<ShortEpgFetchResult> {
  const primaryId = epgChannelId?.trim() || channelId;
  const primaryResponse = await client.getShortEpg(primaryId, limit, signal).catch(() => null);
  const primaryMapped = mapXtreamEpg(primaryResponse);
  const primaryRawCount = primaryResponse?.epg_listings?.length ?? 0;
  const usedEpgChannelIdFallback = primaryId !== channelId;

  if (primaryMapped.length || !usedEpgChannelIdFallback) {
    return {
      programs: primaryMapped.slice(0, limit),
      usedEpgChannelIdFallback,
      primaryRawCount,
      primaryMappedCount: primaryMapped.length,
      fallbackAttempted: false,
      fallbackRawCount: 0,
    };
  }

  const fallbackResponse = await client.getShortEpg(channelId, limit, signal).catch(() => null);
  const fallbackMapped = mapXtreamEpg(fallbackResponse);

  return {
    programs: fallbackMapped.slice(0, limit),
    usedEpgChannelIdFallback,
    primaryRawCount,
    primaryMappedCount: primaryMapped.length,
    fallbackAttempted: true,
    fallbackRawCount: fallbackResponse?.epg_listings?.length ?? 0,
  };
}

/**
 * Dev-only audit trail for the EPG-matching bug: logs enough context to
 * confirm whether a channel's EPG was found via `epg_channel_id`, via the raw
 * stream id fallback, or not at all. Never logs provider URLs/credentials.
 */
function logGuideEpgAudit(entry: {
  streamId: string;
  epgChannelId?: string;
  channelName: string;
  categoryId: string;
  rawRowCount: number;
  normalizedRowCount: number;
  usedEpgChannelIdFallback: boolean;
  fallbackAttempted: boolean;
  missingWindowCount: number;
}) {
  if (typeof __DEV__ === 'undefined' || !__DEV__) {
    return;
  }

  console.log('[NovaCast GuideEpgAudit]', entry);
}

/**
 * Bounded-concurrency EPG fetch for an already-resolved channel list, shared
 * by category-scoped Guide paging and Favorites (which builds its channel
 * list from personalization data outside the provider's category system).
 */
export async function fetchGuideRowsForChannels(
  live: Pick<ProviderLiveRepository, 'getShortEpg'>,
  channels: ProviderLiveChannel[],
  epgLimit: number,
  signal?: AbortSignal,
): Promise<ProviderGuideRow[]> {
  const epgByChannel = new Map<string, ProviderGuideProgram[]>();
  let nextChannelIndex = 0;
  const workerCount = Math.min(XTREAM_GUIDE_EPG_CONCURRENCY, channels.length);

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextChannelIndex < channels.length) {
        const channel = channels[nextChannelIndex++];
        if (signal?.aborted) return;
        const programs = await live.getShortEpg(channel.id, epgLimit, signal, channel.epgChannelId).catch(() => []);
        epgByChannel.set(channel.id, programs);
      }
    }),
  );

  return mapGuideRowsFromChannels(channels, epgByChannel);
}

function buildMockLiveCategories(): ProviderLiveCategory[] {
  return (
    [
      { id: 'favorites', name: 'Favorites', count: 12, icon: 'star-outline' },
      { id: 'recent', name: 'Recent', count: 18, icon: 'history' },
      { id: 'entertainment', name: 'USA Entertainment', count: 214, icon: 'flag-outline' },
      { id: 'news', name: 'USA News', count: 100, icon: 'newspaper-variant-outline' },
      { id: 'sports', name: 'USA Sports', count: 132, icon: 'soccer' },
      { id: 'movies', name: 'Movie Channels', count: 74, icon: 'movie-open-outline' },
      { id: 'kids', name: 'Kids & Family', count: 64, icon: 'baby-face-outline' },
      { id: 'international', name: 'International', count: 302, icon: 'earth' },
    ] satisfies Omit<ProviderLiveCategory, 'renderKey'>[]
  ).map((category) => ({ ...category, renderKey: category.id }));
}

function buildMockLiveChannels(categoryId: string): ProviderLiveChannel[] {
  const base = [
    {
      id: 'nova-one',
      number: 101,
      name: 'Nova One',
      current: 'Signal Ridge',
      currentStart: '8:00 PM',
      currentEnd: '8:30 PM',
      next: 'City After Dark',
      following: 'Morning Line',
      description: 'A team of explorers follows a mysterious transmission through the northern wilderness.',
      resolution: 'FHD',
      audio: '5.1',
      remaining: '27 min',
      progress: 61,
      tone: '#173B67',
    },
    {
      id: 'metro-eight',
      number: 108,
      name: 'Metro Eight',
      current: 'The Fifth Case',
      currentStart: '8:00 PM',
      currentEnd: '8:45 PM',
      next: 'Midnight District',
      following: 'Open File',
      description: 'Detective Mara Cole reopens a case everyone else believed was solved.',
      resolution: 'HD',
      audio: 'Stereo',
      remaining: '41 min',
      progress: 44,
      tone: '#4C2B5F',
    },
    {
      id: 'arena',
      number: 214,
      name: 'Arena Sports',
      current: 'Championship Live',
      currentStart: '7:30 PM',
      currentEnd: '9:00 PM',
      next: 'Postgame Desk',
      following: 'Road to the Finals',
      description: 'Live coverage from the season championship with analysis and instant replay.',
      resolution: 'FHD',
      audio: '5.1',
      remaining: '1 hr 12',
      progress: 33,
      tone: '#1D5B49',
    },
    {
      id: 'nova-news',
      number: 302,
      name: 'Nova News',
      current: 'Evening Report',
      currentStart: '8:00 PM',
      currentEnd: '8:30 PM',
      next: 'World Brief',
      following: 'Night Desk',
      description: 'A concise look at the stories shaping the day, with context and live updates.',
      resolution: 'HD',
      audio: 'Stereo',
      remaining: '18 min',
      progress: 72,
      tone: '#234A78',
    },
    {
      id: 'bright-family',
      number: 415,
      name: 'Bright Family',
      current: 'Weekend Workshop',
      currentStart: '8:00 PM',
      currentEnd: '8:30 PM',
      next: 'Kitchen Crew',
      following: 'Family Challenge',
      description: 'Families build, cook, and compete in a cheerful weekend challenge.',
      resolution: 'HD',
      audio: 'Stereo',
      remaining: '24 min',
      progress: 58,
      tone: '#664477',
    },
    {
      id: 'cinema-nova',
      number: 518,
      name: 'Cinema Nova',
      current: 'Beyond Horizon',
      currentStart: '8:15 PM',
      currentEnd: '10:15 PM',
      next: 'Night Transit',
      following: 'The Long Return',
      description: 'A pilot discovers a forgotten settlement beyond the edge of mapped space.',
      resolution: '4K',
      audio: 'Atmos',
      remaining: '56 min',
      progress: 39,
      tone: '#6A3B2A',
    },
    {
      id: 'pulse',
      number: 620,
      name: 'Pulse Music',
      current: 'Studio Sessions',
      currentStart: '8:00 PM',
      currentEnd: '8:30 PM',
      next: 'Live Room',
      following: 'After Hours Mix',
      description: 'Independent artists perform stripped-down sets from the NovaCast studio.',
      resolution: 'FHD',
      audio: '5.1',
      remaining: '32 min',
      progress: 49,
      tone: '#3E326B',
    },
    {
      id: 'discovery',
      number: 731,
      name: 'Discovery North',
      current: 'Wild Frontiers',
      currentStart: '8:30 PM',
      currentEnd: '9:30 PM',
      next: 'Deep Current',
      following: 'Earth at Night',
      description: 'Cameras follow wildlife across remote landscapes untouched by modern cities.',
      resolution: '4K',
      audio: '5.1',
      remaining: '38 min',
      progress: 55,
      tone: '#28554C',
    },
  ];

  return base.map((channel, index) => ({
    ...channel,
    id: `${categoryId}-${channel.id}`,
    categoryId,
    shortName: shortNameForTitle(channel.name),
    streamUrl: `novacast://${categoryId}/${channel.id}`,
    epgChannelId: channel.id,
    number: channel.number + (categoryId === 'sports' ? 700 : categoryId === 'news' ? 300 : 0),
    name:
      categoryId === 'sports'
        ? ['Arena Sports', 'Field Network', 'Court One', 'Fight Night', 'Racing Central', 'Goal Zone', 'College Live', 'Sports Desk'][index]
        : categoryId === 'news'
          ? ['Nova News', 'Metro News', 'World Desk', 'Capital Report', 'Weather Now', 'Market Live', 'Public Square', 'Late Edition'][index]
          : channel.name,
  }));
}

function buildMockGuideRowsForChannels(channels: ProviderLiveChannel[]) {
  return channels.map((channel) => ({
    channel,
    programs: Array.from({ length: 6 }, (_, programIndex) => ({
      id: `${channel.id}-${programIndex}`,
      title:
        programIndex === 0
          ? channel.current
          : programIndex === 1
            ? channel.next
            : programIndex === 2
              ? channel.following
              : `${channel.name} Extra ${programIndex + 1}`,
      meta: programIndex === 0 ? `${channel.currentStart} - ${channel.currentEnd}` : `${8 + programIndex}:00 PM`,
      description: channel.description,
    })),
  }));
}

function buildMockSeriesCategories(): ProviderSeriesCategory[] {
  return (
    [
      { id: 'new', name: 'New Episodes', count: 198 },
      { id: 'popular', name: 'Popular Series', count: 764 },
      { id: 'netflix', name: 'Netflix Series', count: 542 },
      { id: 'crime', name: 'Crime & Mystery', count: 312 },
      { id: 'family', name: 'Family Series', count: 226 },
      { id: 'international', name: 'International', count: 1048 },
    ] satisfies Omit<ProviderSeriesCategory, 'renderKey'>[]
  ).map((category) => ({ ...category, renderKey: category.id }));
}

function buildMockSeriesPosters(kind: string, categoryId: string): ProviderSeriesPoster[] {
  const titles = [
    'Orbital Line', 'Quiet Harbor', 'Night Transit', 'Signal Ridge', 'The Fifth Case', 'Beyond Horizon',
    'Glass City', 'Echo Division', 'Northern Lights', 'After Midnight', 'Hidden Current', 'Open Water',
    'Last Meridian', 'Blue Static', 'The Long Return', 'Metro Zero', 'Parallel Roads', 'High Country',
  ];

  return Array.from({ length: 30 }, (_, index) => ({
    id: `${kind}-${categoryId}-${index}`,
    seriesId: `${kind}-${categoryId}-${index}`,
    title: `${titles[index % titles.length]}${kind === 'series' && index % 4 === 0 ? ' Files' : ''}`,
    year: String(2016 + (index % 10)),
    rating: (7.1 + ((index * 3) % 20) / 10).toFixed(1),
    tone: toneForIndex(index),
  }));
}

function buildMockSearchHits(query: string): ProviderSearchHit[] {
  const normalized = normalizeQuery(query);
  if (!normalized) {
    return [];
  }

  const movieHits = MOCK_ALL_MOVIES.filter((movie) => matchesMovie(movie, normalized)).slice(0, 8).map((movie) => ({
    ...movie,
    kind: 'movie' as const,
  }));
  const liveHits = buildMockLiveChannels('search')
    .filter((channel) => channel.name.toLowerCase().includes(normalized) || channel.current.toLowerCase().includes(normalized))
    .slice(0, 4)
    .map((channel) => ({
      kind: 'live' as const,
      id: channel.id,
      title: channel.name,
      subtitle: channel.current,
      tone: channel.tone,
    }));
  const seriesHits = buildMockSeriesPosters('series', 'search')
    .filter((item) => item.title.toLowerCase().includes(normalized))
    .slice(0, 4)
    .map((item) => ({
      kind: 'series' as const,
      id: item.id,
      title: item.title,
      subtitle: `${item.year} · ${item.rating}`,
      tone: item.tone,
    }));

  return [...movieHits, ...liveHits, ...seriesHits];
}

export function createMockProviderRepositories(providerId: string): ProviderRepositories {
  const movieSource = new MockMovieDataSource(providerId);

  return {
    movies: movieSource,
    live: {
      async getCategories() {
        return buildMockLiveCategories();
      },
      async getChannels(categoryId: string) {
        return buildMockLiveChannels(categoryId);
      },
      async getChannel(channelId: string) {
        return buildMockLiveChannels('detail').find((channel) => channel.id === channelId) ?? null;
      },
      async getShortEpg(channelId: string) {
        const channel = buildMockLiveChannels('detail').find((item) => item.id === channelId) ?? null;
        if (!channel) {
          return [];
        }

        return [
          {
            id: `${channel.id}-now`,
            title: channel.current,
            meta: `${channel.currentStart} - ${channel.currentEnd}`,
            description: channel.description,
            start: channel.currentStart,
            end: channel.currentEnd,
          },
          {
            id: `${channel.id}-next`,
            title: channel.next,
            meta: 'Next up',
            description: channel.description,
          },
          {
            id: `${channel.id}-following`,
            title: channel.following,
            meta: 'Following',
            description: channel.description,
          },
        ];
      },
    },
    series: {
      async getCategories() {
        return buildMockSeriesCategories();
      },
      async getSeries(categoryId: string) {
        return buildMockSeriesPosters('series', categoryId);
      },
      async getSeriesInfo(seriesId: string) {
        return {
          info: { series_id: seriesId, name: seriesId, plot: 'Mock series details.' },
          seasons: [],
          episodes: {},
        };
      },
    },
    guide: {
      async getRows(_signal, options) {
        const categoryId = options?.categoryId;
        if (categoryId && categoryId !== 'all' && categoryId !== 'favorites') {
          return buildMockGuideRowsForChannels(buildMockLiveChannels(categoryId));
        }
        return buildMockGuideRowsForChannels(buildMockLiveChannels('guide'));
      },
      async getChannelCount(categoryId) {
        if (categoryId && categoryId !== 'all' && categoryId !== 'favorites') {
          return buildMockLiveChannels(categoryId).length;
        }
        return buildMockLiveChannels('guide').length;
      },
    },
    search: {
      async search(query: string) {
        return buildMockSearchHits(query);
      },
    },
    streamUrlBuilder: {
      buildLiveStreamUrl(streamId: string | number, extension = 'ts') {
        return `novacast://${providerId}/live/${streamId}.${extension}`;
      },
      buildVodStreamUrl(streamId: string | number, extension = 'mp4') {
        return `novacast://${providerId}/movie/${streamId}.${extension}`;
      },
      buildSeriesStreamUrl(streamId: string | number, extension = 'ts') {
        return `novacast://${providerId}/series/${streamId}.${extension}`;
      },
    },
  };
}

function mapLiveStream(stream: XtreamLiveStreamResponse, index: number, categoryId: string): ProviderLiveChannel {
  const rawName = stream.name?.trim() || `Channel ${index + 1}`;
  const name = stripProviderStreamTitlePrefix(rawName) || rawName;
  const number = toSafeNumber(stream.num ?? stream.stream_id, index + 1);
  const channelId = String(stream.stream_id ?? `${categoryId}-${index}`);
  const shortName = shortNameForTitle(name);

  return {
    id: channelId,
    categoryId,
    number,
    name,
    shortName,
    current: name,
    next: 'Next program unavailable',
    following: 'Following program unavailable',
    description: 'No program information available.',
    resolution: stream.container_extension === 'm3u8' ? 'FHD' : 'HD',
    audio: 'Stereo',
    remaining: 'Live',
    progress: 0,
    tone: toneForIndex(index),
    currentStart: 'Now',
    currentEnd: 'Later',
    streamUrl: stream.direct_source?.trim() || undefined,
    logoUrl: stream.stream_icon?.trim() || undefined,
    epgChannelId: stream.epg_channel_id?.trim() || undefined,
    containerExtension: stream.container_extension?.trim() || undefined,
  };
}

export function resolveMediaUrl(baseUrl: string, raw?: string | null): string | undefined {
  const value = raw?.trim();
  if (!value) {
    return undefined;
  }

  if (/^https?:\/\//i.test(value)) {
    return value;
  }

  if (value.startsWith('//')) {
    return `https:${value}`;
  }

  try {
    const origin = new URL(baseUrl).origin;
    return value.startsWith('/') ? `${origin}${value}` : `${origin}/${value.replace(/^\/+/, '')}`;
  } catch {
    return undefined;
  }
}

function pickVodPosterUrl(stream: XtreamVodStreamResponse, baseUrl: string): string | undefined {
  const candidates = [
    stream.stream_icon,
    typeof stream.cover === 'string' ? stream.cover : undefined,
    typeof stream.movie_image === 'string' ? stream.movie_image : undefined,
    typeof stream.poster === 'string' ? stream.poster : undefined,
  ];

  for (const candidate of candidates) {
    const resolved = resolveMediaUrl(baseUrl, candidate);
    if (resolved) {
      return resolved;
    }
  }

  return undefined;
}

function mapVodStream(
  stream: XtreamVodStreamResponse,
  index: number,
  categoryId: string,
  baseUrl: string,
): MovieSummary {
  const rawTitle = stream.name?.trim() || `Movie ${index + 1}`;
  const title = stripProviderStreamTitlePrefix(rawTitle) || rawTitle;
  const year = parseYearFromStreamFields(title, stream);
  const addedAt = parseAddedTimestamp(stream.added);
  const rating =
    typeof stream.rating === 'number' ? `${stream.rating}` : typeof stream.rating === 'string' ? stream.rating : undefined;
  const genres = inferGenreTags(title, [categoryId.replace(/-/g, ' ') || 'Movies']);

  return {
    id: String(stream.stream_id ?? `${categoryId}-${index}`),
    categoryId,
    title,
    addedAt: addedAt || undefined,
    releaseDate: stream.releasedate,
    popularity: normalizeRating(stream.popularity) || undefined,
    year,
    durationMinutes: undefined,
    rating,
    genres: genres.length ? genres : [categoryId.replace(/-/g, ' ') || 'Movies'],
    description: undefined,
    director: undefined,
    cast: undefined,
    audio: undefined,
    subtitles: undefined,
    score: undefined,
    audienceScore: undefined,
    externalScore: undefined,
    posterStyleKey: POSTER_STYLE_KEYS[index % POSTER_STYLE_KEYS.length],
    posterUrl: pickVodPosterUrl(stream, baseUrl),
    containerExtension: stream.container_extension?.trim() || undefined,
  };
}

function readText(fields: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = fields[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }

    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value);
    }
  }

  return undefined;
}

function readNumber(fields: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = fields[key];
    const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return undefined;
}

function formatVodRuntime(fields: Record<string, unknown>) {
  const seconds = readNumber(fields, 'duration_secs', 'durationSeconds');
  if (seconds && seconds > 0) {
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    return hours > 0 ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
  }

  const duration = readText(fields, 'duration');
  if (!duration) {
    return undefined;
  }

  return /^\d{1,2}:\d{2}/.test(duration) ? duration : undefined;
}

function firstBackdropValue(value: unknown) {
  if (Array.isArray(value)) {
    return value.find((item): item is string => typeof item === 'string' && Boolean(item.trim()));
  }

  return typeof value === 'string' ? value : undefined;
}

function mapVodInfo(movieId: string, response: XtreamVodInfoResponse | null, baseUrl: string): MediaDetail | null {
  if (!response) {
    return null;
  }

  const fields: Record<string, unknown> = {
    ...(response.movie_data ?? {}),
    ...(response.info ?? {}),
  };
  const title = readText(fields, 'name', 'title') || `Movie ${movieId}`;
  const posterUrl = resolveMediaUrl(
    baseUrl,
    readText(fields, 'movie_image', 'cover_big', 'cover', 'stream_icon', 'poster'),
  );
  const backdropUrl = resolveMediaUrl(baseUrl, firstBackdropValue(fields.backdrop_path) ?? readText(fields, 'backdrop'));
  const rating = readNumber(fields, 'rating_5based', 'rating');
  const releaseDate = readText(fields, 'releaseDate', 'releasedate', 'release_date');
  const yearMatch = releaseDate?.match(/\b(19|20)\d{2}\b/) ?? title.match(/\b(19|20)\d{2}\b/);

  return {
    id: movieId,
    mediaType: 'movie',
    title: stripProviderStreamTitlePrefix(title) || title,
    posterUrl,
    backdropUrl,
    synopsis: readText(fields, 'plot', 'description', 'overview'),
    year: yearMatch?.[0],
    releaseDate,
    runtime: formatVodRuntime(fields),
    genres: normalizeStringList(fields.genre),
    cast: normalizeCast(fields.cast),
    director: readText(fields, 'director', 'movie_director'),
    writer: readText(fields, 'writer', 'writers'),
    studio: readText(fields, 'studio', 'production_company'),
    country: readText(fields, 'country', 'country_code'),
    audio: readText(fields, 'audio', 'audio_channels', 'audio_codec'),
    subtitles: readText(fields, 'subtitles', 'subtitle_languages'),
    rating: rating && rating > 0 ? rating : undefined,
    ratingSource: rating && rating > 0 ? 'Provider' : undefined,
    contentRating: readText(fields, 'content_rating', 'mpaa', 'age_rating'),
    trailerUrl: normalizeTrailerUrl(fields.youtube_trailer),
    seasons: [],
    episodes: [],
  };
}

function mapSeriesPoster(stream: XtreamSeriesResponse, index: number, categoryId: string, baseUrl: string): ProviderSeriesPoster {
  return mapXtreamSeriesPoster(categoryId, stream, index, baseUrl);
}

function mapGuideRowsFromChannels(channels: ProviderLiveChannel[], epgByChannel: Map<string, ProviderGuideProgram[]>) {
  return channels.map((channel) => {
    const programs = epgByChannel.get(channel.id) ?? [];

    return { channel, programs };
  });
}

function bindStreamUrlBuilder(
  client: XtreamClient,
  method: 'buildLiveStreamUrl' | 'buildVodStreamUrl' | 'buildSeriesStreamUrl',
  fallbackPrefix: 'live' | 'movie' | 'series',
) {
  const candidate = client[method];

  if (typeof candidate === 'function') {
    return candidate.bind(client);
  }

  return (streamId: string | number, extension = fallbackPrefix === 'movie' ? 'mp4' : 'ts') =>
    `novacast://xtream/${fallbackPrefix}/${streamId}.${extension}`;
}

export function createXtreamProviderRepositories(client: XtreamClient): ProviderRepositories {
  const vodStreamCache = new Map<string, XtreamVodStreamResponse[]>();
  const categoryCountCache = new Map<string, number>();
  const vodCategoryIds = new Set<string>();
  const seriesCategoryIds = new Set<string>();
  const liveCategoryCountCache = new Map<string, number>();
  const liveCategoryIds = new Set<string>();
  let liveCategoryCountsLoaded = false;

  /**
   * Resolves the live streams belonging to a single normalized category,
   * shared by `live.getChannels`, `guide.getRows`, and `guide.getChannelCount`
   * so category-scoped Guide paging uses the exact same channel-filtering
   * logic as the Live TV screen (no parallel category parser).
   */
  async function resolveLiveCategoryStreams(categoryId: string | undefined, signal?: AbortSignal) {
    if (!categoryId || categoryId === 'all') {
      return client.getLiveStreams(undefined, signal);
    }

    const serverSideCategoryId = categoryId === fallbackProviderCategoryId('live') ? undefined : categoryId;
    const allStreams = await client.getLiveStreams(serverSideCategoryId, signal);
    return allStreams.filter(
      (stream) => resolveProviderStreamCategoryId(stream.category_id, 'live', liveCategoryIds) === categoryId,
    );
  }

  function categoryCount(categoryId: string) {
    return categoryCountCache.get(categoryId) ?? vodStreamCache.get(categoryId)?.length ?? null;
  }

  function mapVodCategories(categories: XtreamCategoryResponse[]): MovieCategory[] {
    return removeExactProviderCategoryDuplicates(categories.map((category, index) => {
      const normalized = normalizeProviderCategory({
        contentType: 'movie',
        id: category.category_id,
        name: category.category_name,
      });
      if (normalized.hasProviderId) {
        vodCategoryIds.add(normalized.id);
      }
      const parsed = parseProviderCategoryLabel(normalized.name);
      const providerCount = readXtreamCategoryCount(category);
      if (providerCount !== null) {
        categoryCountCache.set(normalized.id, providerCount);
      }
      logCategoryNormalization('movie', category.category_id, category.category_name, normalized);
      return {
        id: normalized.id,
        renderKey: buildCategoryRenderKey(normalized.id, index),
        name: normalized.name,
        countryCode: parsed.countryCode,
        regionMarker: parsed.regionMarker,
        count: providerCount ?? categoryCount(normalized.id) ?? 0,
        countKnown: providerCount !== null || categoryCountCache.has(normalized.id),
      };
    }));
  }

  async function fetchCategoryCount(resolvedId: string, options: { cacheStreams?: boolean } = {}): Promise<number> {
    if (categoryCountCache.has(resolvedId)) {
      return categoryCountCache.get(resolvedId)!;
    }

    const allStreams = resolvedId === fallbackProviderCategoryId('movie')
      ? await client.getVodStreams(undefined).catch(() => [])
      : await client.getVodStreams(resolvedId).catch(() => []);
    const streams = allStreams.filter(
      (stream) => resolveProviderStreamCategoryId(stream.category_id, 'movie', vodCategoryIds) === resolvedId,
    );
    categoryCountCache.set(resolvedId, streams.length);
    if (options.cacheStreams !== false && streams.length <= MAX_VOD_CATEGORY_CACHE_ITEMS) {
      vodStreamCache.set(resolvedId, streams);
    }

    return streams.length;
  }

  async function resolveMoviesCategoryId(categoryId: string): Promise<string | null> {
    if (categoryId && categoryId !== 'all') {
      return categoryId;
    }

    const categories = await client.getVodCategories();
    const first = categories[0];
    if (!first) {
      return null;
    }

    return normalizeCategoryId(first.category_id, 'vod-1');
  }

  async function loadVodStreamsForCategory(categoryId: string): Promise<XtreamVodStreamResponse[]> {
    const resolvedId = await resolveMoviesCategoryId(categoryId);
    if (!resolvedId) {
      return [];
    }

    const cached = vodStreamCache.get(resolvedId);
    if (cached) {
      return cached;
    }

    const allStreams = resolvedId === fallbackProviderCategoryId('movie')
      ? await client.getVodStreams(undefined)
      : await client.getVodStreams(resolvedId);
    const streams = allStreams.filter(
      (stream) => resolveProviderStreamCategoryId(stream.category_id, 'movie', vodCategoryIds) === resolvedId,
    );
    categoryCountCache.set(resolvedId, streams.length);
    if (streams.length <= MAX_VOD_CATEGORY_CACHE_ITEMS) {
      vodStreamCache.set(resolvedId, streams);
    }
    return streams;
  }

  const movies: MovieDataSource = {
    async getCategories() {
      const categories = await client.getVodCategories();
      vodCategoryIds.clear();
      return mapVodCategories(categories);
    },
    async getMovieInfo(movieId: string) {
      return mapVodInfo(movieId, await client.getVodInfo(movieId).catch(() => null), client.baseUrl);
    },
    async getCategoryCount(categoryId: string) {
      if (!categoryId || categoryId === 'all') {
        return 0;
      }

      return fetchCategoryCount(categoryId, { cacheStreams: false });
    },
    async prefetchAllCategoryCounts(categoryIds, onCategoryCount) {
      const uniqueIds = [...new Set(categoryIds.filter(Boolean))];

      for (const categoryId of uniqueIds) {
        if (categoryCountCache.has(categoryId) || vodStreamCache.has(categoryId)) {
          onCategoryCount(categoryId, categoryCount(categoryId) ?? 0);
          continue;
        }

        const count = await fetchCategoryCount(categoryId, { cacheStreams: false });
        onCategoryCount(categoryId, count);
      }
    },
    async getMoviesPage({ categoryId, offset, limit, sort = 'newest' }: { categoryId: string; offset: number; limit: number; sort?: ContentSortOption }) {
      const resolvedId = await resolveMoviesCategoryId(categoryId);
      if (!resolvedId) {
        return { items: [], totalCount: 0, hasMore: false };
      }

      const streams = await loadVodStreamsForCategory(resolvedId);
      const knownCategoryTotal = categoryCountCache.get(resolvedId) ?? streams.length;
      const itemsConsideredForSort = streams.length;
      const start = Math.max(0, offset);
      const end = Math.min(itemsConsideredForSort, start + limit);
      const mapped = streams.map((stream, index) => mapVodStream(stream, index, resolvedId, client.baseUrl));
      const sorted = sortContentItems(mapped, sort, 'movie');
      logContentSortAuditPayload({
        providerId: 'xtream',
        section: 'movie',
        categoryId,
        sort,
        knownCategoryTotal,
        itemsConsideredForSort,
        offset: start,
        pageSize: limit,
        requestGeneration: 0,
        sortComplete: knownCategoryTotal === itemsConsideredForSort,
        sample: sorted.slice(0, 5).map((item) => ({
          id: item.id,
          title: item.title,
          orderField: sortAuditField(item, sort, 'movie'),
        })),
      });
      const items = sorted.slice(start, end);
      return {
        items,
        totalCount: knownCategoryTotal,
        hasMore: end < knownCategoryTotal,
        ...buildContentSortPageMetadata(knownCategoryTotal, itemsConsideredForSort, categoryHasValidRatings(mapped)),
      };
    },
    async searchMovies({ query, offset, limit }) {
      const normalized = normalizeQuery(query);
      if (!normalized) {
        return { items: [], totalCount: 0, hasMore: false };
      }

      const categories = await client.getVodCategories();
      const matches: MovieSummary[] = [];

      for (const category of categories) {
        const categoryId = normalizeCategoryId(category.category_id, fallbackProviderCategoryId('movie'));
        const streams = await loadVodStreamsForCategory(categoryId);
        streams.forEach((stream, index) => {
          const movie = mapVodStream(stream, index, categoryId, client.baseUrl);
          if (matchesMovie(movie, normalized)) {
            matches.push(movie);
          }
        });

        if (matches.length >= offset + limit) {
          break;
        }
      }

      const start = Math.max(0, offset);
      const end = Math.max(start, start + limit);
      return {
        items: matches.slice(start, end),
        totalCount: matches.length,
        hasMore: end < matches.length,
      };
    },
    async listCategoryMovies(categoryId: string) {
      const resolvedId = await resolveMoviesCategoryId(categoryId);
      if (!resolvedId) {
        return [];
      }

      const streams = await loadVodStreamsForCategory(resolvedId);
      return streams.map((stream, index) => mapVodStream(stream, index, resolvedId, client.baseUrl));
    },
  };

  const liveRepository: ProviderLiveRepository = {
    async getCategories(signal) {
      const categories = await client.getLiveCategories(signal);
      const mappedCategories = removeExactProviderCategoryDuplicates(categories.map(mapXtreamCategory));
      liveCategoryIds.clear();
      mappedCategories.forEach((category) => liveCategoryIds.add(category.id));
      return mappedCategories;
    },
    async getCategoryCounts(signal) {
      if (liveCategoryCountsLoaded) {
        return Object.fromEntries(liveCategoryCountCache);
      }

      const streams = await client.getLiveStreams(undefined, signal);
      liveCategoryCountCache.clear();
      liveCategoryIds.forEach((categoryId) => liveCategoryCountCache.set(categoryId, 0));
      for (const stream of streams) {
        const categoryId = resolveProviderStreamCategoryId(stream.category_id, 'live', liveCategoryIds);
        liveCategoryCountCache.set(categoryId, (liveCategoryCountCache.get(categoryId) ?? 0) + 1);
      }
      liveCategoryCountsLoaded = true;
      return Object.fromEntries(liveCategoryCountCache);
    },
    async getChannels(categoryId: string, signal) {
      const streams = await resolveLiveCategoryStreams(categoryId, signal);
      return streams
        .slice(0, XTREAM_MAX_ITEMS_PER_CATEGORY)
        .map((stream, index) => mapLiveStream(stream, index, resolveProviderStreamCategoryId(stream.category_id, 'live', liveCategoryIds)));
    },
    async getChannel(channelId: string, signal) {
      const streams = await client.getLiveStreams(undefined, signal);
      const stream = streams.slice(0, XTREAM_MAX_ITEMS_PER_CATEGORY).find((item) => String(item.stream_id) === channelId) ?? null;
      return stream
        ? mapLiveStream(stream, 0, resolveProviderStreamCategoryId(stream.category_id, 'live', liveCategoryIds))
        : null;
    },
    async getShortEpg(channelId: string, limit = 3, signal, epgChannelId?: string) {
      const result = await fetchShortEpgWithFallback(client, channelId, epgChannelId, limit, signal);
      return result.programs;
    },
  };

  return {
    movies,
    live: liveRepository,
    series: {
      async getCategories(signal) {
        const categories = await client.getSeriesCategories(signal);
        seriesCategoryIds.clear();
        return removeExactProviderCategoryDuplicates(categories.map((category, index) => {
          const normalized = normalizeProviderCategory({
            contentType: 'series',
            id: category.category_id,
            name: category.category_name,
          });
          if (normalized.hasProviderId) {
            seriesCategoryIds.add(normalized.id);
          }
          const parsed = parseProviderCategoryLabel(normalized.name);
          const providerCount = readXtreamCategoryCount(category);
          logCategoryNormalization('series', category.category_id, category.category_name, normalized);
          return {
            id: normalized.id,
            renderKey: buildCategoryRenderKey(normalized.id, index),
            name: normalized.name,
            countryCode: parsed.countryCode,
            regionMarker: parsed.regionMarker,
            count: providerCount ?? 0,
            countKnown: providerCount !== null,
          };
        }));
      },
      async getSeries(categoryId: string, signal) {
        const allStreams = await client.getSeries(
          categoryId === 'all' || categoryId === fallbackProviderCategoryId('series') ? undefined : categoryId,
          signal,
        );
        const streams = allStreams.filter(
          (stream) => resolveProviderStreamCategoryId(stream.category_id, 'series', seriesCategoryIds) === categoryId,
        );
        return streams.map((stream, index) => mapSeriesPoster(stream, index, categoryId, client.baseUrl));
      },
      async getSeriesInfo(seriesId: string, signal) {
        return client.getSeriesInfo(seriesId, signal).catch(() => null);
      },
    },
    guide: {
      async getRows(signal, options) {
        const categoryId = options?.categoryId;
        const streams = await resolveLiveCategoryStreams(categoryId, signal);
        const channelOffset = Math.max(0, options?.channelOffset ?? 0);
        const channelLimit = Math.max(1, Math.min(options?.channelLimit ?? XTREAM_GUIDE_CHANNEL_PAGE_SIZE, 100));
        const epgLimit = Math.max(1, Math.min(options?.epgLimit ?? XTREAM_GUIDE_EPG_LIMIT, 48));
        const mappedChannels = streams
          .slice(channelOffset, channelOffset + channelLimit)
          .map((stream, index) => mapLiveStream(stream, channelOffset + index, resolveProviderStreamCategoryId(stream.category_id, 'live', liveCategoryIds)));

        const epgByChannel = new Map<string, ProviderGuideProgram[]>();
        let nextChannelIndex = 0;
        const workerCount = Math.min(XTREAM_GUIDE_EPG_CONCURRENCY, mappedChannels.length);
        await Promise.all(
          Array.from({ length: workerCount }, async () => {
            while (nextChannelIndex < mappedChannels.length) {
              const index = nextChannelIndex++;
              const channel = mappedChannels[index];
              if (signal?.aborted) return;
              const result = await fetchShortEpgWithFallback(client, channel.id, channel.epgChannelId, epgLimit, signal);
              epgByChannel.set(channel.id, result.programs);

              if (index < 3) {
                logGuideEpgAudit({
                  streamId: channel.id,
                  epgChannelId: channel.epgChannelId,
                  channelName: channel.name,
                  categoryId: channel.categoryId,
                  rawRowCount: result.primaryRawCount + result.fallbackRawCount,
                  normalizedRowCount: result.programs.length,
                  usedEpgChannelIdFallback: result.usedEpgChannelIdFallback,
                  fallbackAttempted: result.fallbackAttempted,
                  missingWindowCount: result.programs.filter(
                    (program) => program.startAt === undefined || program.endAt === undefined,
                  ).length,
                });
              }
            }
          }),
        );

        return mapGuideRowsFromChannels(mappedChannels, epgByChannel);
      },
      async getChannelCount(categoryId, signal) {
        const streams = await resolveLiveCategoryStreams(categoryId, signal);
        return streams.length;
      },
    },
    search: {
      async search(query: string, signal) {
        const normalized = normalizeQuery(query);
        if (!normalized) {
          return [];
        }

        const [movieCategories, liveStreams, seriesCategories] = await Promise.all([
          client.getVodCategories(signal).catch(() => []),
          client.getLiveStreams(undefined, signal).catch(() => []),
          client.getSeriesCategories(signal).catch(() => []),
        ]);

        const movieStreams: XtreamVodStreamResponse[] = [];
        for (const category of movieCategories.slice(0, XTREAM_MAX_SEARCH_CATEGORIES)) {
          const streams = await client.getVodStreams(category.category_id ?? undefined, signal).catch(() => []);
          movieStreams.push(...streams.slice(0, XTREAM_MAX_ITEMS_PER_CATEGORY));
          if (movieStreams.length >= 200) {
            break;
          }
        }

        const seriesStreams: XtreamSeriesResponse[] = [];
        for (const category of seriesCategories.slice(0, XTREAM_MAX_SEARCH_CATEGORIES)) {
          const streams = await client.getSeries(category.category_id ?? undefined, signal).catch(() => []);
          seriesStreams.push(...streams.slice(0, XTREAM_MAX_ITEMS_PER_CATEGORY));
          if (seriesStreams.length >= 200) {
            break;
          }
        }

        const movieHits = movieStreams
          .map((stream, index) =>
            mapVodStream(stream, index, normalizeCategoryId(stream.category_id, fallbackProviderCategoryId('movie')), client.baseUrl),
          )
          .filter((movie) => matchesMovie(movie, normalized))
          .map((movie) => ({ ...movie, kind: 'movie' as const }));

        const liveHits = liveStreams.slice(0, XTREAM_MAX_ITEMS_PER_CATEGORY)
          .map((stream, index) => mapLiveStream(stream, index, normalizeCategoryId(stream.category_id, fallbackProviderCategoryId('live'))))
          .filter((channel) => channel.name.toLowerCase().includes(normalized) || channel.current.toLowerCase().includes(normalized))
          .slice(0, 20)
          .map((channel) => ({
            kind: 'live' as const,
            id: channel.id,
            title: channel.name,
            subtitle: channel.current,
            tone: channel.tone,
          }));

        const seriesHits = seriesStreams
          .map((stream, index) => mapSeriesPoster(stream, index, normalizeCategoryId(stream.category_id, fallbackProviderCategoryId('series')), client.baseUrl))
          .filter((series) => series.title.toLowerCase().includes(normalized))
          .slice(0, 20)
          .map((series) => ({
            kind: 'series' as const,
            id: series.id,
            title: series.title,
            subtitle: `${series.year} · ${series.rating}`,
            tone: series.tone,
          }));

        return [...movieHits, ...liveHits, ...seriesHits];
      },
    },
    streamUrlBuilder: {
      buildLiveStreamUrl: bindStreamUrlBuilder(client, 'buildLiveStreamUrl', 'live'),
      buildVodStreamUrl: bindStreamUrlBuilder(client, 'buildVodStreamUrl', 'movie'),
      buildSeriesStreamUrl: bindStreamUrlBuilder(client, 'buildSeriesStreamUrl', 'series'),
    },
    mediaBaseUrl: client.baseUrl,
  };
}

export function buildGuideRowsFromShortEpg(
  channels: ProviderLiveChannel[],
  epgLookup: Map<string, ProviderGuideProgram[]>,
) {
  return mapGuideRowsFromChannels(channels, epgLookup);
}
