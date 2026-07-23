import type { NormalizedGuideRow } from './guideTimeline';

export type GuideLoadStatus = 'loading' | 'ready' | 'empty' | 'no-epg' | 'no-favorites' | 'error';

/** Categories a channel can never belong to; used to detect the synthetic Favorites bucket everywhere. */
export const GUIDE_FAVORITES_CATEGORY_ID = 'favorites';

function hasAnyEpg(rows: NormalizedGuideRow[]) {
  return rows.some((row) => row.programs.some((program) => program.hasValidWindow));
}

/** A single channel with no EPG must not force the whole category into a 'no-epg' state. */
export function statusForRows(categoryId: string, rows: NormalizedGuideRow[], favoritesAvailable: boolean): GuideLoadStatus {
  if (categoryId === GUIDE_FAVORITES_CATEGORY_ID && !favoritesAvailable) {
    return 'no-favorites';
  }
  if (!rows.length) {
    return 'empty';
  }
  return hasAnyEpg(rows) ? 'ready' : 'no-epg';
}

/** Channels must stay unique by stable id across paged loads, regardless of provider duplication. */
export function dedupeRowsByChannelId(rows: NormalizedGuideRow[]): NormalizedGuideRow[] {
  const seen = new Set<string>();
  const result: NormalizedGuideRow[] = [];
  for (const row of rows) {
    if (seen.has(row.channel.id)) continue;
    seen.add(row.channel.id);
    result.push(row);
  }
  return result;
}

export type GuideCategoryResultUpdate = {
  requestId: number;
  currentRequestId: number;
  categoryId: string;
  nextRows: NormalizedGuideRow[];
  hasMore: boolean;
  totalCount: number | null;
  append: boolean;
  favoritesAvailable: boolean;
};

export type GuideCategoryResult = {
  /** False when `requestId` is stale (a category change happened before this request resolved). */
  applied: boolean;
  rows: NormalizedGuideRow[];
  hasMore: boolean;
  totalCount: number | null;
  status: GuideLoadStatus;
};

/**
 * Pure reducer mirroring `resolveLivePreview` in `liveTvLogic.ts`: applies a
 * paged/category result only if its request id still matches the latest
 * request, so a slow response for a category the user has since navigated
 * away from can never clobber the current view.
 */
export function applyGuideCategoryResult(
  currentRows: NormalizedGuideRow[],
  update: GuideCategoryResultUpdate,
): GuideCategoryResult {
  if (update.requestId !== update.currentRequestId) {
    return { applied: false, rows: currentRows, hasMore: false, totalCount: null, status: 'loading' };
  }

  const merged = update.append
    ? dedupeRowsByChannelId([...currentRows, ...update.nextRows])
    : dedupeRowsByChannelId(update.nextRows);

  return {
    applied: true,
    rows: merged,
    hasMore: update.hasMore,
    totalCount: update.totalCount,
    status: statusForRows(update.categoryId, merged, update.favoritesAvailable),
  };
}

export type GuideState = {
  focusedChannelId: string | null;
  focusedProgramId: string | null;
  selectedChannelId: string | null;
  selectedProgramId: string | null;
  focusedTimestamp: number | null;
};

export type GuideTuneRecord = {
  key: string;
  at: number;
};

export function shouldAcceptGuideTune(
  record: GuideTuneRecord | null,
  key: string,
  now: number,
  windowMs = 400,
) {
  return record?.key !== key || now - record.at >= windowMs;
}

export function createInitialGuideState(channelId = 'n1', programId = 'n1-0'): GuideState {
  return {
    focusedChannelId: channelId,
    focusedProgramId: programId,
    selectedChannelId: channelId,
    selectedProgramId: programId,
    focusedTimestamp: null,
  };
}

export function focusGuideProgram(state: GuideState, channelId: string, programId: string): GuideState {
  return {
    ...state,
    focusedChannelId: channelId,
    focusedProgramId: programId,
    focusedTimestamp: null,
  };
}

export function focusGuideProgramAt(state: GuideState, channelId: string, programId: string, timestamp: number | null): GuideState {
  return {
    ...state,
    focusedChannelId: channelId,
    focusedProgramId: programId,
    focusedTimestamp: timestamp,
  };
}

export function selectGuideProgram(state: GuideState, channelId: string, programId: string): GuideState {
  return {
    ...state,
    selectedChannelId: channelId,
    selectedProgramId: programId,
  };
}

/** Stable id so a repeated `showNotification` call updates the same Guide toast in place. */
export const GUIDE_NOTIFICATION_ID = 'guide-data-unavailable';
/** Temporary toast lifetime; see `resolveGuideNotificationForStatus` for when it becomes persistent instead. */
export const GUIDE_NOTIFICATION_DURATION_MS = 7000;

export type GuideNotificationSpec = {
  title: string;
  message: string;
  persistent: boolean;
};

/**
 * Maps a Guide load status to a corner-toast spec, or `null` when the status should stay
 * an inline/full-panel state instead of a toast (`ready`, `empty`, `no-favorites` — the
 * screen still has a clear, distinct empty/ready state of its own for those).
 *
 * Only `error` and `no-epg` become toasts: the channel list, category rail, and timeline
 * stay visible and rendered normally underneath, since neither state actually removes all
 * usable content from the screen (a single channel's own missing EPG is handled per-row
 * elsewhere and never reaches this function at all).
 *
 * `retryAttemptedAndStillFailing` marks the toast `persistent` once the user has already
 * retried and the same failure recurred, so it doesn't silently auto-dismiss while the
 * underlying problem is still unresolved. A first-time failure stays a normal temporary
 * toast (~7s) so it doesn't linger and clutter the screen if the user simply moves on.
 */
export function resolveGuideNotificationForStatus(
  status: GuideLoadStatus,
  retryAttemptedAndStillFailing: boolean,
): GuideNotificationSpec | null {
  if (status === 'no-epg') {
    return {
      title: 'Guide data unavailable',
      message: 'Your provider returned channels, but no program schedule is available yet.',
      persistent: retryAttemptedAndStillFailing,
    };
  }

  if (status === 'error') {
    return {
      title: 'Guide data unavailable',
      message: 'We could not refresh guide data from your provider.',
      persistent: retryAttemptedAndStillFailing,
    };
  }

  return null;
}
