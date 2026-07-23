import { extractYearFromTitle, normalizeProviderTitle } from './titleNormalization.ts';
import {
  getSeriesMetadataCacheEntry,
  markSeriesMetadataFailed,
  markSeriesMetadataMatched,
  type SeriesMetadataCacheEntry,
} from './seriesMetadataCache.ts';
import {
  fetchTmdbSeriesDetails,
  hasTmdbApiKey,
  pickBestTmdbMatch,
  searchTmdbSeries,
  type TmdbSeriesMatch,
} from './tmdbClient.ts';

export type SeriesMetadataMatchResult = {
  status: 'matched' | 'failed' | 'cached';
  metadata?: TmdbSeriesMatch;
  cacheEntry?: SeriesMetadataCacheEntry;
  failureReason?: string;
};

export async function matchSeriesMetadata(input: {
  providerId: string;
  seriesId: string;
  providerTitle: string;
  forceRefresh?: boolean;
}): Promise<SeriesMetadataMatchResult> {
  const normalizedTitle = normalizeProviderTitle(input.providerTitle);
  const expectedYear = extractYearFromTitle(input.providerTitle);

  if (!input.forceRefresh) {
    const cached = await getSeriesMetadataCacheEntry(input.providerId, input.seriesId);
    if (cached) {
      return {
        status: 'cached',
        metadata: cached.metadata,
        cacheEntry: cached,
        failureReason: cached.failureReason,
      };
    }
  }

  if (!hasTmdbApiKey()) {
    await markSeriesMetadataFailed({
      providerId: input.providerId,
      seriesId: input.seriesId,
      providerTitle: input.providerTitle,
      normalizedTitle,
      failureReason: 'TMDB API key missing (set EXPO_PUBLIC_TMDB_API_KEY)',
    });
    return { status: 'failed', failureReason: 'TMDB API key missing' };
  }

  const candidates = await searchTmdbSeries(normalizedTitle, expectedYear);
  const best = pickBestTmdbMatch(normalizedTitle, candidates, expectedYear);

  if (!best) {
    await markSeriesMetadataFailed({
      providerId: input.providerId,
      seriesId: input.seriesId,
      providerTitle: input.providerTitle,
      normalizedTitle,
      failureReason: 'No confident TMDb match',
    });
    return { status: 'failed', failureReason: 'No confident TMDb match' };
  }

  const metadata = await fetchTmdbSeriesDetails(best.id);
  if (!metadata) {
    await markSeriesMetadataFailed({
      providerId: input.providerId,
      seriesId: input.seriesId,
      providerTitle: input.providerTitle,
      normalizedTitle,
      failureReason: 'TMDb details unavailable',
    });
    return { status: 'failed', failureReason: 'TMDb details unavailable' };
  }

  await markSeriesMetadataMatched({
    providerId: input.providerId,
    seriesId: input.seriesId,
    providerTitle: input.providerTitle,
    normalizedTitle,
    tmdbId: metadata.tmdbId,
    metadata,
  });

  return { status: 'matched', metadata };
}
