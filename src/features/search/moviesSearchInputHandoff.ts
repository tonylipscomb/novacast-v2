/**
 * Stage 3G.2 — SearchInput → first-result Down handoff (one token per Down press).
 */

import type { RefObject } from 'react';

import { requestTvFocus } from '../navigation/tvFocusDiagnostics.ts';

import {
  getFirstMoviesSearchResultId,
  getMoviesSearchResultTargetRef,
  setMoviesSearchResultOrder,
} from './moviesSearchFocus.ts';

const MARKER = 'stage3g2-search-input-handoff-v1';

export type MoviesSearchInputHandoffAction =
  | 'down-received'
  | 'ime-dismissed'
  | 'target-resolved'
  | 'target-requested'
  | 'target-confirmed'
  | 'input-reclaimed'
  | 'cancelled'
  | 'empty-results';

export type MoviesSearchInputHandoffToken = {
  requestId: number;
  queryRevision: number;
  targetMovieId: string;
};

type PendingHandoff = MoviesSearchInputHandoffToken & {
  confirmed: boolean;
  focusRequested: boolean;
  cancelled: boolean;
};

type FocusableTarget = { focus: () => void };

let queryRevision = 0;
let pending: PendingHandoff | null = null;
let targetsListener: (() => void) | null = null;
let resolveNativeTag: ((target: FocusableTarget | null | undefined) => number | null) | null = null;

export function setMoviesSearchNativeTagResolver(
  resolver: ((target: FocusableTarget | null | undefined) => number | null) | null,
) {
  resolveNativeTag = resolver;
}

export function bumpMoviesSearchInputQueryRevision() {
  queryRevision += 1;
  return queryRevision;
}

export function getMoviesSearchInputQueryRevision() {
  return queryRevision;
}

export function setMoviesSearchInputTargetsListener(listener: (() => void) | null) {
  targetsListener = listener;
}

export function notifyMoviesSearchInputTargetsChanged() {
  targetsListener?.();
}

export function logMoviesSearchInputHandoff(payload: {
  requestId: number | null;
  queryRevision: number;
  action: MoviesSearchInputHandoffAction;
  resultCount: number;
  firstResultMovieId: string | null;
  firstResultMounted: boolean;
  firstResultNativeTag: number | null;
  inputPreferred: boolean;
  inputFocused: boolean;
  imeVisible: boolean;
  focusRequested: boolean;
  targetConfirmed: boolean;
  blockedReason: string | null;
}) {
  console.info(
    '[NovaCast Movies Search Input Handoff] ' +
      JSON.stringify({
        ...payload,
        marker: MARKER,
      }),
  );
}

export function getFirstMoviesSearchResultNativeTag(): number | null {
  const movieId = getFirstMoviesSearchResultId();
  if (!movieId) {
    return null;
  }
  const ref = getMoviesSearchResultTargetRef(movieId);
  if (!ref?.current) {
    return null;
  }
  return resolveNativeTag?.(ref.current as FocusableTarget) ?? null;
}

export function cancelMoviesSearchInputHandoff(
  reason: string,
  meta?: {
    requestId?: number | null;
    resultCount?: number;
    inputFocused?: boolean;
    inputPreferred?: boolean;
    imeVisible?: boolean;
  },
) {
  if (!pending || pending.cancelled) {
    pending = null;
    return;
  }
  pending.cancelled = true;
  const token = pending;
  pending = null;
  logMoviesSearchInputHandoff({
    requestId: meta?.requestId ?? token.requestId,
    queryRevision: token.queryRevision,
    action: 'cancelled',
    resultCount: meta?.resultCount ?? 0,
    firstResultMovieId: token.targetMovieId,
    firstResultMounted: Boolean(getMoviesSearchResultTargetRef(token.targetMovieId)?.current),
    firstResultNativeTag: getFirstMoviesSearchResultNativeTag(),
    inputPreferred: meta?.inputPreferred ?? false,
    inputFocused: meta?.inputFocused ?? false,
    imeVisible: meta?.imeVisible ?? false,
    focusRequested: token.focusRequested,
    targetConfirmed: token.confirmed,
    blockedReason: reason,
  });
}

/**
 * One Down press → one handoff. No retry loop.
 * Returns true when a focus request was issued.
 */
export function beginMoviesSearchInputDownHandoff(input: {
  requestId: number;
  queryRevision: number;
  resultIds: string[];
  inputPreferred: boolean;
  inputFocused: boolean;
  imeVisible: boolean;
  dismissIme?: () => void;
}): { accepted: boolean; token: MoviesSearchInputHandoffToken | null; nativeTag: number | null } {
  setMoviesSearchResultOrder(input.resultIds);

  logMoviesSearchInputHandoff({
    requestId: input.requestId,
    queryRevision: input.queryRevision,
    action: 'down-received',
    resultCount: input.resultIds.length,
    firstResultMovieId: input.resultIds[0] ?? null,
    firstResultMounted: Boolean(
      input.resultIds[0] && getMoviesSearchResultTargetRef(input.resultIds[0])?.current,
    ),
    firstResultNativeTag: getFirstMoviesSearchResultNativeTag(),
    inputPreferred: input.inputPreferred,
    inputFocused: input.inputFocused,
    imeVisible: input.imeVisible,
    focusRequested: false,
    targetConfirmed: false,
    blockedReason: null,
  });

  if (input.resultIds.length === 0) {
    logMoviesSearchInputHandoff({
      requestId: input.requestId,
      queryRevision: input.queryRevision,
      action: 'empty-results',
      resultCount: 0,
      firstResultMovieId: null,
      firstResultMounted: false,
      firstResultNativeTag: null,
      inputPreferred: input.inputPreferred,
      inputFocused: true,
      imeVisible: input.imeVisible,
      focusRequested: false,
      targetConfirmed: false,
      blockedReason: 'empty-results',
    });
    return { accepted: false, token: null, nativeTag: null };
  }

  // Cancel any prior incomplete handoff — one token per Down.
  if (pending && !pending.confirmed && !pending.cancelled) {
    cancelMoviesSearchInputHandoff('superseded-by-new-down', {
      requestId: input.requestId,
      resultCount: input.resultIds.length,
      inputFocused: input.inputFocused,
      inputPreferred: input.inputPreferred,
      imeVisible: input.imeVisible,
    });
  }

  if (input.imeVisible && input.dismissIme) {
    input.dismissIme();
    logMoviesSearchInputHandoff({
      requestId: input.requestId,
      queryRevision: input.queryRevision,
      action: 'ime-dismissed',
      resultCount: input.resultIds.length,
      firstResultMovieId: input.resultIds[0] ?? null,
      firstResultMounted: Boolean(
        input.resultIds[0] && getMoviesSearchResultTargetRef(input.resultIds[0])?.current,
      ),
      firstResultNativeTag: getFirstMoviesSearchResultNativeTag(),
      inputPreferred: false,
      inputFocused: input.inputFocused,
      imeVisible: false,
      focusRequested: false,
      targetConfirmed: false,
      blockedReason: null,
    });
  }

  const targetMovieId = input.resultIds[0]!;
  const ref = getMoviesSearchResultTargetRef(targetMovieId);
  const mounted = Boolean(ref?.current);
  const nativeTag =
    mounted && ref?.current
      ? resolveNativeTag?.(ref.current as FocusableTarget) ?? null
      : null;

  logMoviesSearchInputHandoff({
    requestId: input.requestId,
    queryRevision: input.queryRevision,
    action: 'target-resolved',
    resultCount: input.resultIds.length,
    firstResultMovieId: targetMovieId,
    firstResultMounted: mounted,
    firstResultNativeTag: nativeTag,
    inputPreferred: false,
    inputFocused: input.inputFocused,
    imeVisible: false,
    focusRequested: false,
    targetConfirmed: false,
    blockedReason: mounted ? null : 'first-result-not-mounted',
  });

  if (!mounted || !ref) {
    return { accepted: false, token: null, nativeTag: null };
  }

  if (input.queryRevision !== queryRevision) {
    logMoviesSearchInputHandoff({
      requestId: input.requestId,
      queryRevision: input.queryRevision,
      action: 'cancelled',
      resultCount: input.resultIds.length,
      firstResultMovieId: targetMovieId,
      firstResultMounted: true,
      firstResultNativeTag: nativeTag,
      inputPreferred: false,
      inputFocused: input.inputFocused,
      imeVisible: false,
      focusRequested: false,
      targetConfirmed: false,
      blockedReason: 'query-revision-changed',
    });
    return { accepted: false, token: null, nativeTag: null };
  }

  const token: MoviesSearchInputHandoffToken = {
    requestId: input.requestId,
    queryRevision: input.queryRevision,
    targetMovieId,
  };
  pending = {
    ...token,
    confirmed: false,
    focusRequested: true,
    cancelled: false,
  };

  logMoviesSearchInputHandoff({
    requestId: input.requestId,
    queryRevision: input.queryRevision,
    action: 'target-requested',
    resultCount: input.resultIds.length,
    firstResultMovieId: targetMovieId,
    firstResultMounted: true,
    firstResultNativeTag: nativeTag,
    inputPreferred: false,
    inputFocused: false,
    imeVisible: false,
    focusRequested: true,
    targetConfirmed: false,
    blockedReason: null,
  });

  const targetRef: RefObject<FocusableTarget | null> = ref as RefObject<FocusableTarget | null>;
  requestTvFocus({
    screen: 'search-overlay',
    source: 'MoviesSearchInputHandoff',
    region: 'search-results',
    itemId: targetMovieId,
    reason: 'down-from-search-input',
    getTarget: () => {
      if (!pending || pending.cancelled || pending.queryRevision !== queryRevision) {
        return null;
      }
      return targetRef.current;
    },
  });

  return { accepted: true, token, nativeTag };
}

export function confirmMoviesSearchInputHandoff(input: {
  movieId: string;
  requestId: number | null;
  inputFocused: boolean;
}) {
  if (!pending || pending.cancelled) {
    return false;
  }
  if (pending.targetMovieId !== input.movieId) {
    return false;
  }
  // One confirmation only — ignore subsequent focus events for the same token.
  if (pending.confirmed) {
    return false;
  }
  pending.confirmed = true;
  const token = pending;
  logMoviesSearchInputHandoff({
    requestId: input.requestId ?? token.requestId,
    queryRevision: token.queryRevision,
    action: 'target-confirmed',
    resultCount: 0,
    firstResultMovieId: token.targetMovieId,
    firstResultMounted: true,
    firstResultNativeTag: getFirstMoviesSearchResultNativeTag(),
    inputPreferred: false,
    inputFocused: input.inputFocused,
    imeVisible: false,
    focusRequested: true,
    targetConfirmed: true,
    blockedReason: null,
  });
  pending = null;
  return true;
}

export function noteMoviesSearchInputReclaimed(meta: {
  requestId: number | null;
  queryRevision: number;
  inputPreferred: boolean;
}) {
  logMoviesSearchInputHandoff({
    requestId: meta.requestId,
    queryRevision: meta.queryRevision,
    action: 'input-reclaimed',
    resultCount: 0,
    firstResultMovieId: getFirstMoviesSearchResultId(),
    firstResultMounted: Boolean(
      getFirstMoviesSearchResultId() &&
        getMoviesSearchResultTargetRef(getFirstMoviesSearchResultId()!)?.current,
    ),
    firstResultNativeTag: getFirstMoviesSearchResultNativeTag(),
    inputPreferred: meta.inputPreferred,
    inputFocused: true,
    imeVisible: false,
    focusRequested: false,
    targetConfirmed: false,
    blockedReason: null,
  });
}

export function hasPendingMoviesSearchInputHandoff() {
  return Boolean(pending && !pending.cancelled && !pending.confirmed);
}

export function resetMoviesSearchInputHandoffForTests() {
  pending = null;
  queryRevision = 0;
  targetsListener = null;
  resolveNativeTag = null;
}
