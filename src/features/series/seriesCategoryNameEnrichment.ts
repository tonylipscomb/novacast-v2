import {
  listKnownSeriesCategoryNames,
  updatePublishedSeriesCategoryNames,
} from '../catalog/catalogRepository.ts';
import { isTrustworthySeriesCategoryName } from './seriesCategoryNameResolution.ts';
import {
  getCachedSeriesCategoryNames,
  rememberSeriesCategoryNames,
} from './seriesCategoryNameCache.ts';
import {
  enrichSeriesCategoryNames,
  logSeriesCategoryNameEnrichment,
  SERIES_CATEGORY_NAME_SAMPLE_IDS,
  type SeriesCategoryNameResolution,
  type SeriesCategoryNameAuditSummary,
} from './seriesCategoryNameResolution.ts';

export async function loadPersistedSeriesCategoryNames(providerId: string): Promise<Map<string, string>> {
  const [cached, catalogKnown] = await Promise.all([
    getCachedSeriesCategoryNames(providerId),
    listKnownSeriesCategoryNames(providerId).catch(() => []),
  ]);
  const merged = new Map(cached);
  for (const row of catalogKnown) {
    if (!merged.has(row.categoryId) && isTrustworthySeriesCategoryName(row.categoryName, row.categoryId)) {
      merged.set(row.categoryId, row.categoryName);
    }
  }
  return merged;
}

export async function enrichAndPersistSeriesCategoryNames(input: {
  providerId: string;
  generation?: number | null;
  categories: Array<{ id: string; name: string; derived?: boolean }>;
  metadataNames?: Map<string, string> | Record<string, string>;
  streamRowNames?: Map<string, string> | Record<string, string>;
  persistToGeneration?: number | null;
  streamRowNameCount?: number | null;
  firstItemKeys?: string[] | null;
  seriesCategoryNameFieldPresentCount?: number | null;
}): Promise<{
  categories: Array<{ id: string; name: string; derived: boolean }>;
  resolutions: SeriesCategoryNameResolution[];
  summary: SeriesCategoryNameAuditSummary;
}> {
  const cachedNames = await loadPersistedSeriesCategoryNames(input.providerId);
  const enriched = enrichSeriesCategoryNames({
    categories: input.categories,
    metadataNames: input.metadataNames,
    streamRowNames: input.streamRowNames,
    cachedNames,
  });
  const realNames = enriched.resolutions
    .filter((resolution) => resolution.nameSource !== 'fallback')
    .map((resolution) => ({
      categoryId: resolution.categoryId,
      name: resolution.resolvedName,
    }));
  await rememberSeriesCategoryNames(input.providerId, realNames).catch(() => undefined);

  const persistGeneration = input.persistToGeneration ?? input.generation ?? 0;
  if (persistGeneration > 0) {
    const upgrades = enriched.resolutions.flatMap((resolution, index) => {
      const previousName = input.categories[index]?.name;
      if (resolution.nameSource === 'fallback' || previousName === resolution.resolvedName) {
        return [];
      }
      return [{ categoryId: resolution.categoryId, categoryName: resolution.resolvedName }];
    });
    if (upgrades.length) {
      await updatePublishedSeriesCategoryNames(input.providerId, persistGeneration, upgrades).catch(
        () => 0,
      );
    }
  }

  logSeriesCategoryNameEnrichment({
    providerId: input.providerId,
    generation: input.generation ?? persistGeneration ?? null,
    resolutions: enriched.resolutions,
    summary: enriched.summary,
    sampleCategoryIds: SERIES_CATEGORY_NAME_SAMPLE_IDS,
    streamRowNameCount:
      input.streamRowNameCount ??
      (input.streamRowNames instanceof Map
        ? input.streamRowNames.size
        : input.streamRowNames
          ? Object.keys(input.streamRowNames).length
          : null),
    firstItemKeys: input.firstItemKeys ?? null,
    seriesCategoryNameFieldPresentCount: input.seriesCategoryNameFieldPresentCount ?? null,
  });
  return enriched;
}
