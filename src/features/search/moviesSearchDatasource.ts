/**
 * Stage 3G — choose the Movies search datasource (SQLite-first).
 */

import { resolveReadableCatalogGeneration } from '../catalog/catalogRepository.ts';
import type { MovieDataSource } from '../movies/data/MovieDataSource.ts';
import { createSqliteMovieDataSource } from '../movies/data/SqliteMovieDataSource.ts';

const MOVIES_SQLITE_READS_ENABLED = process.env.EXPO_PUBLIC_MOVIES_SQLITE_READS === 'true';

export type MoviesSearchDatasourceSelection = {
  providerId: string;
  dataSource: MovieDataSource | null;
  selectedDatasource: 'sqlite-v2' | 'browse-bundle' | 'none';
  readableGeneration: number;
  sqliteAvailable: boolean;
  providerFallbackAllowed: boolean;
  fallbackReason: string | null;
};

export async function resolveMoviesSearchDatasource(input: {
  providerId: string;
  query?: string;
  browseDataSource?: MovieDataSource | null;
  bundleMovies?: MovieDataSource | null;
}): Promise<MoviesSearchDatasourceSelection> {
  const providerId = input.providerId;
  let readableGeneration = 0;
  try {
    readableGeneration = await resolveReadableCatalogGeneration(providerId, 'movie');
  } catch {
    readableGeneration = 0;
  }

  const sqliteAvailable = MOVIES_SQLITE_READS_ENABLED && readableGeneration > 0;
  if (sqliteAvailable) {
    // search-s7-pinned-readable-generation
    const sqlite = createSqliteMovieDataSource(providerId, {
      searchReadableGeneration: readableGeneration,
    });
    const selection: MoviesSearchDatasourceSelection = {
      providerId,
      dataSource: sqlite,
      selectedDatasource: 'sqlite-v2',
      readableGeneration,
      sqliteAvailable: true,
      providerFallbackAllowed: false,
      fallbackReason: null,
    };
    console.info('[NovaCast Movies Search Datasource] ' + JSON.stringify({
      providerId,
      query: input.query ?? '',
      selectedDatasource: selection.selectedDatasource,
      readableGeneration,
      sqliteAvailable: true,
      providerFallbackAllowed: false,
      fallbackReason: null,
      marker: 'stage3g-sqlite-movies-search-v1',
    }));
    return selection;
  }

  const browse = input.browseDataSource ?? null;
  const bundle = input.bundleMovies ?? null;
  // Never prefer Xtream bundle when a browse SQLite wrapper exists.
  const dataSource =
    browse?.sourceKind === 'sqlite'
      ? browse
      : bundle?.sourceKind === 'sqlite'
        ? bundle
        : browse ?? bundle;

  const selectedDatasource =
    dataSource?.sourceKind === 'sqlite'
      ? 'sqlite-v2'
      : dataSource
        ? 'browse-bundle'
        : 'none';

  const providerFallbackAllowed = selectedDatasource !== 'sqlite-v2';
  const fallbackReason = !MOVIES_SQLITE_READS_ENABLED
    ? 'sqlite-reads-disabled'
    : readableGeneration <= 0
      ? 'no-readable-generation'
      : selectedDatasource === 'browse-bundle'
        ? 'using-bundle-or-browse-fallback'
        : 'no-datasource';

  console.info('[NovaCast Movies Search Datasource] ' + JSON.stringify({
    providerId,
    query: input.query ?? '',
    selectedDatasource,
    readableGeneration,
    sqliteAvailable: false,
    providerFallbackAllowed,
    fallbackReason,
    marker: 'stage3g-sqlite-movies-search-v1',
  }));

  return {
    providerId,
    dataSource,
    selectedDatasource,
    readableGeneration,
    sqliteAvailable: false,
    providerFallbackAllowed,
    fallbackReason,
  };
}

export function isSqliteMovieDataSource(dataSource: MovieDataSource | null | undefined) {
  return dataSource?.sourceKind === 'sqlite';
}
