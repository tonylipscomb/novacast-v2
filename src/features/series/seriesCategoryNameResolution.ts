import {
  assignSeriesStreamCategoryId,
  derivedSeriesCategoryName,
  SERIES_UNKNOWN_CATEGORY_ID,
} from '../providers/seriesCatalogCompletion.ts';

export const SERIES_CATEGORY_NAME_AUDIT = '[NovaCast Series Category Name Audit]';

export const SERIES_CATEGORY_NAME_SAMPLE_IDS = [
  '2113',
  '2114',
  '2115',
  '2118',
  '2119',
  '2121',
  '2123',
  '2125',
] as const;

export type SeriesCategoryNameSource = 'metadata' | 'stream-row' | 'cache' | 'fallback';

export type SeriesCategoryNameResolution = {
  categoryId: string;
  resolvedName: string;
  nameSource: SeriesCategoryNameSource;
  metadataPresent: boolean;
  catalogEvidencePresent: boolean;
};

export type SeriesCategoryNameAuditSummary = {
  metadataCategoryCount: number;
  publishedCategoryCount: number;
  resolvedRealNameCount: number;
  fallbackNameCount: number;
};

const FALLBACK_PREFIX = /^series\s+/i;

export function isSeriesFallbackCategoryName(name: string | null | undefined, categoryId: string): boolean {
  const id = String(categoryId ?? '').trim();
  const trimmed = String(name ?? '').trim();
  if (!trimmed) {
    return true;
  }
  if (trimmed === derivedSeriesCategoryName(id)) {
    return true;
  }
  return FALLBACK_PREFIX.test(trimmed) && trimmed.replace(FALLBACK_PREFIX, '').trim() === id;
}

export function isTrustworthySeriesCategoryName(
  name: string | null | undefined,
  categoryId: string,
): boolean {
  const trimmed = String(name ?? '').trim();
  const id = String(categoryId ?? '').trim();
  if (!trimmed || !id) {
    return false;
  }
  if (trimmed === id) {
    return false;
  }
  return !isSeriesFallbackCategoryName(trimmed, id);
}

export function extractSeriesStreamRowCategoryName(record: {
  categoryId?: string | null;
  categoryName?: string | null;
  title?: string | null;
}): string | null {
  const categoryId = assignSeriesStreamCategoryId(record.categoryId);
  const candidate = String(record.categoryName ?? '').trim();
  const title = String(record.title ?? '').trim();
  if (!isTrustworthySeriesCategoryName(candidate, categoryId)) {
    return null;
  }
  // Dump rows sometimes repeat the show title in a name-like field. That is not a category.
  if (title && candidate.toLowerCase() === title.toLowerCase()) {
    return null;
  }
  return candidate;
}

export function collectSeriesStreamRowCategoryNames(
  records: Iterable<{
    categoryId?: string | null;
    categoryName?: string | null;
    title?: string | null;
  }>,
): Map<string, string> {
  const names = new Map<string, string>();
  for (const record of records) {
    const categoryId = assignSeriesStreamCategoryId(record.categoryId);
    if (categoryId === SERIES_UNKNOWN_CATEGORY_ID || names.has(categoryId)) {
      continue;
    }
    const name = extractSeriesStreamRowCategoryName(record);
    if (name) {
      names.set(categoryId, name);
    }
  }
  return names;
}

export function resolveSeriesCategoryName(input: {
  categoryId: string;
  metadataName?: string | null;
  catalogName?: string | null;
  cachedName?: string | null;
}): SeriesCategoryNameResolution {
  const categoryId = assignSeriesStreamCategoryId(input.categoryId);
  const metadataPresent = isTrustworthySeriesCategoryName(input.metadataName, categoryId);
  const catalogEvidencePresent = isTrustworthySeriesCategoryName(input.catalogName, categoryId);
  if (metadataPresent) {
    return {
      categoryId,
      resolvedName: String(input.metadataName).trim(),
      nameSource: 'metadata',
      metadataPresent,
      catalogEvidencePresent,
    };
  }
  if (catalogEvidencePresent) {
    return {
      categoryId,
      resolvedName: String(input.catalogName).trim(),
      nameSource: 'stream-row',
      metadataPresent,
      catalogEvidencePresent,
    };
  }
  if (isTrustworthySeriesCategoryName(input.cachedName, categoryId)) {
    return {
      categoryId,
      resolvedName: String(input.cachedName).trim(),
      nameSource: 'cache',
      metadataPresent,
      catalogEvidencePresent,
    };
  }
  return {
    categoryId,
    resolvedName: derivedSeriesCategoryName(categoryId),
    nameSource: 'fallback',
    metadataPresent,
    catalogEvidencePresent,
  };
}

export function enrichSeriesCategoryNames(input: {
  categories: Array<{ id: string; name: string; derived?: boolean }>;
  metadataNames?: Map<string, string> | Record<string, string>;
  streamRowNames?: Map<string, string> | Record<string, string>;
  cachedNames?: Map<string, string> | Record<string, string>;
}): {
  categories: Array<{ id: string; name: string; derived: boolean }>;
  resolutions: SeriesCategoryNameResolution[];
  summary: SeriesCategoryNameAuditSummary;
} {
  const metadataNames = toNameMap(input.metadataNames);
  const streamRowNames = toNameMap(input.streamRowNames);
  const cachedNames = toNameMap(input.cachedNames);
  const resolutions = input.categories.map((category) => {
    const categoryId = assignSeriesStreamCategoryId(category.id);
    return resolveSeriesCategoryName({
      categoryId,
      metadataName: metadataNames.get(categoryId) ?? (!category.derived ? category.name : null),
      catalogName: streamRowNames.get(categoryId) ?? null,
      cachedName: cachedNames.get(categoryId) ?? null,
    });
  });
  const categories = resolutions.map((resolution, index) => ({
    id: input.categories[index]?.id ?? resolution.categoryId,
    name: resolution.resolvedName,
    derived: resolution.nameSource === 'fallback',
  }));
  return {
    categories,
    resolutions,
    summary: summarizeSeriesCategoryNameResolutions(resolutions, metadataNames.size),
  };
}

export function summarizeSeriesCategoryNameResolutions(
  resolutions: SeriesCategoryNameResolution[],
  metadataCategoryCount: number,
): SeriesCategoryNameAuditSummary {
  let resolvedRealNameCount = 0;
  let fallbackNameCount = 0;
  for (const resolution of resolutions) {
    if (resolution.nameSource === 'fallback') {
      fallbackNameCount += 1;
    } else {
      resolvedRealNameCount += 1;
    }
  }
  return {
    metadataCategoryCount,
    publishedCategoryCount: resolutions.length,
    resolvedRealNameCount,
    fallbackNameCount,
  };
}

export function logSeriesCategoryNameAudit(fields: Record<string, unknown>): void {
  console.info(SERIES_CATEGORY_NAME_AUDIT, JSON.stringify(fields));
}

export function logSeriesCategoryNameEnrichment(input: {
  providerId: string;
  generation?: number | null;
  resolutions: SeriesCategoryNameResolution[];
  summary: SeriesCategoryNameAuditSummary;
  sampleCategoryIds?: readonly string[];
  streamRowNameCount?: number | null;
  firstItemKeys?: string[] | null;
  seriesCategoryNameFieldPresentCount?: number | null;
}): void {
  logSeriesCategoryNameAudit({
    event: 'summary',
    providerId: input.providerId,
    generation: input.generation ?? null,
    metadataCategoryCount: input.summary.metadataCategoryCount,
    publishedCategoryCount: input.summary.publishedCategoryCount,
    resolvedRealNameCount: input.summary.resolvedRealNameCount,
    fallbackNameCount: input.summary.fallbackNameCount,
    streamRowNameCount: input.streamRowNameCount ?? null,
    seriesCategoryNameFieldPresentCount: input.seriesCategoryNameFieldPresentCount ?? null,
    firstItemKeys: input.firstItemKeys ?? null,
  });
  const sampleIds = new Set(input.sampleCategoryIds ?? SERIES_CATEGORY_NAME_SAMPLE_IDS);
  for (const resolution of input.resolutions) {
    if (resolution.nameSource !== 'fallback' && !sampleIds.has(resolution.categoryId)) {
      continue;
    }
    logSeriesCategoryNameAudit({
      event: 'category',
      providerId: input.providerId,
      categoryId: resolution.categoryId,
      resolvedName: resolution.resolvedName,
      nameSource: resolution.nameSource,
      metadataPresent: resolution.metadataPresent,
      catalogEvidencePresent: resolution.catalogEvidencePresent,
    });
  }
}

function toNameMap(
  source?: Map<string, string> | Record<string, string>,
): Map<string, string> {
  if (!source) {
    return new Map();
  }
  if (source instanceof Map) {
    return source;
  }
  return new Map(Object.entries(source));
}
