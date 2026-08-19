import { isNovaCastTraceLoggingEnabled } from '../diagnostics/novacastLogPolicy.ts';
import { resolveSurfedChannelId } from '../playback/continuity/playbackContinuity.ts';

export const LIVE_SURF_OVERLAY_HIDE_MS = 2500;

export type LiveSurfDirection = 1 | -1;

export type LiveSurfLogEvent =
  | 'surf-request'
  | 'adjacent-resolved'
  | 'source-requested'
  | 'source-resolved'
  | 'transition-start'
  | 'transition-complete'
  | 'transition-failed'
  | 'stale-transition-dropped'
  | 'single-channel-noop';

export type LiveSurfAdjacentResult =
  | {
      kind: 'adjacent';
      fromChannelId: string | null;
      toChannelId: string;
      fromIndex: number;
      toIndex: number;
      queueLength: number;
    }
  | {
      kind: 'noop';
      reason: 'empty-queue' | 'single-channel';
      fromChannelId: string | null;
      fromIndex: number;
      toIndex: number;
      queueLength: number;
    };

export function createLiveSurfSessionId(): string {
  return `live-surf-${Date.now().toString(36)}`;
}

export function resolveLiveSurfAdjacent(input: {
  channelIds: string[];
  currentId: string | null;
  direction: LiveSurfDirection;
}): LiveSurfAdjacentResult {
  const queueLength = input.channelIds.length;
  const fromIndex = input.currentId ? input.channelIds.indexOf(input.currentId) : -1;

  if (queueLength <= 0) {
    return {
      kind: 'noop',
      reason: 'empty-queue',
      fromChannelId: input.currentId,
      fromIndex,
      toIndex: fromIndex,
      queueLength,
    };
  }

  if (queueLength === 1) {
    return {
      kind: 'noop',
      reason: 'single-channel',
      fromChannelId: input.currentId ?? input.channelIds[0] ?? null,
      fromIndex: fromIndex >= 0 ? fromIndex : 0,
      toIndex: 0,
      queueLength,
    };
  }

  const toChannelId = resolveSurfedChannelId(input.channelIds, input.currentId, input.direction);
  if (!toChannelId || toChannelId === input.currentId) {
    return {
      kind: 'noop',
      reason: 'single-channel',
      fromChannelId: input.currentId,
      fromIndex,
      toIndex: fromIndex,
      queueLength,
    };
  }

  return {
    kind: 'adjacent',
    fromChannelId: input.currentId,
    toChannelId,
    fromIndex: fromIndex >= 0 ? fromIndex : 0,
    toIndex: input.channelIds.indexOf(toChannelId),
    queueLength,
  };
}

export function shouldApplyLiveSurfResolution(input: {
  requestId: number;
  latestRequestId: number;
  toChannelId: string;
  latestChannelId: string | null;
}): boolean {
  return input.requestId === input.latestRequestId && input.toChannelId === input.latestChannelId;
}

export function logLiveSurf(fields: {
  event: LiveSurfLogEvent;
  direction?: LiveSurfDirection | null;
  fromChannelId?: string | null;
  toChannelId?: string | null;
  fromIndex?: number | null;
  toIndex?: number | null;
  queueLength?: number | null;
  surfSessionId?: string | null;
  requestId?: number | null;
}): void {
  if (fields.event !== 'transition-failed' && !isNovaCastTraceLoggingEnabled()) {
    return;
  }
  console.info(
    '[NovaCast Live Surf] ' +
      JSON.stringify({
        event: fields.event,
        direction: fields.direction ?? null,
        fromChannelId: fields.fromChannelId ?? null,
        toChannelId: fields.toChannelId ?? null,
        fromIndex: fields.fromIndex ?? null,
        toIndex: fields.toIndex ?? null,
        queueLength: fields.queueLength ?? null,
        surfSessionId: fields.surfSessionId ?? null,
        requestId: fields.requestId ?? null,
      }),
  );
}
