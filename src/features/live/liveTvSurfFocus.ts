import type { LiveSurfDirection } from './liveTvSurf.ts';

export type LiveSurfFocusOwner = 'anchor' | 'left-sentinel' | 'right-sentinel' | 'other' | null;

export type LiveSurfFocusRejectReason =
  | 'not-armed'
  | 'transition-in-flight'
  | 'not-from-anchor'
  | 'stale-focus-epoch'
  | 'duplicate-sentinel-focus'
  | 'focus-destinations-not-ready';

export type LiveSurfFocusLogEvent =
  | 'anchor-focus'
  | 'router-armed'
  | 'left-sentinel-focus'
  | 'right-sentinel-focus'
  | 'surf-focus-accepted'
  | 'surf-focus-rejected'
  | 'router-disarmed'
  | 'transition-focus-reset'
  | 'anchor-focus-request'
  | 'anchor-focus-restored'
  | 'router-arm-rejected';

export type LiveSurfFocusRouterState = {
  focusOwner: LiveSurfFocusOwner;
  previousFocusOwner: LiveSurfFocusOwner;
  routerArmed: boolean;
  transitionInFlight: boolean;
  focusEpoch: number;
};

export function createLiveSurfFocusRouterState(): LiveSurfFocusRouterState {
  return {
    focusOwner: null,
    previousFocusOwner: null,
    routerArmed: false,
    transitionInFlight: false,
    focusEpoch: 0,
  };
}

function withOwner(state: LiveSurfFocusRouterState, owner: LiveSurfFocusOwner): LiveSurfFocusRouterState {
  return {
    ...state,
    previousFocusOwner: state.focusOwner,
    focusOwner: owner,
  };
}

export function applyLiveSurfAnchorFocus(state: LiveSurfFocusRouterState): {
  next: LiveSurfFocusRouterState;
  armed: boolean;
} {
  const parked = withOwner(state, 'anchor');
  if (state.transitionInFlight) {
    return { next: { ...parked, routerArmed: false }, armed: false };
  }

  return { next: { ...parked, routerArmed: true }, armed: true };
}

export function evaluateLiveSurfSentinelFocus(input: {
  state: LiveSurfFocusRouterState;
  direction: LiveSurfDirection;
  incomingEpoch: number;
}):
  | { accept: true; next: LiveSurfFocusRouterState }
  | { accept: false; reason: LiveSurfFocusRejectReason; next: LiveSurfFocusRouterState } {
  const sentinelOwner: LiveSurfFocusOwner = input.direction < 0 ? 'left-sentinel' : 'right-sentinel';

  if (input.state.transitionInFlight && input.state.focusOwner === sentinelOwner) {
    return {
      accept: false,
      reason: 'duplicate-sentinel-focus',
      next: withOwner(input.state, sentinelOwner),
    };
  }

  if (input.state.transitionInFlight) {
    return {
      accept: false,
      reason: 'transition-in-flight',
      next: withOwner(input.state, sentinelOwner),
    };
  }

  if (!input.state.routerArmed) {
    return {
      accept: false,
      reason: 'not-armed',
      next: withOwner(input.state, sentinelOwner),
    };
  }

  if (input.incomingEpoch !== input.state.focusEpoch) {
    return {
      accept: false,
      reason: 'stale-focus-epoch',
      next: withOwner(input.state, sentinelOwner),
    };
  }

  if (input.state.focusOwner === sentinelOwner) {
    return {
      accept: false,
      reason: 'duplicate-sentinel-focus',
      next: withOwner(input.state, sentinelOwner),
    };
  }

  if (input.state.focusOwner !== 'anchor') {
    return {
      accept: false,
      reason: 'not-from-anchor',
      next: withOwner(input.state, sentinelOwner),
    };
  }

  return {
    accept: true,
    next: {
      ...input.state,
      previousFocusOwner: input.state.focusOwner,
      focusOwner: sentinelOwner,
      routerArmed: false,
      transitionInFlight: true,
    },
  };
}

export function resetLiveSurfFocusAfterTransition(state: LiveSurfFocusRouterState): LiveSurfFocusRouterState {
  return {
    ...state,
    previousFocusOwner: state.focusOwner,
    routerArmed: false,
    transitionInFlight: false,
    focusEpoch: state.focusEpoch + 1,
  };
}

export type LiveSurfNativeHandles = {
  anchor: number | null;
  left: number | null;
  right: number | null;
};

export type LiveSurfHandleLogEvent =
  | 'anchor-handle'
  | 'sentinel-handles'
  | 'focus-destinations-applied'
  | 'focus-destinations-refreshed';

export function liveSurfFocusDestinationsReady(handles: LiveSurfNativeHandles): boolean {
  return handles.anchor != null && handles.left != null && handles.right != null;
}

export function shouldRequestLiveSurfAnchorFocus(state: LiveSurfFocusRouterState): boolean {
  return !(state.focusOwner === 'anchor' && state.routerArmed && !state.transitionInFlight);
}

export function shouldRemountLiveSurfSentinelsOnEpochChange(): boolean {
  return false;
}

export function liveSurfNativeHandlesSurvivedEpochChange(input: {
  before: LiveSurfNativeHandles & { focusEpoch: number };
  after: LiveSurfNativeHandles & { focusEpoch: number };
}): boolean {
  return (
    input.before.anchor === input.after.anchor &&
    input.before.left === input.after.left &&
    input.before.right === input.after.right &&
    input.before.focusEpoch !== input.after.focusEpoch
  );
}

export function logLiveSurfHandles(fields: {
  event: LiveSurfHandleLogEvent;
  focusEpoch?: number | null;
  anchorHandle?: number | null;
  leftSentinelHandle?: number | null;
  rightSentinelHandle?: number | null;
  appliedNextFocusLeft?: number | null;
  appliedNextFocusRight?: number | null;
  handlesReady?: boolean;
}): void {
  console.info(
    '[NovaCast Live Surf Handles] ' +
      JSON.stringify({
        event: fields.event,
        focusEpoch: fields.focusEpoch ?? null,
        anchorHandle: fields.anchorHandle ?? null,
        leftSentinelHandle: fields.leftSentinelHandle ?? null,
        rightSentinelHandle: fields.rightSentinelHandle ?? null,
        appliedNextFocusLeft: fields.appliedNextFocusLeft ?? null,
        appliedNextFocusRight: fields.appliedNextFocusRight ?? null,
        handlesReady: fields.handlesReady ?? null,
      }),
  );
}

export function logLiveSurfFocus(fields: {
  event: LiveSurfFocusLogEvent;
  channelId?: string | null;
  focusOwner?: LiveSurfFocusOwner;
  previousFocusOwner?: LiveSurfFocusOwner;
  routerArmed?: boolean;
  transitionInFlight?: boolean;
  focusEpoch?: number | null;
  direction?: LiveSurfDirection | null;
  reason?: LiveSurfFocusRejectReason | null;
  surfSessionId?: string | null;
}): void {
  console.info(
    '[NovaCast Live Surf Focus] ' +
      JSON.stringify({
        event: fields.event,
        channelId: fields.channelId ?? null,
        focusOwner: fields.focusOwner ?? null,
        previousFocusOwner: fields.previousFocusOwner ?? null,
        routerArmed: fields.routerArmed ?? null,
        transitionInFlight: fields.transitionInFlight ?? null,
        focusEpoch: fields.focusEpoch ?? null,
        direction: fields.direction ?? null,
        reason: fields.reason ?? null,
        surfSessionId: fields.surfSessionId ?? null,
      }),
  );
}
