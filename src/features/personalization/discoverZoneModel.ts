import { getMediaLibraryState } from '../media-browser/mediaLibraryStore.ts';
import { getMovieLibraryState } from '../movies/smart/movieLibraryStore.ts';

import {
  hydrateCanonicalMovie,
  hydrateCanonicalSeries,
  type DiscoverZoneHydrationDeps,
  type DiscoverZoneItem,
} from './discoverZoneHydration.ts';
import { getLiveFavoriteEntries } from './personalizationStore.ts';

export type DiscoverZoneScope = 'movies' | 'series' | 'live';

export type { DiscoverZoneItem };

export type DiscoverZoneSnapshot = {
  scope: DiscoverZoneScope;
  watchlist: DiscoverZoneItem[];
  favorites: DiscoverZoneItem[];
};

export type DiscoverZoneSnapshotDeps = DiscoverZoneHydrationDeps & {
  getMovieLibrary?: typeof getMovieLibraryState;
  getMediaLibrary?: typeof getMediaLibraryState;
  getLiveFavorites?: typeof getLiveFavoriteEntries;
};

export function emptyDiscoverZoneSnapshot(scope: DiscoverZoneScope): DiscoverZoneSnapshot {
  return { scope, watchlist: [], favorites: [] };
}

export function discoverZoneRails(snapshot: DiscoverZoneSnapshot) {
  if (snapshot.scope === 'live') {
    return snapshot.favorites.length ? ([['favorites', snapshot.favorites]] as const) : [];
  }

  return (
    [
      ['watchlist', snapshot.watchlist],
      ['favorites', snapshot.favorites],
    ] as const
  ).filter(([, items]) => items.length > 0);
}

export function discoverZoneRailTitle(scope: DiscoverZoneScope, rail: 'watchlist' | 'favorites') {
  if (rail === 'watchlist') {
    return 'My Watchlist';
  }
  if (scope === 'movies') {
    return 'Favorite Movies';
  }
  if (scope === 'series') {
    return 'Favorite Series';
  }
  return 'Favorite Channels';
}

async function hydrateMovieItems(
  providerId: string,
  ids: string[],
  deps: DiscoverZoneSnapshotDeps | undefined,
  snapshots: Map<string, { title?: string; artworkUrl?: string }>,
) {
  const items: DiscoverZoneItem[] = [];
  for (const id of ids) {
    const hydrated = await hydrateCanonicalMovie(providerId, id, deps, snapshots.get(id));
    if (hydrated.item) {
      items.push(hydrated.item);
    }
  }
  return items;
}

async function hydrateSeriesItems(
  providerId: string,
  ids: string[],
  deps: DiscoverZoneSnapshotDeps | undefined,
  snapshots: Map<string, { title?: string; artworkUrl?: string }>,
) {
  const items: DiscoverZoneItem[] = [];
  for (const id of ids) {
    const hydrated = await hydrateCanonicalSeries(providerId, id, deps, snapshots.get(id));
    if (hydrated.item) {
      items.push(hydrated.item);
    }
  }
  return items;
}

export async function loadDiscoverZoneSnapshot(
  providerId: string,
  scope: DiscoverZoneScope,
  deps?: DiscoverZoneSnapshotDeps,
): Promise<DiscoverZoneSnapshot> {
  if (!providerId) {
    return emptyDiscoverZoneSnapshot(scope);
  }

  if (scope === 'live') {
    const getLiveFavorites = deps?.getLiveFavorites ?? getLiveFavoriteEntries;
    const liveFavorites = await getLiveFavorites(providerId);
    return {
      scope,
      watchlist: [],
      favorites: liveFavorites.map((item) => ({
        id: item.contentId,
        title: item.title,
        artworkUrl: item.artworkUrl,
        subtitle: 'Favorite channel',
        mediaType: 'live' as const,
        resolved: true,
      })),
    };
  }

  if (scope === 'movies') {
    const getMovieLibrary = deps?.getMovieLibrary ?? getMovieLibraryState;
    const movieLibrary = await getMovieLibrary(providerId);
    const snapshots = new Map(
      movieLibrary.watchHistory.map((entry) => [entry.movieId, { title: entry.title, artworkUrl: entry.artworkUrl }]),
    );
    return {
      scope,
      watchlist: await hydrateMovieItems(providerId, movieLibrary.watchlist, deps, snapshots),
      favorites: await hydrateMovieItems(providerId, movieLibrary.favorites, deps, snapshots),
    };
  }

  const getMediaLibrary = deps?.getMediaLibrary ?? getMediaLibraryState;
  const mediaLibrary = await getMediaLibrary(providerId);
  const favoriteIds = [
    ...new Set([
      ...mediaLibrary.favoriteRecords.filter((item) => item.mediaType === 'series').map((item) => item.contentId),
      ...mediaLibrary.favorites,
    ]),
  ];
  const snapshots = new Map<string, { title?: string; artworkUrl?: string }>();
  for (const record of mediaLibrary.favoriteRecords) {
    if (record.mediaType === 'series') {
      snapshots.set(record.contentId, { title: record.title, artworkUrl: record.artworkUrl });
    }
  }
  for (const entry of mediaLibrary.watchHistory) {
    const seriesId = entry.seriesId ?? (entry.mediaKind === 'episode' ? undefined : entry.mediaId);
    if (seriesId && !snapshots.has(seriesId)) {
      snapshots.set(seriesId, { title: entry.seriesTitle ?? entry.title, artworkUrl: entry.artworkUrl });
    }
  }

  return {
    scope,
    watchlist: await hydrateSeriesItems(providerId, mediaLibrary.watchlist, deps, snapshots),
    favorites: await hydrateSeriesItems(providerId, favoriteIds, deps, snapshots),
  };
}
