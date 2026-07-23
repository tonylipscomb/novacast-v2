// Requires EXPO_PUBLIC_TMDB_API_KEY in env for live lookups. Structure works without a key.
import { extractYearFromTitle, normalizeProviderTitle } from './titleNormalization.ts';

const TMDB_BASE = 'https://api.themoviedb.org/3';
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p';

export type TmdbSeriesMatch = {
  tmdbId: number;
  title: string;
  originalTitle?: string;
  overview?: string;
  year?: number;
  rating?: number;
  posterPath?: string;
  backdropPath?: string;
  genres: string[];
  runtimeMinutes?: number;
  seasons?: number;
  episodes?: number;
  network?: string;
  creator?: string;
  cast?: string[];
};

export type TmdbSearchResult = {
  id: number;
  name: string;
  original_name?: string;
  overview?: string;
  first_air_date?: string;
  vote_average?: number;
  popularity?: number;
  poster_path?: string;
  backdrop_path?: string;
};

function getApiKey() {
  return process.env.EXPO_PUBLIC_TMDB_API_KEY?.trim() ?? '';
}

function buildImageUrl(path?: string, size: 'w342' | 'w500' | 'w780' | 'original' = 'w500') {
  if (!path?.trim()) {
    return undefined;
  }
  return `${TMDB_IMAGE_BASE}/${size}${path}`;
}

export function hasTmdbApiKey() {
  return Boolean(getApiKey());
}

export async function searchTmdbSeries(title: string, year?: number): Promise<TmdbSearchResult[]> {
  const apiKey = getApiKey();
  if (!apiKey) {
    return [];
  }

  const query = normalizeProviderTitle(title);
  if (!query) {
    return [];
  }

  const params = new URLSearchParams({
    api_key: apiKey,
    query,
    include_adult: 'false',
    language: 'en-US',
  });
  if (year) {
    params.set('first_air_date_year', String(year));
  }

  const response = await fetch(`${TMDB_BASE}/search/tv?${params.toString()}`);
  if (!response.ok) {
    return [];
  }

  const payload = (await response.json()) as { results?: TmdbSearchResult[] };
  return Array.isArray(payload.results) ? payload.results : [];
}

export async function fetchTmdbSeriesDetails(tmdbId: number): Promise<TmdbSeriesMatch | null> {
  const apiKey = getApiKey();
  if (!apiKey || !Number.isFinite(tmdbId)) {
    return null;
  }

  const params = new URLSearchParams({
    api_key: apiKey,
    language: 'en-US',
    append_to_response: 'credits',
  });

  const response = await fetch(`${TMDB_BASE}/tv/${tmdbId}?${params.toString()}`);
  if (!response.ok) {
    return null;
  }

  const payload = (await response.json()) as {
    id: number;
    name?: string;
    original_name?: string;
    overview?: string;
    first_air_date?: string;
    vote_average?: number;
    poster_path?: string;
    backdrop_path?: string;
    episode_run_time?: number[];
    number_of_seasons?: number;
    number_of_episodes?: number;
    genres?: { name?: string }[];
    networks?: { name?: string }[];
    created_by?: { name?: string }[];
    credits?: { cast?: { name?: string }[] };
  };

  const year = payload.first_air_date ? Number.parseInt(payload.first_air_date.slice(0, 4), 10) : undefined;
  const runtimeMinutes = Array.isArray(payload.episode_run_time) ? payload.episode_run_time[0] : undefined;

  return {
    tmdbId: payload.id,
    title: payload.name?.trim() || `Series ${payload.id}`,
    originalTitle: payload.original_name?.trim(),
    overview: payload.overview?.trim(),
    year: Number.isFinite(year) ? year : undefined,
    rating: typeof payload.vote_average === 'number' ? payload.vote_average : undefined,
    posterPath: buildImageUrl(payload.poster_path, 'w500'),
    backdropPath: buildImageUrl(payload.backdrop_path, 'w780'),
    genres: (payload.genres ?? []).map((genre) => genre.name?.trim() || '').filter(Boolean),
    runtimeMinutes,
    seasons: payload.number_of_seasons,
    episodes: payload.number_of_episodes,
    network: payload.networks?.[0]?.name?.trim(),
    creator: payload.created_by?.[0]?.name?.trim(),
    cast: (payload.credits?.cast ?? []).slice(0, 8).map((person) => person.name?.trim() || '').filter(Boolean),
  };
}

export function pickBestTmdbMatch(title: string, candidates: TmdbSearchResult[], expectedYear?: number) {
  const normalized = normalizeProviderTitle(title);
  const fallbackYear = expectedYear ?? extractYearFromTitle(title);

  let best: TmdbSearchResult | null = null;
  let bestScore = 0;

  for (const candidate of candidates) {
    const candidateYear = candidate.first_air_date ? Number.parseInt(candidate.first_air_date.slice(0, 4), 10) : undefined;
    let score = 0;

    const candidateTitle = normalizeProviderTitle(candidate.name ?? '');
    if (candidateTitle.toLowerCase() === normalized.toLowerCase()) {
      score += 1;
    } else if (candidateTitle.toLowerCase().includes(normalized.toLowerCase()) || normalized.toLowerCase().includes(candidateTitle.toLowerCase())) {
      score += 0.7;
    }

    if (fallbackYear && candidateYear && Math.abs(fallbackYear - candidateYear) <= 1) {
      score += 0.2;
    }

    score += Math.min(0.2, (candidate.popularity ?? 0) / 1000);
    score += Math.min(0.1, (candidate.vote_average ?? 0) / 100);

    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }

  return bestScore >= 0.7 ? best : null;
}
