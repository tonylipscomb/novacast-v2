import type { MovieSummary } from '@/features/movies/movieTypes.ts';
import type { SeriesSummary } from '@/features/media-browser/mediaTypes.ts';
import type { MediaDetail } from '@/features/media-browser/mediaTypes.ts';
import type { SeriesMetadataCacheEntry } from '@/features/series/metadata/seriesMetadataCache.ts';
import type { NovaPulseMovieEnrichment } from './novaPulseEnrichment.ts';
import type { NovaPulseItem } from './novaPulseTypes.ts';
import { isNovaPulseEnglishDescription, normalizeNovaPulseGenres } from './novaPulseLogic.ts';

export type NovaPulsePresentationDiagnostics = {
  movieBackdropAvailable: number;
  seriesBackdropAvailable: number;
  movieDescriptionsLocal: number;
  movieDescriptionsCached: number;
  seriesDescriptionsLocal: number;
  seriesDescriptionsCached: number;
  cachedSeriesMetadataHits: number;
  cachedMovieDetailHits: number;
  nonEnglishDescriptionsRejected: number;
  descriptionFallbackSucceeded: number;
  descriptionOmittedForLanguage: number;
};

export type NovaPulsePresentationInput = {
  items: readonly NovaPulseItem[];
  movies: readonly MovieSummary[];
  series: readonly SeriesSummary[];
  cachedSeriesMetadata?: ReadonlyMap<string, SeriesMetadataCacheEntry>;
  movieEnrichments?: ReadonlyMap<string, NovaPulseMovieEnrichment>;
  getCachedMovieDetail?: (movieId: string) => MediaDetail | null;
};

export type NovaPulsePresentationResult = {
  items: NovaPulseItem[];
  diagnostics: NovaPulsePresentationDiagnostics;
};

function runtimeMinutes(value?: string | number) {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  const text = String(value ?? '').trim();
  if (!text) return undefined;
  const hours = text.match(/(\d+(?:\.\d+)?)\s*h/i);
  const minutes = text.match(/(\d+)\s*m/i);
  if (hours || minutes) return (hours ? Number(hours[1]) * 60 : 0) + (minutes ? Number(minutes[1]) : 0);
  const numeric = Number(text);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : undefined;
}

function firstNonEmpty<T>(...values: (T | null | undefined)[]): T | undefined {
  return values.find((value) => value != null && (typeof value !== 'string' || value.trim().length > 0)) ?? undefined;
}

export function enrichNovaPulsePresentation(input: NovaPulsePresentationInput): NovaPulsePresentationResult {
  const movieById = new Map((input.movies ?? []).map((movie) => [String(movie.id), movie]));
  const seriesById = new Map((input.series ?? []).map((series) => [String(series.id || series.seriesId), series]));
  const diagnostics: NovaPulsePresentationDiagnostics = {
    movieBackdropAvailable: 0,
    seriesBackdropAvailable: 0,
    movieDescriptionsLocal: 0,
    movieDescriptionsCached: 0,
    seriesDescriptionsLocal: 0,
    seriesDescriptionsCached: 0,
    cachedSeriesMetadataHits: 0,
    cachedMovieDetailHits: 0,
    nonEnglishDescriptionsRejected: 0,
    descriptionFallbackSucceeded: 0,
    descriptionOmittedForLanguage: 0,
  };

  const items = input.items.map((item) => {
    if (item.type === 'movie') {
      const movieId = item.sourceItemId ?? '';
      const local = movieById.get(movieId);
      const enriched = input.movieEnrichments?.get(movieId);
      const cached = enriched?.status === 'matched'
        ? enriched
        : input.getCachedMovieDetail?.(movieId) ?? null;
      if (cached) diagnostics.cachedMovieDetailHits += 1;
      const localDescription = item.description?.trim();
      const cachedDescription = cached?.synopsis?.trim();
      const descriptionCandidates = [localDescription, cachedDescription].filter((value): value is string => Boolean(value));
      const description = descriptionCandidates.find(isNovaPulseEnglishDescription);
      if (localDescription && !isNovaPulseEnglishDescription(localDescription)) diagnostics.nonEnglishDescriptionsRejected += 1;
      if (description && description !== localDescription) diagnostics.descriptionFallbackSucceeded += 1;
      if (descriptionCandidates.length && !description) diagnostics.descriptionOmittedForLanguage += 1;
      if (description === localDescription) diagnostics.movieDescriptionsLocal += 1;
      else if (description === cachedDescription) diagnostics.movieDescriptionsCached += 1;
      const backdropUrl = firstNonEmpty(cached?.backdropUrl, item.backdropUrl, local?.backdropUrl);
      if (backdropUrl) diagnostics.movieBackdropAvailable += 1;
      return {
        ...item,
        description,
        backdropUrl: backdropUrl ?? undefined,
        posterUrl: firstNonEmpty(cached?.posterUrl, item.posterUrl, local?.posterUrl),
        artworkUrl: firstNonEmpty(backdropUrl, cached?.posterUrl, item.posterUrl, local?.posterUrl, item.artworkUrl),
        genres: normalizeNovaPulseGenres(item.genres?.length ? item.genres : cached?.genres),
        runtimeMinutes: item.runtimeMinutes ?? runtimeMinutes(cached?.runtime),
        year: item.year ?? (cached?.year ? Number.parseInt(cached.year, 10) || undefined : undefined),
        rating: item.rating ?? cached?.rating,
        ratingSource: item.ratingSource ?? cached?.ratingSource,
        contentRating: item.contentRating ?? cached?.contentRating,
      };
    }

    if (item.type === 'series') {
      const seriesId = item.sourceItemId ?? '';
      const local = seriesById.get(seriesId);
      const cachedEntry = input.cachedSeriesMetadata?.get(seriesId);
      const cached = cachedEntry?.status === 'matched' ? cachedEntry.metadata : undefined;
      if (cached) diagnostics.cachedSeriesMetadataHits += 1;
      const localDescription = item.description?.trim();
      const cachedDescription = cached?.overview?.trim();
      const descriptionCandidates = [localDescription, cachedDescription].filter((value): value is string => Boolean(value));
      const description = descriptionCandidates.find(isNovaPulseEnglishDescription);
      if (localDescription && !isNovaPulseEnglishDescription(localDescription)) diagnostics.nonEnglishDescriptionsRejected += 1;
      if (description && description !== localDescription) diagnostics.descriptionFallbackSucceeded += 1;
      if (descriptionCandidates.length && !description) diagnostics.descriptionOmittedForLanguage += 1;
      if (description === localDescription) diagnostics.seriesDescriptionsLocal += 1;
      else if (description === cachedDescription) diagnostics.seriesDescriptionsCached += 1;
      const backdropUrl = firstNonEmpty(cached?.backdropPath, item.backdropUrl, local?.backdropUrl);
      if (backdropUrl) diagnostics.seriesBackdropAvailable += 1;
      return {
        ...item,
        description,
        backdropUrl: backdropUrl ?? undefined,
        posterUrl: firstNonEmpty(cached?.posterPath, item.posterUrl, local?.posterUrl),
        artworkUrl: firstNonEmpty(backdropUrl, cached?.posterPath, item.posterUrl, local?.posterUrl, item.artworkUrl),
        genres: normalizeNovaPulseGenres(item.genres?.length ? item.genres : cached?.genres),
        runtimeMinutes: item.runtimeMinutes ?? cached?.runtimeMinutes,
        year: item.year ?? cached?.year,
        rating: item.rating ?? cached?.rating,
        ratingSource: item.ratingSource ?? (cached?.rating != null ? 'TMDB' : undefined),
        network: cached?.network,
      };
    }

    return item;
  });

  return { items, diagnostics };
}
