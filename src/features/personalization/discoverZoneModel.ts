import { getMediaLibraryState } from '../media-browser/mediaLibraryStore.ts';
import type { ContinueWatchingEntry } from '../media-browser/mediaTypes.ts';
import { getMovieLibraryState } from '../movies/smart/movieLibraryStore.ts';
import { isContinueWatchingEligible } from '../playback/continuity/playbackContinuity.ts';

import {
  hydrateCanonicalMovie,
  hydrateCanonicalSeries,
  type DiscoverZoneHydrationDeps,
  type DiscoverZoneItem,
} from './discoverZoneHydration.ts';
import { getLiveFavoriteEntries, getRecentItems } from './personalizationStore.ts';
import { dedupeRecentItems, type RecentItemRecord } from './personalizationModel.ts';

export type DiscoverZoneScope = 'movies' | 'series' | 'live';

export type { DiscoverZoneItem };

export type DiscoverZoneSnapshot = {
  scope: DiscoverZoneScope;
  watchlist: DiscoverZoneItem[];
  favorites: DiscoverZoneItem[];
  continueWatching: DiscoverZoneItem[];
  recent: DiscoverZoneItem[];
};

export type DiscoverZoneSnapshotDeps = DiscoverZoneHydrationDeps & {
  getMovieLibrary?: typeof getMovieLibraryState;
  getMediaLibrary?: typeof getMediaLibraryState;
  getLiveFavorites?: typeof getLiveFavoriteEntries;
  getRecentItems?: typeof getRecentItems;
};

export function emptyDiscoverZoneSnapshot(scope: DiscoverZoneScope): DiscoverZoneSnapshot {
  return { scope, watchlist: [], favorites: [], continueWatching: [], recent: [] };
}

export function discoverZoneRails(snapshot: DiscoverZoneSnapshot) {
  if (snapshot.scope === 'live') {
    return snapshot.favorites.length ? ([['favorites', snapshot.favorites]] as const) : [];
  }

  const recent = snapshot.recent ?? [];
  return (
    [
      ['continueWatching', snapshot.continueWatching ?? []],
      ['recent', recent],
      ['watchlist', snapshot.watchlist],
      ['favorites', snapshot.favorites],
    ] as const
  ).filter(([, items]) => items.length > 0);
}

export function discoverZoneRailTitle(scope: DiscoverZoneScope, rail: 'continueWatching' | 'watchlist' | 'favorites' | 'recent') {
  if (rail === 'continueWatching') {
    return 'Continue Watching';
  }
  if (rail === 'recent') {
    return 'Recently Watched';
  }
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

function recentEpisodeToItem(entry: RecentItemRecord): DiscoverZoneItem | null {
  if (entry.mediaType !== 'episode' || !entry.parentSeriesId || !entry.seasonNumber || !entry.episodeNumber) {
    return null;
  }
  return {
    id: entry.contentId,
    title: entry.title,
    artworkUrl: entry.artworkUrl,
    subtitle: `Series · S${entry.seasonNumber} E${entry.episodeNumber}`,
    mediaType: 'episode',
    resolved: true,
    recentEpisode: {
      seriesId: entry.parentSeriesId,
      episodeId: entry.contentId,
      seasonNumber: entry.seasonNumber,
      episodeNumber: entry.episodeNumber,
    },
  };
}

function continueEpisodeToItem(entry: ContinueWatchingEntry): DiscoverZoneItem | null {
  if (!entry.seriesId || !entry.seasonNumber || !entry.episodeNumber || !isContinueWatchingEligible(entry.positionMs, entry.durationMs)) {
    return null;
  }
  return {
    id: entry.mediaId,
    title: entry.seriesTitle ? `${entry.seriesTitle}: ${entry.title}` : entry.title,
    artworkUrl: entry.artworkUrl,
    subtitle: `${entry.seriesTitle ? `${entry.seriesTitle} · ` : ''}S${entry.seasonNumber} E${entry.episodeNumber}`,
    mediaType: 'episode',
    resolved: true,
    recentEpisode: {
      seriesId: entry.seriesId,
      episodeId: entry.episodeId ?? entry.mediaId,
      seasonNumber: entry.seasonNumber,
      episodeNumber: entry.episodeNumber,
    },
    continueWatching: {
      positionMs: entry.positionMs,
      durationMs: entry.durationMs,
      progressPercent: entry.progressPercent,
    },
  };
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
      continueWatching: [],
      recent: [],
    };
  }

  if (scope === 'movies') {
    const getMovieLibrary = deps?.getMovieLibrary ?? getMovieLibraryState;
    const movieLibrary = await getMovieLibrary(providerId);
    const snapshots = new Map(
      movieLibrary.watchHistory.map((entry) => [entry.movieId, { title: entry.title, artworkUrl: entry.artworkUrl }]),
    );
    const loadRecentItems = deps?.getRecentItems ?? getRecentItems;
    const recentItems = await loadRecentItems(providerId);
    const recentMovieEntries = dedupeRecentItems(recentItems.filter((entry) => entry.providerId === providerId && entry.mediaType === 'movie'), 20);
    const recentMovieItems = await hydrateMovieItems(
      providerId,
      recentMovieEntries.map((entry) => entry.contentId),
      deps,
      new Map(recentMovieEntries.map((entry) => [entry.contentId, { title: entry.title, artworkUrl: entry.artworkUrl }])),
    );
    const movieContinueEntries = movieLibrary.watchHistory
      .map((entry) => {
        const durationMs = Number.isFinite(entry.durationMs) ? Math.max(0, entry.durationMs ?? 0) : 0;
        const positionMs = Number.isFinite(entry.positionMs)
          ? Math.max(0, entry.positionMs ?? 0)
          : durationMs > 0 ? (durationMs * (entry.progressPercent ?? 0)) / 100 : 0;
        const progressPercent = durationMs > 0 ? Math.min(100, Math.round((positionMs / durationMs) * 100)) : 0;
        return { entry, durationMs, positionMs, progressPercent };
      })
      .filter(({ entry, positionMs, durationMs }) => entry.completed !== true && isContinueWatchingEligible(positionMs, durationMs))
      .sort((left, right) => right.entry.watchedAt - left.entry.watchedAt)
      .filter((item, index, all) => all.findIndex((candidate) => candidate.entry.movieId === item.entry.movieId) === index)
      .slice(0, 20);
    const continueMovieItems = await hydrateMovieItems(
      providerId,
      movieContinueEntries.map(({ entry }) => entry.movieId),
      deps,
      new Map(movieContinueEntries.map(({ entry }) => [entry.movieId, { title: entry.title, artworkUrl: entry.artworkUrl }])),
    );
    const continueById = new Map(movieContinueEntries.map((item) => [item.entry.movieId, item]));
    for (const item of continueMovieItems) {
      const progress = continueById.get(item.id);
      if (progress) {
        item.continueWatching = {
          positionMs: progress.positionMs,
          durationMs: progress.durationMs,
          progressPercent: progress.progressPercent,
        };
      }
    }
    return {
      scope,
      watchlist: await hydrateMovieItems(providerId, movieLibrary.watchlist, deps, snapshots),
      favorites: await hydrateMovieItems(providerId, movieLibrary.favorites, deps, snapshots),
      continueWatching: continueMovieItems,
      recent: recentMovieItems,
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

  const loadRecentItems = deps?.getRecentItems ?? getRecentItems;
  const recentItems = await loadRecentItems(providerId);
  const recent = dedupeRecentItems(recentItems.filter((entry) => entry.providerId === providerId && entry.mediaType === 'episode'), 20)
    .map(recentEpisodeToItem)
    .filter((item): item is DiscoverZoneItem => Boolean(item));
  const continueEpisodes = mediaLibrary.continueWatching
    .filter((entry) => entry.providerId === providerId && isContinueWatchingEligible(entry.positionMs, entry.durationMs))
    .sort((left, right) => right.lastWatchedAt - left.lastWatchedAt)
    .filter((entry, index, all) => all.findIndex((candidate) => candidate.mediaId === entry.mediaId) === index)
    .slice(0, 20)
    .map(continueEpisodeToItem)
    .filter((item): item is DiscoverZoneItem => Boolean(item));

  return {
    scope,
    watchlist: await hydrateSeriesItems(providerId, mediaLibrary.watchlist, deps, snapshots),
    favorites: await hydrateSeriesItems(providerId, favoriteIds, deps, snapshots),
    continueWatching: continueEpisodes,
    recent,
  };
}
