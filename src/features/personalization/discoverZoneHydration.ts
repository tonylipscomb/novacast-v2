import type { CatalogItemRecord } from '../catalog/catalogTypes.ts';
import type { SeriesSummary } from '../media-browser/mediaTypes.ts';
import type { MovieSummary } from '../movies/movieTypes.ts';

export type DiscoverZoneItem = {
  id: string;
  title: string;
  artworkUrl?: string;
  subtitle?: string;
  mediaType: 'movie' | 'series' | 'live';
  resolved?: boolean;
  canonicalMovie?: MovieSummary;
  canonicalSeries?: SeriesSummary;
};


export type DiscoverZoneLibrarySnapshot = {
  title?: string;
  artworkUrl?: string;
};

export type DiscoverZoneHydrationDeps = {
  getMovieFromIndex?: (providerId: string, id: string) => MovieSummary | undefined;
  getMovieFromCatalog?: (providerId: string, id: string) => Promise<MovieSummary | null>;
  getSeriesFromIndex?: (providerId: string, id: string) => SeriesSummary | undefined;
  getSeriesFromCatalog?: (providerId: string, id: string) => Promise<SeriesSummary | null>;
};

export function isNumericIdentityValue(value: string | undefined | null): boolean {
  return /^\d+$/.test(String(value ?? '').trim());
}

export function isSafeDiscoverZoneTitle(title: string | undefined | null, id: string): boolean {
  const trimmed = String(title ?? '').trim();
  if (!trimmed) {
    return false;
  }
  if (isNumericIdentityValue(trimmed)) {
    return false;
  }
  if (trimmed === String(id).trim() && isNumericIdentityValue(id)) {
    return false;
  }
  return true;
}

export function isSafeDiscoverZoneArtworkUrl(url: string | undefined | null): boolean {
  const trimmed = String(url ?? '').trim();
  if (!trimmed || isNumericIdentityValue(trimmed)) {
    return false;
  }
  return true;
}

export function shouldShowDiscoverToolbarHighlight(nativeFocused: boolean, overlayOpen: boolean): boolean {
  return nativeFocused && !overlayOpen;
}

export function catalogItemToMovieSummary(item: CatalogItemRecord): MovieSummary {
  return {
    id: item.contentId,
    categoryId: item.categoryId ?? '',
    title: item.title,
    year: item.releaseYear ?? undefined,
    releaseDate: item.releaseDate ?? undefined,
    rating: item.rating == null ? undefined : String(item.rating),
    genres: ['Movies'],
    description: item.description ?? undefined,
    score: item.rating ?? undefined,
    posterStyleKey: 'ember',
    posterUrl: item.artworkUrl ?? undefined,
    containerExtension: item.streamExtension ?? undefined,
    providerSortOrder: item.providerSortOrder ?? undefined,
  };
}

export function catalogItemToSeriesSummary(item: CatalogItemRecord): SeriesSummary {
  const seriesId = item.seriesId ?? item.contentId;
  return {
    id: item.contentId,
    seriesId,
    categoryId: item.categoryId ?? '',
    title: item.title,
    year: item.releaseYear != null ? String(item.releaseYear) : undefined,
    rating: item.rating != null ? String(item.rating) : undefined,
    releaseDate: item.releaseDate ?? undefined,
    description: item.description ?? undefined,
    genres: [],
    posterStyleKey: 'ember',
    posterUrl: item.artworkUrl ?? undefined,
    backdropUrl: item.backdropUrl ?? undefined,
  };
}

export function canOpenDiscoverZoneDetail(item: DiscoverZoneItem): boolean {
  if (item.mediaType === 'live') {
    return Boolean(item.id);
  }
  if (item.mediaType === 'movie') {
    return Boolean(item.canonicalMovie && isSafeDiscoverZoneTitle(item.canonicalMovie.title, item.canonicalMovie.id));
  }
  if (item.mediaType === 'series') {
    return Boolean(
      item.canonicalSeries && isSafeDiscoverZoneTitle(item.canonicalSeries.title, item.canonicalSeries.id),
    );
  }
  return false;
}

function safeArtwork(url: string | undefined | null): string | undefined {
  return isSafeDiscoverZoneArtworkUrl(url) ? String(url).trim() : undefined;
}

export function logDiscoverZoneHydration(payload: {
  scope: 'movies' | 'series';
  savedContentId: string;
  providerIdPresent: boolean;
  canonicalRowFound: boolean;
  resolvedTitlePresent: boolean;
  resolvedPosterPresent: boolean;
  selectionEntityType: 'movie-summary' | 'series-summary' | 'unresolved';
}) {
  console.info('[NovaCast Discover Zone Hydration] ' + JSON.stringify(payload));
}

export function logDiscoverZoneFocus(payload: {
  event: 'native-focus-received' | 'native-focus-lost' | 'press-clear' | 'overlay-open-clear';
  visualFocused: boolean;
  overlayOpen: boolean;
  target: 'MovieToolbar.DiscoverZone';
}) {
  console.info('[NovaCast Discover Zone Focus] ' + JSON.stringify(payload));
}

export function resolveHydratedMovie(input: {
  providerId: string;
  savedId: string;
  indexSummary?: MovieSummary | null;
  catalogSummary?: MovieSummary | null;
  snapshot?: DiscoverZoneLibrarySnapshot | null;
}): { summary: MovieSummary | null; item: DiscoverZoneItem | null } {
  const savedId = String(input.savedId ?? '').trim();
  const canonical =
    (input.catalogSummary && isSafeDiscoverZoneTitle(input.catalogSummary.title, savedId)
      ? input.catalogSummary
      : null) ??
    (input.indexSummary && isSafeDiscoverZoneTitle(input.indexSummary.title, savedId) ? input.indexSummary : null);

  if (canonical) {
    const artworkUrl = safeArtwork(canonical.posterUrl);
    const item: DiscoverZoneItem = {
      id: canonical.id,
      title: canonical.title,
      artworkUrl,
      subtitle: canonical.year ? String(canonical.year) : undefined,
      mediaType: 'movie',
      resolved: true,
      canonicalMovie: { ...canonical, posterUrl: artworkUrl },
    };
    logDiscoverZoneHydration({
      scope: 'movies',
      savedContentId: savedId,
      providerIdPresent: Boolean(input.providerId),
      canonicalRowFound: true,
      resolvedTitlePresent: true,
      resolvedPosterPresent: Boolean(artworkUrl),
      selectionEntityType: 'movie-summary',
    });
    return { summary: item.canonicalMovie ?? canonical, item };
  }

  const snapshotTitle = isSafeDiscoverZoneTitle(input.snapshot?.title, savedId) ? input.snapshot?.title?.trim() : undefined;
  if (snapshotTitle) {
    const artworkUrl = safeArtwork(input.snapshot?.artworkUrl);
    logDiscoverZoneHydration({
      scope: 'movies',
      savedContentId: savedId,
      providerIdPresent: Boolean(input.providerId),
      canonicalRowFound: false,
      resolvedTitlePresent: true,
      resolvedPosterPresent: Boolean(artworkUrl),
      selectionEntityType: 'unresolved',
    });
    return {
      summary: null,
      item: {
        id: savedId,
        title: snapshotTitle,
        artworkUrl,
        mediaType: 'movie',
        resolved: false,
      },
    };
  }

  logDiscoverZoneHydration({
    scope: 'movies',
    savedContentId: savedId,
    providerIdPresent: Boolean(input.providerId),
    canonicalRowFound: false,
    resolvedTitlePresent: false,
    resolvedPosterPresent: false,
    selectionEntityType: 'unresolved',
  });
  return { summary: null, item: null };
}

export function resolveHydratedSeries(input: {
  providerId: string;
  savedId: string;
  indexSummary?: SeriesSummary | null;
  catalogSummary?: SeriesSummary | null;
  snapshot?: DiscoverZoneLibrarySnapshot | null;
}): { summary: SeriesSummary | null; item: DiscoverZoneItem | null } {
  const savedId = String(input.savedId ?? '').trim();
  const canonical =
    (input.catalogSummary && isSafeDiscoverZoneTitle(input.catalogSummary.title, savedId)
      ? input.catalogSummary
      : null) ??
    (input.indexSummary && isSafeDiscoverZoneTitle(input.indexSummary.title, savedId) ? input.indexSummary : null);

  if (canonical) {
    const artworkUrl = safeArtwork(canonical.posterUrl);
    const item: DiscoverZoneItem = {
      id: canonical.id,
      title: canonical.title,
      artworkUrl,
      subtitle: canonical.year ? String(canonical.year) : undefined,
      mediaType: 'series',
      resolved: true,
      canonicalSeries: { ...canonical, posterUrl: artworkUrl },
    };
    logDiscoverZoneHydration({
      scope: 'series',
      savedContentId: savedId,
      providerIdPresent: Boolean(input.providerId),
      canonicalRowFound: true,
      resolvedTitlePresent: true,
      resolvedPosterPresent: Boolean(artworkUrl),
      selectionEntityType: 'series-summary',
    });
    return { summary: item.canonicalSeries ?? canonical, item };
  }

  const snapshotTitle = isSafeDiscoverZoneTitle(input.snapshot?.title, savedId) ? input.snapshot?.title?.trim() : undefined;
  if (snapshotTitle) {
    const artworkUrl = safeArtwork(input.snapshot?.artworkUrl);
    logDiscoverZoneHydration({
      scope: 'series',
      savedContentId: savedId,
      providerIdPresent: Boolean(input.providerId),
      canonicalRowFound: false,
      resolvedTitlePresent: true,
      resolvedPosterPresent: Boolean(artworkUrl),
      selectionEntityType: 'unresolved',
    });
    return {
      summary: null,
      item: {
        id: savedId,
        title: snapshotTitle,
        artworkUrl,
        mediaType: 'series',
        resolved: false,
      },
    };
  }

  logDiscoverZoneHydration({
    scope: 'series',
    savedContentId: savedId,
    providerIdPresent: Boolean(input.providerId),
    canonicalRowFound: false,
    resolvedTitlePresent: false,
    resolvedPosterPresent: false,
    selectionEntityType: 'unresolved',
  });
  return { summary: null, item: null };
}

async function loadCatalogMovieSummary(providerId: string, id: string): Promise<MovieSummary | null> {
  const { getCatalogMovieItem } = await import('../catalog/catalogRepository.ts');
  const row = await getCatalogMovieItem(providerId, id);
  return row ? catalogItemToMovieSummary(row) : null;
}

async function loadCatalogSeriesSummary(providerId: string, id: string): Promise<SeriesSummary | null> {
  const { getCatalogSeriesItem } = await import('../catalog/catalogRepository.ts');
  const row = await getCatalogSeriesItem(providerId, id);
  return row ? catalogItemToSeriesSummary(row) : null;
}

export async function hydrateCanonicalMovie(
  providerId: string,
  savedId: string,
  deps?: DiscoverZoneHydrationDeps,
  snapshot?: DiscoverZoneLibrarySnapshot | null,
): Promise<{ summary: MovieSummary | null; item: DiscoverZoneItem | null }> {
  const indexSummary = deps?.getMovieFromIndex
    ? deps.getMovieFromIndex(providerId, savedId)
    : (await import('../movies/smart/movieCatalogIndex.ts')).getMovieCatalogIndex(providerId).getSummaries([savedId])[0];
  let catalogSummary: MovieSummary | null = null;
  if (!indexSummary || !isSafeDiscoverZoneTitle(indexSummary.title, savedId)) {
    catalogSummary = deps?.getMovieFromCatalog
      ? await deps.getMovieFromCatalog(providerId, savedId)
      : await loadCatalogMovieSummary(providerId, savedId);
    if (catalogSummary && isSafeDiscoverZoneTitle(catalogSummary.title, savedId) && !deps?.getMovieFromCatalog) {
      (await import('../movies/smart/movieCatalogIndex.ts')).getMovieCatalogIndex(providerId).ingest([catalogSummary]);
    }
  }
  return resolveHydratedMovie({
    providerId,
    savedId,
    indexSummary,
    catalogSummary,
    snapshot,
  });
}

export async function hydrateCanonicalSeries(
  providerId: string,
  savedId: string,
  deps?: DiscoverZoneHydrationDeps,
  snapshot?: DiscoverZoneLibrarySnapshot | null,
): Promise<{ summary: SeriesSummary | null; item: DiscoverZoneItem | null }> {
  const indexSummary = deps?.getSeriesFromIndex
    ? deps.getSeriesFromIndex(providerId, savedId)
    : (await import('../series/smart/seriesCatalogIndex.ts')).getSeriesCatalogIndex(providerId).getSummaries([savedId])[0];
  let catalogSummary: SeriesSummary | null = null;
  if (!indexSummary || !isSafeDiscoverZoneTitle(indexSummary.title, savedId)) {
    catalogSummary = deps?.getSeriesFromCatalog
      ? await deps.getSeriesFromCatalog(providerId, savedId)
      : await loadCatalogSeriesSummary(providerId, savedId);
    if (catalogSummary && isSafeDiscoverZoneTitle(catalogSummary.title, savedId) && !deps?.getSeriesFromCatalog) {
      (await import('../series/smart/seriesCatalogIndex.ts')).getSeriesCatalogIndex(providerId).ingest([catalogSummary]);
    }
  }
  return resolveHydratedSeries({
    providerId,
    savedId,
    indexSummary,
    catalogSummary,
    snapshot,
  });
}

export async function hydrateCanonicalMovies(
  providerId: string,
  ids: string[],
  deps?: DiscoverZoneHydrationDeps,
): Promise<MovieSummary[]> {
  const summaries: MovieSummary[] = [];
  for (const id of ids) {
    const hydrated = await hydrateCanonicalMovie(providerId, id, deps);
    if (hydrated.summary) {
      summaries.push(hydrated.summary);
    }
  }
  return summaries;
}

export async function hydrateCanonicalSeriesList(
  providerId: string,
  ids: string[],
  deps?: DiscoverZoneHydrationDeps,
): Promise<SeriesSummary[]> {
  const summaries: SeriesSummary[] = [];
  for (const id of ids) {
    const hydrated = await hydrateCanonicalSeries(providerId, id, deps);
    if (hydrated.summary) {
      summaries.push(hydrated.summary);
    }
  }
  return summaries;
}
