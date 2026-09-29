import type { ProviderSeriesPoster, ProviderSeriesRepository } from '../../providers/providerRepositories.ts';
import { resolveMediaUrl } from '../../providers/providerRepositories.ts';
import type { XtreamSeriesEpisodeResponse, XtreamSeriesInfoResponse } from '../../providers/xtreamClient.ts';
import type { SeriesDetail, SeriesEpisodeSummary, SeriesSeasonSummary, SeriesSummary } from '../../media-browser/mediaTypes.ts';
import { inferGenreTags, parseRatingNumber, parseYearFromStreamFields } from '../../movies/smart/movieMetadata.ts';
import { normalizeStringList, normalizeTrailerUrl } from '../../media-browser/mediaDetail.ts';
import { stripProviderStreamTitlePrefix } from '../metadata/titleNormalization.ts';
import { compareSearchCandidates, matchesSearchQuery } from '../../search/searchRanking.ts';
import { normalizeSearchQuery } from '../../search/searchQuery.ts';
import { logContentSortAuditPayload } from '../../media-browser/contentSortAudit.ts';
import {
  buildContentSortPageMetadata,
  categoryHasValidRatings,
  sortAuditField,
  sortContentItems,
  type ContentSortOption,
} from '../../media-browser/contentSorting.ts';

import type { SeriesDataSource } from './SeriesDataSource';
import { logSeriesDataSourceAudit } from '../seriesDataSourceAudit';

const POSTER_STYLE_KEYS = ['ember', 'signal', 'glacier', 'orbit', 'midnight', 'onyx', 'aurora', 'dune'] as const;
const MAX_CACHED_CATEGORY_ITEMS = 100_000;

// TEMPORARY: remove after The Chi provider response is diagnosed. This is
// deliberately limited to shape/count metadata and never logs credentials or
// the provider URL.
function logSeriesInfoAudit(payload: Record<string, unknown>) {
  console.info('[NovaCast Series Info Audit]', JSON.stringify(payload));
}

function posterStyleKeyForIndex(index: number) {
  return POSTER_STYLE_KEYS[index % POSTER_STYLE_KEYS.length];
}

function mapPosterToSummary(poster: ProviderSeriesPoster, categoryId: string, index: number): SeriesSummary {
  return {
    id: poster.id,
    seriesId: poster.seriesId,
    categoryId,
    title: poster.title,
    countryCode: poster.countryCode,
    rawTitle: poster.rawTitle,
    year: poster.year,
    rating: poster.rating,
    releaseDate: poster.releaseDate,
    genres: inferGenreTags(poster.title, []),
    posterStyleKey: posterStyleKeyForIndex(index),
    posterUrl: poster.posterUrl,
    addedAt: poster.addedAt,
    latestEpisodeDate: poster.latestEpisodeDate,
    popularity: poster.popularity,
  };
}

function mapSeriesInfo(seriesId: string, info: XtreamSeriesInfoResponse | null, mediaBaseUrl?: string): SeriesDetail | null {
  if (!info) {
    return null;
  }

  const rawInfo = info.info ?? {};
  const rawTitle = typeof rawInfo.name === 'string' ? rawInfo.name : `Series ${seriesId}`;
  const title = stripProviderStreamTitlePrefix(rawTitle) || rawTitle;
  const description = typeof rawInfo.plot === 'string' ? rawInfo.plot : undefined;
  const ratingValue = parseRatingNumber(
    typeof rawInfo.rating === 'number' || typeof rawInfo.rating === 'string' ? rawInfo.rating : undefined,
  );
  const yearValue = parseYearFromStreamFields(title, rawInfo);
  const coverCandidate =
    (typeof rawInfo.cover === 'string' ? rawInfo.cover : undefined) ??
    (typeof rawInfo.stream_icon === 'string' ? rawInfo.stream_icon : undefined);
  const backdropCandidate =
    (typeof rawInfo.backdrop_path === 'string' ? rawInfo.backdrop_path : undefined) ?? coverCandidate;
  const posterUrl = mediaBaseUrl ? resolveMediaUrl(mediaBaseUrl, coverCandidate) : coverCandidate;
  const backdropUrl = mediaBaseUrl ? resolveMediaUrl(mediaBaseUrl, backdropCandidate) : backdropCandidate;
  const genreValues = normalizeStringList(rawInfo.genre);
  const runtimeValue = Array.isArray(rawInfo.episode_run_time)
    ? Number(rawInfo.episode_run_time[0])
    : Number(rawInfo.episode_run_time);

  const episodeGroups = info.episodes ?? {};
  const seasons: SeriesSeasonSummary[] = [];
  const episodesBySeason: Record<string, SeriesEpisodeSummary[]> = {};

  for (const [seasonKey, episodes] of Object.entries(episodeGroups)) {
    const episodeList = Object.values(episodes ?? {}) as XtreamSeriesEpisodeResponse[];
    const mappedEpisodes = episodeList.map((episode, index) => ({
      id: String(episode.id ?? `${seasonKey}-${index}`),
      seriesId,
      title: stripProviderStreamTitlePrefix(episode.title?.trim() || '') || episode.title?.trim() || `Episode ${episode.episode_num ?? index + 1}`,
      seasonNumber: String(episode.season ?? seasonKey),
      episodeNumber: String(episode.episode_num ?? index + 1),
      streamId: String(episode.id ?? episode.stream_id ?? `${seasonKey}-${index}`),
      extension: episode.container_extension?.trim() || 'ts',
      durationMinutes: Number.isFinite(Number(episode.duration)) && Number(episode.duration) > 0
        ? Number(episode.duration) / 60
        : undefined,
      airDate: episode.releasedate?.trim() || undefined,
      description: typeof episode.plot === 'string' ? episode.plot : undefined,
    }));

    episodesBySeason[seasonKey] = mappedEpisodes;
    seasons.push({
      id: seasonKey,
      label: `Season ${seasonKey}`,
      seasonNumber: seasonKey,
      episodeCount: mappedEpisodes.length,
    });
  }

  for (const rawSeason of info.seasons ?? []) {
    const season = rawSeason as Record<string, unknown>;
    const seasonNumber = String(season.season_number ?? season.season_num ?? season.season ?? '').trim();
    if (!seasonNumber || seasons.some((item) => item.seasonNumber === seasonNumber)) {
      continue;
    }

    const episodeCount = Number(season.episode_count ?? 0);
    episodesBySeason[seasonNumber] ??= [];
    seasons.push({
      id: seasonNumber,
      label: typeof season.name === 'string' && season.name.trim() ? season.name.trim() : `Season ${seasonNumber}`,
      seasonNumber,
      episodeCount: Number.isFinite(episodeCount) ? episodeCount : episodesBySeason[seasonNumber].length,
    });
  }

  seasons.sort((left, right) => Number.parseInt(left.seasonNumber, 10) - Number.parseInt(right.seasonNumber, 10));

  return {
    seriesId,
    title,
    description,
    year: yearValue ? String(yearValue) : undefined,
    releaseDate: typeof rawInfo.releaseDate === 'string'
      ? rawInfo.releaseDate
      : typeof rawInfo.releasedate === 'string'
        ? rawInfo.releasedate
        : undefined,
    rating: ratingValue > 0 ? `${ratingValue}` : undefined,
    runtimeMinutes: Number.isFinite(runtimeValue) && runtimeValue > 0 ? runtimeValue : undefined,
    genres: genreValues.length ? genreValues : inferGenreTags(title, []),
    posterUrl,
    backdropUrl,
    director: typeof rawInfo.director === 'string' ? rawInfo.director : undefined,
    writer: typeof rawInfo.writer === 'string' ? rawInfo.writer : undefined,
    studio: typeof rawInfo.studio === 'string' ? rawInfo.studio : undefined,
    country: typeof rawInfo.country === 'string' ? rawInfo.country : undefined,
    audio: typeof rawInfo.audio === 'string' ? rawInfo.audio : undefined,
    subtitles: typeof rawInfo.subtitles === 'string' ? rawInfo.subtitles : undefined,
    contentRating: typeof rawInfo.content_rating === 'string'
      ? rawInfo.content_rating
      : typeof rawInfo.mpaa === 'string'
        ? rawInfo.mpaa
        : undefined,
    trailerUrl: normalizeTrailerUrl(rawInfo.youtube_trailer),
    creator: typeof rawInfo.creator === 'string' ? rawInfo.creator : undefined,
    network: typeof rawInfo.network === 'string' ? rawInfo.network : undefined,
    cast: normalizeStringList(rawInfo.cast),
    seasons,
    episodesBySeason,
  };
}

export function buildSeriesPreviewDetail(series: SeriesSummary): SeriesDetail {
  return {
    seriesId: series.seriesId,
    title: series.title,
    description: undefined,
    year: series.year,
    rating: series.rating,
    genres: series.genres,
    posterUrl: series.posterUrl,
    backdropUrl: series.posterUrl,
    seasons: [],
    episodesBySeason: {},
  };
}

export function createProviderSeriesDataSource(
  repository: ProviderSeriesRepository,
  mediaBaseUrl?: string,
): SeriesDataSource {
  const categoryCache = new Map<string, SeriesSummary[]>();

  logSeriesDataSourceAudit({
    event: 'repository-source-created',
    providerId: null,
    selectedSource: 'repository',
    sourceClass: 'ProviderSeriesDataSource',
    sqliteEnabled: false,
  });

  return {
    async getCategories() {
      logSeriesDataSourceAudit({
        event: 'source-getCategories-enter',
        selectedSource: 'repository',
        sourceClass: 'ProviderSeriesDataSource',
        sqliteEnabled: false,
        fallbackReason: 'repository.getCategories',
      });
      const categories = await repository.getCategories();
      logSeriesDataSourceAudit({
        event: 'source-getCategories-result',
        selectedSource: 'repository',
        sourceClass: 'ProviderSeriesDataSource',
        sqliteEnabled: false,
        categoryCount: categories.length,
        fallbackReason: 'get_series_categories',
      });
      return categories;
    },

    async getSeriesPage({ categoryId, offset, limit, sort = 'newest' }: { categoryId: string; offset: number; limit: number; sort?: ContentSortOption }) {
      let items = categoryCache.get(categoryId);
      if (!items) {
        const posters = await repository.getSeries(categoryId);
        items = posters.map((poster, index) => mapPosterToSummary(poster, categoryId, index));
        if (items.length <= MAX_CACHED_CATEGORY_ITEMS) {
          categoryCache.set(categoryId, items);
        }
      }

      const sorted = sortContentItems(items, sort, 'series');
      logContentSortAuditPayload({
        providerId: 'provider-series',
        section: 'series',
        categoryId,
        sort,
        knownCategoryTotal: items.length,
        itemsConsideredForSort: items.length,
        offset,
        pageSize: limit,
        requestGeneration: 0,
        sortComplete: true,
        sample: sorted.slice(0, 5).map((item) => ({
          id: item.id,
          title: item.title,
          orderField: sortAuditField(item, sort, 'series'),
        })),
      });
      const pageItems = sorted.slice(offset, offset + limit);
      return {
        items: pageItems,
        totalCount: items.length,
        hasMore: offset + pageItems.length < items.length,
        ...buildContentSortPageMetadata(items.length, items.length, categoryHasValidRatings(items)),
      };
    },

    async getSeriesInfo(seriesId) {
      const startedAt = Date.now();
      try {
        const info = await repository.getSeriesInfo(seriesId);
        const rawEpisodes = info?.episodes;
        const episodeSeasonKeys = rawEpisodes && typeof rawEpisodes === 'object'
          ? Object.keys(rawEpisodes)
          : [];
        const rawEpisodeCounts = Object.fromEntries(
          episodeSeasonKeys.map((key) => {
            const value = rawEpisodes?.[key];
            return [key, Array.isArray(value) ? value.length : value && typeof value === 'object' ? Object.keys(value).length : 0];
          }),
        );
        const detail = mapSeriesInfo(seriesId, info, mediaBaseUrl);
        logSeriesInfoAudit({
          origin: 'series-detail',
          title: typeof info?.info?.name === 'string' ? info.info.name : null,
          canonicalSeriesId: detail?.seriesId ?? null,
          providerSeriesId: String(seriesId),
          datasource: 'ProviderSeriesDataSource',
          responseSource: 'provider',
          httpStatus: 'ok',
          durationMs: Date.now() - startedAt,
          responseShape: info == null ? 'null' : Array.isArray(info) ? 'array' : typeof info,
          responseTopLevelKeys: info && typeof info === 'object' ? Object.keys(info) : [],
          metadataSeasonCount: Array.isArray(info?.seasons) ? info.seasons.length : 0,
          metadataSeasonNumbers: Array.isArray(info?.seasons)
            ? info.seasons.map((season) => String(season.season_number ?? season.season_num ?? season.season ?? ''))
            : [],
          episodeContainerType: rawEpisodes == null ? String(rawEpisodes) : Array.isArray(rawEpisodes) ? 'array' : typeof rawEpisodes,
          episodeSeasonKeys,
          episodeCountBySeason: rawEpisodeCounts,
          totalEpisodeCount: Object.values(rawEpisodeCounts).reduce((sum, count) => sum + Number(count), 0),
          parsedSeasonNumbers: detail?.seasons.map((season) => season.seasonNumber) ?? [],
          parsedEpisodeCountBySeason: detail ? Object.fromEntries(Object.entries(detail.episodesBySeason).map(([key, value]) => [key, value.length])) : {},
          selectedSeason: null,
          selectedSeasonEpisodeCount: null,
          errorCategory: null,
        });
        return detail;
      } catch (error) {
        const safeError = error as { httpStatus?: number; classification?: string; name?: string; message?: string };
        logSeriesInfoAudit({
          origin: 'series-detail',
          title: null,
          canonicalSeriesId: null,
          providerSeriesId: String(seriesId),
          datasource: 'ProviderSeriesDataSource',
          responseSource: 'provider',
          httpStatus: safeError.httpStatus ?? null,
          durationMs: Date.now() - startedAt,
          responseShape: 'error',
          responseTopLevelKeys: [],
          metadataSeasonCount: 0,
          metadataSeasonNumbers: [],
          episodeContainerType: null,
          episodeSeasonKeys: [],
          episodeCountBySeason: {},
          totalEpisodeCount: 0,
          parsedSeasonNumbers: [],
          parsedEpisodeCountBySeason: {},
          selectedSeason: null,
          selectedSeasonEpisodeCount: null,
          errorCategory: safeError.classification ?? safeError.name ?? 'request-failed',
        });
        throw error;
      }
    },

    async getCategoryCount(categoryId) {
      const items = categoryCache.get(categoryId);
      if (items) {
        return items.length;
      }
      const posters = await repository.getSeries(categoryId);
      return posters.length;
    },

    async listCategorySeries(categoryId) {
      const posters = await repository.getSeries(categoryId);
      const items = posters.map((poster, index) => mapPosterToSummary(poster, categoryId, index));
      if (items.length <= MAX_CACHED_CATEGORY_ITEMS) {
        categoryCache.set(categoryId, items);
      }
      return items;
    },

    getCatalogListRequestUrl(categoryId) {
      return repository.getCatalogListRequestUrl?.(categoryId) ?? null;
    },

    async searchSeries({ query, offset, limit, signal }) {
      // search-s3-cancellable-series
      const throwIfAborted = () => {
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      };
      throwIfAborted();
      const normalized = normalizeSearchQuery(query);
      if (!normalized) {
        return { items: [], totalCount: 0, hasMore: false };
      }

      const categories = await repository.getCategories();
      throwIfAborted();
      const seenSeriesIds = new Set<string>();
      const matches: SeriesSummary[] = [];

      for (const category of categories) {
        throwIfAborted();
        let items = categoryCache.get(category.id);
        if (!items) {
          const posters = await repository.getSeries(category.id);
          throwIfAborted();
          items = posters.map((poster, index) => mapPosterToSummary(poster, category.id, index));
          if (items.length <= MAX_CACHED_CATEGORY_ITEMS) {
            categoryCache.set(category.id, items);
          }
        }

        let searchItemIndex = 0;
        for (const item of items) {
          if ((searchItemIndex++ & 255) === 0) throwIfAborted();
          const dedupeKey = item.seriesId || item.id;
          if (seenSeriesIds.has(dedupeKey)) {
            continue;
          }

          const metadata = [item.genres?.join(' '), item.year, item.rating].filter(Boolean).join(' ');
          if (
            !matchesSearchQuery(query, { title: item.title, metadata }) &&
            !metadata.toLocaleLowerCase().includes(normalized)
          ) {
            continue;
          }

          seenSeriesIds.add(dedupeKey);
          matches.push(item);
        }

        if (matches.length >= offset + limit + 50) {
          break;
        }
      }

      matches.sort((left, right) =>
        compareSearchCandidates(
          query,
          { title: left.title, metadata: [left.genres?.join(' '), left.year, left.rating].filter(Boolean).join(' ') },
          { title: right.title, metadata: [right.genres?.join(' '), right.year, right.rating].filter(Boolean).join(' ') },
        ),
      );

      const pageItems = matches.slice(offset, offset + limit);
      return {
        items: pageItems,
        totalCount: matches.length,
        hasMore: offset + limit < matches.length,
      };
    },
  };
}
