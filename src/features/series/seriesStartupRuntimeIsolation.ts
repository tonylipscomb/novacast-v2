/**
 * Stage 4.2O — Series startup runtime isolation + Detail/episode/playback
 * browse-boundary diagnostics. Mirrors the relevant subset of
 * `moviesStartupRuntimeIsolation.ts` needed for Series browse (Detail itself
 * is out of scope for this stage — these helpers only *guard* the boundary).
 */

export const SERIES_FOCUS_STAGE4O1_MARKER = 'stage4o1-series-startup-runtime-isolation-v1';

export type SeriesStartupSession = {
  sessionId: string;
  providerId: string;
  interactive: boolean;
  focusOwnershipActive: boolean;
  focusConfirmed: boolean;
  focusReleased: boolean;
  startedAt: number;
};

const sessionsByProvider = new Map<string, SeriesStartupSession>();

let nextSessionSerial = 1;

export function createSeriesStartupSessionId(providerId: string): string {
  const serial = nextSessionSerial++;
  return `series-startup:${providerId}:${serial}:${Date.now()}`;
}

export function beginSeriesStartupSession(providerId: string): SeriesStartupSession {
  const session: SeriesStartupSession = {
    sessionId: createSeriesStartupSessionId(providerId),
    providerId,
    interactive: false,
    focusOwnershipActive: true,
    focusConfirmed: false,
    focusReleased: false,
    startedAt: Date.now(),
  };
  sessionsByProvider.set(providerId, session);
  return session;
}

export function getSeriesStartupSession(providerId: string): SeriesStartupSession | null {
  return sessionsByProvider.get(providerId) ?? null;
}

export function markSeriesStartupSessionInteractive(providerId: string): void {
  const session = sessionsByProvider.get(providerId);
  if (!session) {
    return;
  }
  session.interactive = true;
}

export function releaseSeriesStartupFocusOwnership(providerId: string): {
  released: boolean;
  session: SeriesStartupSession | null;
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

export function shouldBlockSeriesStartupReentry(providerId: string): boolean {
  return Boolean(sessionsByProvider.get(providerId)?.interactive);
}

export function resetSeriesStartupSessionsForTests(): void {
  sessionsByProvider.clear();
  nextSessionSerial = 1;
}

export function shouldDropLateSeriesStartupFocusResult(input: {
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

/**
 * Detail/episode/playback isolation violation kinds (Stage 4.2O §12).
 * Series Detail (`SeriesDetailOverlay`) is unchanged this stage — these are
 * guard-rail assertions the browse model/screen call to prove the boundary
 * holds, not a redesign of Detail itself.
 */
export type SeriesBrowseIsolationViolationKind =
  | 'categories-replaced-by-detail'
  | 'visible-series-replaced-by-detail'
  | 'category-reloaded-on-detail-close'
  | 'grid-remounted-on-playback-return'
  | 'episode-hydration-during-browse-startup'
  | 'browse-generation-mutated-by-season-change';

export function logSeriesBrowseIsolationViolation(
  kind: SeriesBrowseIsolationViolationKind,
  payload: Record<string, unknown> = {},
): void {
  console.info(
    '[NovaCast Series Browse Isolation Violation] ' +
      JSON.stringify({
        kind,
        marker: SERIES_FOCUS_STAGE4O1_MARKER,
        ...payload,
      }),
  );
}
