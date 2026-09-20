import type { MovieSummary } from '../movies/movieTypes.ts';
import type { SeriesSummary } from '../media-browser/mediaTypes.ts';

export const NOVA_PULSE_LOCAL_CATALOG_LIMIT = 32;

export type NovaPulseLocalCatalog = {
  movies: MovieSummary[];
  series: SeriesSummary[];
};

/**
 * Reads the already-published local catalog only. This deliberately uses the
 * SQLite-only sources rather than the SQLite-first screen wrappers so Home
 * cannot turn this bounded refresh into another provider request.
 */
export async function loadNovaPulseLocalCatalog(providerId: string): Promise<NovaPulseLocalCatalog> {
  const [{ createSqliteMovieDataSource }, { createSqliteSeriesDataSource }] = await Promise.all([
    import('../movies/data/SqliteMovieDataSource.ts'),
    import('../series/data/SqliteSeriesDataSource.ts'),
  ]);

  const [movieResult, seriesResult] = await Promise.allSettled([
    createSqliteMovieDataSource(providerId).getMoviesPage({
      categoryId: 'all',
      offset: 0,
      limit: NOVA_PULSE_LOCAL_CATALOG_LIMIT,
      sort: 'title-asc',
    }),
    createSqliteSeriesDataSource(providerId).getSeriesPage({
      categoryId: 'all',
      offset: 0,
      limit: NOVA_PULSE_LOCAL_CATALOG_LIMIT,
      sort: 'title-asc',
    }),
  ]);

  return {
    movies: movieResult.status === 'fulfilled' ? movieResult.value.items : [],
    series: seriesResult.status === 'fulfilled' ? seriesResult.value.items : [],
  };
}
