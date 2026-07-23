import { derivePlaybackMode } from './unifiedPlayerLogic.ts';
import type { UnifiedControlFocusId } from './unifiedPlayerLogic.ts';
import type { PlaybackMode, UnifiedPlayerMachineState } from './types.ts';
import { getUnifiedPlayerState } from './unifiedPlayerStore.ts';

export const UNIFIED_REMOTE_DEBUG_PREFIX = '[UnifiedRemoteDebug]';

export type UnifiedRemoteEventSource =
  | 'useTVEventHandler'
  | 'TVEventHandler'
  | 'BackHandler'
  | 'overlay-key-capture'
  | 'controls-interaction-key'
  | 'controls-control-key'
  | 'controls-interaction-press'
  | 'controls-onPress'
  | 'controls-onFocus'
  | 'error-state-onPress';

export type UnifiedRemoteKeyAction = 'down' | 'up' | 'repeat';

export type UnifiedRemoteEventDisposition = 'accepted' | 'ignored' | 'deduplicated' | 'consumed';

export type UnifiedRemoteFocusedControl =
  | UnifiedControlFocusId
  | 'interaction-layer'
  | 'error-retry'
  | 'error-back'
  | 'none';

type RecentRemoteEvent = {
  count: number;
  lastAt: number;
  sources: Set<UnifiedRemoteEventSource>;
  keyAction: UnifiedRemoteKeyAction | null;
};

const DEDUP_WINDOW_MS = 350;
const recentEvents = new Map<string, RecentRemoteEvent>();
let focusedControl: UnifiedRemoteFocusedControl = 'none';
let tvHandlerAvailabilityLogged = false;

declare const __DEV__: boolean | undefined;

export function isUnifiedRemoteDebugEnabled(): boolean {
  if (typeof __DEV__ !== 'undefined') {
    return __DEV__;
  }
  return process.env.NODE_ENV !== 'production';
}

export function setUnifiedRemoteFocusedControl(control: UnifiedRemoteFocusedControl) {
  if (!isUnifiedRemoteDebugEnabled()) {
    return;
  }
  focusedControl = control;
}

export function getUnifiedRemoteFocusedControl(): UnifiedRemoteFocusedControl {
  return focusedControl;
}

function readPlaybackContext() {
  const snapshot = getUnifiedPlayerState();
  const playbackMode: PlaybackMode | 'idle' = snapshot.item
    ? derivePlaybackMode(snapshot.item)
    : 'idle';

  return {
    playbackMode,
    controlsVisible: snapshot.controlsVisible,
    machineState: snapshot.machineState as UnifiedPlayerMachineState,
  };
}

function sanitizeKeyLabel(key?: string | null, eventType?: string | null): string | undefined {
  if (!key) {
    return eventType ?? undefined;
  }
  return key;
}

function buildEventFingerprint(input: {
  eventType: string;
  key?: string | null;
  keyCode?: number | null;
  keyAction?: UnifiedRemoteKeyAction | null;
}): string {
  return [
    input.eventType,
    input.keyAction ?? 'unknown-action',
    input.key ?? '',
    input.keyCode ?? '',
  ].join('|');
}

function detectMultiPath(
  fingerprint: string,
  source: UnifiedRemoteEventSource,
  keyAction: UnifiedRemoteKeyAction | null,
): { disposition: UnifiedRemoteEventDisposition; multiPathDetected: boolean; priorSources: string[] } {
  const now = Date.now();
  const existing = recentEvents.get(fingerprint);

  if (!existing || now - existing.lastAt > DEDUP_WINDOW_MS) {
    recentEvents.set(fingerprint, {
      count: 1,
      lastAt: now,
      sources: new Set([source]),
      keyAction,
    });
    return { disposition: 'accepted', multiPathDetected: false, priorSources: [] };
  }

  existing.count += 1;
  existing.lastAt = now;

  const priorSources = [...existing.sources];
  const multiPathDetected = !existing.sources.has(source);
  existing.sources.add(source);

  if (multiPathDetected) {
    return { disposition: 'deduplicated', multiPathDetected: true, priorSources };
  }

  if (keyAction === 'repeat' || existing.count > 1) {
    return { disposition: 'deduplicated', multiPathDetected: false, priorSources };
  }

  return { disposition: 'deduplicated', multiPathDetected: false, priorSources };
}

export type LogUnifiedRemoteEventInput = {
  source: UnifiedRemoteEventSource;
  eventType: string;
  keyAction?: UnifiedRemoteKeyAction | null;
  key?: string | null;
  keyCode?: number | null;
  disposition?: UnifiedRemoteEventDisposition;
  actionTaken: string;
  controlId?: UnifiedRemoteFocusedControl;
};

export function logUnifiedRemoteEvent(input: LogUnifiedRemoteEventInput): void {
  if (!isUnifiedRemoteDebugEnabled()) {
    return;
  }

  const playbackContext = readPlaybackContext();
  const fingerprint = buildEventFingerprint(input);
  const autoDetect = detectMultiPath(fingerprint, input.source, input.keyAction ?? null);
  const disposition = input.disposition ?? autoDetect.disposition;
  const focused = input.controlId ?? focusedControl;

  console.info(UNIFIED_REMOTE_DEBUG_PREFIX, {
    timestamp: new Date().toISOString(),
    source: input.source,
    eventType: input.eventType,
    key: sanitizeKeyLabel(input.key, input.eventType),
    keyCode: input.keyCode ?? null,
    keyAction: input.keyAction ?? null,
    playbackMode: playbackContext.playbackMode,
    controlsVisible: playbackContext.controlsVisible,
    machineState: playbackContext.machineState,
    focusedControl: focused,
    disposition,
    actionTaken: input.actionTaken,
    multiPathDetected: autoDetect.multiPathDetected,
    priorSources: autoDetect.priorSources.length ? autoDetect.priorSources : undefined,
  });
}

export function logUnifiedRemoteTvHandlerAvailability(
  useTvHookAvailable: boolean,
  tvEventHandlerAvailable: boolean,
): void {
  if (!isUnifiedRemoteDebugEnabled() || tvHandlerAvailabilityLogged) {
    return;
  }

  tvHandlerAvailabilityLogged = true;
  console.info(UNIFIED_REMOTE_DEBUG_PREFIX, {
    timestamp: new Date().toISOString(),
    source: 'TVEventHandler',
    eventType: 'availability',
    keyAction: null,
    playbackMode: readPlaybackContext().playbackMode,
    controlsVisible: readPlaybackContext().controlsVisible,
    focusedControl,
    disposition: 'ignored',
    actionTaken: `useTVEventHandler=${useTvHookAvailable}; TVEventHandler=${tvEventHandlerAvailable}`,
  });
}

export function resetUnifiedRemoteDebugForTests() {
  recentEvents.clear();
  focusedControl = 'none';
  tvHandlerAvailabilityLogged = false;
}

export function parseNativeKeyAction(
  nativeEvent: { key?: string; keyCode?: number; repeat?: boolean; eventType?: string },
  phase: 'down' | 'up',
): UnifiedRemoteKeyAction | null {
  if (nativeEvent.repeat) {
    return 'repeat';
  }
  return phase;
}

export function logUnifiedRemoteKeyEvent(input: {
  source: UnifiedRemoteEventSource;
  phase: 'down' | 'up';
  nativeEvent: { key?: string; keyCode?: number; repeat?: boolean; eventType?: string };
  disposition: UnifiedRemoteEventDisposition;
  actionTaken: string;
  controlId?: UnifiedRemoteFocusedControl;
}) {
  logUnifiedRemoteEvent({
    source: input.source,
    eventType: input.nativeEvent.eventType ?? input.nativeEvent.key ?? 'key',
    key: input.nativeEvent.key ?? null,
    keyCode: input.nativeEvent.keyCode ?? null,
    keyAction: parseNativeKeyAction(input.nativeEvent, input.phase),
    disposition: input.disposition,
    actionTaken: input.actionTaken,
    controlId: input.controlId,
  });
}