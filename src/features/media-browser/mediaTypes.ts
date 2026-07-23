export type {
  MovieCategory as MediaCategory,
  MovieCategoryKind as MediaCategoryKind,
  MovieCategorySection as MediaCategorySection,
  MovieSummary as MovieMediaItem,
} from '../movies/movieTypes.ts';

export { SMART_CATEGORY_PREFIX as MEDIA_SMART_CATEGORY_PREFIX } from '../movies/movieTypes.ts';

export type MediaKind = 'movie' | 'series' | 'episode';

export type ContinueWatchingEntry = {
  mediaKind: 'movie' | 'episode';
  providerId: string;
  mediaId: string;
  seriesId?: string;
  seasonNumber?: string;
  episodeNumber?: string;
  episodeId?: string;
  title: string;
  seriesTitle?: string;
  artworkUrl?: string;
  categoryId?: string;
  positionMs: number;
  durationMs: number;
  progressPercent: number;
  lastWatchedAt: number;
};

export type WatchHistoryEntry = {
  mediaKind: 'movie' | 'episode';
  mediaId: string;
  seriesId?: string;
  seasonNumber?: string;
  episodeNumber?: string;
  title: string;
  artworkUrl?: string;
  categoryId?: string;
  seriesTitle?: string;
  watchedAt: number;
  progressPercent?: number;
  durationMs?: number;
};

export type SeriesSummary = {
  id: string;
  seriesId: string;
  categoryId: string;
  title: string;
  countryCode?: string;
  rawTitle?: string;
  year?: string;
  rating?: string;
  addedAt?: number;
  releaseDate?: string | number;
  latestEpisodeDate?: string | number;
  popularity?: number;
  description?: string;
  genres: string[];
  posterStyleKey: string;
  posterUrl?: string;
  backdropUrl?: string;
};

export type SeriesEpisodeSummary = {
  id: string;
  seriesId: string;
  title: string;
  seasonNumber: string;
  episodeNumber: string;
  streamId: string;
  extension: string;
  durationMinutes?: number;
  airDate?: string;
  imageUrl?: string;
  description?: string;
};

export type SeriesSeasonSummary = {
  id: string;
  label: string;
  seasonNumber: string;
  episodeCount: number;
};

export type SeriesDetail = {
  seriesId: string;
  title: string;
  description?: string;
  year?: string;
  releaseDate?: string;
  rating?: string;
  runtimeMinutes?: number;
  genres: string[];
  posterUrl?: string;
  backdropUrl?: string;
  logoUrl?: string;
  director?: string;
  writer?: string;
  studio?: string;
  country?: string;
  audio?: string;
  subtitles?: string;
  contentRating?: string;
  trailerUrl?: string;
  creator?: string;
  network?: string;
  cast?: string[];
  seasons: SeriesSeasonSummary[];
  episodesBySeason: Record<string, SeriesEpisodeSummary[]>;
};

export type MediaCastMember = {
  name: string;
  character?: string;
  imageUrl?: string;
};

export type MediaDetailEpisode = {
  id: string;
  seasonNumber: number;
  episodeNumber: number;
  title: string;
  runtime?: string;
  airDate?: string;
  imageUrl?: string;
  streamId?: string;
  extension?: string;
};

export type MediaDetailSeason = {
  seasonNumber: number;
  name?: string;
  episodeCount: number;
};

export type MediaDetail = {
  id: string;
  mediaType: 'movie' | 'series';
  title: string;
  posterUrl?: string;
  backdropUrl?: string;
  synopsis?: string;
  year?: string;
  releaseDate?: string;
  runtime?: string;
  genres: string[];
  cast: MediaCastMember[];
  director?: string;
  writer?: string;
  studio?: string;
  creator?: string;
  network?: string;
  country?: string;
  audio?: string;
  subtitles?: string;
  rating?: number;
  ratingSource?: string;
  contentRating?: string;
  trailerUrl?: string;
  seasons: MediaDetailSeason[];
  episodes: MediaDetailEpisode[];
};

export type MediaPage<T> = {
  items: T[];
  totalCount: number;
  hasMore: boolean;
};
