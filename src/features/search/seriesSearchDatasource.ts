/**
 * search-s4-authoritative-sqlite
 * Navbar Series Search datasource selection.
 *
 * A partially populated in-memory smart index is acceleration only.
 * When a readable SQLite generation exists, Search must query SQLite directly
 * so a partial index cannot return an authoritative false zero.
 */

import { resolveReadableCatalogGeneration } from '../catalog/catalogRepository.ts';
import { createSqliteSeriesDataSource } from '../series/data/SqliteSeriesDataSource.ts';
import type { SeriesDataSource } from '../series/data/SeriesDataSource.ts';

const SERIES_SQLITE_READS_ENABLED = process.env.EXPO_PUBLIC_SERIES_SQLITE_READS === 'true';

export type SeriesSearchDatasourceSelection = {
  providerId: string;
  dataSource: SeriesDataSource | null;
  selectedDatasource: 'sqlite-v2' | 'bundle' | 'none';
  readableGeneration: number;
  sqliteAvailable: boolean;
};

export async function resolveSeriesSearchDatasource(input: {
  providerId: string;
  query?: string;
  bundleSeriesDataSource?: SeriesDataSource | null;
}): Promise<SeriesSearchDatasourceSelection> {
  let readableGeneration = 0;

  try {
    readableGeneration = await resolveReadableCatalogGeneration(input.providerId, 'series');
  } catch {
    readableGeneration = 0;
  }

  const sqliteAvailable = SERIES_SQLITE_READS_ENABLED && readableGeneration > 0;
  if (sqliteAvailable) {
    const selection: SeriesSearchDatasourceSelection = {
      providerId: input.providerId,
      // search-s7-pinned-readable-generation
      dataSource: createSqliteSeriesDataSource(input.providerId, {
        searchReadableGeneration: readableGeneration,
      }),
      selectedDatasource: 'sqlite-v2',
      readableGeneration,
      sqliteAvailable: true,
    };

    console.info(
      '[NovaCast Series Search Datasource] ' +
        JSON.stringify({
          providerId: input.providerId,
          query: input.query ?? '',
          selectedDatasource: selection.selectedDatasource,
          readableGeneration,
          sqliteAvailable: true,
          marker: 'search-s4-authoritative-sqlite',
        }),
    );

    return selection;
  }

  const fallback = input.bundleSeriesDataSource ?? null;
  const selection: SeriesSearchDatasourceSelection = {
    providerId: input.providerId,
    dataSource: fallback,
    selectedDatasource: fallback ? 'bundle' : 'none',
    readableGeneration,
    sqliteAvailable: false,
  };

  console.info(
    '[NovaCast Series Search Datasource] ' +
      JSON.stringify({
        providerId: input.providerId,
        query: input.query ?? '',
        selectedDatasource: selection.selectedDatasource,
        readableGeneration,
        sqliteAvailable: false,
        marker: 'search-s4-authoritative-sqlite',
      }),
  );

  return selection;
}