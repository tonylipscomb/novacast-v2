import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useEffect, useId, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { recordDiagnostic } from '@/features/diagnostics/diagnosticsClient';
import type { DiagnosticContentType } from '@/features/diagnostics/diagnosticTypes';

export type PlaybackKeepAwakeOptions = {
  active: boolean;
  contentType: DiagnosticContentType;
  contentId?: string | null;
  sessionId?: string | null;
  playerState?: string | null;
};

export function shouldKeepPlaybackAwake(active: boolean, appState: AppStateStatus) {
  return active && appState === 'active';
}

function createLifecycleSessionId() {
  return `playback-awake-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Keeps only an active, foreground video session awake. */
export function usePlaybackKeepAwake({
  active,
  contentType,
  contentId = null,
  sessionId = null,
  playerState = null,
}: PlaybackKeepAwakeOptions) {
  const tag = `novacast-playback-${useId()}`;
  const heldRef = useRef(false);
  const operationRef = useRef(0);
  const desiredRef = useRef(active);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const metadataRef = useRef({ contentType, contentId, sessionId, playerState });

  useEffect(() => {
    desiredRef.current = active;
    metadataRef.current = { contentType, contentId, sessionId, playerState };
  }, [active, contentId, contentType, playerState, sessionId]);

  useEffect(() => {
    const updateLock = (reason: string) => {
      const shouldHold = shouldKeepPlaybackAwake(desiredRef.current, appStateRef.current);
      if (shouldHold && !heldRef.current) {
        if (!metadataRef.current.sessionId) {
          metadataRef.current.sessionId = createLifecycleSessionId();
        }
        heldRef.current = true;
        const operation = ++operationRef.current;
        void activateKeepAwakeAsync(tag).then(() => {
          if (operation !== operationRef.current || !heldRef.current) {
            return;
          }
          const { contentType: nextContentType, contentId: nextContentId, sessionId: nextSessionId, playerState: nextPlayerState } = metadataRef.current;
          recordDiagnostic({
            eventType: 'screen_awake_acquired',
            contentType: nextContentType,
            contentId: nextContentId ?? undefined,
            sessionId: nextSessionId ?? undefined,
            playbackState: nextPlayerState ?? undefined,
            metadata: { acquire_reason: reason, appState: appStateRef.current },
          });
        }).catch(() => {
          if (operation === operationRef.current) {
            heldRef.current = false;
          }
        });
        return;
      }

      if (!shouldHold && heldRef.current) {
        operationRef.current += 1;
        heldRef.current = false;
        void deactivateKeepAwake(tag).catch(() => undefined);
        const { contentType: nextContentType, contentId: nextContentId, sessionId: nextSessionId, playerState: nextPlayerState } = metadataRef.current;
        recordDiagnostic({
          eventType: 'screen_awake_released',
          contentType: nextContentType,
          contentId: nextContentId ?? undefined,
          sessionId: nextSessionId ?? undefined,
          playbackState: nextPlayerState ?? undefined,
          metadata: { release_reason: reason, appState: appStateRef.current },
        });
      }
    };

    const subscription = AppState.addEventListener('change', (nextState) => {
      const previousState = appStateRef.current;
      appStateRef.current = nextState;
      const { contentType: nextContentType, contentId: nextContentId, sessionId: nextSessionId, playerState: nextPlayerState } = metadataRef.current;
      if (desiredRef.current || heldRef.current) {
        recordDiagnostic({
          eventType: 'app_state_changed',
          contentType: nextContentType,
          contentId: nextContentId ?? undefined,
          sessionId: nextSessionId ?? undefined,
          playbackState: nextPlayerState ?? undefined,
          metadata: { previousAppState: previousState, appState: nextState },
        });
      }
      if (desiredRef.current && nextState !== 'active' && previousState === 'active') {
        recordDiagnostic({
          eventType: 'playback_interrupted',
          contentType: nextContentType,
          contentId: nextContentId ?? undefined,
          sessionId: nextSessionId ?? undefined,
          playbackState: nextPlayerState ?? undefined,
          metadata: { interruption_reason: `app_state_${nextState}` },
        });
      }
      updateLock(`app_state_${nextState}`);
    });

    updateLock(active ? 'playback_active' : 'playback_inactive');
    return () => {
      subscription.remove();
      if (heldRef.current) {
        operationRef.current += 1;
        heldRef.current = false;
        void deactivateKeepAwake(tag).catch(() => undefined);
        const { contentType: nextContentType, contentId: nextContentId, sessionId: nextSessionId, playerState: nextPlayerState } = metadataRef.current;
        recordDiagnostic({
          eventType: 'screen_awake_released',
          contentType: nextContentType,
          contentId: nextContentId ?? undefined,
          sessionId: nextSessionId ?? undefined,
          playbackState: nextPlayerState ?? undefined,
          metadata: { release_reason: 'component_unmount', appState: appStateRef.current },
        });
      }
    };
  }, [active, tag]);

  useEffect(() => {
    if (!active && !playerState) {
      return;
    }
    const { contentType: nextContentType, contentId: nextContentId, sessionId: nextSessionId } = metadataRef.current;
    recordDiagnostic({
      eventType: 'player_state_changed',
      contentType: nextContentType,
      contentId: nextContentId ?? undefined,
      sessionId: nextSessionId ?? undefined,
      playbackState: playerState ?? undefined,
      metadata: { playerState: playerState ?? 'unknown' },
    });
  }, [active, playerState]);
}
