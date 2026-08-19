import { novacastTrace } from '../diagnostics/novacastLogPolicy.ts';
import { visibleRangeFromViewableItems, type VisibleIndexRange } from '../live/liveTvFocusScroll.ts';

export const LIVE_SEARCH_RESULT_ROW_HEIGHT = 46;
export const LIVE_SEARCH_FOCUS_SCROLL_VIEW_POSITION = 0.45;
export const LIVE_SEARCH_SCROLL_EDGE_BUFFER = 1;

export type LiveSearchFocusScrollPlan =
  | { action: 'none'; reason: 'already-visible' | 'index-0-initial' | 'invalid-index' | 'empty' }
  | { action: 'scroll'; reason: 'outside-viewport' | 'restore'; index: number; viewPosition: number };

export function planLiveSearchFocusScroll(input: {
  focusedIndex: number;
  visible: VisibleIndexRange | null;
  totalCount: number;
  reason?: 'focus' | 'restore';
}): LiveSearchFocusScrollPlan {
  const { focusedIndex, visible, totalCount } = input;
  if (totalCount <= 0) {
    return { action: 'none', reason: 'empty' };
  }
  if (focusedIndex < 0 || focusedIndex >= totalCount) {
    return { action: 'none', reason: 'invalid-index' };
  }

  if (input.reason === 'restore') {
    if (visible && focusedIndex >= visible.first && focusedIndex <= visible.last) {
      return { action: 'none', reason: 'already-visible' };
    }
    return {
      action: 'scroll',
      reason: 'restore',
      index: focusedIndex,
      viewPosition: LIVE_SEARCH_FOCUS_SCROLL_VIEW_POSITION,
    };
  }

  if (focusedIndex === 0 && (!visible || visible.first === 0)) {
    return { action: 'none', reason: 'index-0-initial' };
  }

  if (!visible) {
    return {
      action: 'scroll',
      reason: 'outside-viewport',
      index: focusedIndex,
      viewPosition: LIVE_SEARCH_FOCUS_SCROLL_VIEW_POSITION,
    };
  }

  const interiorFirst = visible.first + LIVE_SEARCH_SCROLL_EDGE_BUFFER;
  const interiorLast = visible.last - LIVE_SEARCH_SCROLL_EDGE_BUFFER;
  if (focusedIndex >= interiorFirst && focusedIndex <= interiorLast) {
    return { action: 'none', reason: 'already-visible' };
  }

  return {
    action: 'scroll',
    reason: 'outside-viewport',
    index: focusedIndex,
    viewPosition: LIVE_SEARCH_FOCUS_SCROLL_VIEW_POSITION,
  };
}

export function liveSearchResultItemLayout(index: number) {
  return {
    length: LIVE_SEARCH_RESULT_ROW_HEIGHT,
    offset: LIVE_SEARCH_RESULT_ROW_HEIGHT * index,
    index,
  };
}

export function planLiveSearchScrollToIndexFailedFallback(input: {
  index: number;
  averageItemLength?: number;
}) {
  const rowHeight = input.averageItemLength && input.averageItemLength > 0 ? input.averageItemLength : LIVE_SEARCH_RESULT_ROW_HEIGHT;
  return {
    offset: Math.max(0, rowHeight * Math.max(0, input.index)),
    retryIndex: Math.max(0, input.index),
  };
}

export function shouldLiveSearchResultFocusAffectQuery() {
  return false;
}

export function shouldLiveSearchResultFocusOpenKeyboard() {
  return false;
}

export function logLiveSearchFocus(fields: {
  event:
    | 'result-focus'
    | 'result-scroll-request'
    | 'result-scroll-confirmed'
    | 'result-scroll-failed'
    | 'result-restore-focus'
    | 'result-restore-scroll'
    | 'modal-focus-owned'
    | 'background-focus-blocked'
    | 'close-focus-request'
    | 'close-focus-confirmed';
  channelId?: string | null;
  resultIndex?: number | null;
  visibleStartIndex?: number | null;
  visibleEndIndex?: number | null;
  queryLength?: number | null;
  overlayVisible?: boolean;
  source?: string;
}) {
  novacastTrace(
    '[NovaCast Live Search Focus] ' +
      JSON.stringify({
        event: fields.event,
        channelId: fields.channelId ?? null,
        resultIndex: fields.resultIndex ?? null,
        visibleStartIndex: fields.visibleStartIndex ?? null,
        visibleEndIndex: fields.visibleEndIndex ?? null,
        queryLength: fields.queryLength ?? null,
        overlayVisible: fields.overlayVisible ?? null,
        source: fields.source ?? null,
      }),
  );
}

export { visibleRangeFromViewableItems };
