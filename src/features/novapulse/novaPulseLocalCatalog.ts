import type { MovieSummary } from '../movies/movieTypes.ts';
import type { SeriesSummary } from '../media-browser/mediaTypes.ts';

export const NOVA_PULSE_LOCAL_CATALOG_LIMIT = 32;
export const NOVA_PULSE_RECENT_MOVIE_CATALOG_LIMIT = 24;

export type NovaPulseLocalCatalog = {
  movies: MovieSummary[];
  recentMovies: MovieSummary[];
  series: SeriesSummary[];
};

export function mergeNovaPulseMoviePools(
  generalMovies: readonly MovieSummary[],
  recentMovies: readonly MovieSummary[],
): MovieSummary[] {
  const seen = new Set<string>();
  return [...generalMovies, ...recentMovies].filter((movie) => {
    const id = String(movie.id ?? '').trim();
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

/**
 * Reads the already-published local catalog only. This deliberately uses the
 * SQLite-only sources rather than the SQLite-first screen wrappers so Home
 * cannot turn this bounded refresh into another provider request.
 */
export async function loadNovaPulseLocalCatalog(providerId: string, nowMs = Date.now()): Promise<NovaPulseLocalCatalog> {
  const [movieDataSource, seriesDataSource] = await Promise.all([
    import('../movies/data/SqliteMovieDataSource.ts'),
    import('../series/data/SqliteSeriesDataSource.ts'),
  ]);

  const [movieResult, recentMovieResult, seriesResult] = await Promise.allSettled([
    movieDataSource.createSqliteMovieDataSource(providerId).getMoviesPage({
      categoryId: 'all',
      offset: 0,
      limit: NOVA_PULSE_LOCAL_CATALOG_LIMIT,
      sort: 'title-asc',
    }),
    movieDataSource.getRecentlyAddedMovies(providerId, nowMs, NOVA_PULSE_RECENT_MOVIE_CATALOG_LIMIT),
    seriesDataSource.createSqliteSeriesDataSource(providerId).getSeriesPage({
      categoryId: 'all',
      offset: 0,
      limit: NOVA_PULSE_LOCAL_CATALOG_LIMIT,
      sort: 'title-asc',
    }),
  ]);

  return {
    movies: movieResult.status === 'fulfilled' ? movieResult.value.items : [],
    recentMovies: recentMovieResult.status === 'fulfilled' ? recentMovieResult.value : [],
    series: seriesResult.status === 'fulfilled' ? seriesResult.value.items : [],
  };
}
