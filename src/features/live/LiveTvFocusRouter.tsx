import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { findNodeHandle, Platform, Pressable, StyleSheet, View } from 'react-native';

import { focusNativeViewWhenReady } from '@/features/navigation/focusNativeViewWhenReady';

import { logLiveSurf, type LiveSurfDirection } from './liveTvSurf.ts';
import {
  applyLiveSurfAnchorFocus,
  createLiveSurfFocusRouterState,
  evaluateLiveSurfSentinelFocus,
  liveSurfFocusDestinationsReady,
  logLiveSurfFocus,
  logLiveSurfHandles,
  resetLiveSurfFocusAfterTransition,
  shouldRequestLiveSurfAnchorFocus,
  type LiveSurfFocusRouterState,
  type LiveSurfNativeHandles,
} from './liveTvSurfFocus.ts';

export type LiveTvFocusRouterHandles = {
  anchor: number | null;
  left: number | null;
  right: number | null;
};

export type LiveTvFocusRouterHandle = {
  notifyTransitionSettled: () => void;
};

type LiveTvFocusRouterProps = {
  enabled: boolean;
  chromeVisible: boolean;
  fromChannelId?: string | null;
  surfSessionId?: string | null;
  onAnchorPress?: () => void;
  onSentinelFocus: (direction: LiveSurfDirection) => void;
  onHandlesChange?: (handles: LiveTvFocusRouterHandles) => void;
};

/**
 * Native TV focus router for Live fullscreen LEFT/RIGHT channel surfing.
 * Sentinel onFocus is accepted only as a single traversal from the Live anchor.
 * Channel transitions restore the anchor and do not re-arm until that lands.
 */
export const LiveTvFocusRouter = forwardRef<LiveTvFocusRouterHandle, LiveTvFocusRouterProps>(
  function LiveTvFocusRouter(
    {
      enabled,
      chromeVisible,
      fromChannelId = null,
      surfSessionId = null,
      onAnchorPress,
      onSentinelFocus,
      onHandlesChange,
    },
    ref,
  ) {
    const anchorRef = useRef<View | null>(null);
    const machineRef = useRef<LiveSurfFocusRouterState>(createLiveSurfFocusRouterState());
    const restoringAnchorRef = useRef(false);
    const [handles, setHandles] = useState<LiveTvFocusRouterHandles>({
      anchor: null,
      left: null,
      right: null,
    });
    const [anchorPreferred, setAnchorPreferred] = useState(true);
    const onSentinelFocusRef = useRef(onSentinelFocus);
    const onHandlesChangeRef = useRef(onHandlesChange);
    const fromChannelIdRef = useRef(fromChannelId);
    const surfSessionIdRef = useRef(surfSessionId);
    const handlesRef = useRef<LiveSurfNativeHandles>(handles);
    const previousHandlesRef = useRef<LiveSurfNativeHandles>(handles);

    useEffect(() => {
      onSentinelFocusRef.current = onSentinelFocus;
    }, [onSentinelFocus]);
    useEffect(() => {
      onHandlesChangeRef.current = onHandlesChange;
    }, [onHandlesChange]);
    useEffect(() => {
      fromChannelIdRef.current = fromChannelId;
    }, [fromChannelId]);
    useEffect(() => {
      surfSessionIdRef.current = surfSessionId;
    }, [surfSessionId]);

    useEffect(() => {
      handlesRef.current = handles;
      const previous = previousHandlesRef.current;
      const destinationsChanged =
        previous.left !== handles.left || previous.right !== handles.right || previous.anchor !== handles.anchor;
      if (previous.anchor !== handles.anchor) {
        logLiveSurfHandles({
          event: 'anchor-handle',
          focusEpoch: machineRef.current.focusEpoch,
          anchorHandle: handles.anchor,
          leftSentinelHandle: handles.left,
          rightSentinelHandle: handles.right,
          appliedNextFocusLeft: handles.left,
          appliedNextFocusRight: handles.right,
          handlesReady: liveSurfFocusDestinationsReady(handles),
        });
      }
      if (previous.left !== handles.left || previous.right !== handles.right) {
        logLiveSurfHandles({
          event: 'sentinel-handles',
          focusEpoch: machineRef.current.focusEpoch,
          anchorHandle: handles.anchor,
          leftSentinelHandle: handles.left,
          rightSentinelHandle: handles.right,
          appliedNextFocusLeft: handles.left,
          appliedNextFocusRight: handles.right,
          handlesReady: liveSurfFocusDestinationsReady(handles),
        });
      }
      if (destinationsChanged) {
        logLiveSurfHandles({
          event: previous.left == null && previous.right == null ? 'focus-destinations-applied' : 'focus-destinations-refreshed',
          focusEpoch: machineRef.current.focusEpoch,
          anchorHandle: handles.anchor,
          leftSentinelHandle: handles.left,
          rightSentinelHandle: handles.right,
          appliedNextFocusLeft: handles.left,
          appliedNextFocusRight: handles.right,
          handlesReady: liveSurfFocusDestinationsReady(handles),
        });
      }
      previousHandlesRef.current = handles;
      onHandlesChangeRef.current?.(handles);
    }, [handles]);

    const snapshot = useCallback(
      () => ({
        channelId: fromChannelIdRef.current,
        focusOwner: machineRef.current.focusOwner,
        previousFocusOwner: machineRef.current.previousFocusOwner,
        routerArmed: machineRef.current.routerArmed,
        transitionInFlight: machineRef.current.transitionInFlight,
        focusEpoch: machineRef.current.focusEpoch,
        surfSessionId: surfSessionIdRef.current,
      }),
      [],
    );

    const restoreAnchorFocus = useCallback(() => {
      if (!enabled || Platform.OS !== 'android') {
        return;
      }
      if (!shouldRequestLiveSurfAnchorFocus(machineRef.current)) {
        return;
      }
      restoringAnchorRef.current = true;
      setAnchorPreferred(true);
      logLiveSurfFocus({
        event: 'anchor-focus-request',
        direction: null,
        ...snapshot(),
      });
      return focusNativeViewWhenReady(
        () => anchorRef.current,
        () => {
          restoringAnchorRef.current = false;
        },
        8,
      );
    }, [enabled, snapshot]);

    const notifyTransitionSettled = useCallback(() => {
      if (!machineRef.current.transitionInFlight) {
        return;
      }
      machineRef.current = resetLiveSurfFocusAfterTransition(machineRef.current);
      logLiveSurfFocus({
        event: 'transition-focus-reset',
        ...snapshot(),
      });
      logLiveSurfHandles({
        event: 'sentinel-handles',
        focusEpoch: machineRef.current.focusEpoch,
        anchorHandle: handlesRef.current.anchor,
        leftSentinelHandle: handlesRef.current.left,
        rightSentinelHandle: handlesRef.current.right,
        appliedNextFocusLeft: handlesRef.current.left,
        appliedNextFocusRight: handlesRef.current.right,
        handlesReady: liveSurfFocusDestinationsReady(handlesRef.current),
      });
      if (machineRef.current.focusOwner === 'anchor') {
        const result = applyLiveSurfAnchorFocus(machineRef.current);
        if (result.armed && !liveSurfFocusDestinationsReady(handlesRef.current)) {
          machineRef.current = { ...result.next, routerArmed: false };
          logLiveSurfFocus({
            event: 'router-arm-rejected',
            reason: 'focus-destinations-not-ready',
            ...snapshot(),
          });
        } else {
          machineRef.current = result.next;
          if (result.armed) {
            logLiveSurfFocus({
              event: 'router-armed',
              ...snapshot(),
            });
          }
        }
      }
      restoreAnchorFocus();
    }, [restoreAnchorFocus, snapshot]);

    useImperativeHandle(ref, () => ({ notifyTransitionSettled }), [notifyTransitionSettled]);

    const publishHandle = useCallback((slot: keyof LiveTvFocusRouterHandles, instance: View | null) => {
      if (Platform.OS !== 'android') {
        return;
      }
      const handle = instance ? findNodeHandle(instance) : null;
      setHandles((current) => {
        if (current[slot] === handle) {
          return current;
        }
        return { ...current, [slot]: handle };
      });
    }, []);

    const assignAnchorRef = useCallback(
      (instance: View | null) => {
        anchorRef.current = instance;
        publishHandle('anchor', instance);
      },
      [publishHandle],
    );
    const assignLeftRef = useCallback(
      (instance: View | null) => {
        publishHandle('left', instance);
      },
      [publishHandle],
    );
    const assignRightRef = useCallback(
      (instance: View | null) => {
        publishHandle('right', instance);
      },
      [publishHandle],
    );

    useEffect(() => {
      if (!enabled) {
        machineRef.current = createLiveSurfFocusRouterState();
        restoringAnchorRef.current = false;
        setAnchorPreferred(true);
      }
    }, [enabled]);

    useEffect(() => {
      if (!enabled || chromeVisible || Platform.OS !== 'android') {
        return;
      }
      if (machineRef.current.transitionInFlight) {
        return;
      }
      if (!shouldRequestLiveSurfAnchorFocus(machineRef.current)) {
        return;
      }
      return restoreAnchorFocus();
    }, [chromeVisible, enabled, restoreAnchorFocus]);

    const handleAnchorFocus = useCallback(() => {
      const result = applyLiveSurfAnchorFocus(machineRef.current);
      machineRef.current = result.next;
      logLiveSurfFocus({
        event: 'anchor-focus',
        ...snapshot(),
      });
      if (restoringAnchorRef.current) {
        logLiveSurfFocus({
          event: 'anchor-focus-restored',
          ...snapshot(),
        });
        restoringAnchorRef.current = false;
      }
      if (result.armed && !liveSurfFocusDestinationsReady(handlesRef.current)) {
        machineRef.current = { ...result.next, routerArmed: false };
        logLiveSurfFocus({
          event: 'router-arm-rejected',
          reason: 'focus-destinations-not-ready',
          ...snapshot(),
        });
        return;
      }
      if (result.armed) {
        logLiveSurfFocus({
          event: 'router-armed',
          ...snapshot(),
        });
      }
    }, [snapshot]);

    const handleSentinelNativeFocus = useCallback(
      (direction: LiveSurfDirection) => {
        const sentinelEvent = direction < 0 ? 'left-sentinel-focus' : 'right-sentinel-focus';
        logLiveSurfFocus({
          event: sentinelEvent,
          direction,
          ...snapshot(),
        });
        const decision = evaluateLiveSurfSentinelFocus({
          state: machineRef.current,
          direction,
          incomingEpoch: machineRef.current.focusEpoch,
        });
        machineRef.current = decision.next;
        if (!decision.accept) {
          logLiveSurfFocus({
            event: 'surf-focus-rejected',
            direction,
            reason: decision.reason,
            ...snapshot(),
          });
          return;
        }

        setAnchorPreferred(false);
        logLiveSurfFocus({
          event: 'surf-focus-accepted',
          direction,
          ...snapshot(),
        });
        logLiveSurfFocus({
          event: 'router-disarmed',
          direction,
          ...snapshot(),
        });
        logLiveSurf({
          event: 'surf-request',
          direction,
          fromChannelId: fromChannelIdRef.current,
          surfSessionId: surfSessionIdRef.current,
        });
        onSentinelFocusRef.current(direction);
      },
      [snapshot],
    );

    if (!enabled || Platform.OS !== 'android') {
      return null;
    }

    const bounce = handles.anchor ?? undefined;

    return (
      <>
        <Pressable
          ref={assignAnchorRef}
          collapsable={false}
          focusable
          accessible={false}
          importantForAccessibility="no"
          hasTVPreferredFocus={!chromeVisible && anchorPreferred}
          onFocus={handleAnchorFocus}
          onPress={() => onAnchorPress?.()}
          {...(handles.left != null ? { nextFocusLeft: handles.left } : {})}
          {...(handles.right != null ? { nextFocusRight: handles.right } : {})}
          style={styles.sentinel}
        />
        <View
          ref={assignLeftRef}
          collapsable={false}
          focusable
          accessible={false}
          importantForAccessibility="no"
          onFocus={() => handleSentinelNativeFocus(-1)}
          {...(bounce != null
            ? {
                nextFocusLeft: bounce,
                nextFocusRight: bounce,
                nextFocusUp: bounce,
                nextFocusDown: bounce,
              }
            : {})}
          style={styles.sentinel}
        />
        <View
          ref={assignRightRef}
          collapsable={false}
          focusable
          accessible={false}
          importantForAccessibility="no"
          onFocus={() => handleSentinelNativeFocus(1)}
          {...(bounce != null
            ? {
                nextFocusLeft: bounce,
                nextFocusRight: bounce,
                nextFocusUp: bounce,
                nextFocusDown: bounce,
              }
            : {})}
          style={styles.sentinel}
        />
      </>
    );
  },
);

const styles = StyleSheet.create({
  sentinel: {
    position: 'absolute',
    width: 1,
    height: 1,
    opacity: 0.01,
    left: 0,
    top: 0,
    overflow: 'hidden',
    backgroundColor: 'transparent',
    borderWidth: 0,
  },
});
