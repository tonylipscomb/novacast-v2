import { useEffect } from 'react';

import {
  isUnifiedRemoteDebugEnabled,
  logUnifiedRemoteEvent,
  logUnifiedRemoteTvHandlerAvailability,
} from './unifiedRemoteDebug.ts';

type TvEventPayload = {
  eventType?: string;
  eventKeyAction?: number;
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

function UnifiedRemoteDebugUseTvHookListener({
  onTvEvent,
}: {
  onTvEvent: (event: TvEventPayload) => void;
}) {
  // React Native TV APIs are optional across Android TV runtimes.
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- resolve the optional API only when this debug listener mounts.
  const reactNative = require('react-native') as {
    useTVEventHandler?: (handler: (event: TvEventPayload) => void) => void;
  };
  const useTVEventHandler = reactNative.useTVEventHandler ?? noopUseTVEventHandler;
  useTVEventHandler(onTvEvent);
  return null;
}

type UnifiedRemoteDebugListenersProps = {
  enabled: boolean;
};

export function UnifiedRemoteDebugListeners({ enabled }: UnifiedRemoteDebugListenersProps) {
  useEffect(() => {
    if (!isUnifiedRemoteDebugEnabled() || !enabled) {
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-require-imports -- resolve optional TV APIs without changing the production import graph.
    const reactNative = require('react-native') as {
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
      logUnifiedRemoteEvent({
        source: 'TVEventHandler',
        eventType: event.eventType ?? 'unknown',
        keyAction: resolveKeyAction(event.eventKeyAction),
        disposition: 'accepted',
        actionTaken: 'observed-tv-event-handler-callback',
      });
    });

    return () => {
      handler.disable();
    };
  }, [enabled]);

  if (!isUnifiedRemoteDebugEnabled() || !enabled) {
    return null;
  }

  return (
    <UnifiedRemoteDebugUseTvHookListener
      onTvEvent={(event) => {
        logUnifiedRemoteEvent({
          source: 'useTVEventHandler',
          eventType: event.eventType ?? 'unknown',
          keyAction: resolveKeyAction(event.eventKeyAction),
          disposition: 'accepted',
          actionTaken: 'observed-use-tv-event-handler-callback',
        });
      }}
    />
  );
}
