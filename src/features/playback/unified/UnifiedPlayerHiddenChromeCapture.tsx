import { useCallback, useEffect, useRef, useState } from 'react';
import { findNodeHandle, Platform, StyleSheet, View } from 'react-native';

import { focusNativeViewWhenReady } from '@/features/navigation/focusNativeViewWhenReady';

import {
  logVodFocusSeek,
  type VodSeekDirection,
} from './vodSeek.ts';

export type VodFocusRouterHandles = {
  anchor: number | null;
  left: number | null;
  right: number | null;
};

type UnifiedPlayerVodFocusRouterProps = {
  enabled: boolean;
  chromeVisible: boolean;
  mediaType?: string | null;
  contentId?: string | null;
  timelineFocused: boolean;
  seekPreviewActive: boolean;
  actualPositionMs: number;
  previewPositionMs: number | null;
  seekSessionId: string | null;
  seekHandle?: number | null;
  onSentinelFocus: (direction: VodSeekDirection) => void;
  onHiddenChromeWake?: (key: 'left' | 'right' | 'up' | 'down') => void;
  onHandlesChange?: (handles: VodFocusRouterHandles) => void;
};

/**
 * Native TV focus router for VOD LEFT/RIGHT.
 * ONN consumes DPAD as focus navigation, not JS key events.
 * Hidden chrome parks on the anchor; LEFT/RIGHT move to dedicated sentinels.
 */
export function UnifiedPlayerVodFocusRouter({
  enabled,
  chromeVisible,
  mediaType = null,
  contentId = null,
  timelineFocused,
  seekPreviewActive,
  actualPositionMs,
  previewPositionMs,
  seekSessionId,
  seekHandle = null,
  onSentinelFocus,
  onHiddenChromeWake,
  onHandlesChange,
}: UnifiedPlayerVodFocusRouterProps) {
  const anchorRef = useRef<View | null>(null);
  const [handles, setHandles] = useState<VodFocusRouterHandles>({
    anchor: null,
    left: null,
    right: null,
  });
  const [wakeHandles, setWakeHandles] = useState<{ up: number | null; down: number | null }>({
    up: null,
    down: null,
  });
  const onSentinelFocusRef = useRef(onSentinelFocus);
  const onHiddenChromeWakeRef = useRef(onHiddenChromeWake);
  const onHandlesChangeRef = useRef(onHandlesChange);
  const mediaTypeRef = useRef(mediaType);
  const contentIdRef = useRef(contentId);
  const chromeVisibleRef = useRef(chromeVisible);
  const timelineFocusedRef = useRef(timelineFocused);
  const seekPreviewActiveRef = useRef(seekPreviewActive);
  const actualPositionMsRef = useRef(actualPositionMs);
  const previewPositionMsRef = useRef(previewPositionMs);
  const seekSessionIdRef = useRef(seekSessionId);

  useEffect(() => {
    onSentinelFocusRef.current = onSentinelFocus;
  }, [onSentinelFocus]);
  useEffect(() => {
    onHiddenChromeWakeRef.current = onHiddenChromeWake;
  }, [onHiddenChromeWake]);
  useEffect(() => {
    onHandlesChangeRef.current = onHandlesChange;
  }, [onHandlesChange]);
  useEffect(() => {
    mediaTypeRef.current = mediaType;
  }, [mediaType]);
  useEffect(() => {
    contentIdRef.current = contentId;
  }, [contentId]);
  useEffect(() => {
    chromeVisibleRef.current = chromeVisible;
  }, [chromeVisible]);
  useEffect(() => {
    timelineFocusedRef.current = timelineFocused;
  }, [timelineFocused]);
  useEffect(() => {
    seekPreviewActiveRef.current = seekPreviewActive;
  }, [seekPreviewActive]);
  useEffect(() => {
    actualPositionMsRef.current = actualPositionMs;
  }, [actualPositionMs]);
  useEffect(() => {
    previewPositionMsRef.current = previewPositionMs;
  }, [previewPositionMs]);
  useEffect(() => {
    seekSessionIdRef.current = seekSessionId;
  }, [seekSessionId]);

  useEffect(() => {
    onHandlesChangeRef.current?.(handles);
  }, [handles]);

  const publishHandle = useCallback((slot: keyof VodFocusRouterHandles, instance: View | null) => {
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
  const assignUpRef = useCallback((instance: View | null) => {
    if (Platform.OS !== 'android') {
      return;
    }
    const handle = instance ? findNodeHandle(instance) : null;
    setWakeHandles((current) => (current.up === handle ? current : { ...current, up: handle }));
  }, []);
  const assignDownRef = useCallback((instance: View | null) => {
    if (Platform.OS !== 'android') {
      return;
    }
    const handle = instance ? findNodeHandle(instance) : null;
    setWakeHandles((current) => (current.down === handle ? current : { ...current, down: handle }));
  }, []);

  useEffect(() => {
    if (!enabled || chromeVisible || Platform.OS !== 'android') {
      return;
    }
    logVodFocusSeek({
      event: 'hidden-anchor-focus-request',
      mediaType: mediaTypeRef.current,
      contentId: contentIdRef.current,
      controlsVisible: false,
      timelineFocused: timelineFocusedRef.current,
      seekPreviewActive: seekPreviewActiveRef.current,
      actualPositionMs: actualPositionMsRef.current,
      previewPositionMs: previewPositionMsRef.current,
      seekSessionId: seekSessionIdRef.current,
    });
    return focusNativeViewWhenReady(() => anchorRef.current, () => {}, 2);
  }, [chromeVisible, enabled]);

  const snapshotFields = useCallback(
    () => ({
      mediaType: mediaTypeRef.current,
      contentId: contentIdRef.current,
      controlsVisible: chromeVisibleRef.current,
      timelineFocused: timelineFocusedRef.current,
      seekPreviewActive: seekPreviewActiveRef.current,
      actualPositionMs: actualPositionMsRef.current,
      previewPositionMs: previewPositionMsRef.current,
      seekSessionId: seekSessionIdRef.current,
    }),
    [],
  );

  const handleAnchorFocus = useCallback(() => {
    logVodFocusSeek({
      event: 'hidden-anchor-focus-confirmed',
      ...snapshotFields(),
    });
  }, [snapshotFields]);

  const handleSentinelNativeFocus = useCallback(
    (direction: VodSeekDirection) => {
      if (!chromeVisibleRef.current) {
        onHiddenChromeWakeRef.current?.(direction === 1 ? 'right' : 'left');
        return;
      }
      logVodFocusSeek({
        event: direction === 1 ? 'right-sentinel-focus' : 'left-sentinel-focus',
        ...snapshotFields(),
        direction,
      });
      onSentinelFocusRef.current(direction);
      logVodFocusSeek({
        event: 'preview-step-forwarded',
        ...snapshotFields(),
        direction,
        seekPreviewActive: true,
      });
    },
    [snapshotFields],
  );

  const handleVerticalWake = useCallback((key: 'up' | 'down') => {
    if (chromeVisibleRef.current) {
      return;
    }
    onHiddenChromeWakeRef.current?.(key);
  }, []);

  if (!enabled || Platform.OS !== 'android') {
    return null;
  }

  const timelineReturn = seekHandle ?? undefined;

  return (
    <>
      <View
        ref={assignAnchorRef}
        collapsable={false}
        focusable={!chromeVisible}
        accessible={false}
        importantForAccessibility="no"
        onFocus={handleAnchorFocus}
        // Hidden playback chrome is an explicit handoff target, never a
        // startup preferred-focus owner. Home owns first native focus.
        {...(handles.left != null ? { nextFocusLeft: handles.left } : {})}
        {...(handles.right != null ? { nextFocusRight: handles.right } : {})}
        {...(!chromeVisible && wakeHandles.up != null ? { nextFocusUp: wakeHandles.up } : {})}
        {...(!chromeVisible && wakeHandles.down != null ? { nextFocusDown: wakeHandles.down } : {})}
        style={styles.sentinel}
      />
      <View
        ref={assignLeftRef}
        collapsable={false}
        focusable
        accessible={false}
        importantForAccessibility="no"
        onFocus={() => handleSentinelNativeFocus(-1)}
        {...(chromeVisible && timelineReturn != null
          ? {
              nextFocusLeft: timelineReturn,
              nextFocusRight: timelineReturn,
              nextFocusUp: timelineReturn,
              nextFocusDown: timelineReturn,
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
        {...(chromeVisible && timelineReturn != null
          ? {
              nextFocusLeft: timelineReturn,
              nextFocusRight: timelineReturn,
              nextFocusUp: timelineReturn,
              nextFocusDown: timelineReturn,
            }
          : {})}
        style={styles.sentinel}
      />
      <View
        ref={assignUpRef}
        collapsable={false}
        focusable={!chromeVisible}
        accessible={false}
        importantForAccessibility="no"
        onFocus={() => handleVerticalWake('up')}
        style={styles.sentinel}
      />
      <View
        ref={assignDownRef}
        collapsable={false}
        focusable={!chromeVisible}
        accessible={false}
        importantForAccessibility="no"
        onFocus={() => handleVerticalWake('down')}
        style={styles.sentinel}
      />
    </>
  );
}

export const UnifiedPlayerHiddenChromeCapture = UnifiedPlayerVodFocusRouter;

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
