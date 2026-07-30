import type { NativeCatalogRecord } from './nativeCatalogDecodeTypes.ts';

export function isCatalogSqliteWriterOnlyDiagnosticEnabled() {
  return (
    typeof process !== 'undefined' &&
    process.env?.EXPO_PUBLIC_CATALOG_SQLITE_WRITER_ONLY_DIAGNOSTIC === 'true'
  );
}

export function nativeRecordToMovieSummary(
  record: NativeCatalogRecord,
  categoryId: string,
): {
  id: string;
  categoryId: string;
  title: string;
  genres: string[];
  posterStyleKey: string;
  posterUrl?: string;
  rating?: string;
  releaseDate?: string;
  containerExtension?: string;
  providerSortOrder?: number;
} {
  return {
    id: record.contentId,
    categoryId: record.categoryId || categoryId,
    title: record.title,
    genres: [(record.categoryId || categoryId).replace(/-/g, ' ') || 'Movies'],
    posterStyleKey: 'native',
    posterUrl: record.artworkUrl ?? undefined,
    rating: record.rating != null ? String(record.rating) : undefined,
    releaseDate: record.releaseDate ?? undefined,
    containerExtension: record.streamExtension ?? undefined,
    providerSortOrder: record.providerSortOrder ?? undefined,
  };
}

export function nativeRecordToSeriesSummary(
  record: NativeCatalogRecord,
  categoryId: string,
): {
  id: string;
  seriesId: string;
  categoryId: string;
  title: string;
  genres: string[];
  posterStyleKey: string;
  posterUrl?: string;
  backdropUrl?: string;
  rating?: string;
  releaseDate?: string;
} {
  const seriesId = record.seriesId || record.contentId;
  return {
    id: seriesId,
    seriesId,
    categoryId: record.categoryId || categoryId,
    title: record.title,
    genres: [],
    posterStyleKey: 'native',
    posterUrl: record.artworkUrl ?? undefined,
    backdropUrl: record.backdropUrl ?? undefined,
    rating: record.rating != null ? String(record.rating) : undefined,
    releaseDate: record.releaseDate ?? undefined,
  };
}
