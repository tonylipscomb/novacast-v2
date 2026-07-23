import type { ElementRef } from 'react';
import { useCallback, useEffect, useRef } from 'react';
import { Pressable, StyleSheet } from 'react-native';

import { focusNativeViewWhenReady } from '@/features/navigation/focusNativeViewWhenReady';

import {
  isUnifiedDpadNavigationKey,
  UNIFIED_CONTROL_ACTIVATE_DEBOUNCE_MS,
} from './unifiedPlayerLogic.ts';
import {
  isUnifiedRemoteDebugEnabled,
  logUnifiedRemoteEvent,
} from './unifiedRemoteDebug.ts';

type UnifiedPlayerInteractionLayerProps = {
  active: boolean;
  onTogglePlay: () => void;
  onRevealControls: () => void;
};

export function UnifiedPlayerInteractionLayer({
  active,
  onTogglePlay,
  onRevealControls,
}: UnifiedPlayerInteractionLayerProps) {
  const lastKeyActivateAtRef = useRef(0);
  const interactionRef = useRef<ElementRef<typeof Pressable> | null>(null);

  useEffect(() => {
    if (!active) {
      return;
    }

    return focusNativeViewWhenReady(
      () => interactionRef.current,
      () => {
        if (isUnifiedRemoteDebugEnabled()) {
          logUnifiedRemoteEvent({
            source: 'controls-interaction-key',
            eventType: 'focus',
            disposition: 'accepted',
            actionTaken: 'hidden-player-interaction-focused',
            controlId: 'interaction-layer',
          });
        }
      },
    );
  }, [active]);

  const handlePress = useCallback(() => {
    if (Date.now() - lastKeyActivateAtRef.current < UNIFIED_CONTROL_ACTIVATE_DEBOUNCE_MS) {
      return;
    }
    lastKeyActivateAtRef.current = Date.now();
    if (isUnifiedRemoteDebugEnabled()) {
      logUnifiedRemoteEvent({
        source: 'controls-interaction-press',
        eventType: 'press',
        disposition: 'accepted',
        actionTaken: 'toggle-playback',
        controlId: 'interaction-layer',
      });
    }
    onTogglePlay();
  }, [onTogglePlay]);

  const handleKeyDown = useCallback(
    (event: {
      nativeEvent: { key?: string; code?: string; keyCode?: number | null };
      preventDefault?: () => void;
      stopPropagation?: () => void;
    }) => {
      const { key, code, keyCode } = event.nativeEvent;
      if (!isUnifiedDpadNavigationKey(key ?? code ?? '', keyCode)) {
        return;
      }

      event.preventDefault?.();
      event.stopPropagation?.();
      if (isUnifiedRemoteDebugEnabled()) {
        logUnifiedRemoteEvent({
          source: 'controls-interaction-key',
          eventType: key ?? code ?? 'dpad',
          disposition: 'accepted',
          actionTaken: 'reveal-player-controls',
          controlId: 'interaction-layer',
        });
      }
      onRevealControls();
    },
    [onRevealControls],
  );

  if (!active) {
    return null;
  }

  return (
    <Pressable
      ref={interactionRef}
      focusable={active}
      pointerEvents="auto"
      onPress={handlePress}
      {...({ onKeyDown: handleKeyDown } as any)}
      onFocus={() => {
        if (isUnifiedRemoteDebugEnabled()) {
          logUnifiedRemoteEvent({
            source: 'controls-interaction-key',
            eventType: 'focus',
            disposition: 'accepted',
            actionTaken: 'hidden-player-interaction-focused',
            controlId: 'interaction-layer',
          });
        }
      }}
      style={styles.layer}
      accessibilityLabel="Playback controls"
    />
  );
}

const styles = StyleSheet.create({
  layer: {
    ...StyleSheet.absoluteFill,
    zIndex: 10,
    elevation: 12,
  },
});
