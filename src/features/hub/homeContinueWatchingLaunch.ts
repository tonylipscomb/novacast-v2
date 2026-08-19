import type { HomeContinueWatchingItem } from '@/features/personalization/personalizationModel';

function normalizeHomeCwExtension(value?: string | null): string | undefined {
  if (!value) {
    return undefined;
  }
  let normalized = String(value).trim().toLowerCase().replace(/[?#].*$/, '');
  if (!normalized || normalized.includes('/') || normalized.includes('\\')) {
    return undefined;
  }
  normalized = normalized.replace(/^\.+/, '');
  const parts = normalized.split('.');
  normalized = parts[parts.length - 1] ?? '';
  if (!normalized || normalized.length > 10 || !/^[a-z0-9-]+$/.test(normalized)) {
    return undefined;
  }
  return normalized;
}

export type HomeContinueWatchingOrigin = 'home-continue-watching';

export type HomeContinueWatchingExtensionSource = 'canonical' | 'catalog' | 'history' | 'fallback';

export type HomeContinueWatchingCatalogMovie = {
  id: string;
  title: string;
  posterUrl?: string;
  containerExtension?: string;
};

export type HomeContinueWatchingLaunchDecision =
  | {
      kind: 'launch-movie';
      origin: HomeContinueWatchingOrigin;
      resumePolicy: 'silent';
      movieId: string;
      title: string;
      artworkUrl?: string;
      containerExtension?: string;
      extensionSource: HomeContinueWatchingExtensionSource;
      positionMs: number;
      sourceResolvable: true;
    }
  | {
      kind: 'launch-episode';
      origin: HomeContinueWatchingOrigin;
      resumePolicy: 'silent';
      seriesId: string;
      episodeId: string;
      contentId: string;
      positionMs: number;
      sourceResolvable: true;
    }
  | {
      kind: 'error';
      origin: HomeContinueWatchingOrigin;
      remainOnHome: true;
      reason: 'missing-identity' | 'unresolved-episode';
      sourceResolvable: false;
    };

export function shouldHomeContinueWatchingOpenMovies(): false {
  return false;
}

export function isHomeContinueWatchingMovieItem(item: Pick<HomeContinueWatchingItem, 'mediaType' | 'parentSeriesId' | 'episodeId'>) {
  return item.mediaType === 'movie' || (!item.parentSeriesId && !item.episodeId);
}

export function resolveHomeContinueWatchingContainerExtension(input: {
  sqliteCatalogExtension?: string | null;
  memoryCatalogExtension?: string | null;
  savedHistoryExtension?: string | null;
}): {
  containerExtension?: string;
  extensionSource: HomeContinueWatchingExtensionSource;
} {
  const sqlite = normalizeHomeCwExtension(input.sqliteCatalogExtension);
  if (sqlite) {
    return { containerExtension: sqlite, extensionSource: 'canonical' };
  }
  const memory = normalizeHomeCwExtension(input.memoryCatalogExtension);
  if (memory) {
    return { containerExtension: memory, extensionSource: 'catalog' };
  }
  const saved = normalizeHomeCwExtension(input.savedHistoryExtension);
  if (saved) {
    return { containerExtension: saved, extensionSource: 'history' };
  }
  return { extensionSource: 'fallback' };
}

export function resolveHomeContinueWatchingMovieIdentity(input: {
  item: HomeContinueWatchingItem;
  catalogMovie?: HomeContinueWatchingCatalogMovie | null;
  sqliteCatalogMovie?: HomeContinueWatchingCatalogMovie | null;
}) {
  const item = input.item;
  const sqlite = input.sqliteCatalogMovie;
  const memory = input.catalogMovie;
  const extension = resolveHomeContinueWatchingContainerExtension({
    sqliteCatalogExtension: sqlite?.containerExtension,
    memoryCatalogExtension: memory?.containerExtension,
    savedHistoryExtension: item.containerExtension,
  });
  const movieId = sqlite?.id || memory?.id || item.contentId;
  return {
    movieId,
    title: sqlite?.title || memory?.title || item.title,
    artworkUrl: sqlite?.posterUrl || memory?.posterUrl || item.artworkUrl,
    containerExtension: extension.containerExtension,
    extensionSource: extension.extensionSource,
    canonicalMovieFound: Boolean(sqlite?.id || memory?.id),
    lookupKeyType: 'content-id' as const,
    savedExtensionPresent: Boolean(normalizeHomeCwExtension(item.containerExtension)),
    canonicalExtensionPresent: Boolean(
      normalizeHomeCwExtension(sqlite?.containerExtension ?? memory?.containerExtension),
    ),
    resolvedExtensionPresent: Boolean(extension.containerExtension),
    positionMs: item.positionMs,
  };
}

export function describeHomeContinueWatchingShape(
  item: HomeContinueWatchingItem,
  extras?: {
    canonicalMovieFound?: boolean;
    canonicalContainerExtensionPresent?: boolean;
    resolvedContainerExtensionPresent?: boolean;
    extensionSource?: HomeContinueWatchingExtensionSource;
    decision?: HomeContinueWatchingLaunchDecision['kind'];
  },
) {
  const savedContainerExtensionPresent = Boolean(normalizeHomeCwExtension(item.containerExtension));
  return {
    mediaType: item.mediaType,
    contentIdPresent: Boolean(item.contentId),
    movieIdPresent: item.mediaType === 'movie' && Boolean(item.contentId),
    episodeIdPresent: Boolean(item.episodeId),
    seriesIdPresent: Boolean(item.parentSeriesId),
    providerIdPresent: Boolean(item.providerId),
    streamIdPresent: Boolean(item.contentId),
    savedContainerExtensionPresent,
    containerExtensionPresent: extras?.resolvedContainerExtensionPresent ?? savedContainerExtensionPresent,
    canonicalMovieFound: extras?.canonicalMovieFound ?? false,
    canonicalContainerExtensionPresent: extras?.canonicalContainerExtensionPresent ?? false,
    resolvedContainerExtensionPresent: extras?.resolvedContainerExtensionPresent ?? false,
    extensionSource: extras?.extensionSource,
    savedPositionPresent: Number.isFinite(item.positionMs) && item.positionMs > 0,
    resumeEligible: Number.isFinite(item.positionMs) && item.positionMs > 0,
    decision: extras?.decision,
  };
}

export function decideHomeContinueWatchingLaunch(input: {
  item: HomeContinueWatchingItem;
  catalogMovie?: HomeContinueWatchingCatalogMovie | null;
  sqliteCatalogMovie?: HomeContinueWatchingCatalogMovie | null;
}): HomeContinueWatchingLaunchDecision {
  const item = input.item;
  if (isHomeContinueWatchingMovieItem(item)) {
    const identity = resolveHomeContinueWatchingMovieIdentity(input);
    if (!identity.movieId) {
      return {
        kind: 'error',
        origin: 'home-continue-watching',
        remainOnHome: true,
        reason: 'missing-identity',
        sourceResolvable: false,
      };
    }
    return {
      kind: 'launch-movie',
      origin: 'home-continue-watching',
      resumePolicy: 'silent',
      movieId: identity.movieId,
      title: identity.title,
      artworkUrl: identity.artworkUrl,
      containerExtension: identity.containerExtension,
      extensionSource: identity.extensionSource,
      positionMs: identity.positionMs,
      sourceResolvable: true,
    };
  }

  const seriesId = item.parentSeriesId;
  const episodeId = item.episodeId || item.contentId;
  if (!seriesId || !episodeId) {
    return {
      kind: 'error',
      origin: 'home-continue-watching',
      remainOnHome: true,
      reason: 'unresolved-episode',
      sourceResolvable: false,
    };
  }

  return {
    kind: 'launch-episode',
    origin: 'home-continue-watching',
    resumePolicy: 'silent',
    seriesId,
    episodeId,
    contentId: item.contentId,
    positionMs: item.positionMs,
    sourceResolvable: true,
  };
}

export function shouldRetryHomeContinueWatchingFallbackExtension(input: {
  mediaType?: string;
  extensionSource?: string | null;
  httpResponseCode?: number | null;
  attemptedExtension?: string | null;
  canonicalExtension?: string | null;
  alreadyRetried: boolean;
}): boolean {
  if (input.alreadyRetried) {
    return false;
  }
  if (input.mediaType !== 'movie') {
    return false;
  }
  if (input.extensionSource !== 'fallback') {
    return false;
  }
  if (input.httpResponseCode !== 551) {
    return false;
  }
  const attempted = normalizeHomeCwExtension(input.attemptedExtension) ?? 'mp4';
  const canonical = normalizeHomeCwExtension(input.canonicalExtension);
  return Boolean(canonical && canonical !== attempted);
}

export function logHomeContinueWatchingLaunch(fields: {
  origin: HomeContinueWatchingOrigin;
  mediaType?: string;
  contentIdPresent?: boolean;
  movieIdPresent?: boolean;
  episodeIdPresent?: boolean;
  seriesIdPresent?: boolean;
  providerIdPresent?: boolean;
  streamIdPresent?: boolean;
  savedContainerExtensionPresent?: boolean;
  containerExtensionPresent?: boolean;
  canonicalMovieFound?: boolean;
  canonicalContainerExtensionPresent?: boolean;
  resolvedContainerExtensionPresent?: boolean;
  extensionSource?: HomeContinueWatchingExtensionSource;
  sourceResolvable?: boolean;
  savedPositionPresent?: boolean;
  resumeEligible?: boolean;
  decision?: HomeContinueWatchingLaunchDecision['kind'];
}) {
  console.info('[NovaCast Home Continue Watching]', {
    mediaType: fields.mediaType,
    movieIdPresent: fields.movieIdPresent,
    contentIdPresent: fields.contentIdPresent,
    providerIdPresent: fields.providerIdPresent,
    streamIdPresent: fields.streamIdPresent,
    savedContainerExtensionPresent: fields.savedContainerExtensionPresent,
    canonicalMovieFound: fields.canonicalMovieFound,
    canonicalContainerExtensionPresent: fields.canonicalContainerExtensionPresent,
    resolvedContainerExtensionPresent: fields.resolvedContainerExtensionPresent,
    extensionSource: fields.extensionSource,
    savedPositionPresent: fields.savedPositionPresent,
    resumeEligible: fields.resumeEligible,
    decision: fields.decision,
  });
}

export function logHomeContinueWatchingCanonicalization(payload: {
  event: 'lookup-start' | 'lookup-hit' | 'lookup-miss' | 'canonical-merged' | 'extension-recovered' | 'launch';
  movieId?: string | null;
  lookupKeyType?: 'content-id';
  canonicalFound?: boolean;
  savedExtensionPresent?: boolean;
  canonicalExtensionPresent?: boolean;
  resolvedExtensionPresent?: boolean;
}) {
  console.info(
    '[NovaCast Home CW Canonicalization] ' +
      JSON.stringify({
        event: payload.event,
        movieId: payload.movieId ?? null,
        lookupKeyType: payload.lookupKeyType ?? 'content-id',
        canonicalFound: payload.canonicalFound ?? false,
        savedExtensionPresent: payload.savedExtensionPresent ?? false,
        canonicalExtensionPresent: payload.canonicalExtensionPresent ?? false,
        resolvedExtensionPresent: payload.resolvedExtensionPresent ?? false,
      }),
  );
}

type HomeCwFallbackRecovery = {
  movieId: string;
  extensionSource: HomeContinueWatchingExtensionSource;
  attemptedExtension?: string;
  recover: () => Promise<{ streamUrl: string; containerExtension: string } | null>;
  alreadyRetried: boolean;
};

let armedFallbackRecovery: HomeCwFallbackRecovery | null = null;

export function armHomeContinueWatchingFallbackRecovery(
  next: Omit<HomeCwFallbackRecovery, 'alreadyRetried'>,
) {
  armedFallbackRecovery = { ...next, alreadyRetried: false };
}

export function disarmHomeContinueWatchingFallbackRecovery() {
  armedFallbackRecovery = null;
}

export async function tryHomeContinueWatchingFallbackRecovery(input: {
  movieId: string;
  httpResponseCode?: number | null;
  mediaType?: string;
}): Promise<{ streamUrl: string; containerExtension: string } | null> {
  const armed = armedFallbackRecovery;
  if (!armed || armed.movieId !== input.movieId) {
    return null;
  }
  if (armed.alreadyRetried || armed.extensionSource !== 'fallback' || input.httpResponseCode !== 551) {
    return null;
  }
  if (input.mediaType && input.mediaType !== 'movie') {
    return null;
  }
  armed.alreadyRetried = true;
  const recovered = await armed.recover();
  if (!recovered) {
    return null;
  }
  const recoveredExt = normalizeHomeCwExtension(recovered.containerExtension);
  const attempted = normalizeHomeCwExtension(armed.attemptedExtension) ?? 'mp4';
  if (!recoveredExt || recoveredExt === attempted) {
    return null;
  }
  logHomeContinueWatchingCanonicalization({
    event: 'extension-recovered',
    movieId: input.movieId,
    lookupKeyType: 'content-id',
    canonicalFound: true,
    savedExtensionPresent: Boolean(normalizeHomeCwExtension(armed.attemptedExtension)),
    canonicalExtensionPresent: true,
    resolvedExtensionPresent: true,
  });
  return { streamUrl: recovered.streamUrl, containerExtension: recoveredExt };
}
