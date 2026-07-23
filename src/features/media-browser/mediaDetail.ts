import type { MovieSummary } from '../movies/movieTypes.ts';
import type {
  MediaCastMember,
  MediaDetail,
  SeriesDetail,
  SeriesEpisodeSummary,
} from './mediaTypes.ts';

function cleanText(value: unknown) {
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }

  return undefined;
}

function toNumber(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}

function formatRuntimeMinutes(minutes: number | undefined) {
  if (!minutes || minutes <= 0) {
    return undefined;
  }

  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return hours > 0 ? `${hours}h ${remainder}m` : `${remainder}m`;
}

export function normalizeStringList(value: unknown) {
  if (Array.isArray(value)) {
    return value.map(cleanText).filter((item): item is string => Boolean(item));
  }

  const text = cleanText(value);
  return text
    ? text
        .split(/[,|]/)
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
}

export function normalizeCast(value: unknown): MediaCastMember[] {
  if (Array.isArray(value)) {
    return value
      .map((item): MediaCastMember | null => {
        if (typeof item === 'string') {
          const name = item.trim();
          return name ? { name } : null;
        }

        if (item && typeof item === 'object') {
          const entry = item as Record<string, unknown>;
          const name = cleanText(entry.name ?? entry.actor);
          if (!name) {
            return null;
          }

          const character = cleanText(entry.character ?? entry.role);
          const imageUrl = cleanText(entry.profile_path ?? entry.profilePath ?? entry.image);

          return {
            name,
            ...(character ? { character } : {}),
            ...(imageUrl ? { imageUrl } : {}),
          };
        }

        return null;
      })
      .filter((item): item is MediaCastMember => Boolean(item));
  }

  return normalizeStringList(value).map((name) => ({ name }));
}

export function normalizeTrailerUrl(value: unknown) {
  const trailer = cleanText(value);
  if (!trailer) {
    return undefined;
  }

  if (/^https?:\/\//i.test(trailer)) {
    return trailer;
  }

  return `https://www.youtube.com/watch?v=${encodeURIComponent(trailer)}`;
}

export function buildMoviePreviewDetail(movie: MovieSummary): MediaDetail {
  return {
    id: movie.id,
    mediaType: 'movie',
    title: movie.title,
    posterUrl: movie.posterUrl,
    synopsis: movie.description,
    year: movie.year ? String(movie.year) : undefined,
    releaseDate: movie.releaseDate ? String(movie.releaseDate) : undefined,
    runtime: formatRuntimeMinutes(movie.durationMinutes),
    genres: movie.genres.filter(Boolean),
    cast: normalizeCast(movie.cast),
    director: movie.director,
    audio: movie.audio,
    subtitles: movie.subtitles,
    rating: toNumber(movie.rating),
    ratingSource: movie.rating ? 'Provider' : undefined,
    seasons: [],
    episodes: [],
  };
}

function mapSeriesEpisode(episode: SeriesEpisodeSummary): MediaDetail['episodes'][number] {
  const seasonNumber = Number(episode.seasonNumber);
  const episodeNumber = Number(episode.episodeNumber);

  return {
    id: episode.id,
    seasonNumber: Number.isFinite(seasonNumber) ? seasonNumber : 0,
    episodeNumber: Number.isFinite(episodeNumber) ? episodeNumber : 0,
    title: episode.title,
    runtime: formatRuntimeMinutes(episode.durationMinutes),
    airDate: episode.airDate,
    imageUrl: episode.imageUrl,
    streamId: episode.streamId,
    extension: episode.extension,
  };
}

export function buildSeriesMediaDetail(detail: SeriesDetail): MediaDetail {
  const episodes = Object.values(detail.episodesBySeason)
    .flat()
    .map(mapSeriesEpisode)
    .sort((left, right) => left.seasonNumber - right.seasonNumber || left.episodeNumber - right.episodeNumber);

  return {
    id: detail.seriesId,
    mediaType: 'series',
    title: detail.title,
    posterUrl: detail.posterUrl,
    backdropUrl: detail.backdropUrl,
    synopsis: detail.description,
    year: detail.year,
    releaseDate: detail.releaseDate,
    runtime: formatRuntimeMinutes(detail.runtimeMinutes),
    genres: detail.genres.filter(Boolean),
    cast: normalizeCast(detail.cast),
    director: detail.director,
    writer: detail.writer,
    studio: detail.studio,
    creator: detail.creator,
    network: detail.network,
    country: detail.country,
    audio: detail.audio,
    subtitles: detail.subtitles,
    rating: toNumber(detail.rating),
    ratingSource: detail.rating ? 'Provider' : undefined,
    contentRating: detail.contentRating,
    trailerUrl: detail.trailerUrl,
    seasons: detail.seasons.map((season) => ({
      seasonNumber: Number(season.seasonNumber),
      name: season.label,
      episodeCount: season.episodeCount,
    })),
    episodes,
  };
}

export function buildSeriesPreviewDetail(input: {
  id: string;
  title: string;
  year?: string;
  rating?: string;
  description?: string;
  genres: string[];
  posterUrl?: string;
}): MediaDetail {
  return {
    id: input.id,
    mediaType: 'series',
    title: input.title,
    posterUrl: input.posterUrl,
    synopsis: input.description,
    year: input.year,
    genres: input.genres.filter(Boolean),
    cast: [],
    rating: toNumber(input.rating),
    ratingSource: input.rating ? 'Provider' : undefined,
    seasons: [],
    episodes: [],
  };
}
