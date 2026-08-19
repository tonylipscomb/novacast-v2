/**
 * VOD timeline seek/scrub helpers.
 * Movie and episode playback share this path. Live TV must never enter it.
 */

import { isNovaCastTraceLoggingEnabled } from '../../diagnostics/novacastLogPolicy.ts';

export const VOD_SEEK_IDLE_COMMIT_MS = 700;
export const VOD_SEEK_END_GUARD_MS = 1_000;
export const VOD_SEEK_STEP_MS = 10_000;
export const VOD_SEEK_ACCELERATION_STEPS_MS = [10_000, 30_000, 60_000, 120_000] as const;

export type VodSeekMediaType = 'movie' | 'episode';
export type VodSeekCommitReason = 'ok' | 'idle';
export type VodSeekDirection = 1 | -1;

export type VodSeekLogEvent =
  | 'seek-preview-start'
  | 'seek-preview-step'
  | 'seek-acceleration-change'
  | 'seek-commit-requested'
  | 'seek-committed'
  | 'seek-cancelled'
  | 'seek-clamped'
  | 'seek-ignored'
  | 'seek-progress-saved';

export type VodSeekLogFields = {
  event: VodSeekLogEvent;
  mediaType?: string | null;
  contentId?: string | null;
  actualPositionMs?: number | null;
  previewPositionMs?: number | null;
  durationMs?: number | null;
  direction?: VodSeekDirection | null;
  stepMs?: number | null;
  repeatCount?: number | null;
  commitReason?: VodSeekCommitReason | null;
  wasPlaying?: boolean | null;
  seekSessionId?: string | null;
  reason?: string | null;
};

export type VodSeekCommitGate = {
  seekSessionId: string;
  commitStarted: boolean;
  commitCompleted: boolean;
};

let vodSeekSessionSeq = 0;

export function isVodSeekMediaType(mediaType?: string | null): mediaType is VodSeekMediaType {
  return mediaType === 'movie' || mediaType === 'episode';
}

export function canEnterVodSeek(durationMs: number): boolean {
  return Number.isFinite(durationMs) && durationMs > 0;
}

export function createVodSeekSessionId(): string {
  vodSeekSessionSeq += 1;
  return `vod-seek-${Date.now()}-${vodSeekSessionSeq}`;
}

export function createVodSeekCommitGate(seekSessionId: string): VodSeekCommitGate {
  return {
    seekSessionId,
    commitStarted: false,
    commitCompleted: false,
  };
}

export function canCommitVodSeek(
  gate: VodSeekCommitGate | null | undefined,
  expectedSessionId: string | null | undefined,
): boolean {
  if (!gate || !expectedSessionId) {
    return false;
  }
  if (gate.seekSessionId !== expectedSessionId) {
    return false;
  }
  return !gate.commitStarted && !gate.commitCompleted;
}

export function beginVodSeekCommit(
  gate: VodSeekCommitGate | null | undefined,
  expectedSessionId: string | null | undefined,
): boolean {
  if (!canCommitVodSeek(gate, expectedSessionId) || !gate) {
    return false;
  }
  gate.commitStarted = true;
  return true;
}

export function completeVodSeekCommit(gate: VodSeekCommitGate | null | undefined): void {
  if (!gate) {
    return;
  }
  gate.commitStarted = true;
  gate.commitCompleted = true;
}

export function resolveVodSeekStepMs(repeatCount: number): number {
  const inputNumber = Math.max(1, Math.floor(repeatCount) + 1);
  if (inputNumber <= 3) {
    return VOD_SEEK_ACCELERATION_STEPS_MS[0];
  }
  if (inputNumber <= 7) {
    return VOD_SEEK_ACCELERATION_STEPS_MS[1];
  }
  if (inputNumber <= 12) {
    return VOD_SEEK_ACCELERATION_STEPS_MS[2];
  }
  return VOD_SEEK_ACCELERATION_STEPS_MS[3];
}

export function resolveVodSeekRepeatCount(input: {
  previousDirection: VodSeekDirection | null;
  nextDirection: VodSeekDirection;
  previousRepeatCount: number;
}): number {
  if (input.previousDirection !== input.nextDirection) {
    return 0;
  }
  return input.previousRepeatCount + 1;
}

export function clampVodSeekPreview(
  requestedMs: number,
  durationMs: number,
): {
  positionMs: number | null;
  clamped: boolean;
  reason: 'invalid' | 'zero' | 'end-guard' | null;
} {
  if (!Number.isFinite(requestedMs) || !canEnterVodSeek(durationMs)) {
    return { positionMs: null, clamped: true, reason: 'invalid' };
  }

  const endGuard = durationMs > VOD_SEEK_END_GUARD_MS * 2 ? VOD_SEEK_END_GUARD_MS : 0;
  const maxMs = Math.max(0, durationMs - endGuard);
  const positionMs = Math.max(0, Math.min(requestedMs, maxMs));
  if (positionMs === requestedMs) {
    return { positionMs, clamped: false, reason: null };
  }
  return {
    positionMs,
    clamped: true,
    reason: requestedMs < 0 ? 'zero' : 'end-guard',
  };
}

export function applyVodSeekPreviewStep(input: {
  actualPositionMs: number;
  previewPositionMs: number | null;
  durationMs: number;
  direction: VodSeekDirection;
  repeatCount: number;
}): {
  ignored: boolean;
  ignoreReason: 'unknown-duration' | null;
  previewPositionMs: number | null;
  stepMs: number;
  clamped: boolean;
  clampReason: 'invalid' | 'zero' | 'end-guard' | null;
} {
  const stepMs = resolveVodSeekStepMs(input.repeatCount) * input.direction;
  if (!canEnterVodSeek(input.durationMs)) {
    return {
      ignored: true,
      ignoreReason: 'unknown-duration',
      previewPositionMs: null,
      stepMs,
      clamped: false,
      clampReason: null,
    };
  }

  const baseMs = input.previewPositionMs ?? input.actualPositionMs;
  const requestedMs = baseMs + stepMs;
  const clamped = clampVodSeekPreview(requestedMs, input.durationMs);
  return {
    ignored: false,
    ignoreReason: null,
    previewPositionMs: clamped.positionMs,
    stepMs,
    clamped: clamped.clamped,
    clampReason: clamped.reason,
  };
}

export type VodSeekRemoteEvent = {
  eventType?: string | null;
  eventKeyAction?: number | null;
  keyCode?: number | null;
  key?: string | null;
};

export type HiddenVodSeekRemoteAction = 'hidden-vod-seek' | 'preview-step' | 'generic-reveal' | 'ignore';

export type VodSeekRemoteLogEvent =
  | 'remote-received'
  | 'generic-controls-reveal'
  | 'hidden-vod-seek-match'
  | 'timeline-focus-request'
  | 'timeline-focus-confirmed'
  | 'preview-entry-request'
  | 'preview-entry-confirmed'
  | 'remote-consumed'
  | 'remote-fell-through';

function normalizeVodSeekEventToken(value?: string | null): string {
  return (value ?? '').trim().toLowerCase().replace(/[_-\s]/g, '');
}

export function isVodSeekKeyUp(eventKeyAction?: number | null): boolean {
  return eventKeyAction === 1;
}

export function isVodSeekKeyRepeat(eventKeyAction?: number | null): boolean {
  return eventKeyAction === 2;
}

export function resolveVodSeekDirection(event: VodSeekRemoteEvent = {}): VodSeekDirection | null {
  const token = normalizeVodSeekEventToken(event.eventType ?? event.key);
  if (
    token === 'left' ||
    token === 'arrowleft' ||
    token === 'dpadleft' ||
    token === 'keycodedpadleft' ||
    token === 'rewind' ||
    token === 'seekbackward' ||
    token === 'mediarewind'
  ) {
    return -1;
  }
  if (
    token === 'right' ||
    token === 'arrowright' ||
    token === 'dpadright' ||
    token === 'keycodedpadright' ||
    token === 'fastforward' ||
    token === 'seekforward' ||
    token === 'mediafastforward'
  ) {
    return 1;
  }
  if (event.keyCode === 21 || event.keyCode === 89) {
    return -1;
  }
  if (event.keyCode === 22 || event.keyCode === 90) {
    return 1;
  }
  return null;
}

export function resolveVodSeekHiddenDirection(
  eventType?: string | null,
  keyCode?: number | null,
): VodSeekDirection | null {
  return resolveVodSeekDirection({ eventType, keyCode });
}

export function isVodSeekDpadEvent(event: VodSeekRemoteEvent = {}): boolean {
  if (resolveVodSeekDirection(event) != null) {
    return true;
  }
  const token = normalizeVodSeekEventToken(event.eventType ?? event.key);
  if (
    token === 'up' ||
    token === 'down' ||
    token === 'arrowup' ||
    token === 'arrowdown' ||
    token === 'dpadup' ||
    token === 'dpaddown'
  ) {
    return true;
  }
  return event.keyCode === 19 || event.keyCode === 20 || event.keyCode === 21 || event.keyCode === 22;
}

export function shouldDedupeVodSeekRemotePress(input: {
  previousAtMs: number | null;
  nowMs: number;
  eventKeyAction?: number | null;
  windowMs?: number;
}): boolean {
  if (isVodSeekKeyRepeat(input.eventKeyAction)) {
    return false;
  }
  if (input.previousAtMs == null) {
    return false;
  }
  return input.nowMs - input.previousAtMs < (input.windowMs ?? 50);
}

export function resolveHiddenVodSeekRemoteAction(input: {
  controlsVisible: boolean;
  mediaType?: string | null;
  durationMs?: number | null;
  eventType?: string | null;
  eventKeyAction?: number | null;
  keyCode?: number | null;
  seekPreviewActive?: boolean;
  timelineFocused?: boolean;
}): HiddenVodSeekRemoteAction {
  if (isVodSeekKeyUp(input.eventKeyAction)) {
    return 'ignore';
  }

  const direction = resolveVodSeekDirection(input);
  const vodEligible = isVodSeekMediaType(input.mediaType) && canEnterVodSeek(input.durationMs ?? 0);

  // Hidden VOD DPAD/SELECT wakes chrome only. Seek starts after chrome is visible.
  if (direction != null && vodEligible && input.controlsVisible && input.seekPreviewActive) {
    return 'preview-step';
  }

  if (!input.controlsVisible && isVodSeekDpadEvent(input)) {
    return 'generic-reveal';
  }

  return 'ignore';
}

export function shouldBeginHiddenVodSeek(input: {
  controlsVisible: boolean;
  mediaType?: string | null;
  eventType?: string | null;
  eventKeyAction?: number | null;
  keyCode?: number | null;
  durationMs?: number | null;
  timelineFocused?: boolean;
}): boolean {
  return (
    resolveHiddenVodSeekRemoteAction({
      controlsVisible: input.controlsVisible,
      mediaType: input.mediaType,
      eventType: input.eventType,
      eventKeyAction: input.eventKeyAction,
      keyCode: input.keyCode,
      durationMs: input.durationMs ?? 1,
      timelineFocused: input.timelineFocused,
    }) === 'hidden-vod-seek'
  );
}

export function decideVodSeekBackAction(previewActive: boolean): 'cancel-preview' | 'player-back' {
  return previewActive ? 'cancel-preview' : 'player-back';
}

export function formatVodSeekClock(positionMs: number, durationMs = 0): string {
  const safeMs = Number.isFinite(positionMs) ? Math.max(0, positionMs) : 0;
  const totalSeconds = Math.floor(safeMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0 || durationMs >= 3_600_000) {
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function formatVodSeekDelta(deltaMs: number): string | null {
  if (!Number.isFinite(deltaMs) || Math.abs(deltaMs) < 500) {
    return null;
  }
  const sign = deltaMs < 0 ? '-' : '+';
  const totalSeconds = Math.round(Math.abs(deltaMs) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${sign}${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function logVodSeek(fields: VodSeekLogFields): void {
  if (!isNovaCastTraceLoggingEnabled()) {
    return;
  }
  console.info(
    '[NovaCast VOD Seek] ' +
      JSON.stringify({
        event: fields.event,
        mediaType: fields.mediaType ?? null,
        contentId: fields.contentId ?? null,
        actualPositionMs: fields.actualPositionMs ?? null,
        previewPositionMs: fields.previewPositionMs ?? null,
        durationMs: fields.durationMs ?? null,
        direction: fields.direction ?? null,
        stepMs: fields.stepMs ?? null,
        repeatCount: fields.repeatCount ?? null,
        commitReason: fields.commitReason ?? null,
        wasPlaying: fields.wasPlaying ?? null,
        seekSessionId: fields.seekSessionId ?? null,
        reason: fields.reason ?? null,
      }),
  );
}

export function logVodSeekRemote(fields: {
  event: VodSeekRemoteLogEvent;
  mediaType?: string | null;
  controlsVisible?: boolean | null;
  allowSeek?: boolean | null;
  timelineFocused?: boolean | null;
  seekPreviewActive?: boolean | null;
  vodEligible?: boolean | null;
  hiddenVodSeekEligible?: boolean | null;
  eventConsumedBy?: string | null;
  nativeTimelineHandlePresent?: boolean | null;
  eventType?: string | null;
  eventKeyAction?: number | null;
  keyCode?: number | null;
  direction?: VodSeekDirection | null;
}): void {
  if (!isNovaCastTraceLoggingEnabled()) {
    return;
  }
  console.info(
    '[NovaCast VOD Seek Remote] ' +
      JSON.stringify({
        event: fields.event,
        mediaType: fields.mediaType ?? null,
        controlsVisible: fields.controlsVisible ?? null,
        allowSeek: fields.allowSeek ?? null,
        timelineFocused: fields.timelineFocused ?? null,
        seekPreviewActive: fields.seekPreviewActive ?? null,
        vodEligible: fields.vodEligible ?? null,
        hiddenVodSeekEligible: fields.hiddenVodSeekEligible ?? null,
        eventConsumedBy: fields.eventConsumedBy ?? null,
        nativeTimelineHandlePresent: fields.nativeTimelineHandlePresent ?? null,
        eventType: fields.eventType ?? null,
        eventKeyAction: fields.eventKeyAction ?? null,
        keyCode: fields.keyCode ?? null,
        direction: fields.direction ?? null,
      }),
  );
}

export type PlayerChromeRevealSource =
  | 'remote-handler'
  | 'overlay-touch'
  | 'overlay-keydown'
  | 'controls-focus'
  | 'timeline-focus'
  | 'timeline-listener'
  | 'playback-state'
  | 'interaction-layer'
  | 'generic-dpad'
  | 'native-focus'
  | 'controller'
  | 'play-toggle'
  | 'rewind-button'
  | 'forward-button'
  | 'seek-flush'
  | 'handle-seek'
  | 'handle-back'
  | 'retry'
  | 'error-state'
  | 'hidden-focus-sentinel'
  | 'other';

export type VodDirectionalSeekSource =
  | 'overlay-keydown'
  | 'remote-handler'
  | 'timeline-listener'
  | 'controls-listener'
  | 'useTVEventHandler'
  | 'TVEventHandler'
  | 'hidden-focus-sentinel';

export type VodDirectionalSeekEntry = 'begin-preview' | 'preview-step' | 'reveal-only' | 'ignore';

export function logPlayerChrome(fields: {
  event: 'reveal-request';
  source: PlayerChromeRevealSource;
  mediaType?: string | null;
  controlsVisibleBefore?: boolean | null;
  focusedControl?: string | null;
  seekPreviewActive?: boolean | null;
}): void {
  if (!isNovaCastTraceLoggingEnabled()) {
    return;
  }
  console.info(
    '[NovaCast Player Chrome] ' +
      JSON.stringify({
        event: fields.event,
        source: fields.source,
        mediaType: fields.mediaType ?? null,
        controlsVisibleBefore: fields.controlsVisibleBefore ?? null,
        focusedControl: fields.focusedControl ?? null,
        seekPreviewActive: fields.seekPreviewActive ?? null,
      }),
  );
}

export function logTvInputRaw(fields: {
  source: string;
  rawEventType?: string | null;
  eventKeyAction?: number | null;
  keyCode?: number | null;
  controlsVisible?: boolean | null;
  focusedControl?: string | null;
  mediaType?: string | null;
}): void {
  if (!isNovaCastTraceLoggingEnabled()) {
    return;
  }
  console.info(
    '[NovaCast TV Input Raw] ' +
      JSON.stringify({
        source: fields.source,
        rawEventType: fields.rawEventType ?? null,
        eventKeyAction: fields.eventKeyAction ?? null,
        keyCode: fields.keyCode ?? null,
        controlsVisible: fields.controlsVisible ?? null,
        focusedControl: fields.focusedControl ?? null,
        mediaType: fields.mediaType ?? null,
      }),
  );
}

export function logPlayerFocus(fields: {
  event: 'focus-received' | 'focus-lost';
  control: string;
  previousControl?: string | null;
  controlsVisible?: boolean | null;
  seekPreviewActive?: boolean | null;
}): void {
  if (!isNovaCastTraceLoggingEnabled()) {
    return;
  }
  console.info(
    '[NovaCast Player Focus] ' +
      JSON.stringify({
        event: fields.event,
        control: fields.control,
        previousControl: fields.previousControl ?? null,
        controlsVisible: fields.controlsVisible ?? null,
        seekPreviewActive: fields.seekPreviewActive ?? null,
      }),
  );
}

export function resolveVodDirectionalSeekEntry(input: {
  direction: VodSeekDirection | null;
  controlsVisible: boolean;
  mediaType?: string | null;
  durationMs: number;
  seekPreviewActive?: boolean;
  upNextActive?: boolean;
}): VodDirectionalSeekEntry {
  if (input.upNextActive) {
    return 'ignore';
  }
  if (input.mediaType === 'live') {
    return input.controlsVisible ? 'ignore' : 'reveal-only';
  }
  if (input.direction == null) {
    return input.controlsVisible ? 'ignore' : 'reveal-only';
  }
  if (!isVodSeekMediaType(input.mediaType) || !canEnterVodSeek(input.durationMs)) {
    return input.controlsVisible ? 'ignore' : 'reveal-only';
  }
  if (!input.controlsVisible) {
    return 'reveal-only';
  }
  if (input.seekPreviewActive) {
    return 'preview-step';
  }
  return 'begin-preview';
}

export function shouldTrapVodSeekHorizontalFocus(_input: {
  controlsVisible: boolean;
  timelineFocused: boolean;
  allowSeek: boolean;
}): boolean {
  // Horizontal LEFT/RIGHT while the timeline is focused is owned by native
  // seek sentinels, not TVFocusGuideView trap.
  return false;
}

export function shouldActivateVodFocusRouter(input: {
  mediaType?: string | null;
  upNextActive?: boolean;
  platformOs?: string;
}): boolean {
  return (
    (input.platformOs ?? 'android') === 'android' &&
    !input.upNextActive &&
    isVodSeekMediaType(input.mediaType)
  );
}

export function shouldActivateHiddenChromeKeyCapture(input: {
  controlsVisible: boolean;
  mediaType?: string | null;
  upNextActive?: boolean;
  platformOs?: string;
}): boolean {
  return shouldActivateVodFocusRouter({
    mediaType: input.mediaType,
    upNextActive: input.upNextActive,
    platformOs: input.platformOs,
  });
}

export function resolveSeekHorizontalSentinelHandle(
  direction: VodSeekDirection,
  handles: { left?: number | null; right?: number | null },
): number | null {
  const handle = direction < 0 ? handles.left : handles.right;
  return handle ?? null;
}

export type VodFocusSeekLogEvent =
  | 'hidden-anchor-focus-request'
  | 'hidden-anchor-focus-confirmed'
  | 'left-sentinel-focus'
  | 'right-sentinel-focus'
  | 'timeline-return-request'
  | 'timeline-return-confirmed'
  | 'preview-step-forwarded';

export function logVodFocusSeek(fields: {
  event: VodFocusSeekLogEvent;
  mediaType?: string | null;
  contentId?: string | null;
  controlsVisible?: boolean | null;
  timelineFocused?: boolean | null;
  seekPreviewActive?: boolean | null;
  direction?: VodSeekDirection | null;
  actualPositionMs?: number | null;
  previewPositionMs?: number | null;
  stepMs?: number | null;
  repeatCount?: number | null;
  seekSessionId?: string | null;
}): void {
  if (!isNovaCastTraceLoggingEnabled()) {
    return;
  }
  console.info(
    '[NovaCast VOD Focus Seek] ' +
      JSON.stringify({
        event: fields.event,
        mediaType: fields.mediaType ?? null,
        contentId: fields.contentId ?? null,
        controlsVisible: fields.controlsVisible ?? null,
        timelineFocused: fields.timelineFocused ?? null,
        seekPreviewActive: fields.seekPreviewActive ?? null,
        direction: fields.direction ?? null,
        actualPositionMs: fields.actualPositionMs ?? null,
        previewPositionMs: fields.previewPositionMs ?? null,
        stepMs: fields.stepMs ?? null,
        repeatCount: fields.repeatCount ?? null,
        seekSessionId: fields.seekSessionId ?? null,
      }),
  );
}

/**
 * Native onFocus is not a direction. LEFT must rewind and RIGHT must advance.
 * Timeline focus may reveal chrome, but it must never invent a seek step.
 */
export function nativeTimelineFocusImpliesSeekDirection(): false {
  return false;
}

let lastVodDirectionalSeek: {
  atMs: number;
  direction: VodSeekDirection;
  source: string;
} | null = null;

export function resetVodDirectionalSeekDedupeForTests(): void {
  lastVodDirectionalSeek = null;
}

export function shouldSkipDuplicateVodDirectionalSeek(input: {
  direction: VodSeekDirection;
  nowMs: number;
  eventKeyAction?: number | null;
  source: string;
  windowMs?: number;
}): boolean {
  if (isVodSeekKeyRepeat(input.eventKeyAction)) {
    return false;
  }
  if (input.source === 'hidden-focus-sentinel') {
    if (!lastVodDirectionalSeek || lastVodDirectionalSeek.direction !== input.direction) {
      return false;
    }
    return input.nowMs - lastVodDirectionalSeek.atMs < 16;
  }
  if (!lastVodDirectionalSeek) {
    return false;
  }
  if (lastVodDirectionalSeek.direction !== input.direction) {
    return false;
  }
  return input.nowMs - lastVodDirectionalSeek.atMs < (input.windowMs ?? 80);
}

export function noteVodDirectionalSeek(input: {
  direction: VodSeekDirection;
  nowMs: number;
  source: string;
}): void {
  lastVodDirectionalSeek = {
    atMs: input.nowMs,
    direction: input.direction,
    source: input.source,
  };
}

export function consumeVodDirectionalSeek(input: {
  direction: VodSeekDirection;
  nowMs: number;
  eventKeyAction?: number | null;
  source: string;
  windowMs?: number;
}): boolean {
  if (
    shouldSkipDuplicateVodDirectionalSeek({
      direction: input.direction,
      nowMs: input.nowMs,
      eventKeyAction: input.eventKeyAction,
      source: input.source,
      windowMs: input.windowMs,
    })
  ) {
    return false;
  }
  noteVodDirectionalSeek({
    direction: input.direction,
    nowMs: input.nowMs,
    source: input.source,
  });
  return true;
}
