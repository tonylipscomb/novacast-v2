import { useEffect, useRef } from 'react';
import * as ReactNative from 'react-native';
import { Platform } from 'react-native';

import {
  isUnifiedDpadNavigationKey,
  isUnifiedTvSelectEvent,
  UNIFIED_CONTROL_ACTIVATE_DEBOUNCE_MS,
} from './unifiedPlayerLogic.ts';
import {
  isUnifiedRemoteDebugEnabled,
  logUnifiedRemoteEvent,
  logUnifiedRemoteTvHandlerAvailability,
} from './unifiedRemoteDebug.ts';

type TvEventPayload = {
  eventType?: string;
  eventKeyAction?: number;
};

type UnifiedPlayerRemoteHandlersInput = {
  enabled: boolean;
  controlsVisible: boolean;
  onTogglePlay: () => void;
  onRevealControls: () => void;
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
  onTogglePlay,
  onRevealControls,
}: UnifiedPlayerRemoteHandlersInput) {
  const lastActivateAtRef = useRef(0);
  const controlsVisibleRef = useRef(controlsVisible);
  const onTogglePlayRef = useRef(onTogglePlay);
  const onRevealControlsRef = useRef(onRevealControls);
  const enabledRef = useRef(enabled);

  useEffect(() => {
    controlsVisibleRef.current = controlsVisible;
  }, [controlsVisible]);

  useEffect(() => {
    onTogglePlayRef.current = onTogglePlay;
  }, [onTogglePlay]);

  useEffect(() => {
    onRevealControlsRef.current = onRevealControls;
  }, [onRevealControls]);

  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  const handleTvEvent = (event: TvEventPayload, source: 'useTVEventHandler' | 'TVEventHandler') => {
    if (!enabledRef.current) {
      return;
    }

    const keyAction = resolveKeyAction(event.eventKeyAction);
    const eventType = event.eventType ?? 'unknown';
    const isDpadEvent = isUnifiedDpadNavigationKey(eventType, null);
    const isSelectEvent = isUnifiedTvSelectEvent(eventType);

    if (keyAction != null && keyAction !== 'down' && !isDpadEvent && !isSelectEvent) {
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

    if (controlsVisibleRef.current) {
      return;
    }

    if (isSelectEvent) {
      if (Date.now() - lastActivateAtRef.current < UNIFIED_CONTROL_ACTIVATE_DEBOUNCE_MS) {
        return;
      }
      lastActivateAtRef.current = Date.now();
      onTogglePlayRef.current();
      return;
    }

    if (isDpadEvent) {
      onRevealControlsRef.current();
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
