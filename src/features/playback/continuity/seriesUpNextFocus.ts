import { isNovaCastTraceLoggingEnabled } from '../../diagnostics/novacastLogPolicy.ts';

export type SeriesUpNextFocusControl = 'play-now' | 'cancel';

export type SeriesAutoplayFocusEvent =
  | 'overlay-focus-owned'
  | 'play-now-focus-requested'
  | 'play-now-focused'
  | 'cancel-focused'
  | 'focus-move'
  | 'background-focus-blocked'
  | 'focus-restored';

export function getSeriesUpNextDefaultFocus(): SeriesUpNextFocusControl {
  return 'play-now';
}

export function shouldBlockPlayerChromeFocus(upNextVisible: boolean): boolean {
  return upNextVisible;
}

export function buildSeriesUpNextNativeFocusProps(
  control: SeriesUpNextFocusControl,
  handles: { playNow: number | null; cancel: number | null },
): {
  nextFocusLeft: number | null;
  nextFocusRight: number | null;
  nextFocusUp: number | null;
  nextFocusDown: number | null;
} {
  const playNow = handles.playNow;
  const cancel = handles.cancel;
  if (control === 'play-now') {
    const self = playNow;
    return {
      nextFocusLeft: self,
      nextFocusUp: self,
      nextFocusRight: cancel ?? self,
      nextFocusDown: self,
    };
  }
  const self = cancel;
  return {
    nextFocusLeft: playNow ?? self,
    nextFocusUp: self,
    nextFocusRight: self,
    nextFocusDown: self,
  };
}

export function resolveSeriesUpNextFocusMove(
  current: SeriesUpNextFocusControl,
  direction: 'left' | 'right' | 'up' | 'down',
): SeriesUpNextFocusControl {
  if (current === 'play-now' && direction === 'right') {
    return 'cancel';
  }
  if (current === 'cancel' && direction === 'left') {
    return 'play-now';
  }
  return current;
}

export function logSeriesAutoplayFocus(fields: {
  event: SeriesAutoplayFocusEvent;
  focusedControl?: SeriesUpNextFocusControl | null;
}) {
  if (!isNovaCastTraceLoggingEnabled()) {
    return;
  }
  console.info(
    '[NovaCast Series Autoplay Focus] ' +
      JSON.stringify({
        event: fields.event,
        focusedControl: fields.focusedControl ?? null,
      }),
  );
}
