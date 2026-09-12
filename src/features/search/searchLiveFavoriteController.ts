import { useCallback, useEffect, useRef } from 'react';
import { DeviceEventEmitter, Platform } from 'react-native';

import type { LiveSearchResult } from './searchTypes';
import { createSearchLiveFavoriteController } from './searchLiveFavoriteControllerCore';

type SearchLiveFavoriteControllerOptions = {
  enabled: boolean;
  onToggle: (result: LiveSearchResult) => void;
};

/** Owns the single native TV hold listener for one Search surface. */
export function useSearchLiveFavoriteController({ enabled, onToggle }: SearchLiveFavoriteControllerOptions) {
  const focusedResultRef = useRef<LiveSearchResult | null>(null);
  const onToggleRef = useRef(onToggle);
  const suppressedResultIdRef = useRef<string | null>(null);
  onToggleRef.current = onToggle;

  const controllerRef = useRef<ReturnType<typeof createSearchLiveFavoriteController> | null>(null);
  if (!controllerRef.current) {
    controllerRef.current = createSearchLiveFavoriteController({
      onToggle: (result) => {
        suppressedResultIdRef.current = result.id;
        onToggleRef.current(result);
      },
    });
  }

  const setFocusedLiveResult = useCallback((result: LiveSearchResult | null) => {
    focusedResultRef.current = result;
    controllerRef.current?.setFocused(result);
  }, []);

  const consumeSuppressedPress = useCallback((id: string) => {
    if (suppressedResultIdRef.current !== id) return false;
    suppressedResultIdRef.current = null;
    controllerRef.current?.consumeSuppressedPress(id);
    return true;
  }, []);

  useEffect(() => {
    if (!enabled || Platform.OS !== 'android' || Platform.isTV !== true) {
      controllerRef.current?.cancel('search-controller-disabled');
      return;
    }
    const subscription = DeviceEventEmitter.addListener('onNovaCastNativeTvKey', (event: {
      keyCode?: number;
      action?: number;
      eventKeyAction?: number;
      keyAction?: number;
      repeatCount?: number;
    }) => {
      if (event.keyCode !== 23 && event.keyCode !== 66 && event.keyCode !== 160) return;
      controllerRef.current?.handleNativeEvent({
        keyCode: event.keyCode,
        action: event.action,
        eventKeyAction: event.eventKeyAction,
        keyAction: event.keyAction,
        repeatCount: event.repeatCount,
      });
    });
    return () => {
      subscription.remove();
      controllerRef.current?.cancel('search-controller-unmount');
    };
  }, [enabled]);

  return { setFocusedLiveResult, consumeSuppressedPress };
}
