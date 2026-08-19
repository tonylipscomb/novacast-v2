/**
 * Stage 3G — deterministic Search input → result-grid focus handoff.
 */

import { novacastTrace } from '../diagnostics/novacastLogPolicy.ts';
import type { RefObject } from 'react';
import type { View } from 'react-native';

import { requestTvFocus } from '../navigation/tvFocusDiagnostics.ts';

const MARKER = 'stage3g-sqlite-movies-search-v1';

type FocusTarget = {
  movieId: string;
  ref: RefObject<View | null>;
};

const targets = new Map<string, FocusTarget>();
let orderedIds: string[] = [];
let pendingFocusRequest: {
  requestId: number;
  movieId: string;
  retryCount: number;
  cancelled: boolean;
  timer: ReturnType<typeof setTimeout> | null;
} | null = null;
let focusGeneration = 0;

export function logMoviesSearchFocus(payload: {
  requestId: number | null;
  query: string;
  resultCount: number;
  action:
    | 'results-ready'
    | 'down-from-input'
    | 'target-requested'
    | 'target-confirmed'
    | 'up-to-input'
    | 'cancelled'
    | 'empty-no-target';
  targetMovieId: string | null;
  targetMounted: boolean;
  focusRequested: boolean;
  actuallyFocusedMovieId: string | null;
  searchInputFocused: boolean;
  retryCount: number;
}) {
  novacastTrace(
    '[NovaCast Movies Search Focus] ' +
      JSON.stringify({
        ...payload,
        marker: MARKER,
      }),
  );
}

export function registerMoviesSearchResultTarget(movieId: string, ref: RefObject<View | null>) {
  targets.set(movieId, { movieId, ref });
}

export function unregisterMoviesSearchResultTarget(movieId: string, ref: RefObject<View | null>) {
  const current = targets.get(movieId);
  if (current && current.ref === ref) {
    targets.delete(movieId);
  }
}

export function getMoviesSearchResultTargetRef(movieId: string): RefObject<View | null> | null {
  return targets.get(movieId)?.ref ?? null;
}

export function setMoviesSearchResultOrder(ids: string[]) {
  orderedIds = ids.slice();
}

export function getFirstMoviesSearchResultId() {
  return orderedIds[0] ?? null;
}

export function cancelMoviesSearchResultFocus(reason: string, meta?: {
  requestId?: number | null;
  query?: string;
  resultCount?: number;
  searchInputFocused?: boolean;
}) {
  focusGeneration += 1;
  if (pendingFocusRequest?.timer) {
    clearTimeout(pendingFocusRequest.timer);
  }
  if (pendingFocusRequest && !pendingFocusRequest.cancelled) {
    pendingFocusRequest.cancelled = true;
    logMoviesSearchFocus({
      requestId: meta?.requestId ?? pendingFocusRequest.requestId,
      query: meta?.query ?? '',
      resultCount: meta?.resultCount ?? orderedIds.length,
      action: 'cancelled',
      targetMovieId: pendingFocusRequest.movieId,
      targetMounted: targets.has(pendingFocusRequest.movieId),
      focusRequested: true,
      actuallyFocusedMovieId: null,
      searchInputFocused: meta?.searchInputFocused ?? false,
      retryCount: pendingFocusRequest.retryCount,
    });
  }
  pendingFocusRequest = null;
  void reason;
}

export function noteMoviesSearchResultsReady(input: {
  requestId: number;
  query: string;
  resultIds: string[];
  searchInputFocused: boolean;
}) {
  setMoviesSearchResultOrder(input.resultIds);
  if (input.resultIds.length === 0) {
    cancelMoviesSearchResultFocus('empty-results', {
      requestId: input.requestId,
      query: input.query,
      resultCount: 0,
      searchInputFocused: input.searchInputFocused,
    });
    logMoviesSearchFocus({
      requestId: input.requestId,
      query: input.query,
      resultCount: 0,
      action: 'empty-no-target',
      targetMovieId: null,
      targetMounted: false,
      focusRequested: false,
      actuallyFocusedMovieId: null,
      searchInputFocused: input.searchInputFocused,
      retryCount: 0,
    });
    return;
  }

  logMoviesSearchFocus({
    requestId: input.requestId,
    query: input.query,
    resultCount: input.resultIds.length,
    action: 'results-ready',
    targetMovieId: input.resultIds[0] ?? null,
    targetMounted: Boolean(input.resultIds[0] && targets.has(input.resultIds[0]!)),
    focusRequested: false,
    actuallyFocusedMovieId: null,
    searchInputFocused: input.searchInputFocused,
    retryCount: 0,
  });
}

export function requestFocusFirstMoviesSearchResult(input: {
  requestId: number;
  query: string;
  searchInputFocused: boolean;
}): boolean {
  const movieId = getFirstMoviesSearchResultId();
  if (!movieId) {
    logMoviesSearchFocus({
      requestId: input.requestId,
      query: input.query,
      resultCount: 0,
      action: 'empty-no-target',
      targetMovieId: null,
      targetMounted: false,
      focusRequested: false,
      actuallyFocusedMovieId: null,
      searchInputFocused: input.searchInputFocused,
      retryCount: 0,
    });
    return false;
  }

  cancelMoviesSearchResultFocus('new-down-request');
  const gen = focusGeneration;
  pendingFocusRequest = {
    requestId: input.requestId,
    movieId,
    retryCount: 0,
    cancelled: false,
    timer: null,
  };

  logMoviesSearchFocus({
    requestId: input.requestId,
    query: input.query,
    resultCount: orderedIds.length,
    action: 'down-from-input',
    targetMovieId: movieId,
    targetMounted: targets.has(movieId),
    focusRequested: true,
    actuallyFocusedMovieId: null,
    searchInputFocused: input.searchInputFocused,
    retryCount: 0,
  });

  const attempt = () => {
    if (!pendingFocusRequest || pendingFocusRequest.cancelled || gen !== focusGeneration) {
      return;
    }
    const target = targets.get(movieId);
    const mounted = Boolean(target?.ref.current);
    logMoviesSearchFocus({
      requestId: input.requestId,
      query: input.query,
      resultCount: orderedIds.length,
      action: 'target-requested',
      targetMovieId: movieId,
      targetMounted: mounted,
      focusRequested: true,
      actuallyFocusedMovieId: null,
      searchInputFocused: false,
      retryCount: pendingFocusRequest.retryCount,
    });
    if (!mounted) {
      if (pendingFocusRequest.retryCount >= 3) {
        return;
      }
      pendingFocusRequest.retryCount += 1;
      pendingFocusRequest.timer = setTimeout(attempt, 50);
      return;
    }
    requestTvFocus({
      screen: 'search-overlay',
      source: 'MoviesSearchFocus',
      region: 'search-results',
      reason: 'down-from-search-input',
      getTarget: () => targets.get(movieId)?.ref.current ?? null,
    });
  };

  attempt();
  return true;
}

export function confirmMoviesSearchResultFocused(input: {
  requestId: number;
  query: string;
  movieId: string;
  searchInputFocused: boolean;
}) {
  if (pendingFocusRequest && pendingFocusRequest.movieId === input.movieId) {
    pendingFocusRequest.cancelled = true;
    if (pendingFocusRequest.timer) {
      clearTimeout(pendingFocusRequest.timer);
    }
    pendingFocusRequest = null;
  }
  logMoviesSearchFocus({
    requestId: input.requestId,
    query: input.query,
    resultCount: orderedIds.length,
    action: 'target-confirmed',
    targetMovieId: input.movieId,
    targetMounted: true,
    focusRequested: true,
    actuallyFocusedMovieId: input.movieId,
    searchInputFocused: input.searchInputFocused,
    retryCount: 0,
  });
}

export function resetMoviesSearchFocusForTests() {
  targets.clear();
  orderedIds = [];
  cancelMoviesSearchResultFocus('test-reset');
}
