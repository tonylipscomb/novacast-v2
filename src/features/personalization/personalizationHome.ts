import type { ProviderRepositoryBundle } from '../providers/providerBundle.ts';
import { getMovieCatalogIndex } from '../movies/smart/movieCatalogIndex.ts';
import { getMovieLibraryState } from '../movies/smart/movieLibraryStore.ts';
import { getSeriesCatalogIndex } from '../series/smart/seriesCatalogIndex.ts';
import { getMediaLibraryState } from '../media-browser/mediaLibraryStore.ts';

import {
  dedupeRecentItems,
  isContinueWatchingEligible,
  progressPercent,
  type HomeContinueWatchingItem,
  type RecentItemRecord,
} from './personalizationModel';
import { getLiveFavoriteEntries, getPersonalizationState } from './personalizationStore';
import type { MovieSummary } from '../movies/movieTypes.ts';
import type { SeriesSummary } from '../media-browser/mediaTypes.ts';

export type HomeFavoriteChannel = {
  id: string;
  title: string;
  artworkUrl?: string;
  categoryId?: string;
};

export type HomeFavoriteMovie = MovieSummary;
export type HomeFavoriteSeries = SeriesSummary;

export type HomePersonalizationSnapshot = {
  providerId: string;
  continueWatching: HomeContinueWatchingItem[];
  favoriteChannels: HomeFavoriteChannel[];
  favoriteMovies: HomeFavoriteMovie[];
  favoriteSeries: HomeFavoriteSeries[];
  recentlyWatched: RecentItemRecord[];
};

function emptySnapshot(): HomePersonalizationSnapshot {
  return {
    providerId: '',
    continueWatching: [],
    favoriteChannels: [],
    favoriteMovies: [],
    favoriteSeries: [],
    recentlyWatched: [],
  };
}

export async function loadHomePersonalization(providerId: string, bundle: ProviderRepositoryBundle | null) {
  if (!providerId) {
    return emptySnapshot();
  }

  const [movieLibrary, mediaLibrary, providerPersonalization, liveFavorites] = await Promise.all([
    getMovieLibraryState(providerId),
    getMediaLibraryState(providerId),
    getPersonalizationState(providerId),
    getLiveFavoriteEntries(providerId),
  ]);

  const movieIndex = getMovieCatalogIndex(providerId);
  const seriesIndex = getSeriesCatalogIndex(providerId);

  const movieContinue = movieLibrary.watchHistory
    .map((entry) => {
      const durationMs = entry.durationMs ?? 0;
      const positionMs = durationMs > 0 ? (durationMs * (entry.progressPercent ?? 0)) / 100 : 0;
      const movie = movieIndex.getEntry(entry.movieId);
      return {
        providerId,
        mediaType: 'movie' as const,
        contentId: entry.movieId,
        title: movie?.title ?? entry.title,
        artworkUrl: movie?.posterUrl ?? entry.artworkUrl,
        positionMs,
        durationMs,
        progressPercent: progressPercent(positionMs, durationMs),
        updatedAt: entry.watchedAt,
      } satisfies HomeContinueWatchingItem;
    })
    .filter((entry) => isContinueWatchingEligible(entry.positionMs, entry.durationMs));

  const episodeContinue = mediaLibrary.continueWatching
    .map((entry) => {
      const series = entry.seriesId ? seriesIndex.getEntry(entry.seriesId) : undefined;
      const title = entry.seriesTitle ? `${entry.seriesTitle}: ${entry.title}` : entry.title;
      return {
        providerId,
        mediaType: 'episode' as const,
        contentId: entry.mediaId,
        title,
        subtitle: entry.seriesTitle
          ? `${entry.seriesTitle} - S${entry.seasonNumber ?? '?'} E${entry.episodeNumber ?? '?'}`
          : `S${entry.seasonNumber ?? '?'} E${entry.episodeNumber ?? '?'}`,
        artworkUrl: entry.artworkUrl ?? series?.posterUrl,
        parentSeriesId: entry.seriesId,
        episodeId: entry.episodeId,
        seasonNumber: entry.seasonNumber,
        episodeNumber: entry.episodeNumber,
        positionMs: entry.positionMs,
        durationMs: entry.durationMs,
        progressPercent: progressPercent(entry.positionMs, entry.durationMs),
        updatedAt: entry.lastWatchedAt,
      } satisfies HomeContinueWatchingItem;
    })
    .filter((entry) => isContinueWatchingEligible(entry.positionMs, entry.durationMs));

  const favoriteMovieIds = movieLibrary.favorites;
  const favoriteSeriesIds = [
    ...new Set([
      ...mediaLibrary.favoriteRecords.filter((item) => item.mediaType === 'series').map((item) => item.contentId),
      ...mediaLibrary.favorites,
    ]),
  ];
  const favoriteMovies = movieIndex.getSummaries(favoriteMovieIds);
  const favoriteSeries = seriesIndex.getSummaries(favoriteSeriesIds);

  const historyItems: RecentItemRecord[] = [
    ...movieLibrary.watchHistory.map((entry) => ({
      providerId,
      mediaType: 'movie' as const,
      contentId: entry.movieId,
      title: entry.title,
      artworkUrl: entry.artworkUrl ?? movieIndex.getEntry(entry.movieId)?.posterUrl,
      lastOpenedAt: entry.watchedAt,
    })),
    ...mediaLibrary.watchHistory.map((entry) => ({
      providerId,
      mediaType: entry.mediaKind,
      contentId: entry.mediaId,
      title: entry.seriesTitle ? `${entry.seriesTitle}: ${entry.title}` : entry.title,
      artworkUrl: entry.artworkUrl ?? (entry.seriesId ? seriesIndex.getEntry(entry.seriesId)?.posterUrl : undefined),
      parentSeriesId: entry.seriesId,
      seasonNumber: entry.seasonNumber,
      episodeNumber: entry.episodeNumber,
      lastOpenedAt: entry.watchedAt,
    })),
    ...providerPersonalization.recentItems,
  ];

  return {
    providerId,
    continueWatching: [...movieContinue, ...episodeContinue].sort((left, right) => right.updatedAt - left.updatedAt).slice(0, 20),
    favoriteChannels: liveFavorites.map((item) => ({
      id: item.contentId,
      title: item.title,
      artworkUrl: item.artworkUrl,
      categoryId: item.categoryId,
    })),
    favoriteMovies,
    favoriteSeries,
    recentlyWatched: dedupeRecentItems(historyItems),
  } satisfies HomePersonalizationSnapshot;
}
