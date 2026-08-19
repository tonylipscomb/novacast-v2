import { isNovaCastTraceLoggingEnabled } from '../../diagnostics/novacastLogPolicy.ts';
import { isVodSeekMediaType } from './vodSeek.ts';
import { isUnifiedControlActivateKey, isUnifiedTvSelectEvent } from './unifiedPlayerLogic.ts';

export type PlayerChromeWakeKey = 'left' | 'right' | 'up' | 'down' | 'select';

export type PlayerChromeFocusEvent =
  | 'wake-input'
  | 'wake-consumed'
  | 'controls-revealed'
  | 'default-focus-requested'
  | 'default-focused'
  | 'visible-input-routed'
  | 'stale-focus-cleared';

export type PlayerChromeDefaultFocusControl = 'play';

function normalizeWakeToken(value?: string | null): string {
  return (value ?? '').trim().toLowerCase().replace(/[_-\s]/g, '');
}

export function getPlayerChromeDefaultFocusControl(): PlayerChromeDefaultFocusControl {
  return 'play';
}

export function resolvePlayerChromeWakeKey(input: {
  eventType?: string | null;
  key?: string | null;
  keyCode?: number | null;
}): PlayerChromeWakeKey | null {
  const token = normalizeWakeToken(input.eventType ?? input.key);
  if (isUnifiedTvSelectEvent(input.eventType) || isUnifiedControlActivateKey(input.eventType ?? input.key ?? '', input.keyCode)) {
    return 'select';
  }
  if (
    token === 'left' ||
    token === 'arrowleft' ||
    token === 'dpadleft' ||
    input.keyCode === 21
  ) {
    return 'left';
  }
  if (
    token === 'right' ||
    token === 'arrowright' ||
    token === 'dpadright' ||
    input.keyCode === 22
  ) {
    return 'right';
  }
  if (
    token === 'up' ||
    token === 'arrowup' ||
    token === 'dpadup' ||
    input.keyCode === 19
  ) {
    return 'up';
  }
  if (
    token === 'down' ||
    token === 'arrowdown' ||
    token === 'dpaddown' ||
    input.keyCode === 20
  ) {
    return 'down';
  }
  return null;
}

export function shouldConsumePlayerChromeWake(input: {
  controlsVisible: boolean;
  upNextActive?: boolean;
  mediaType?: string | null;
  key?: PlayerChromeWakeKey | null;
  eventKeyAction?: number | null;
}): boolean {
  if (input.upNextActive) {
    return false;
  }
  if (input.controlsVisible) {
    return false;
  }
  if (input.eventKeyAction === 1) {
    return false;
  }
  if (input.mediaType === 'live' || !isVodSeekMediaType(input.mediaType)) {
    return false;
  }
  return input.key != null;
}

export function shouldRouteVisiblePlayerChromeInput(input: {
  controlsVisible: boolean;
  upNextActive?: boolean;
  mediaType?: string | null;
  key?: PlayerChromeWakeKey | null;
}): boolean {
  if (input.upNextActive) {
    return false;
  }
  if (!input.controlsVisible || input.key == null) {
    return false;
  }
  if (input.mediaType === 'live' || !isVodSeekMediaType(input.mediaType)) {
    return false;
  }
  return true;
}

export function logPlayerChromeFocus(fields: {
  event: PlayerChromeFocusEvent;
  key?: PlayerChromeWakeKey | null;
  mediaType?: string | null;
  focusedControl?: string | null;
}): void {
  if (!isNovaCastTraceLoggingEnabled()) {
    return;
  }
  const mediaType =
    fields.mediaType === 'movie' || fields.mediaType === 'episode' ? fields.mediaType : undefined;
  console.info(
    '[NovaCast Player Chrome Focus] ' +
      JSON.stringify({
        event: fields.event,
        ...(fields.key ? { key: fields.key } : {}),
        ...(mediaType ? { mediaType } : {}),
        focusedControl: fields.focusedControl ?? null,
      }),
  );
}
