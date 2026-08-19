import type { NativeCatalogRecord } from './nativeCatalogDecodeTypes.ts';
import { resolveCatalogItemCategoryId } from './vodCategoryFilterCapability.ts';

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
  addedAt?: number;
  popularity?: number;
  releaseDate?: string;
  year?: number;
  containerExtension?: string;
  providerSortOrder?: number;
} {
  const resolvedCategoryId = resolveCatalogItemCategoryId(record.categoryId, categoryId, {
    allowFallback: true,
  });
  return {
    id: record.contentId,
    categoryId: resolvedCategoryId,
    title: record.title,
    genres: [resolvedCategoryId.replace(/-/g, ' ') || 'Movies'],
    posterStyleKey: 'native',
    posterUrl: record.artworkUrl ?? undefined,
    rating: record.rating != null ? String(record.rating) : undefined,
    addedAt: typeof record.addedAt === 'number' ? record.addedAt : undefined,
    popularity: typeof record.popularity === 'number' ? record.popularity : undefined,
    releaseDate: record.releaseDate ?? undefined,
    year: typeof record.releaseYear === 'number' ? record.releaseYear : undefined,
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
  addedAt?: number;
  popularity?: number;
  releaseDate?: string;
  year?: number;
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
    addedAt: typeof record.addedAt === 'number' ? record.addedAt : undefined,
    popularity: typeof record.popularity === 'number' ? record.popularity : undefined,
    releaseDate: record.releaseDate ?? undefined,
    year: typeof record.releaseYear === 'number' ? record.releaseYear : undefined,
  };
}
