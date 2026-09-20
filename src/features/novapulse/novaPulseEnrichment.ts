import type { MediaDetail } from '../media-browser/mediaTypes.ts';
import { getCachedProviderMovieInfo } from '../movies/movieDetailEnrichment.ts';
import {
  getSeriesMetadataCacheEntry,
  type SeriesMetadataCacheEntry,
} from '../series/metadata/seriesMetadataCache.ts';
import { matchSeriesMetadata } from '../series/metadata/seriesMetadataMatcher.ts';
import type { NovaPulseItem } from './novaPulseTypes.ts';

export const NOVA_PULSE_MOVIE_ENRICHMENT_BUDGET = 4;
export const NOVA_PULSE_SERIES_ENRICHMENT_BUDGET = 2;
export const NOVA_PULSE_MOVIE_CONCURRENCY = 2;
export const NOVA_PULSE_SERIES_CONCURRENCY = 1;

type MovieEnrichmentFields = Pick<MediaDetail,
  | 'synopsis'
  | 'backdropUrl'
  | 'posterUrl'
  | 'runtime'
  | 'genres'
  | 'contentRating'
  | 'year'
  | 'releaseDate'
  | 'rating'
  | 'ratingSource'
>;

export type NovaPulseMovieEnrichment = MovieEnrichmentFields & {
  providerId: string;
  movieId: string;
  status: 'matched' | 'failed';
  updatedAt: number;
  failureReason?: string;
};

export type NovaPulseEnrichmentDiagnostics = {
  selectedMovies: number;
  selectedSeries: number;
  movieEligible: number;
  seriesEligible: number;
  movieCacheHits: number;
  seriesCacheHits: number;
  movieRequestsStarted: number;
  seriesRequestsStarted: number;
  movieEnriched: number;
  seriesEnriched: number;
  movieFailed: number;
  seriesFailed: number;
  movieSkippedBudget: number;
  seriesSkippedBudget: number;
  staleProviderResultsIgnored: number;
};

export type NovaPulseEnrichmentResult = {
  providerId: string;
  movies: ReadonlyMap<string, NovaPulseMovieEnrichment>;
  series: ReadonlyMap<string, SeriesMetadataCacheEntry>;
  diagnostics: NovaPulseEnrichmentDiagnostics;
};

type MovieFetcher = (movieId: string) => Promise<MediaDetail | null>;
type SeriesCacheReader = (providerId: string, seriesId: string) => Promise<SeriesMetadataCacheEntry | null>;
type SeriesMatcher = (input: { providerId: string; seriesId: string; providerTitle: string }) => Promise<{ cacheEntry?: SeriesMetadataCacheEntry } | null>;

const MOVIE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MOVIE_CACHE_LIMIT_PER_PROVIDER = 250;
const movieCache = new Map<string, NovaPulseMovieEnrichment>();
const movieInFlight = new Map<string, Promise<NovaPulseMovieEnrichment>>();
const seriesInFlight = new Map<string, Promise<SeriesMetadataCacheEntry | null>>();

function key(providerId: string, contentId: string) {
  return `${providerId}::${contentId}`;
}

function pruneMovieCache(providerId: string) {
  const entries = [...movieCache.entries()]
    .filter(([, value]) => value.providerId === providerId)
    .sort(([, left], [, right]) => left.updatedAt - right.updatedAt);
  while (entries.length > MOVIE_CACHE_LIMIT_PER_PROVIDER) {
    const oldest = entries.shift();
    if (oldest) movieCache.delete(oldest[0]);
  }
}

function sanitizeMovieDetail(providerId: string, movieId: string, detail: MediaDetail): NovaPulseMovieEnrichment {
  return {
    providerId,
    movieId,
    status: 'matched',
    updatedAt: Date.now(),
    synopsis: detail.synopsis?.trim() || undefined,
    backdropUrl: detail.backdropUrl?.trim() || undefined,
    posterUrl: detail.posterUrl?.trim() || undefined,
    runtime: detail.runtime,
    genres: detail.genres.filter(Boolean),
    contentRating: detail.contentRating?.trim() || undefined,
    year: detail.year,
    releaseDate: detail.releaseDate,
    rating: detail.rating,
    ratingSource: detail.ratingSource,
  };
}

function hasText(value?: string | number) {
  return value != null && String(value).trim().length > 0;
}

export function needsNovaPulseMovieEnrichment(item: NovaPulseItem) {
  if (item.type !== 'movie') return false;
  const hasDescription = hasText(item.description);
  const hasBackdrop = hasText(item.backdropUrl);
  const hasGenre = Boolean(item.genres?.some((genre) => hasText(genre)));
  const hasRuntime = item.runtimeMinutes != null && item.runtimeMinutes > 0;
  // A description plus usable artwork is already presentation-ready. Otherwise
  // enrich only when at least one useful metadata dimension is absent.
  return !(hasDescription && hasBackdrop) && (!hasDescription || !hasBackdrop || (!hasGenre && !hasRuntime));
}

export function needsNovaPulseSeriesEnrichment(item: NovaPulseItem) {
  if (item.type !== 'series') return false;
  const hasDescription = hasText(item.description);
  const hasBackdrop = hasText(item.backdropUrl);
  const hasGenre = Boolean(item.genres?.some((genre) => hasText(genre)));
  const hasRuntime = item.runtimeMinutes != null && item.runtimeMinutes > 0;
  return !(hasDescription && hasBackdrop) && (!hasDescription || !hasBackdrop || (!hasGenre && !hasRuntime));
}

function getFreshMovieCache(providerId: string, movieId: string) {
  const cached = movieCache.get(key(providerId, movieId));
  if (!cached) return null;
  if (Date.now() - cached.updatedAt > MOVIE_CACHE_TTL_MS) {
    movieCache.delete(key(providerId, movieId));
    return null;
  }
  return cached;
}

async function enrichMovie(providerId: string, movieId: string, fetchMovie: MovieFetcher) {
  const cacheKey = key(providerId, movieId);
  const cached = getFreshMovieCache(providerId, movieId);
  if (cached) return cached;
  const existing = movieInFlight.get(cacheKey);
  if (existing) return existing;

  const request = fetchMovie(movieId)
    .then((detail) => {
      const result = detail
        ? sanitizeMovieDetail(providerId, movieId, detail)
        : { providerId, movieId, status: 'failed' as const, updatedAt: Date.now(), genres: [], failureReason: 'provider-detail-null' };
      movieCache.set(cacheKey, result);
      pruneMovieCache(providerId);
      return result;
    })
    .catch(() => {
      const result: NovaPulseMovieEnrichment = {
        providerId,
        movieId,
        status: 'failed',
        updatedAt: Date.now(),
        genres: [],
        failureReason: 'provider-detail-failed',
      };
      movieCache.set(cacheKey, result);
      pruneMovieCache(providerId);
      return result;
    })
    .finally(() => movieInFlight.delete(cacheKey));
  movieInFlight.set(cacheKey, request);
  return request;
}

async function enrichSeries(providerId: string, item: NovaPulseItem, readCache: SeriesCacheReader, match: SeriesMatcher) {
  const seriesId = item.sourceItemId ?? '';
  const cacheKey = key(providerId, seriesId);
  const cached = await readCache(providerId, seriesId);
  if (cached) return { cached, requested: false };
  const existing = seriesInFlight.get(cacheKey);
  if (existing) return { cached: await existing, requested: false };

  const request = match({
    providerId,
    seriesId,
    providerTitle: item.title,
  }).then(async (result) => result?.cacheEntry ?? readCache(providerId, seriesId)).catch(() => null).finally(() => seriesInFlight.delete(cacheKey));
  seriesInFlight.set(cacheKey, request);
  return { cached: await request, requested: true };
}

async function runBounded<T>(items: readonly T[], concurrency: number, task: (item: T) => Promise<void>) {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const item = items[next++];
      await task(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
}

export async function runNovaPulseEnrichmentCycle(input: {
  providerId: string;
  items: readonly NovaPulseItem[];
  fetchMovieDetail?: MovieFetcher;
  getCachedMovieDetail?: (providerId: string, movieId: string) => MediaDetail | null;
  readSeriesCache?: SeriesCacheReader;
  matchSeries?: SeriesMatcher;
  isCurrent?: () => boolean;
}): Promise<NovaPulseEnrichmentResult> {
  const selectedMovies = input.items.filter((item) => item.type === 'movie');
  const selectedSeries = input.items.filter((item) => item.type === 'series');
  const eligibleMovies = selectedMovies.filter(needsNovaPulseMovieEnrichment);
  const eligibleSeries = selectedSeries.filter(needsNovaPulseSeriesEnrichment);
  const movieWork = eligibleMovies.slice(0, NOVA_PULSE_MOVIE_ENRICHMENT_BUDGET);
  const seriesWork = eligibleSeries.slice(0, NOVA_PULSE_SERIES_ENRICHMENT_BUDGET);
  const diagnostics: NovaPulseEnrichmentDiagnostics = {
    selectedMovies: selectedMovies.length,
    selectedSeries: selectedSeries.length,
    movieEligible: eligibleMovies.length,
    seriesEligible: eligibleSeries.length,
    movieCacheHits: 0,
    seriesCacheHits: 0,
    movieRequestsStarted: 0,
    seriesRequestsStarted: 0,
    movieEnriched: 0,
    seriesEnriched: 0,
    movieFailed: 0,
    seriesFailed: 0,
    movieSkippedBudget: Math.max(0, eligibleMovies.length - movieWork.length),
    seriesSkippedBudget: Math.max(0, eligibleSeries.length - seriesWork.length),
    staleProviderResultsIgnored: 0,
  };
  const movies = new Map<string, NovaPulseMovieEnrichment>();
  const series = new Map<string, SeriesMetadataCacheEntry>();
  const fetchMovieDetail = input.fetchMovieDetail;
  const getCachedMovieDetail = input.getCachedMovieDetail ?? getCachedProviderMovieInfo;
  const readSeriesCache = input.readSeriesCache ?? getSeriesMetadataCacheEntry;
  const matchSeries = input.matchSeries ?? matchSeriesMetadata;

  if (fetchMovieDetail) {
    await runBounded(movieWork, NOVA_PULSE_MOVIE_CONCURRENCY, async (item) => {
      const movieId = item.sourceItemId ?? '';
      const cached = getFreshMovieCache(input.providerId, movieId);
      if (cached) {
        diagnostics.movieCacheHits += 1;
        movies.set(movieId, cached);
        return;
      }
      const existing = getCachedMovieDetail(input.providerId, movieId);
      if (existing) {
        diagnostics.movieCacheHits += 1;
        return;
      }
      diagnostics.movieRequestsStarted += 1;
      const result = await enrichMovie(input.providerId, movieId, fetchMovieDetail);
      if (input.isCurrent && !input.isCurrent()) {
        diagnostics.staleProviderResultsIgnored += 1;
        return;
      }
      movies.set(movieId, result);
      if (result.status === 'matched') diagnostics.movieEnriched += 1;
      else diagnostics.movieFailed += 1;
    });
  }

  await runBounded(seriesWork, NOVA_PULSE_SERIES_CONCURRENCY, async (item) => {
    const result = await enrichSeries(input.providerId, item, readSeriesCache, matchSeries);
    if (input.isCurrent && !input.isCurrent()) {
      diagnostics.staleProviderResultsIgnored += 1;
      return;
    }
    if (!result.requested) diagnostics.seriesCacheHits += 1;
    else diagnostics.seriesRequestsStarted += 1;
    if (result.cached) {
      series.set(item.sourceItemId ?? '', result.cached);
      if (result.cached.status === 'matched') diagnostics.seriesEnriched += 1;
      else diagnostics.seriesFailed += 1;
    }
  });

  return { providerId: input.providerId, movies, series, diagnostics };
}

export function resetNovaPulseEnrichmentForTests() {
  movieCache.clear();
  movieInFlight.clear();
  seriesInFlight.clear();
}
