import {
  getMediaLibraryState,
  toggleMediaWatchlist,
} from '../media-browser/mediaLibraryStore.ts';

export const SERIES_WATCHLIST_MARKER = 'rc-series-watchlist-canonical';

export type SeriesWatchlistIdentity = {
  id?: string;
  seriesId?: string;
};

export type SeriesWatchlistEvent = 'add' | 'remove' | 'hydrate' | 'press';

function trimId(value: string | undefined | null): string {
  return String(value ?? '').trim();
}

/** Canonical saved ID is catalog `content_id` (`series.id`), matching Movies' `movie.id`. */
export function resolveSeriesWatchlistContentId(series: SeriesWatchlistIdentity | null | undefined): string {
  const contentId = trimId(series?.id);
  if (contentId) {
    return contentId;
  }
  return trimId(series?.seriesId);
}

export function seriesWatchlistLookupIds(series: SeriesWatchlistIdentity | null | undefined): string[] {
  return [...new Set([trimId(series?.id), trimId(series?.seriesId)].filter(Boolean))];
}

export function isSeriesWatchlisted(watchlist: string[], series: SeriesWatchlistIdentity | null | undefined): boolean {
  if (!Array.isArray(watchlist) || watchlist.length === 0) {
    return false;
  }
  return seriesWatchlistLookupIds(series).some((id) => watchlist.includes(id));
}

export function logSeriesWatchlist(payload: {
  event: SeriesWatchlistEvent;
  providerIdPresent: boolean;
  seriesIdPresent: boolean;
  canonicalIdResolved: boolean;
  saved: boolean;
}) {
  console.info(
    '[NovaCast Series Watchlist] ' +
      JSON.stringify({
        marker: SERIES_WATCHLIST_MARKER,
        event: payload.event,
        providerIdPresent: payload.providerIdPresent === true,
        seriesIdPresent: payload.seriesIdPresent === true,
        canonicalIdResolved: payload.canonicalIdResolved === true,
        saved: payload.saved === true,
      }),
  );
}

export async function toggleCanonicalSeriesWatchlist(
  providerId: string,
  series: SeriesWatchlistIdentity | null | undefined,
): Promise<boolean> {
  const canonicalId = resolveSeriesWatchlistContentId(series);
  const lookupIds = seriesWatchlistLookupIds(series);
  const providerIdPresent = Boolean(trimId(providerId));
  const seriesIdPresent = lookupIds.length > 0;
  const canonicalIdResolved = Boolean(canonicalId);

  logSeriesWatchlist({
    event: 'press',
    providerIdPresent,
    seriesIdPresent,
    canonicalIdResolved,
    saved: false,
  });

  if (!providerIdPresent || !canonicalIdResolved) {
    return false;
  }

  const before = await getMediaLibraryState(providerId);
  const currentlySaved = isSeriesWatchlisted(before.watchlist, series);

  if (currentlySaved) {
    for (const id of lookupIds) {
      const current = await getMediaLibraryState(providerId);
      if (current.watchlist.includes(id)) {
        await toggleMediaWatchlist(providerId, id);
      }
    }
  } else {
    await toggleMediaWatchlist(providerId, canonicalId);
  }

  const after = await getMediaLibraryState(providerId);
  const saved = isSeriesWatchlisted(after.watchlist, series);
  logSeriesWatchlist({
    event: saved ? 'add' : 'remove',
    providerIdPresent: true,
    seriesIdPresent: true,
    canonicalIdResolved: true,
    saved,
  });
  return saved;
}
