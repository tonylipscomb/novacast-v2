/**
 * Diagnostics-only Movies playback audit (Browse + Search).
 * Observe-only — does not alter launcher, resolver, or player behavior.
 */

export type MoviePlaybackAuditOrigin = 'browse-detail' | 'search-detail';

export type MoviePlaybackFailureStage =
  | 'play-pressed'
  | 'movie-resolved'
  | 'launcher-called'
  | 'source-resolution-started'
  | 'source-resolved'
  | 'player-requested'
  | 'player-mounted'
  | 'playback-started'
  | 'failed'
  | null;

const MARKER = 'movies-playback-audit-diagnostics-v1';

type LifecycleSnapshot = {
  origin: MoviePlaybackAuditOrigin;
  movieId: string | null;
  detailOpen: boolean;
  playPressed: boolean;
  canonicalMovieResolved: boolean;
  launcherCalled: boolean;
  sourceResolverCalled: boolean;
  sourceResolved: boolean;
  playerRouteRequested: boolean;
  playerMounted: boolean;
  playbackStarted: boolean;
  failureStage: MoviePlaybackFailureStage;
  failureReason: string | null;
};

let active: LifecycleSnapshot | null = null;

function emitLifecycle(snapshot: LifecycleSnapshot) {
  console.info(
    '[NovaCast Movie Playback Lifecycle] ' +
      JSON.stringify({
        ...snapshot,
        marker: MARKER,
      }),
  );
}

export function logMoviePlaybackShape(input: {
  origin: MoviePlaybackAuditOrigin;
  movieId?: string | null;
  contentId?: string | null;
  streamId?: string | null;
  providerId?: string | null;
  mediaType?: string | null;
  containerExtension?: string | null;
  playbackSource?: string | null;
  directSource?: string | null;
  title?: string | null;
  posterUrl?: string | null;
}) {
  console.info(
    '[NovaCast Movie Playback Shape] ' +
      JSON.stringify({
        origin: input.origin,
        hasMovieId: Boolean(String(input.movieId ?? '').trim()),
        hasContentId: Boolean(String(input.contentId ?? input.movieId ?? '').trim()),
        hasStreamId: Boolean(String(input.streamId ?? input.movieId ?? '').trim()),
        hasProviderId: Boolean(String(input.providerId ?? '').trim()),
        hasMediaType: Boolean(String(input.mediaType ?? '').trim()),
        hasContainerExtension: Boolean(String(input.containerExtension ?? '').trim()),
        hasPlaybackSource: Boolean(String(input.playbackSource ?? '').trim()),
        hasDirectSource: Boolean(String(input.directSource ?? '').trim()),
        hasTitle: Boolean(String(input.title ?? '').trim()),
        hasPoster: Boolean(String(input.posterUrl ?? '').trim()),
        marker: MARKER,
      }),
  );
}

export function beginMoviePlaybackLifecycle(input: {
  origin: MoviePlaybackAuditOrigin;
  movieId: string | null;
  detailOpen: boolean;
}) {
  active = {
    origin: input.origin,
    movieId: input.movieId,
    detailOpen: input.detailOpen,
    playPressed: true,
    canonicalMovieResolved: false,
    launcherCalled: false,
    sourceResolverCalled: false,
    sourceResolved: false,
    playerRouteRequested: false,
    playerMounted: false,
    playbackStarted: false,
    failureStage: null,
    failureReason: null,
  };
  emitLifecycle(active);
}

export function markMoviePlaybackLifecycle(
  stage:
    | 'movie-resolved'
    | 'launcher-called'
    | 'source-resolution-started'
    | 'source-resolved'
    | 'player-requested'
    | 'player-mounted'
    | 'playback-started'
    | 'failed',
  patch: Partial<
    Pick<LifecycleSnapshot, 'movieId' | 'detailOpen' | 'failureReason' | 'failureStage'>
  > = {},
) {
  if (!active) {
    return;
  }

  const next: LifecycleSnapshot = {
    ...active,
    ...patch,
  };

  switch (stage) {
    case 'movie-resolved':
      next.canonicalMovieResolved = true;
      next.failureStage = null;
      break;
    case 'launcher-called':
      next.launcherCalled = true;
      next.failureStage = null;
      break;
    case 'source-resolution-started':
      next.sourceResolverCalled = true;
      next.failureStage = null;
      break;
    case 'source-resolved':
      next.sourceResolverCalled = true;
      next.sourceResolved = true;
      next.failureStage = null;
      break;
    case 'player-requested':
      next.playerRouteRequested = true;
      next.failureStage = null;
      break;
    case 'player-mounted':
      next.playerMounted = true;
      next.failureStage = null;
      break;
    case 'playback-started':
      next.playbackStarted = true;
      next.failureStage = null;
      break;
    case 'failed':
      next.failureStage = patch.failureStage ?? 'failed';
      next.failureReason = patch.failureReason ?? next.failureReason ?? 'unknown';
      break;
    default:
      break;
  }

  active = next;
  emitLifecycle(next);
}

/** Called from the unified player host — diagnostics only. */
export function noteMoviePlaybackPlayerMounted(movieId: string | null | undefined) {
  if (!active) {
    return;
  }
  if (movieId && active.movieId && movieId !== active.movieId) {
    return;
  }
  markMoviePlaybackLifecycle('player-mounted', { movieId: movieId ?? active.movieId });
}

/** Called when native playback reaches a started/playing signal — diagnostics only. */
export function noteMoviePlaybackStarted(movieId: string | null | undefined) {
  if (!active) {
    return;
  }
  if (movieId && active.movieId && movieId !== active.movieId) {
    return;
  }
  markMoviePlaybackLifecycle('playback-started', { movieId: movieId ?? active.movieId });
}

export function noteMoviePlaybackFailed(reason: string, movieId?: string | null) {
  markMoviePlaybackLifecycle('failed', {
    movieId: movieId ?? active?.movieId ?? null,
    failureReason: reason,
  });
}

export function getActiveMoviePlaybackAuditMovieId() {
  return active?.movieId ?? null;
}

export function getMoviePlaybackAuditMarker() {
  return MARKER;
}
