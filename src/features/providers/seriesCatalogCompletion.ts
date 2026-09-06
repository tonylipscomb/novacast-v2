import { fallbackProviderCategoryId } from './categoryNormalization.ts';

export type SeriesCatalogIngestionStrategy = 'full-dump-stream-category';

export const SERIES_UNKNOWN_CATEGORY_ID = fallbackProviderCategoryId('series');

export type SeriesCatalogCompletionInput = {
  strategy: SeriesCatalogIngestionStrategy;
  fullDumpCompleted: boolean;
  decodedSeriesCount: number;
  distinctSeriesIds: number;
  distinctStreamCategoryIds: number;
  categoryAssignmentFinished: boolean;
  sqliteWriterEnabled: boolean;
  cancelled: boolean;
  staleGeneration: boolean;
  fatalError: boolean;
};

export type SeriesCatalogCompletionDecision = {
  publish: boolean;
  completionDecision: 'publish' | 'reject';
  completionReason: string;
};

export function canonicalSeriesContentId(record: {
  contentId?: string | null;
  seriesId?: string | null;
}): string {
  const seriesId = typeof record.seriesId === 'string' ? record.seriesId.trim() : '';
  if (seriesId) {
    return seriesId;
  }
  return typeof record.contentId === 'string' ? record.contentId.trim() : '';
}

export function derivedSeriesCategoryName(categoryId: string): string {
  const id = String(categoryId ?? '').trim();
  if (!id || id === SERIES_UNKNOWN_CATEGORY_ID) {
    return 'Unknown';
  }
  return `Series ${id}`;
}

export function assignSeriesStreamCategoryId(rawCategoryId: unknown): string {
  const id = String(rawCategoryId ?? '').trim();
  return id || SERIES_UNKNOWN_CATEGORY_ID;
}

export function mergeSeriesMetadataWithDumpCategories(input: {
  metadata: Array<{ id: string; name: string }>;
  streamCategoryIds: Iterable<string>;
  missingCategoryIdCount: number;
}): {
  categories: Array<{ id: string; name: string; derived: boolean }>;
  streamCategoryIdsMissingFromMetadata: string[];
  unknownCategoryAssignedCount: number;
} {
  const metadata = input.metadata
    .map((category) => ({
      id: String(category.id ?? '').trim(),
      name: String(category.name ?? '').trim() || derivedSeriesCategoryName(String(category.id ?? '')),
      derived: false,
    }))
    .filter((category) => category.id);
  const known = new Set(metadata.map((category) => category.id));
  const missing = unknownSeriesStreamCategoryIds(known, input.streamCategoryIds);
  const derived = missing.map((id) => ({
    id,
    name: derivedSeriesCategoryName(id),
    derived: true,
  }));
  const categories = [...metadata, ...derived];
  if (input.missingCategoryIdCount > 0 && !known.has(SERIES_UNKNOWN_CATEGORY_ID)) {
    categories.push({
      id: SERIES_UNKNOWN_CATEGORY_ID,
      name: derivedSeriesCategoryName(SERIES_UNKNOWN_CATEGORY_ID),
      derived: true,
    });
  }
  return {
    categories,
    streamCategoryIdsMissingFromMetadata: missing,
    unknownCategoryAssignedCount: missing.length + (input.missingCategoryIdCount > 0 ? 1 : 0),
  };
}

export function unknownSeriesStreamCategoryIds(
  metadataCategoryIds: Iterable<string>,
  streamCategoryIds: Iterable<string>,
): string[] {
  const known = new Set(
    Array.from(metadataCategoryIds)
      .map((id) => String(id).trim())
      .filter(Boolean),
  );
  const unknown: string[] = [];
  for (const raw of streamCategoryIds) {
    const id = String(raw).trim();
    if (id && !known.has(id)) {
      unknown.push(id);
    }
  }
  unknown.sort();
  return unknown;
}

export function decideSeriesCatalogCompletion(
  input: SeriesCatalogCompletionInput,
): SeriesCatalogCompletionDecision {
  if (input.cancelled || input.staleGeneration) {
    return {
      publish: false,
      completionDecision: 'reject',
      completionReason: 'cancelled-or-stale',
    };
  }
  if (input.fatalError) {
    return {
      publish: false,
      completionDecision: 'reject',
      completionReason: 'fatal-decode-or-write',
    };
  }
  if (!input.sqliteWriterEnabled) {
    return {
      publish: false,
      completionDecision: 'reject',
      completionReason: 'sqlite-writer-invalid',
    };
  }
  if (!input.fullDumpCompleted) {
    return {
      publish: false,
      completionDecision: 'reject',
      completionReason: 'full-dump-not-completed',
    };
  }
  if (input.decodedSeriesCount <= 0 || input.distinctSeriesIds <= 0) {
    return {
      publish: false,
      completionDecision: 'reject',
      completionReason: 'full-dump-empty',
    };
  }
  if (!input.categoryAssignmentFinished) {
    return {
      publish: false,
      completionDecision: 'reject',
      completionReason: 'category-assignment-invalid',
    };
  }
  return {
    publish: true,
    completionDecision: 'publish',
    completionReason: 'full-dump-succeeded',
  };
}

export function logSeriesCompletionProbe(fields: Record<string, unknown>) {
  console.info('[NovaCast Series Completion Probe]', JSON.stringify(fields));
}

export function logSeriesFullDumpSync(fields: Record<string, unknown>) {
  console.info(
    '[NovaCast Series Full Dump Sync]',
    JSON.stringify({
      strategy: 'full-dump-stream-category',
      ...fields,
    }),
  );
}
