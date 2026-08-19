import AsyncStorage from '@react-native-async-storage/async-storage';

import { getCatalogDatabase } from './catalogDatabase.ts';
import {
  CATALOG_SORT_COVERAGE_SELECT,
  evaluateSortMetadataUpgradeNeed,
  type CatalogSortMetadataCoverage,
} from './catalogSortOrder.ts';
import { catalogItemsTable } from './catalogTableRouting.ts';
import type { CatalogMediaType } from './catalogTypes.ts';

export { evaluateSortMetadataUpgradeNeed };

const STORAGE_KEY = '@novacast/catalog-sort-metadata-v4';

type UpgradeStatus = 'scheduled' | 'satisfied';

type UpgradeMap = Record<string, UpgradeStatus>;

let cache: UpgradeMap | null = null;
let loadPromise: Promise<UpgradeMap> | null = null;

function upgradeKey(providerId: string, mediaType: CatalogMediaType) {
  return `${providerId}:${mediaType}`;
}

async function readUpgradeMap(): Promise<UpgradeMap> {
  if (cache) {
    return cache;
  }
  if (!loadPromise) {
    loadPromise = (async () => {
      if (typeof AsyncStorage.getItem !== 'function') {
        cache = {};
        return cache;
      }
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        cache = raw ? (JSON.parse(raw) as UpgradeMap) : {};
      } catch {
        cache = {};
      }
      return cache;
    })();
  }
  return loadPromise;
}

async function writeUpgradeMap(next: UpgradeMap) {
  cache = next;
  if (typeof AsyncStorage.setItem === 'function') {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }
}

export async function getCatalogSortMetadataCoverage(input: {
  providerId: string;
  mediaType: CatalogMediaType;
  generation: number;
  categoryId?: string | null;
}): Promise<CatalogSortMetadataCoverage> {
  if (input.generation <= 0) {
    return {
      rowCount: 0,
      releaseDatePresentCount: 0,
      releaseYearPresentCount: 0,
      addedAtPresentCount: 0,
      popularityPresentCount: 0,
    };
  }

  const db = await getCatalogDatabase();
  const itemsTable = catalogItemsTable(input.mediaType);
  const params: (string | number)[] = [input.providerId, input.mediaType, input.generation];
  let where = 'provider_id = ? AND media_type = ? AND sync_generation = ?';
  if (input.categoryId) {
    where += ' AND category_id = ?';
    params.push(input.categoryId);
  }

  const row = await db.getFirst<{
    row_count?: number;
    release_date_present?: number;
    release_year_present?: number;
    added_at_present?: number;
    popularity_present?: number;
  }>(`SELECT ${CATALOG_SORT_COVERAGE_SELECT} FROM ${itemsTable} WHERE ${where}`, params);

  return {
    rowCount: Number(row?.row_count ?? 0),
    releaseDatePresentCount: Number(row?.release_date_present ?? 0),
    releaseYearPresentCount: Number(row?.release_year_present ?? 0),
    addedAtPresentCount: Number(row?.added_at_present ?? 0),
    popularityPresentCount: Number(row?.popularity_present ?? 0),
  };
}

export async function isSortMetadataUpgradeSatisfied(
  providerId: string,
  mediaType: CatalogMediaType,
) {
  const map = await readUpgradeMap();
  return map[upgradeKey(providerId, mediaType)] === 'satisfied';
}

export async function isSortMetadataUpgradeScheduled(
  providerId: string,
  mediaType: CatalogMediaType,
) {
  const map = await readUpgradeMap();
  return map[upgradeKey(providerId, mediaType)] === 'scheduled';
}

export async function markSortMetadataUpgradeScheduled(
  providerId: string,
  mediaType: CatalogMediaType,
) {
  const map = { ...(await readUpgradeMap()) };
  map[upgradeKey(providerId, mediaType)] = 'scheduled';
  await writeUpgradeMap(map);
}

export async function markSortMetadataUpgradeSatisfied(
  providerId: string,
  mediaType: CatalogMediaType,
) {
  const map = { ...(await readUpgradeMap()) };
  map[upgradeKey(providerId, mediaType)] = 'satisfied';
  await writeUpgradeMap(map);
}

async function resolveProviderGeneration(providerId: string) {
  const db = await getCatalogDatabase();
  const row = await db.getFirst<{ catalog_generation?: number }>(
    'SELECT catalog_generation FROM catalog_providers WHERE provider_id = ?',
    [providerId],
  );
  return Number(row?.catalog_generation ?? 0);
}

/**
 * One-time v4 sort-metadata rewrite eligibility.
 * Does not invalidate the current readable generation.
 */
export async function shouldRequestSortMetadataUpgrade(
  providerId: string,
  mediaType: CatalogMediaType,
): Promise<boolean> {
  if (await isSortMetadataUpgradeSatisfied(providerId, mediaType)) {
    return false;
  }
  if (await isSortMetadataUpgradeScheduled(providerId, mediaType)) {
    return true;
  }

  const generation = await resolveProviderGeneration(providerId);
  const coverage = await getCatalogSortMetadataCoverage({
    providerId,
    mediaType,
    generation,
  });
  if (!evaluateSortMetadataUpgradeNeed(coverage)) {
    if (coverage.rowCount > 0 && coverage.addedAtPresentCount > 0) {
      await markSortMetadataUpgradeSatisfied(providerId, mediaType);
    }
    return false;
  }

  await markSortMetadataUpgradeScheduled(providerId, mediaType);
  console.info(
    '[NovaCast Content Sort Audit] ' +
      JSON.stringify({
        event: 'v4-metadata-upgrade-scheduled',
        mediaType,
        providerId,
        generation,
        rowCount: coverage.rowCount,
        primaryMetadata: {
          releaseDatePresentCount: coverage.releaseDatePresentCount,
          releaseYearPresentCount: coverage.releaseYearPresentCount,
          addedAtPresentCount: coverage.addedAtPresentCount,
          popularityPresentCount: coverage.popularityPresentCount,
        },
      }),
  );
  return true;
}

export function resetSortMetadataUpgradeForTests() {
  cache = null;
  loadPromise = null;
}
