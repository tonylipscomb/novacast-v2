import { normalizeReleaseDate } from './contentSorting.ts';

const MIN_MOVIE_RELEASE_YEAR = 1888;
const MAX_REASONABLE_FUTURE_MS = Date.now() + 5 * 365 * 24 * 60 * 60 * 1000;

function isEmptyDateValue(value: unknown) {
  if (value === null || value === undefined) {
    return true;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length === 0 || trimmed === '0';
  }
  if (typeof value === 'number') {
    return !Number.isFinite(value) || value === 0;
  }
  return false;
}

/** Returns a sortable UTC timestamp in milliseconds, or null when the value is invalid. */
export function normalizeSortableTimestamp(value: unknown, options: { allowFuture?: boolean } = {}): number | null {
  if (isEmptyDateValue(value)) {
    return null;
  }

  const allowFuture = options.allowFuture === true;

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (/^\d{4}$/.test(trimmed)) {
      const year = Number(trimmed);
      if (year >= 1900 && year <= 2100) {
        const utc = Date.UTC(year, 0, 1);
        return isPlausibleTimestamp(utc, allowFuture) ? utc : null;
      }
      return null;
    }
  }

  const normalized = normalizeReleaseDate(value, { allowFuture });
  return normalized > 0 ? normalized : null;
}

function isPlausibleTimestamp(timestamp: number, allowFuture = false) {
  if (timestamp < Date.UTC(MIN_MOVIE_RELEASE_YEAR, 0, 1)) {
    return false;
  }
  if (allowFuture) {
    return timestamp <= MAX_REASONABLE_FUTURE_MS;
  }
  return timestamp <= Date.now();
}

/** Movie release dates may include upcoming titles, but reject clearly impossible years. */
export function normalizeMovieReleaseTimestamp(value: unknown): number | null {
  const timestamp = normalizeSortableTimestamp(value, { allowFuture: true });
  if (timestamp === null) {
    return null;
  }

  if (timestamp < Date.UTC(MIN_MOVIE_RELEASE_YEAR, 0, 1)) {
    return null;
  }

  if (timestamp > MAX_REASONABLE_FUTURE_MS) {
    return null;
  }

  return timestamp;
}

export function normalizeProviderAddedTimestamp(value: unknown): number | null {
  return normalizeSortableTimestamp(value, { allowFuture: false });
}

export function normalizeSeriesEpisodeTimestamp(entry: {
  latestEpisodeDate?: unknown;
  releaseDate?: unknown;
  airDate?: unknown;
  releasedAt?: unknown;
  addedAt?: unknown;
  added?: unknown;
  year?: unknown;
}): number | null {
  return (
    normalizeSortableTimestamp(entry.latestEpisodeDate, { allowFuture: true }) ??
    normalizeSortableTimestamp(entry.airDate, { allowFuture: true }) ??
    normalizeSortableTimestamp(entry.releasedAt, { allowFuture: true }) ??
    normalizeSortableTimestamp(entry.releaseDate, { allowFuture: true }) ??
    normalizeProviderAddedTimestamp(entry.addedAt ?? entry.added) ??
    normalizeSortableTimestamp(entry.year, { allowFuture: false })
  );
}

export function normalizeMovieSortTimestamps(entry: {
  releaseDate?: unknown;
  addedAt?: unknown;
  added?: unknown;
  year?: unknown;
}) {
  const releaseTimestamp =
    normalizeMovieReleaseTimestamp(entry.releaseDate) ?? normalizeMovieReleaseTimestamp(entry.year);
  const addedTimestamp = normalizeProviderAddedTimestamp(entry.addedAt ?? entry.added);
  return { releaseTimestamp, addedTimestamp };
}
