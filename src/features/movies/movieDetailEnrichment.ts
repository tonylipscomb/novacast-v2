import type { CatalogItemRecord } from '../catalog/catalogTypes.ts';
import type { MediaDetail } from '../media-browser/mediaTypes.ts';
import {
  normalizeSingleExtension,
  resolveMovieContainerExtension,
} from '../providers/playbackSourceDiagnostics.ts';

export const MOVIE_DETAIL_ENRICHMENT_MARKER = 'stage3h-movie-detail-enrichment-v1';

export type MovieDetailEnrichmentOrigin = 'browse' | 'search';

export type MovieDetailMode =
  | 'local-complete'
  | 'local-preview-enriching'
  | 'enriched'
  | 'preview-fallback';

export type ResolvedExtensionSource = 'provider' | 'catalog' | 'none';

export type MovieDetailEnrichmentDiagnostic = {
  origin: MovieDetailEnrichmentOrigin;
  movieId: string;
  localRowFound: boolean;
  localExtensionPresent: boolean;
  providerInfoRequested: boolean;
  providerInfoSucceeded: boolean;
  providerExtensionPresent: boolean;
  resolvedExtensionSource: ResolvedExtensionSource;
  detailMode: MovieDetailMode;
  failureReason: string | null;
};

const INVALID_EXTENSION_PLACEHOLDERS = new Set([
  'null',
  'undefined',
  'none',
  'n/a',
  'na',
  'unknown',
  'empty',
]);

/** Session / short-lived provider VOD-info cache keyed by providerId + movieId. */
const PROVIDER_VOD_INFO_TTL_MS = 30 * 60 * 1000;
type ProviderVodInfoCacheEntry = {
  detail: MediaDetail;
  cachedAt: number;
};
const providerVodInfoCache = new Map<string, ProviderVodInfoCacheEntry>();

function cacheKey(providerId: string, movieId: string) {
  return `${providerId}::${movieId}`;
}

export function resetMovieDetailEnrichmentCacheForTests() {
  providerVodInfoCache.clear();
}

export function normalizeDetailContainerExtension(
  value: string | undefined | null,
): string | undefined {
  const normalized = normalizeSingleExtension(value);
  if (!normalized || INVALID_EXTENSION_PLACEHOLDERS.has(normalized)) {
    return undefined;
  }
  return normalized;
}

export function resolveDetailContainerExtension(
  providerExtension: string | undefined | null,
  catalogExtension: string | undefined | null,
): { extension?: string; source: ResolvedExtensionSource } {
  // Prefer shared resolver (provider VOD-info → catalog list/stream_extension).
  const resolved = resolveMovieContainerExtension(providerExtension, catalogExtension);
  if (resolved && !INVALID_EXTENSION_PLACEHOLDERS.has(resolved)) {
    const fromProvider = normalizeDetailContainerExtension(providerExtension);
    if (fromProvider && fromProvider === resolved) {
      return { extension: resolved, source: 'provider' };
    }
    const fromCatalog = normalizeDetailContainerExtension(catalogExtension);
    if (fromCatalog && fromCatalog === resolved) {
      return { extension: resolved, source: 'catalog' };
    }
    return { extension: resolved, source: fromProvider ? 'provider' : 'catalog' };
  }

  const fromProvider = normalizeDetailContainerExtension(providerExtension);
  if (fromProvider) {
    return { extension: fromProvider, source: 'provider' };
  }
  const fromCatalog = normalizeDetailContainerExtension(catalogExtension);
  if (fromCatalog) {
    return { extension: fromCatalog, source: 'catalog' };
  }
  // Do not invent an extension; safe resolver may still play extensionless.
  return { extension: undefined, source: 'none' };
}

export function buildLocalMovieDetailFromCatalogItem(
  item: CatalogItemRecord,
  movieId: string,
): MediaDetail {
  const extension = normalizeDetailContainerExtension(item.streamExtension);
  const year =
    item.releaseYear != null && Number.isFinite(item.releaseYear)
      ? String(item.releaseYear)
      : item.releaseDate?.match(/\b(19|20)\d{2}\b/)?.[0];

  return {
    id: movieId,
    mediaType: 'movie',
    title: item.title || `Movie ${movieId}`,
    posterUrl: item.artworkUrl ?? undefined,
    backdropUrl: item.backdropUrl ?? undefined,
    synopsis: item.description?.trim() || undefined,
    year,
    releaseDate: item.releaseDate ?? undefined,
    rating: item.rating != null && item.rating > 0 ? item.rating : undefined,
    ratingSource: item.rating != null && item.rating > 0 ? 'Provider' : undefined,
    containerExtension: extension,
    genres: [],
    cast: [],
    seasons: [],
    episodes: [],
  };
}

export function isLocalMovieDetailComplete(detail: MediaDetail): boolean {
  const hasExtension = Boolean(normalizeDetailContainerExtension(detail.containerExtension));
  const hasSynopsis = Boolean(detail.synopsis?.trim());
  return hasExtension && hasSynopsis;
}

export function mergeLocalAndProviderMovieDetail(
  local: MediaDetail,
  provider: MediaDetail,
): { detail: MediaDetail; resolvedExtensionSource: ResolvedExtensionSource } {
  const { extension, source } = resolveDetailContainerExtension(
    provider.containerExtension,
    local.containerExtension,
  );

  return {
    resolvedExtensionSource: source,
    detail: {
      ...local,
      // Preserve canonical selected movie id.
      id: local.id,
      mediaType: 'movie',
      title: local.title || provider.title,
      posterUrl: provider.posterUrl || local.posterUrl,
      backdropUrl: provider.backdropUrl || local.backdropUrl,
      synopsis: provider.synopsis?.trim() || local.synopsis,
      year: provider.year || local.year,
      releaseDate: provider.releaseDate || local.releaseDate,
      runtime: provider.runtime || local.runtime,
      genres: provider.genres.length > 0 ? provider.genres : local.genres,
      cast: provider.cast.length > 0 ? provider.cast : local.cast,
      director: provider.director || local.director,
      writer: provider.writer || local.writer,
      studio: provider.studio || local.studio,
      country: provider.country || local.country,
      audio: provider.audio || local.audio,
      subtitles: provider.subtitles || local.subtitles,
      rating: provider.rating ?? local.rating,
      ratingSource: provider.ratingSource || local.ratingSource,
      contentRating: provider.contentRating || local.contentRating,
      trailerUrl: provider.trailerUrl || local.trailerUrl,
      containerExtension: extension,
      seasons: [],
      episodes: [],
    },
  };
}

export function getCachedProviderMovieInfo(
  providerId: string,
  movieId: string,
): MediaDetail | null {
  const entry = providerVodInfoCache.get(cacheKey(providerId, movieId));
  if (!entry) {
    return null;
  }
  if (Date.now() - entry.cachedAt > PROVIDER_VOD_INFO_TTL_MS) {
    providerVodInfoCache.delete(cacheKey(providerId, movieId));
    return null;
  }
  return entry.detail;
}

export function setCachedProviderMovieInfo(
  providerId: string,
  movieId: string,
  detail: MediaDetail,
) {
  providerVodInfoCache.set(cacheKey(providerId, movieId), {
    detail,
    cachedAt: Date.now(),
  });
}

export function logMovieDetailEnrichment(diagnostic: MovieDetailEnrichmentDiagnostic) {
  console.info(
    '[NovaCast Movie Detail Enrichment] ' +
      JSON.stringify({
        ...diagnostic,
        marker: MOVIE_DETAIL_ENRICHMENT_MARKER,
      }),
  );
}
