import AsyncStorage from '@react-native-async-storage/async-storage';

import type { SeriesSummary } from '../../media-browser/mediaTypes.ts';
import { inferGenreTags, parseRatingNumber } from '../../movies/smart/movieMetadata.ts';
import { normalizeMediaTitle } from '../../series/metadata/titleNormalization.ts';
import {
  buildCatalogCompleteness,
  MAX_CATALOG_INDEX_ITEMS,
  type CatalogCompletenessMetadata,
} from '../../providers/catalogCompleteness.ts';

export type SeriesCatalogEntry = {
  id: string;
  seriesId: string;
  title: string;
  countryCode?: string;
  rawTitle?: string;
  categoryId: string;
  rating: number;
  addedAt?: number;
  releaseDate?: string | number;
  latestEpisodeDate?: string | number;
  popularity?: number;
  year?: number;
  posterUrl?: string;
  posterStyleKey: string;
  genreTags: string[];
};

export const MAX_SERIES_CATALOG_INDEX_ENTRIES = MAX_CATALOG_INDEX_ITEMS;

function toEntry(series: SeriesSummary): SeriesCatalogEntry {
  const title = normalizeMediaTitle(series.title) || series.title;
  const year = series.year ? Number.parseInt(series.year, 10) : undefined;
  return {
    id: series.id,
    seriesId: series.seriesId,
    title,
    countryCode: series.countryCode,
    rawTitle: series.rawTitle,
    categoryId: series.categoryId,
    rating: parseRatingNumber(series.rating),
    addedAt: series.addedAt,
    releaseDate: series.releaseDate,
    latestEpisodeDate: series.latestEpisodeDate,
    popularity: series.popularity,
    year: Number.isFinite(year) ? year : undefined,
    posterUrl: series.posterUrl,
    posterStyleKey: series.posterStyleKey,
    genreTags: inferGenreTags(title, series.genres),
  };
}

export function entryToSeriesSummary(entry: SeriesCatalogEntry): SeriesSummary {
  return {
    id: entry.id,
    seriesId: entry.seriesId,
    categoryId: entry.categoryId,
    title: entry.title,
    countryCode: entry.countryCode,
    rawTitle: entry.rawTitle,
    year: entry.year ? String(entry.year) : undefined,
    rating: entry.rating > 0 ? `${entry.rating}` : undefined,
    addedAt: entry.addedAt,
    releaseDate: entry.releaseDate,
    latestEpisodeDate: entry.latestEpisodeDate,
    popularity: entry.popularity,
    genres: entry.genreTags.length ? entry.genreTags : ['Series'],
    description: 'Curated from your NovaCast series library.',
    posterStyleKey: entry.posterStyleKey,
    posterUrl: entry.posterUrl,
  };
}

export class SeriesCatalogIndex {
  private entries = new Map<string, SeriesCatalogEntry>();
  private providerId: string;
  private sourceUniqueIds = new Set<string>();
  private indexTruncated = false;
  private categoryLoadTruncated = false;

  constructor(providerId: string) {
    this.providerId = providerId;
  }

  beginSync() {
    this.entries.clear();
    this.sourceUniqueIds.clear();
    this.indexTruncated = false;
    this.categoryLoadTruncated = false;
  }

  markCategoryLoadTruncated() {
    this.categoryLoadTruncated = true;
  }

  getCompleteness(): CatalogCompletenessMetadata {
    return buildCatalogCompleteness(this.sourceUniqueIds.size, this.entries.size, {
      indexTruncated: this.indexTruncated,
      categoryLoadTruncated: this.categoryLoadTruncated,
    });
  }

  get size() {
    return this.entries.size;
  }

  ingest(seriesList: SeriesSummary[]) {
    for (const series of seriesList) {
      this.sourceUniqueIds.add(series.id);
      if (!this.entries.has(series.id) && this.entries.size >= MAX_SERIES_CATALOG_INDEX_ENTRIES) {
        this.indexTruncated = true;
        break;
      }
      this.entries.set(series.id, toEntry(series));
    }
    scheduleCatalogPersist(this.providerId, this);
  }

  ingestEntry(entry: SeriesCatalogEntry) {
    this.entries.set(entry.id, entry);
  }

  getEntry(id: string) {
    return this.entries.get(id);
  }

  getSummaries(ids: string[]) {
    return ids
      .map((id) => this.entries.get(id))
      .filter((entry): entry is SeriesCatalogEntry => Boolean(entry))
      .map(entryToSeriesSummary);
  }

  listAllEntries() {
    return [...this.entries.values()];
  }

  forEachEntry(callback: (entry: SeriesCatalogEntry) => void) {
    for (const entry of this.entries.values()) {
      callback(entry);
    }
  }

  buildCategoryCounts() {
    const counts: Record<string, number> = {};
    for (const entry of this.entries.values()) {
      if (!entry.categoryId) {
        continue;
      }
      counts[entry.categoryId] = (counts[entry.categoryId] ?? 0) + 1;
    }
    return counts;
  }

  query(
    predicate: (entry: SeriesCatalogEntry) => boolean,
    sort: (left: SeriesCatalogEntry, right: SeriesCatalogEntry) => number,
    offset: number,
    limit: number,
  ) {
    const filtered: SeriesCatalogEntry[] = [];
    for (const entry of this.entries.values()) {
      if (predicate(entry)) {
        filtered.push(entry);
      }
    }
    filtered.sort(sort);
    const items = filtered.slice(offset, offset + limit);
    return {
      items: items.map(entryToSeriesSummary),
      totalCount: filtered.length,
      hasMore: offset + limit < filtered.length,
    };
  }

  queryEntries(
    predicate: (entry: SeriesCatalogEntry) => boolean,
    sort: (left: SeriesCatalogEntry, right: SeriesCatalogEntry) => number,
    offset: number,
    limit: number,
  ) {
    const filtered: SeriesCatalogEntry[] = [];
    for (const entry of this.entries.values()) {
      if (predicate(entry)) {
        filtered.push(entry);
      }
    }
    filtered.sort(sort);
    const items = filtered.slice(offset, offset + limit);
    return {
      items,
      totalCount: filtered.length,
      hasMore: offset + limit < filtered.length,
    };
  }

  count(predicate: (entry: SeriesCatalogEntry) => boolean) {
    let total = 0;
    for (const entry of this.entries.values()) {
      if (predicate(entry)) {
        total += 1;
      }
    }
    return total;
  }
}

const indexes = new Map<string, SeriesCatalogIndex>();
const CATALOG_STORAGE_PREFIX = '@novacast/series-catalog/';

function catalogStorageKey(providerId: string) {
  return `${CATALOG_STORAGE_PREFIX}${providerId}`;
}

/** Full-catalog AsyncStorage blobs OOM on Fire TV; keep the index in memory for this session. */
function scheduleCatalogPersist(_providerId: string, _index: SeriesCatalogIndex) {
  // no-op
}

async function clearLegacyCatalogStorage(providerId: string) {
  if (typeof AsyncStorage.removeItem !== 'function') {
    return;
  }

  try {
    await AsyncStorage.removeItem(catalogStorageKey(providerId));
  } catch {
    // Ignore cleanup failures.
  }
}

export function getSeriesCatalogIndex(providerId: string) {
  const existing = indexes.get(providerId);
  if (existing) {
    return existing;
  }

  const next = new SeriesCatalogIndex(providerId);
  indexes.set(providerId, next);
  void clearLegacyCatalogStorage(providerId);
  return next;
}

export function resetSeriesCatalogIndex(providerId?: string) {
  if (providerId) {
    indexes.delete(providerId);
    if (typeof AsyncStorage.removeItem === 'function') {
      void AsyncStorage.removeItem(catalogStorageKey(providerId));
    }
    return;
  }

  indexes.clear();
}
