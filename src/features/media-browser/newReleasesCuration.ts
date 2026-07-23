import type { MovieCatalogEntry } from '../movies/smart/movieCatalogIndex.ts';
import type { SeriesCatalogEntry } from '../series/smart/seriesCatalogIndex.ts';
import { normalizeTitleForSort } from './contentSorting.ts';
import {
  normalizeMovieSortTimestamps,
  normalizeProviderAddedTimestamp,
  normalizeSeriesEpisodeTimestamp,
} from './newReleasesDate.ts';

export const SMART_CATEGORY_KEY_NEW_RELEASES = 'new-releases';
export const SMART_CATEGORY_KEY_FEATURES = 'features';
export const LEGACY_SMART_CATEGORY_KEY_DISCOVER = 'discover';

export function resolveSmartCategoryKey(key: string) {
  return key === LEGACY_SMART_CATEGORY_KEY_DISCOVER ? SMART_CATEGORY_KEY_FEATURES : key;
}

export function isFeaturesSmartCategoryKey(key: string) {
  const resolved = resolveSmartCategoryKey(key);
  return resolved === SMART_CATEGORY_KEY_FEATURES || resolved === SMART_CATEGORY_KEY_NEW_RELEASES;
}
export const MOVIE_NEW_RELEASES_LIMIT = 50;
export const SERIES_NEW_RELEASES_LIMIT = 50;

type PopularitySignals = {
  popularity?: number;
  rating?: number;
};

function comparePopularity(left: PopularitySignals, right: PopularitySignals) {
  const leftPopularity = left.popularity ?? 0;
  const rightPopularity = right.popularity ?? 0;
  if (leftPopularity !== rightPopularity) {
    return rightPopularity - leftPopularity;
  }

  const leftRating = left.rating ?? 0;
  const rightRating = right.rating ?? 0;
  return rightRating - leftRating;
}

function compareDeterministicTitle(leftTitle: string, rightTitle: string, leftId: string, rightId: string) {
  const titleCompare = leftTitle.localeCompare(rightTitle);
  if (titleCompare !== 0) {
    return titleCompare;
  }
  return leftId.localeCompare(rightId);
}

function resolveSeriesGroupKey(entry: SeriesCatalogEntry) {
  const seriesId = String(entry.seriesId ?? '').trim();
  if (seriesId) {
    return `series:${seriesId}`;
  }

  const providerSeriesId = String(entry.id ?? '').trim();
  if (providerSeriesId) {
    return `provider:${providerSeriesId}`;
  }

  const normalizedTitle = normalizeTitleForSort(entry.title);
  return normalizedTitle ? `title:${normalizedTitle}` : `entry:${entry.id}`;
}

function compareSeriesNewReleaseCandidates(left: SeriesCatalogEntry, right: SeriesCatalogEntry) {
  const leftEpisodeDate = normalizeSeriesEpisodeTimestamp(left);
  const rightEpisodeDate = normalizeSeriesEpisodeTimestamp(right);
  const leftHasEpisodeDate = leftEpisodeDate !== null;
  const rightHasEpisodeDate = rightEpisodeDate !== null;

  if (leftHasEpisodeDate !== rightHasEpisodeDate) {
    return leftHasEpisodeDate ? -1 : 1;
  }

  if (leftEpisodeDate !== null && rightEpisodeDate !== null && leftEpisodeDate !== rightEpisodeDate) {
    return rightEpisodeDate - leftEpisodeDate;
  }

  const leftAdded = normalizeProviderAddedTimestamp(left.addedAt);
  const rightAdded = normalizeProviderAddedTimestamp(right.addedAt);
  if (leftAdded !== null && rightAdded !== null && leftAdded !== rightAdded) {
    return rightAdded - leftAdded;
  }
  if (leftAdded !== null && rightAdded === null) {
    return -1;
  }
  if (leftAdded === null && rightAdded !== null) {
    return 1;
  }

  const popularityCompare = comparePopularity(left, right);
  if (popularityCompare !== 0) {
    return popularityCompare;
  }

  return compareDeterministicTitle(left.title, right.title, left.id, right.id);
}

function compareSeriesNewReleaseRows(left: SeriesCatalogEntry, right: SeriesCatalogEntry) {
  const leftEpisodeDate = normalizeSeriesEpisodeTimestamp(left);
  const rightEpisodeDate = normalizeSeriesEpisodeTimestamp(right);
  const leftHasEpisodeDate = leftEpisodeDate !== null;
  const rightHasEpisodeDate = rightEpisodeDate !== null;

  if (leftHasEpisodeDate !== rightHasEpisodeDate) {
    return leftHasEpisodeDate ? -1 : 1;
  }

  if (leftEpisodeDate !== null && rightEpisodeDate !== null && leftEpisodeDate !== rightEpisodeDate) {
    return rightEpisodeDate - leftEpisodeDate;
  }

  const leftAdded = normalizeProviderAddedTimestamp(left.addedAt);
  const rightAdded = normalizeProviderAddedTimestamp(right.addedAt);
  if (leftAdded !== null && rightAdded !== null && leftAdded !== rightAdded) {
    return rightAdded - leftAdded;
  }
  if (leftAdded !== null && rightAdded === null) {
    return -1;
  }
  if (leftAdded === null && rightAdded !== null) {
    return 1;
  }

  const popularityCompare = comparePopularity(left, right);
  if (popularityCompare !== 0) {
    return popularityCompare;
  }

  return compareDeterministicTitle(left.title, right.title, left.id, right.id);
}

function compareMovieNewReleaseRows(left: MovieCatalogEntry, right: MovieCatalogEntry) {
  const leftDates = normalizeMovieSortTimestamps(left);
  const rightDates = normalizeMovieSortTimestamps(right);
  const leftHasRelease = leftDates.releaseTimestamp !== null;
  const rightHasRelease = rightDates.releaseTimestamp !== null;

  if (leftHasRelease !== rightHasRelease) {
    return leftHasRelease ? -1 : 1;
  }

  if (
    leftDates.releaseTimestamp !== null &&
    rightDates.releaseTimestamp !== null &&
    leftDates.releaseTimestamp !== rightDates.releaseTimestamp
  ) {
    return rightDates.releaseTimestamp - leftDates.releaseTimestamp;
  }

  const leftAdded = leftDates.addedTimestamp;
  const rightAdded = rightDates.addedTimestamp;
  if (leftAdded !== null && rightAdded !== null && leftAdded !== rightAdded) {
    return rightAdded - leftAdded;
  }
  if (leftAdded !== null && rightAdded === null) {
    return -1;
  }
  if (leftAdded === null && rightAdded !== null) {
    return 1;
  }

  return compareDeterministicTitle(left.title, right.title, left.id, right.id);
}

function pickBestSeriesCandidate(current: SeriesCatalogEntry | undefined, candidate: SeriesCatalogEntry) {
  if (!current) {
    return candidate;
  }
  return compareSeriesNewReleaseCandidates(candidate, current) < 0 ? candidate : current;
}

export function curateSeriesNewReleases(entries: readonly SeriesCatalogEntry[]): SeriesCatalogEntry[] {
  if (!entries.length) {
    return [];
  }

  const bestBySeries = new Map<string, SeriesCatalogEntry>();
  for (const entry of entries) {
    const groupKey = resolveSeriesGroupKey(entry);
    bestBySeries.set(groupKey, pickBestSeriesCandidate(bestBySeries.get(groupKey), entry));
  }

  const datedEpisodes: SeriesCatalogEntry[] = [];
  const undatedCandidates: SeriesCatalogEntry[] = [];

  for (const entry of bestBySeries.values()) {
    if (normalizeSeriesEpisodeTimestamp(entry) !== null) {
      datedEpisodes.push(entry);
    } else {
      undatedCandidates.push(entry);
    }
  }

  datedEpisodes.sort(compareSeriesNewReleaseRows);
  undatedCandidates.sort(compareSeriesNewReleaseRows);

  const curated: SeriesCatalogEntry[] = [];
  const represented = new Set<string>();

  for (const entry of datedEpisodes) {
    if (curated.length >= SERIES_NEW_RELEASES_LIMIT) {
      break;
    }
    curated.push(entry);
    represented.add(resolveSeriesGroupKey(entry));
  }

  for (const entry of undatedCandidates) {
    if (curated.length >= SERIES_NEW_RELEASES_LIMIT) {
      break;
    }
    const groupKey = resolveSeriesGroupKey(entry);
    if (represented.has(groupKey)) {
      continue;
    }
    curated.push(entry);
    represented.add(groupKey);
  }

  return curated.slice(0, SERIES_NEW_RELEASES_LIMIT);
}

export function curateMovieNewReleases(entries: readonly MovieCatalogEntry[]): MovieCatalogEntry[] {
  if (!entries.length) {
    return [];
  }

  const withRelease: MovieCatalogEntry[] = [];
  const addedOnly: MovieCatalogEntry[] = [];
  const undated: MovieCatalogEntry[] = [];

  for (const entry of entries) {
    const { releaseTimestamp, addedTimestamp } = normalizeMovieSortTimestamps(entry);
    if (releaseTimestamp !== null) {
      withRelease.push(entry);
    } else if (addedTimestamp !== null) {
      addedOnly.push(entry);
    } else {
      undated.push(entry);
    }
  }

  withRelease.sort(compareMovieNewReleaseRows);
  addedOnly.sort(compareMovieNewReleaseRows);
  undated.sort(compareMovieNewReleaseRows);

  const curated: MovieCatalogEntry[] = [];
  for (const entry of withRelease) {
    if (curated.length >= MOVIE_NEW_RELEASES_LIMIT) {
      break;
    }
    curated.push(entry);
  }

  for (const entry of addedOnly) {
    if (curated.length >= MOVIE_NEW_RELEASES_LIMIT) {
      break;
    }
    curated.push(entry);
  }

  if (curated.length < MOVIE_NEW_RELEASES_LIMIT) {
    for (const entry of undated) {
      if (curated.length >= MOVIE_NEW_RELEASES_LIMIT) {
        break;
      }
      curated.push(entry);
    }
  }

  return curated.slice(0, MOVIE_NEW_RELEASES_LIMIT);
}

export function collectSeriesCatalogEntries(
  index: { forEachEntry(callback: (entry: SeriesCatalogEntry) => void): void },
): SeriesCatalogEntry[] {
  const entries: SeriesCatalogEntry[] = [];
  index.forEachEntry((entry) => {
    entries.push(entry);
  });
  return entries;
}

export function collectMovieCatalogEntries(
  index: { forEachEntry(callback: (entry: MovieCatalogEntry) => void): void },
): MovieCatalogEntry[] {
  const entries: MovieCatalogEntry[] = [];
  index.forEachEntry((entry) => {
    entries.push(entry);
  });
  return entries;
}

export function paginateCuratedEntries<T>(entries: readonly T[], offset: number, limit: number) {
  const items = entries.slice(offset, offset + limit);
  return {
    items,
    totalCount: entries.length,
    hasMore: offset + limit < entries.length,
  };
}
