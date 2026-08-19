import { useEffect, useRef } from 'react';
import * as ReactNative from 'react-native';
import { Platform } from 'react-native';

import {
  isUnifiedDpadNavigationKey,
  isUnifiedTvSelectEvent,
} from './unifiedPlayerLogic.ts';
import { getUnifiedPlayerState } from './unifiedPlayerStore.ts';
import {
  isUnifiedRemoteDebugEnabled,
  logUnifiedRemoteEvent,
  logUnifiedRemoteTvHandlerAvailability,
} from './unifiedRemoteDebug.ts';
import {
  canEnterVodSeek,
  isVodSeekKeyUp,
  isVodSeekMediaType,
  logTvInputRaw,
  logVodSeekRemote,
  resolveHiddenVodSeekRemoteAction,
  resolveVodSeekDirection,
} from './vodSeek.ts';
import {
  logPlayerChromeFocus,
  resolvePlayerChromeWakeKey,
  shouldConsumePlayerChromeWake,
  shouldRouteVisiblePlayerChromeInput,
} from './playerChromeWake.ts';

type TvEventPayload = {
  eventType?: string;
  eventKeyAction?: number;
  keyCode?: number;
  key?: string;
};

type UnifiedPlayerRemoteHandlersInput = {
  enabled: boolean;
  controlsVisible: boolean;
  mediaType?: string | null;
  upNextActive?: boolean;
  onTogglePlay: () => void;
  onRevealControls: (source?: 'remote-handler' | 'generic-dpad') => void;
  onRequestDefaultFocus?: () => void;
  getSeekPreviewActive?: () => boolean;
  getTimelineFocused?: () => boolean;
  getTimelineHandlePresent?: () => boolean;
};

function noopUseTVEventHandler(_handler: (event: TvEventPayload) => void) {
  // RN 0.86 Android builds may not ship TV event hooks; keep hook order stable.
}

function resolveKeyAction(eventKeyAction?: number): 'down' | 'up' | 'repeat' | null {
  if (eventKeyAction === 0) {
    return 'down';
  }
  if (eventKeyAction === 1) {
    return 'up';
  }
  if (eventKeyAction === 2) {
    return 'repeat';
  }
  return null;
}

function UnifiedPlayerRemoteUseTvHookListener({
  onTvEvent,
}: {
  onTvEvent: (event: TvEventPayload) => void;
}) {
  const reactNative = ReactNative as typeof ReactNative & {
    useTVEventHandler?: (handler: (event: TvEventPayload) => void) => void;
  };
  const useTVEventHandler = reactNative.useTVEventHandler ?? noopUseTVEventHandler;
  useTVEventHandler(onTvEvent);
  return null;
}

export function UnifiedPlayerRemoteHandlers({
  enabled,
  controlsVisible,
  mediaType = null,
  upNextActive = false,
  onTogglePlay: _onTogglePlay,
  onRevealControls,
  onRequestDefaultFocus,
  getSeekPreviewActive,
  getTimelineFocused,
  getTimelineHandlePresent,
}: UnifiedPlayerRemoteHandlersInput) {
  const wakeConsumedRef = useRef(false);
  const controlsVisibleRef = useRef(controlsVisible);
  const mediaTypeRef = useRef(mediaType);
  const upNextActiveRef = useRef(upNextActive);
  const onRevealControlsRef = useRef(onRevealControls);
  const onRequestDefaultFocusRef = useRef(onRequestDefaultFocus);
  const getSeekPreviewActiveRef = useRef(getSeekPreviewActive);
  const getTimelineFocusedRef = useRef(getTimelineFocused);
  const getTimelineHandlePresentRef = useRef(getTimelineHandlePresent);
  const enabledRef = useRef(enabled);

  useEffect(() => {
    controlsVisibleRef.current = controlsVisible;
    if (controlsVisible) {
      wakeConsumedRef.current = false;
    }
  }, [controlsVisible]);

  useEffect(() => {
    mediaTypeRef.current = mediaType;
  }, [mediaType]);

  useEffect(() => {
    upNextActiveRef.current = upNextActive;
  }, [upNextActive]);

  useEffect(() => {
    onRevealControlsRef.current = onRevealControls;
  }, [onRevealControls]);

  useEffect(() => {
    onRequestDefaultFocusRef.current = onRequestDefaultFocus;
  }, [onRequestDefaultFocus]);

  useEffect(() => {
    getSeekPreviewActiveRef.current = getSeekPreviewActive;
  }, [getSeekPreviewActive]);

  useEffect(() => {
    getTimelineFocusedRef.current = getTimelineFocused;
  }, [getTimelineFocused]);

  useEffect(() => {
    getTimelineHandlePresentRef.current = getTimelineHandlePresent;
  }, [getTimelineHandlePresent]);

  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  const handleTvEvent = (event: TvEventPayload, source: 'useTVEventHandler' | 'TVEventHandler') => {
    if (!enabledRef.current) {
      return;
    }

    const liveState = getUnifiedPlayerState();
    const keyAction = resolveKeyAction(event.eventKeyAction);
    const eventType = event.eventType ?? event.key ?? 'unknown';
    const keyCode = event.keyCode ?? null;
    const isDpadEvent = isUnifiedDpadNavigationKey(eventType, keyCode);
    const isSelectEvent = isUnifiedTvSelectEvent(eventType);
    const direction = resolveVodSeekDirection({
      eventType,
      eventKeyAction: event.eventKeyAction,
      keyCode,
      key: event.key,
    });
    const mediaTypeNow = liveState.item?.mediaType ?? mediaTypeRef.current;
    const controlsVisibleNow = liveState.controlsVisible;
    const durationMs = liveState.durationMs;
    const allowSeek = mediaTypeNow !== 'live';
    const seekPreviewActive = getSeekPreviewActiveRef.current?.() === true;
    const timelineFocused = getTimelineFocusedRef.current?.() === true;
    const nativeTimelineHandlePresent = getTimelineHandlePresentRef.current?.() === true;
    const vodEligible = isVodSeekMediaType(mediaTypeNow) && canEnterVodSeek(durationMs);
    const hiddenVodSeekEligible = vodEligible && !controlsVisibleNow && direction != null;

    logTvInputRaw({
      source,
      rawEventType: eventType,
      eventKeyAction: event.eventKeyAction ?? null,
      keyCode,
      controlsVisible: controlsVisibleNow,
      focusedControl: timelineFocused ? 'seek' : null,
      mediaType: mediaTypeNow,
    });

    const remoteFields = {
      mediaType: mediaTypeNow,
      controlsVisible: controlsVisibleNow,
      allowSeek,
      timelineFocused,
      seekPreviewActive,
      vodEligible,
      hiddenVodSeekEligible,
      nativeTimelineHandlePresent,
      eventType,
      eventKeyAction: event.eventKeyAction ?? null,
      keyCode,
      direction,
    };

    if (direction != null) {
      logVodSeekRemote({
        event: 'remote-received',
        ...remoteFields,
      });
    }

    if (keyAction != null && keyAction !== 'down' && !isDpadEvent && !isSelectEvent && direction == null) {
      return;
    }

    if (isUnifiedRemoteDebugEnabled()) {
      logUnifiedRemoteEvent({
        source,
        eventType,
        keyAction,
        disposition: 'accepted',
        actionTaken: 'observed-tv-event-handler-callback',
      });
    }

    const wakeKey = resolvePlayerChromeWakeKey({
      eventType,
      key: event.key,
      keyCode,
    });
    const wakeInput = {
      controlsVisible: controlsVisibleNow || wakeConsumedRef.current,
      upNextActive: upNextActiveRef.current,
      mediaType: mediaTypeNow,
      key: wakeKey,
      eventKeyAction: event.eventKeyAction,
    };

    if (shouldConsumePlayerChromeWake(wakeInput) && !isVodSeekKeyUp(event.eventKeyAction)) {
      wakeConsumedRef.current = true;
      logPlayerChromeFocus({
        event: 'wake-input',
        key: wakeKey,
        mediaType: mediaTypeNow,
        focusedControl: null,
      });
      logPlayerChromeFocus({
        event: 'wake-consumed',
        key: wakeKey,
        mediaType: mediaTypeNow,
        focusedControl: null,
      });
      onRevealControlsRef.current('remote-handler');
      onRequestDefaultFocusRef.current?.();
      return;
    }

    if (
      shouldRouteVisiblePlayerChromeInput({
        controlsVisible: controlsVisibleNow,
        upNextActive: upNextActiveRef.current,
        mediaType: mediaTypeNow,
        key: wakeKey,
      })
    ) {
      logPlayerChromeFocus({
        event: 'visible-input-routed',
        key: wakeKey,
        mediaType: mediaTypeNow,
        focusedControl: timelineFocused ? 'seek' : null,
      });
    }

    const action = resolveHiddenVodSeekRemoteAction({
      controlsVisible: controlsVisibleNow,
      mediaType: mediaTypeNow,
      durationMs,
      eventType,
      eventKeyAction: event.eventKeyAction,
      keyCode,
      seekPreviewActive,
      timelineFocused,
    });

    if (action === 'hidden-vod-seek' && direction != null) {
      logVodSeekRemote({
        event: 'remote-fell-through',
        ...remoteFields,
        eventConsumedBy: 'hidden-focus-sentinel',
      });
      return;
    }

    if (action === 'preview-step' && direction != null) {
      logVodSeekRemote({
        event: 'remote-fell-through',
        ...remoteFields,
        eventConsumedBy: 'hidden-focus-sentinel',
      });
      return;
    }

    if (controlsVisibleNow) {
      if (direction != null) {
        logVodSeekRemote({
          event: 'remote-fell-through',
          ...remoteFields,
          eventConsumedBy: 'visible-controls',
        });
      }
      return;
    }

    if (wakeConsumedRef.current) {
      return;
    }

    if (action === 'generic-reveal' || isDpadEvent) {
      if (direction != null) {
        logVodSeekRemote({
          event: 'generic-controls-reveal',
          ...remoteFields,
          eventConsumedBy: 'generic-controls-reveal',
        });
      }
      onRevealControlsRef.current('generic-dpad');
      return;
    }

    if (direction != null) {
      logVodSeekRemote({
        event: 'remote-fell-through',
        ...remoteFields,
        eventConsumedBy: 'fell-through',
      });
    }
  };

  useEffect(() => {
    if (!enabled || Platform.OS !== 'android') {
      return;
    }

    const reactNative = ReactNative as typeof ReactNative & {
      useTVEventHandler?: (handler: (event: TvEventPayload) => void) => void;
      TVEventHandler?: new () => {
        enable: (component: null, callback: (component: null, data: TvEventPayload) => void) => void;
        disable: () => void;
      };
    };

    const useTvHookAvailable = typeof reactNative.useTVEventHandler === 'function';
    const tvEventHandlerAvailable = typeof reactNative.TVEventHandler === 'function';
    logUnifiedRemoteTvHandlerAvailability(useTvHookAvailable, tvEventHandlerAvailable);

    if (!tvEventHandlerAvailable) {
      return;
    }

    const handler = new reactNative.TVEventHandler!();
    handler.enable(null, (_component, event) => {
      handleTvEvent(event, 'TVEventHandler');
    });

    return () => {
      handler.disable();
    };
  }, [enabled]);

  if (!enabled || Platform.OS !== 'android') {
    return null;
  }

  return (
    <UnifiedPlayerRemoteUseTvHookListener
      onTvEvent={(event) => {
        handleTvEvent(event, 'useTVEventHandler');
      }}
    />
  );
}
