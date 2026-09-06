import { useCallback, useEffect, useRef, useState, type ComponentType, type ElementRef, type ReactNode } from 'react';
import * as ReactNative from 'react-native';
import { findNodeHandle, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { novaTvFocus } from '@/components/nova/novaTvFocus';
import { NOVA_GLASS } from '@/components/nova/novaGlassTheme';
import { displayStreamTitle } from '@/features/series/metadata/titleNormalization';
import { novaTheme } from '@/theme';

import { formatSeasonEpisode } from './playbackContinuity.ts';
import {
  buildSeriesUpNextNativeFocusProps,
  getSeriesUpNextDefaultFocus,
  logSeriesAutoplayFocus,
  type SeriesUpNextFocusControl,
} from './seriesUpNextFocus.ts';

export type PlaybackUpNextOverlayProps = {
  visible: boolean;
  secondsLeft: number;
  title: string;
  seasonNumber?: string;
  episodeNumber?: string;
  autoplay?: boolean;
  onPlayNow: () => void;
  onCancel: () => void;
};

type NativeFocusable = {
  focus?: () => void;
  setNativeProps?: (props: Record<string, number>) => void;
};

function applySeriesUpNextNativeRouting(input: {
  playNowNode: NativeFocusable | null;
  cancelNode: NativeFocusable | null;
  playNow: number | null;
  cancel: number | null;
}) {
  const playNowProps = buildSeriesUpNextNativeFocusProps('play-now', {
    playNow: input.playNow,
    cancel: input.cancel,
  });
  const cancelProps = buildSeriesUpNextNativeFocusProps('cancel', {
    playNow: input.playNow,
    cancel: input.cancel,
  });
  if (input.playNow != null) {
    input.playNowNode?.setNativeProps?.({
      nextFocusLeft: playNowProps.nextFocusLeft ?? input.playNow,
      nextFocusUp: playNowProps.nextFocusUp ?? input.playNow,
      nextFocusRight: playNowProps.nextFocusRight ?? input.playNow,
      nextFocusDown: playNowProps.nextFocusDown ?? input.playNow,
    });
  }
  if (input.cancel != null) {
    input.cancelNode?.setNativeProps?.({
      nextFocusLeft: cancelProps.nextFocusLeft ?? input.cancel,
      nextFocusUp: cancelProps.nextFocusUp ?? input.cancel,
      nextFocusRight: cancelProps.nextFocusRight ?? input.cancel,
      nextFocusDown: cancelProps.nextFocusDown ?? input.cancel,
    });
  }
}

export function PlaybackUpNextOverlay({
  visible,
  secondsLeft,
  title,
  seasonNumber,
  episodeNumber,
  autoplay = true,
  onPlayNow,
  onCancel,
}: PlaybackUpNextOverlayProps) {
  const [preferredConsumed, setPreferredConsumed] = useState(false);
  const [focusedControl, setFocusedControl] = useState<SeriesUpNextFocusControl>(getSeriesUpNextDefaultFocus());
  const [playNowHandle, setPlayNowHandle] = useState<number | null>(null);
  const [cancelHandle, setCancelHandle] = useState<number | null>(null);
  const [guideDestinations, setGuideDestinations] = useState<object[]>([]);
  const playNowRef = useRef<ElementRef<typeof Pressable> | null>(null);
  const cancelRef = useRef<ElementRef<typeof Pressable> | null>(null);
  const focusedControlRef = useRef<SeriesUpNextFocusControl>(getSeriesUpNextDefaultFocus());
  const playNowHandleRef = useRef<number | null>(null);
  const cancelHandleRef = useRef<number | null>(null);
  const focusRequestedRef = useRef(false);
  const ownedLoggedRef = useRef(false);

  const routeNativeFocus = useCallback(() => {
    applySeriesUpNextNativeRouting({
      playNowNode: playNowRef.current as NativeFocusable | null,
      cancelNode: cancelRef.current as NativeFocusable | null,
      playNow: playNowHandleRef.current,
      cancel: cancelHandleRef.current,
    });
  }, []);

  const noteFocus = useCallback((next: SeriesUpNextFocusControl) => {
    const previous = focusedControlRef.current;
    focusedControlRef.current = next;
    setFocusedControl(next);
    if (previous !== next) {
      logSeriesAutoplayFocus({ event: 'focus-move', focusedControl: next });
    }
    logSeriesAutoplayFocus({
      event: next === 'play-now' ? 'play-now-focused' : 'cancel-focused',
      focusedControl: next,
    });
  }, []);

  const bindPlayNowRef = useCallback((instance: ElementRef<typeof Pressable> | null) => {
    playNowRef.current = instance;
    if (!instance) {
      return;
    }
    const handle = findNodeHandle(instance);
    playNowHandleRef.current = handle;
    setPlayNowHandle((current) => (current === handle ? current : handle));
    setGuideDestinations((current) => (current.includes(instance) ? current : [...current, instance]));
    routeNativeFocus();
  }, [routeNativeFocus]);

  const bindCancelRef = useCallback((instance: ElementRef<typeof Pressable> | null) => {
    cancelRef.current = instance;
    if (!instance) {
      return;
    }
    const handle = findNodeHandle(instance);
    cancelHandleRef.current = handle;
    setCancelHandle((current) => (current === handle ? current : handle));
    setGuideDestinations((current) => (current.includes(instance) ? current : [...current, instance]));
    routeNativeFocus();
  }, [routeNativeFocus]);

  useEffect(() => {
    if (!visible) {
      return;
    }
    if (!ownedLoggedRef.current) {
      ownedLoggedRef.current = true;
      logSeriesAutoplayFocus({ event: 'overlay-focus-owned', focusedControl: 'play-now' });
      logSeriesAutoplayFocus({ event: 'background-focus-blocked', focusedControl: null });
    }
    if (focusRequestedRef.current) {
      return;
    }
    focusRequestedRef.current = true;
    logSeriesAutoplayFocus({ event: 'play-now-focus-requested', focusedControl: 'play-now' });

    let unmounted = false;
    let retried = false;
    const attempt = () => {
      if (unmounted) {
        return;
      }
      const target = playNowRef.current as NativeFocusable | null;
      if (target && typeof target.focus === 'function') {
        try {
          target.focus();
        } catch {
          // Native focus is best-effort; visual default remains Play Now.
        }
        return;
      }
      if (!retried) {
        retried = true;
        requestAnimationFrame(attempt);
      }
    };
    requestAnimationFrame(attempt);
    return () => {
      unmounted = true;
    };
  }, [visible]);

  if (!visible) {
    return null;
  }

  const episodeLabel = formatSeasonEpisode(seasonNumber, episodeNumber);
  const reactNative = ReactNative as typeof ReactNative & { TVFocusGuideView?: typeof View };
  const FocusBoundaryView = (reactNative.TVFocusGuideView ?? View) as unknown as ComponentType<{
    children?: ReactNode;
    style?: unknown;
    autoFocus?: boolean;
    trapFocusLeft?: boolean;
    trapFocusRight?: boolean;
    trapFocusUp?: boolean;
    trapFocusDown?: boolean;
    destinations?: object[];
    pointerEvents?: 'box-none' | 'auto' | 'none' | 'box-only';
    accessibilityViewIsModal?: boolean;
  }>;
  const playNowFocusProps = buildSeriesUpNextNativeFocusProps('play-now', {
    playNow: playNowHandle,
    cancel: cancelHandle,
  });
  const cancelFocusProps = buildSeriesUpNextNativeFocusProps('cancel', {
    playNow: playNowHandle,
    cancel: cancelHandle,
  });

  return (
    <FocusBoundaryView
      style={styles.panel}
      pointerEvents="box-none"
      accessibilityViewIsModal
      {...(Platform.OS === 'android'
        ? {
            autoFocus: false,
            trapFocusLeft: true,
            trapFocusRight: true,
            trapFocusUp: true,
            trapFocusDown: true,
            ...(guideDestinations.length ? { destinations: guideDestinations } : {}),
          }
        : {})}>
      <Text style={styles.kicker}>
        UP NEXT
      </Text>
      {episodeLabel ? (
        <Text style={styles.episode}>
          {episodeLabel}
        </Text>
      ) : null}
      <Text numberOfLines={2} style={styles.title}>
        {displayStreamTitle(title)}
      </Text>
      <Text style={styles.countdown}>
        {autoplay ? `Playing in ${secondsLeft}` : 'Ready when you are'}
      </Text>
      <View style={styles.actions} focusable={false} pointerEvents="box-none">
        <Pressable
          ref={bindPlayNowRef}
          collapsable={false}
          focusable
          hasTVPreferredFocus={!preferredConsumed}
          accessibilityRole="button"
          accessibilityLabel="Play Now"
          {...(Platform.OS === 'android' && playNowFocusProps.nextFocusLeft != null
            ? {
                nextFocusLeft: playNowFocusProps.nextFocusLeft,
                nextFocusRight: playNowFocusProps.nextFocusRight ?? playNowFocusProps.nextFocusLeft,
                nextFocusUp: playNowFocusProps.nextFocusUp ?? playNowFocusProps.nextFocusLeft,
                nextFocusDown: playNowFocusProps.nextFocusDown ?? playNowFocusProps.nextFocusLeft,
              }
            : {})}
          onFocus={() => {
            if (!preferredConsumed) {
              setPreferredConsumed(true);
            }
            noteFocus('play-now');
          }}
          onPress={onPlayNow}
          style={[
            styles.button,
            styles.primary,
            novaTvFocus.base,
            focusedControl === 'play-now' && styles.buttonFocused,
            focusedControl === 'play-now' && novaTvFocus.active,
          ]}>
          <Text style={styles.primaryText}>
            Play Now
          </Text>
        </Pressable>
        <Pressable
          ref={bindCancelRef}
          collapsable={false}
          focusable
          accessibilityRole="button"
          accessibilityLabel="Cancel"
          {...(Platform.OS === 'android' && cancelFocusProps.nextFocusRight != null
            ? {
                nextFocusLeft: cancelFocusProps.nextFocusLeft ?? cancelFocusProps.nextFocusRight,
                nextFocusRight: cancelFocusProps.nextFocusRight,
                nextFocusUp: cancelFocusProps.nextFocusUp ?? cancelFocusProps.nextFocusRight,
                nextFocusDown: cancelFocusProps.nextFocusDown ?? cancelFocusProps.nextFocusRight,
              }
            : {})}
          onFocus={() => {
            if (!preferredConsumed) {
              setPreferredConsumed(true);
            }
            noteFocus('cancel');
          }}
          onPress={onCancel}
          style={[
            styles.button,
            styles.secondary,
            novaTvFocus.base,
            focusedControl === 'cancel' && styles.buttonFocused,
            focusedControl === 'cancel' && novaTvFocus.active,
          ]}>
          <Text style={styles.secondaryText}>
            Cancel
          </Text>
        </Pressable>
      </View>
    </FocusBoundaryView>
  );
}

const styles = StyleSheet.create({
  panel: {
    position: 'absolute',
    right: 36,
    bottom: 36,
    width: 420,
    borderRadius: 18,
    backgroundColor: 'rgba(8, 13, 25, 0.76)',
    borderWidth: 1,
    borderColor: NOVA_GLASS.subtle.borderColor,
    paddingHorizontal: 22,
    paddingVertical: 20,
    gap: 6,
    zIndex: 30,
    elevation: Platform.OS === 'android' ? 40 : 8,
  },
  kicker: {
    color: novaTheme.colors.textMuted,
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 1.4,
  },
  episode: {
    color: novaTheme.colors.accent,
    fontSize: 16,
    fontWeight: '700',
  },
  title: {
    color: novaTheme.colors.textPrimary,
    fontSize: 22,
    fontWeight: '700',
  },
  countdown: {
    color: novaTheme.colors.textSecondary,
    fontSize: 16,
    marginBottom: 8,
  },
  actions: {
    flexDirection: 'row',
    gap: 12,
  },
  button: {
    minWidth: 132,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    alignItems: 'center',
  },
  primary: {
    backgroundColor: NOVA_GLASS.active.backgroundColor,
    borderColor: NOVA_GLASS.active.borderColor,
  },
  secondary: {
    backgroundColor: NOVA_GLASS.subtle.backgroundColor,
    borderColor: NOVA_GLASS.subtle.borderColor,
  },
  buttonFocused: {
    backgroundColor: NOVA_GLASS.activeFocused.backgroundColor,
    borderColor: NOVA_GLASS.activeFocused.borderColor,
  },
  primaryText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  secondaryText: {
    color: novaTheme.colors.textPrimary,
    fontSize: 15,
    fontWeight: '600',
  },
});
