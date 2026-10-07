import type { MovieSummary } from '@/features/movies/movieTypes';
import type { SeriesSummary } from '@/features/media-browser/mediaTypes';
import type { NovaPulseItem, NovaPulseRecommendationSignals, NovaPulseSourceResult } from './novaPulseTypes';
import { getNovaPulseDisplayCountry, getNovaPulseDisplayRuntimeMinutes, getNovaPulseDisplayYear, getNovaPulseMovieFreshness, normalizeNovaPulseGenres, normalizeNovaPulseYear, resolveNovaPulseDescription, sanitizeNovaPulseDisplayTitle } from './novaPulseLogic.ts';
import type { ProviderHealthSnapshot } from '@/features/providers/providerHealth.ts';
import type { NovaPulseWeatherResult } from './novaPulseWeather';
import type { NovaPulseNewsResult } from './novaPulseNews';

export type NovaPulseSource = {
  id: string;
  getItems: () => NovaPulseSourceResult;
};

function finiteRating(value?: string | number) {
  const rating = Number(value);
  return Number.isFinite(rating) && rating > 0 ? rating : undefined;
}

function presentationScore(input: {
  title?: string;
  artworkUrl?: string;
  description?: string;
  rating?: string | number;
  year?: number;
  releaseDate?: string | number;
}) {
  let score = 0;
  if (input.artworkUrl?.trim()) score += 3;
  else score -= 1;
  if (input.description?.trim()) score += 3;
  else score -= 2;
  if (finiteRating(input.rating)) score += 1;
  if (getNovaPulseDisplayYear(input.year) || input.releaseDate) score += 1;
  if (sanitizeNovaPulseDisplayTitle(input.title)) score += 1;
  return score;
}

function preferPresentable<T>(items: readonly T[], score: (item: T) => number, limit = 32) {
  return [...items].sort((left, right) => score(right) - score(left)).slice(0, limit);
}

function stableMovie(movie: MovieSummary, recommendations: ReadonlyMap<string, NovaPulseRecommendationSignals> | undefined, sessionNowMs: number): NovaPulseItem {
  const id = String(movie.id);
  const addedAt = Number.isFinite(movie.addedAt) ? movie.addedAt : undefined;
  const freshness = getNovaPulseMovieFreshness(addedAt, sessionNowMs);
  return {
    id: `catalog-movie-${id}`,
    type: 'movie',
    subtype: 'featured',
    title: sanitizeNovaPulseDisplayTitle(movie.title),
    description: resolveNovaPulseDescription({ description: movie.description }, '') || undefined,
    year: getNovaPulseDisplayYear(movie.year),
    countryCode: movie.countryCode ?? getNovaPulseDisplayCountry(movie.title),
    genres: normalizeNovaPulseGenres(movie.genres),
    runtimeMinutes: getNovaPulseDisplayRuntimeMinutes(movie.durationMinutes),
    rating: finiteRating(movie.rating ?? movie.score),
    ratingSource: movie.rating ? 'Rating' : undefined,
    artworkUrl: movie.posterUrl,
    posterUrl: movie.posterUrl,
    backdropUrl: movie.backdropUrl,
    artworkFit: movie.backdropUrl ? 'cover' : 'contain',
    priority: 90,
    ...(addedAt !== undefined ? { addedAt } : {}),
    ...(freshness ? { catalogStatus: 'RECENTLY ADDED' as const } : {}),
    sourceId: 'catalog-movies',
    sourceItemId: id,
    publishedAt: movie.releaseDate ? Date.parse(String(movie.releaseDate)) || undefined : movie.addedAt,
    updatedAt: movie.addedAt,
    sortPriority: movie.popularity ?? movie.regionRank,
    dedupeKey: `movie:${id}`,
    recommendation: recommendations?.get(`movie:${id}`),
    action: { type: 'details', target: '/movies', contentId: id },
  };
}

function stableSeries(series: SeriesSummary, recommendations?: ReadonlyMap<string, NovaPulseRecommendationSignals>): NovaPulseItem {
  const id = String(series.id || series.seriesId);
  return {
    id: `catalog-series-${id}`,
    type: 'series',
    subtype: 'featured',
    title: sanitizeNovaPulseDisplayTitle(series.title),
    description: resolveNovaPulseDescription({ description: series.description }, '') || undefined,
    year: normalizeNovaPulseYear(series.year),
    countryCode: series.countryCode ?? getNovaPulseDisplayCountry(series.title),
    genres: normalizeNovaPulseGenres(series.genres),
    rating: finiteRating(series.rating),
    ratingSource: series.rating ? 'Rating' : undefined,
    artworkUrl: series.backdropUrl ?? series.posterUrl,
    posterUrl: series.posterUrl,
    backdropUrl: series.backdropUrl,
    artworkFit: series.backdropUrl ? 'cover' : 'contain',
    priority: 80,
    sourceId: 'catalog-series',
    sourceItemId: id,
    publishedAt: series.releaseDate ? Date.parse(String(series.releaseDate)) || undefined : series.addedAt,
    updatedAt: series.latestEpisodeDate ? Date.parse(String(series.latestEpisodeDate)) || undefined : series.addedAt,
    sortPriority: series.popularity ?? series.providerSortOrder,
    dedupeKey: `series:${id}`,
    recommendation: recommendations?.get(`series:${id}`),
    action: { type: 'details', target: '/series', contentId: id, seriesId: series.seriesId || id },
  };
}

function bounded<T>(items: readonly T[], limit = 8) {
  return items.filter(Boolean).slice(0, limit);
}

export function createNovaPulseCatalogSource(
  movies: readonly MovieSummary[],
  series: readonly SeriesSummary[],
  recommendations?: ReadonlyMap<string, NovaPulseRecommendationSignals>,
  sessionNowMs = Date.now(),
): NovaPulseSource {
  return {
    id: 'catalog',
    getItems: () => ({
      sourceId: 'catalog',
      fetchedAt: Date.now(),
      items: [
        ...preferPresentable(movies.filter(Boolean), (movie) => presentationScore(movie), 56).map((movie) => stableMovie(movie, recommendations, sessionNowMs)),
        ...preferPresentable(series.filter(Boolean).slice(0, 32), (seriesItem) => presentationScore({
          ...seriesItem,
          year: normalizeNovaPulseYear(seriesItem.year),
          artworkUrl: seriesItem.backdropUrl ?? seriesItem.posterUrl,
        })).map((seriesItem) => stableSeries(seriesItem, recommendations)),
      ],
    }),
  };
}

export function createNovaPulseMockSource(
  items: readonly NovaPulseItem[],
  includeCatalogFallback: boolean | { movie?: boolean; series?: boolean } = false,
): NovaPulseSource {
  const includeMovieFallback = typeof includeCatalogFallback === 'boolean'
    ? includeCatalogFallback
    : includeCatalogFallback.movie === true;
  const includeSeriesFallback = typeof includeCatalogFallback === 'boolean'
    ? includeCatalogFallback
    : includeCatalogFallback.series === true;
  return {
    id: 'mock',
    getItems: () => ({
      sourceId: 'mock',
      items: items.filter((item) =>
        item.type === 'movie'
          ? includeMovieFallback
          : item.type === 'series'
            ? includeSeriesFallback
            : true,
      ),
    }),
  };
}

export function createNovaPulseSportsSource(items: readonly NovaPulseItem[]): NovaPulseSource {
  return {
    id: 'sports',
    getItems: () => ({ sourceId: 'sports', fetchedAt: Date.now(), items: items.filter((item) => item.type === 'sports') }),
  };
}

export function createNovaPulseLiveEpgSource(items: readonly NovaPulseItem[]): NovaPulseSource {
  return {
    id: 'live-epg',
    getItems: () => ({ sourceId: 'live-epg', fetchedAt: Date.now(), items: items.filter((item) => item.type === 'live_epg') }),
  };
}

export function createNovaPulseProviderHealthSource(snapshot: ProviderHealthSnapshot): NovaPulseSource {
  const copy: Record<string, { title: string; body: string; priority: number }> = {
    degraded: { title: 'Provider Service Issue', body: 'Some provider services are having trouble.', priority: 55 },
    unavailable: { title: 'Provider Temporarily Unavailable', body: 'Your TV provider is not responding right now.', priority: 88 },
    authentication_required: { title: 'Provider Sign-In Needed', body: 'Your TV provider needs you to sign in again.', priority: 96 },
    subscription_expired: { title: 'Provider Subscription Expired', body: 'Your provider subscription may have expired.', priority: 95 },
    recovered: { title: 'Provider Service Restored', body: 'Your provider is responding normally again.', priority: 45 },
  };
  const alertStatuses = ['degraded', 'unavailable', 'authentication_required', 'subscription_expired', 'recovered'] as const;
  const alertStatus = alertStatuses.includes(snapshot.status as (typeof alertStatuses)[number])
    ? snapshot.status as (typeof alertStatuses)[number]
    : null;
  if (!alertStatus) {
    return { id: 'provider-health', getItems: () => ({ sourceId: 'provider-health', items: [] }) };
  }
  const value = alertStatus ? copy[alertStatus] : undefined;
  const item: NovaPulseItem | null = value ? {
    id: `provider-health-${alertStatus}`,
    type: 'provider_alert', title: value.title, message: value.body, description: value.body,
    badge: 'PROVIDER ALERT', priority: value.priority, providerHealthState: alertStatus,
    action: { type: 'none' }, sourceId: 'provider-health', sourceItemId: alertStatus,
    dedupeKey: `provider-health:${alertStatus}`,
  } : null;
  return { id: 'provider-health', getItems: () => ({ sourceId: 'provider-health', items: item ? [item] : [] }) };
}

export function createNovaPulseWeatherSource(result: NovaPulseWeatherResult): NovaPulseSource {
  return {
    id: 'weather',
    getItems: () => ({ sourceId: 'weather', fetchedAt: Date.now(), items: result.item ? [result.item] : [] }),
  };
}

export function createNovaPulseNewsSource(result: NovaPulseNewsResult): NovaPulseSource {
  return {
    id: 'news',
    getItems: () => ({ sourceId: 'news', fetchedAt: Date.now(), items: result.item ? [result.item] : [] }),
  };
}
