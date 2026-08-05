/**
 * Stage 4.2L.1 — Movies startup runtime isolation + Detail-close focus ownership helpers.
 */

export const MOVIES_FOCUS_STAGE4L1_MARKER = 'stage4l1-movies-startup-runtime-isolation-v1';

export type MoviesStartupSession = {
  sessionId: string;
  providerId: string;
  pinnedGeneration: number;
  interactive: boolean;
  focusOwnershipActive: boolean;
  focusConfirmed: boolean;
  focusReleased: boolean;
  startedAt: number;
};

export type MoviesToolbarSearchFocusGateInput = {
  detailPhase: string;
  detailOpen: boolean;
  detailClosing: boolean;
  restoringBrowseFocus: boolean;
  postRestoreLatchActive: boolean;
  startupFocusOwnershipActive: boolean;
  playbackReturnRestoring: boolean;
};

const sessionsByProvider = new Map<string, MoviesStartupSession>();

let nextSessionSerial = 1;

export function createMoviesStartupSessionId(providerId: string): string {
  const serial = nextSessionSerial++;
  return `movies-startup:${providerId}:${serial}:${Date.now()}`;
}

export function beginMoviesStartupSession(providerId: string): MoviesStartupSession {
  const session: MoviesStartupSession = {
    sessionId: createMoviesStartupSessionId(providerId),
    providerId,
    pinnedGeneration: 0,
    interactive: false,
    focusOwnershipActive: true,
    focusConfirmed: false,
    focusReleased: false,
    startedAt: Date.now(),
  };
  sessionsByProvider.set(providerId, session);
  return session;
}

export function getMoviesStartupSession(providerId: string): MoviesStartupSession | null {
  return sessionsByProvider.get(providerId) ?? null;
}

export function setMoviesStartupPinnedGeneration(providerId: string, generation: number): void {
  const session = sessionsByProvider.get(providerId);
  if (!session || session.interactive) {
    return;
  }
  if (generation > 0) {
    session.pinnedGeneration = generation;
  }
}

export function markMoviesStartupSessionInteractive(providerId: string): void {
  const session = sessionsByProvider.get(providerId);
  if (!session) {
    return;
  }
  session.interactive = true;
}

export function releaseMoviesStartupFocusOwnership(providerId: string): {
  released: boolean;
  session: MoviesStartupSession | null;
} {
  const session = sessionsByProvider.get(providerId);
  if (!session) {
    return { released: false, session: null };
  }
  if (session.focusReleased) {
    return { released: false, session };
  }
  session.focusConfirmed = true;
  session.focusOwnershipActive = false;
  session.focusReleased = true;
  return { released: true, session };
}

export function shouldBlockMoviesStartupReentry(providerId: string): boolean {
  return Boolean(sessionsByProvider.get(providerId)?.interactive);
}

export function resetMoviesStartupSessionsForTests(): void {
  sessionsByProvider.clear();
  nextSessionSerial = 1;
}

/** Search must never carry preferred focus while poster restoration / startup owns focus. */
export function shouldAllowMoviesToolbarSearchPreferredFocus(
  input: MoviesToolbarSearchFocusGateInput,
): boolean {
  if (input.startupFocusOwnershipActive) {
    return false;
  }
  if (input.detailOpen || input.detailClosing) {
    return false;
  }
  if (input.restoringBrowseFocus || input.postRestoreLatchActive) {
    return false;
  }
  if (input.playbackReturnRestoring) {
    return false;
  }
  switch (input.detailPhase) {
    case 'detail-open':
    case 'return-focus-arming':
    case 'return-focus-requested':
    case 'closing-prepare':
    case 'closing-viewport':
    case 'closing-focus':
    case 'closing-confirm':
    case 'browse-restored':
      return false;
    default:
      return true;
  }
}

/**
 * @deprecated Stage 4.2L.2 — Search onFocus must never correct focus via requestTvFocus.
 * Kept as a no-op predictor for diagnostics only (always returns correct: false).
 */
export function shouldCorrectMoviesToolbarSearchFocusSteal(_input: {
  browseDetailCloseActive: boolean;
  searchPreferredFocus: boolean;
  correctionAlreadyIssuedForToken: boolean;
}): { correct: boolean; reason: string } {
  return { correct: false, reason: 'correction-disabled-stage4l2' };
}

export function shouldDropLateMoviesStartupFocusResult(input: {
  startupInteractive: boolean;
  startupFocusReleased: boolean;
  detailOpen: boolean;
  detailClosing: boolean;
}): boolean {
  // After the one-shot startup focus is released, never apply late startup mutations.
  if (input.startupFocusReleased) {
    return true;
  }
  // Once interactive, Detail-active completions must not steal browse focus.
  if (input.startupInteractive && (input.detailOpen || input.detailClosing)) {
    return true;
  }
  return false;
}

export function isValidExpoBlurTargetRef(blurTarget: unknown): boolean {
  if (!blurTarget || typeof blurTarget !== 'object') {
    return false;
  }
  const ref = blurTarget as { current?: unknown; __expoBlurTarget?: boolean };
  // Explicit opt-in marker set by MoviesScreen when wrapping BlurTargetView.
  if (ref.__expoBlurTarget === true && ref.current != null) {
    return true;
  }
  return false;
}

export function extractPlaybackHttpStatus(error: unknown): number | null {
  const value =
    typeof error === 'string'
      ? error
      : error instanceof Error
        ? `${error.name} ${error.message}`
        : String(error ?? '');
  const responseCode = value.match(
    /InvalidResponseCodeException[:\s]+(\d{3})|Response code[:\s]+(\d{3})|HTTP\s+(\d{3})|\b(401|403|404|429|458|5\d{2})\b/i,
  );
  if (!responseCode) {
    return null;
  }
  const raw = responseCode[1] || responseCode[2] || responseCode[3] || responseCode[4];
  const status = Number(raw);
  return Number.isFinite(status) ? status : null;
}

export function classifyPlaybackHttpStatus(
  status: number,
):
  | 'authorization'
  | 'unavailable_stream'
  | 'provider_rate_limit'
  | 'provider_source_rejected'
  | 'provider_server_failure'
  | 'provider' {
  if (status === 401 || status === 403) {
    return 'authorization';
  }
  if (status === 404) {
    return 'unavailable_stream';
  }
  if (status === 429) {
    return 'provider_rate_limit';
  }
  if (status === 458) {
    return 'provider_source_rejected';
  }
  if (status >= 500 && status <= 599) {
    return 'provider_server_failure';
  }
  return 'provider';
}

export type SanitizedPlaybackSourceSnapshot = {
  movieId: string;
  streamIdType: 'content-id';
  containerExtension: string | null;
  sourceScheme: string | null;
  sourceHost: string | null;
  finalPathExtension: string | null;
  providerId: string | null;
  credentialsEmbedded: boolean;
  httpResponseCode: number | null;
};

export function buildSanitizedPlaybackSourceSnapshot(input: {
  movieId: string;
  streamUrl: string | null | undefined;
  containerExtension?: string | null;
  providerId?: string | null;
  httpResponseCode?: number | null;
}): SanitizedPlaybackSourceSnapshot {
  let sourceScheme: string | null = null;
  let sourceHost: string | null = null;
  let finalPathExtension: string | null = null;
  let credentialsEmbedded = false;

  if (input.streamUrl) {
    try {
      const parsed = new URL(input.streamUrl);
      sourceScheme = parsed.protocol.replace(':', '') || null;
      sourceHost = parsed.hostname || null;
      credentialsEmbedded = Boolean(parsed.username || parsed.password);
      const path = parsed.pathname || '';
      const dot = path.lastIndexOf('.');
      if (dot > 0 && dot < path.length - 1) {
        finalPathExtension = path.slice(dot + 1).toLowerCase();
      }
      // Xtream-style /movie/user/pass/id.ext embeds credentials in path segments.
      if (/\/movie\/[^/]+\/[^/]+\//i.test(path) || /\/series\/[^/]+\/[^/]+\//i.test(path)) {
        credentialsEmbedded = true;
      }
    } catch {
      sourceScheme = null;
      sourceHost = null;
    }
  }

  return {
    movieId: input.movieId,
    streamIdType: 'content-id',
    containerExtension: input.containerExtension ?? finalPathExtension,
    sourceScheme,
    sourceHost,
    finalPathExtension,
    providerId: input.providerId ?? null,
    credentialsEmbedded,
    httpResponseCode: input.httpResponseCode ?? null,
  };
}
