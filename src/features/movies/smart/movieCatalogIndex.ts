import AsyncStorage from '@react-native-async-storage/async-storage';

import { buildSearchHaystack } from '../../search/searchRanking.ts';
import { normalizeSearchQuery } from '../../search/searchQuery.ts';
import type { MovieSummary } from '../movieTypes.ts';
import { normalizeMediaTitle } from '../../series/metadata/titleNormalization.ts';
import {
  buildCatalogCompleteness,
  MAX_CATALOG_INDEX_ITEMS,
  type CatalogCompletenessMetadata,
} from '../../providers/catalogCompleteness.ts';
import { inferGenreTags, parseAddedTimestamp, parseRatingNumber, parseYearFromTitle } from './movieMetadata.ts';

export type MovieCatalogEntry = {
  id: string;
  title: string;
  /** Lowercased title for fast substring checks during search. */
  normalizedTitle: string;
  /** Title + genres/year haystack for fast reject before ranking. */
  searchHaystack: string;
  countryCode?: string;
  categoryId: string;
  rating: number;
  added: number;
  releaseDate?: string | number;
  popularity?: number;
  year?: number;
  posterUrl?: string;
  containerExtension?: string;
  posterStyleKey: string;
  genreTags: string[];
};

export const MAX_MOVIE_CATALOG_INDEX_ENTRIES = MAX_CATALOG_INDEX_ITEMS;

function toEntry(movie: MovieSummary, added = 0): MovieCatalogEntry {
  const title = normalizeMediaTitle(movie.title) || movie.title;
  const year = movie.year ?? parseYearFromTitle(title);
  const genreTags = inferGenreTags(title, movie.genres);
  const normalizedTitle = normalizeSearchQuery(title);
  const searchHaystack = buildSearchHaystack([title, genreTags.join(' '), year, movie.rating]);
  return {
    id: movie.id,
    title,
    normalizedTitle,
    searchHaystack,
    countryCode: movie.countryCode,
    categoryId: movie.categoryId,
    rating: parseRatingNumber(movie.rating),
    added: added || parseAddedTimestamp(typeof movie.addedAt === 'number' ? String(movie.addedAt) : undefined),
    releaseDate: movie.releaseDate,
    popularity: movie.popularity,
    year,
    posterUrl: movie.posterUrl,
    containerExtension: movie.containerExtension,
    posterStyleKey: movie.posterStyleKey,
    genreTags,
  };
}

export function entryToSummary(entry: MovieCatalogEntry): MovieSummary {
  return {
    id: entry.id,
    categoryId: entry.categoryId,
    title: entry.title,
    countryCode: entry.countryCode,
    year: entry.year,
    addedAt: entry.added || undefined,
    releaseDate: entry.releaseDate,
    popularity: entry.popularity,
    rating: entry.rating > 0 ? `${entry.rating}` : undefined,
    genres: entry.genreTags.length ? entry.genreTags : ['Movies'],
    description: 'Curated from your NovaCast movie library.',
    posterStyleKey: entry.posterStyleKey,
    posterUrl: entry.posterUrl,
    containerExtension: entry.containerExtension,
    score: entry.rating > 0 ? entry.rating : undefined,
  };
}

export class MovieCatalogIndex {
  private entries = new Map<string, MovieCatalogEntry>();
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

  getProviderId() {
    return this.providerId;
  }

  ingest(movies: MovieSummary[]) {
    for (const movie of movies) {
      this.sourceUniqueIds.add(movie.id);
      if (!this.entries.has(movie.id) && this.entries.size >= MAX_MOVIE_CATALOG_INDEX_ENTRIES) {
        this.indexTruncated = true;
        break;
      }
      const added = typeof movie.addedAt === 'number' ? movie.addedAt : 0;
      this.entries.set(movie.id, toEntry(movie, added));
    }
    scheduleCatalogPersist(this.providerId, this);
  }

  ingestEntry(entry: MovieCatalogEntry) {
    const normalizedTitle = entry.normalizedTitle || normalizeSearchQuery(entry.title);
    const searchHaystack =
      entry.searchHaystack ||
      buildSearchHaystack([entry.title, entry.genreTags.join(' '), entry.year, entry.rating]);
    this.entries.set(entry.id, { ...entry, normalizedTitle, searchHaystack });
  }

  getEntry(id: string) {
    return this.entries.get(id);
  }

  getSummaries(ids: string[]) {
    return ids.map((id) => this.entries.get(id)).filter((entry): entry is MovieCatalogEntry => Boolean(entry)).map(entryToSummary);
  }

  listAllEntries() {
    return [...this.entries.values()];
  }

  forEachEntry(callback: (entry: MovieCatalogEntry) => void) {
    for (const entry of this.entries.values()) {
      callback(entry);
    }
  }

  /** Backfill search haystacks for entries indexed before search metadata existed. */
  ensureSearchMetadata() {
    for (const entry of this.entries.values()) {
      if (entry.searchHaystack && entry.normalizedTitle) {
        continue;
      }

      const normalizedTitle = entry.normalizedTitle || normalizeSearchQuery(entry.title);
      const searchHaystack =
        entry.searchHaystack ||
        buildSearchHaystack([entry.title, entry.genreTags.join(' '), entry.year, entry.rating]);
      this.entries.set(entry.id, { ...entry, normalizedTitle, searchHaystack });
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
    predicate: (entry: MovieCatalogEntry) => boolean,
    sort: (left: MovieCatalogEntry, right: MovieCatalogEntry) => number,
    offset: number,
    limit: number,
  ) {
    const filtered: MovieCatalogEntry[] = [];
    for (const entry of this.entries.values()) {
      if (predicate(entry)) {
        filtered.push(entry);
      }
    }
    filtered.sort(sort);
    const items = filtered.slice(offset, offset + limit);
    return {
      items: items.map(entryToSummary),
      totalCount: filtered.length,
      hasMore: offset + limit < filtered.length,
    };
  }

  queryEntries(
    predicate: (entry: MovieCatalogEntry) => boolean,
    sort: (left: MovieCatalogEntry, right: MovieCatalogEntry) => number,
    offset: number,
    limit: number,
  ) {
    const filtered: MovieCatalogEntry[] = [];
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

  count(predicate: (entry: MovieCatalogEntry) => boolean) {
    let total = 0;
    for (const entry of this.entries.values()) {
      if (predicate(entry)) {
        total += 1;
      }
    }
    return total;
  }
}

const indexes = new Map<string, MovieCatalogIndex>();
const CATALOG_STORAGE_PREFIX = '@novacast/movie-catalog/';

function catalogStorageKey(providerId: string) {
  return `${CATALOG_STORAGE_PREFIX}${providerId}`;
}

/** Full-catalog AsyncStorage blobs OOM on Fire TV; keep the index in memory for this session. */
function scheduleCatalogPersist(_providerId: string, _index: MovieCatalogIndex) {
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

export function getMovieCatalogIndex(providerId: string) {
  const existing = indexes.get(providerId);
  if (existing) {
    return existing;
  }

  const next = new MovieCatalogIndex(providerId);
  indexes.set(providerId, next);
  void clearLegacyCatalogStorage(providerId);
  return next;
}

export function resetMovieCatalogIndex(providerId?: string) {
  if (providerId) {
    indexes.delete(providerId);
    if (typeof AsyncStorage.removeItem === 'function') {
      void AsyncStorage.removeItem(catalogStorageKey(providerId));
    }
    return;
  }

  indexes.clear();
}
