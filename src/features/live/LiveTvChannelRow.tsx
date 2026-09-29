import type { ElementRef } from 'react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DeviceEventEmitter, findNodeHandle, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { displayStreamTitle } from '@/features/series/metadata/titleNormalization';
import { novaTvFocus, createNovaTvFocusTextStyles, createNovaTvFocusChrome } from '@/components/nova/novaTvFocus';
import { NOVA_GLASS } from '@/components/nova/novaGlassTheme';
import { useAppTheme } from '@/theme/AppThemeProvider';
import type { NovaTheme } from '@/theme/tokens';

import { LIVE_TV_NO_PROGRAM_LABEL, resolveLiveTvNowPlaying } from './liveTvProgramText';

import type { LiveTvChannelEpgData, LiveTvChannelRowShellData } from './liveTvChannelRowData';
import { notifyLiveTvChannelFocusMove } from './liveTvFocusIdle';
import { getLiveTvRowVisualFlags } from './liveTvUiPerfMode';
import { recordLiveTvChannelFocus, recordLiveTvChannelRowRender } from './liveTvScrollPerf';
import { createFavoriteHoldDetector } from './liveFavoriteHold';
import { getAnalyticsCurrentRoute } from '@/features/analytics/novaAnalytics';
import { recordDiagnostic } from '@/features/diagnostics/diagnosticsClient';

const rowVisualFlags = getLiveTvRowVisualFlags();

export type LiveTvChannelRowProps = {
  data: LiveTvChannelRowShellData;
  epg: LiveTvChannelEpgData;
  selected: boolean;
  previewing: boolean;
  preferFocus: boolean;
  trapFocusUp: boolean;
  trapFocusDown: boolean;
  nextFocusLeft?: number;
  nextFocusRight?: number;
  onFocus: (channelId: string) => void;
  onTune: (channelId: string) => void;
  isFavorite: boolean;
  onFavorite: (channelId: string) => void;
  onPlay: (channelId: string) => void;
  playEnabled: boolean;
  registerFavoriteActionRef?: (channelId: string, instance: ElementRef<typeof View> | null) => void;
  registerPlayActionRef?: (channelId: string, instance: ElementRef<typeof View> | null) => void;
  registerRef: (channelId: string, instance: ElementRef<typeof View> | null) => void;
};

function channelRowPropsAreEqual(previous: LiveTvChannelRowProps, next: LiveTvChannelRowProps): boolean {
  return (
    previous.data === next.data &&
    previous.epg === next.epg &&
    previous.selected === next.selected &&
    previous.previewing === next.previewing &&
    previous.preferFocus === next.preferFocus &&
    previous.trapFocusUp === next.trapFocusUp &&
    previous.trapFocusDown === next.trapFocusDown &&
    previous.nextFocusLeft === next.nextFocusLeft &&
    previous.nextFocusRight === next.nextFocusRight &&
    previous.onFocus === next.onFocus &&
    previous.onTune === next.onTune &&
    previous.isFavorite === next.isFavorite &&
    previous.onFavorite === next.onFavorite &&
    previous.onPlay === next.onPlay &&
    previous.playEnabled === next.playEnabled &&
    previous.registerFavoriteActionRef === next.registerFavoriteActionRef &&
    previous.registerPlayActionRef === next.registerPlayActionRef &&
    previous.registerRef === next.registerRef
  );
}

export const LiveTvChannelRow = memo(function LiveTvChannelRow({
  data,
  epg,
  selected,
  previewing,
  preferFocus,
  trapFocusUp,
  trapFocusDown,
  nextFocusLeft,
  nextFocusRight,
  onFocus,
  onTune,
  isFavorite,
  onFavorite,
  onPlay,
  playEnabled,
  registerFavoriteActionRef,
  registerPlayActionRef,
  registerRef,
}: LiveTvChannelRowProps) {
  recordLiveTvChannelRowRender();
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [isFocused, setIsFocused] = useState(false);
  const [focusedAction, setFocusedAction] = useState<'favorite' | 'play' | null>(null);
  const longPressHandledRef = useRef(false);
  const isFocusedRef = useRef(false);
  const focusedActionRef = useRef<'favorite' | 'play' | null>(null);
  const isTvRow = Platform.OS === 'android' && Platform.isTV;
  const favoriteHoldRef = useRef<ReturnType<typeof createFavoriteHoldDetector> | null>(null);
  const emitFavoriteHoldDiagnostic = useCallback((eventType: 'favorite_hold_started' | 'favorite_hold_triggered' | 'favorite_hold_cancelled', result: { reason: string; durationMs: number; thresholdMs: number; measuredHoldMs: number; keyCode?: number; suppressionArmed: boolean }, keyEventType: string) => {
    recordDiagnostic({
      eventType,
      contentType: 'live',
      contentId: data.id,
      contentTitle: displayStreamTitle(data.name),
      metadata: {
        key_event_type: keyEventType,
        hold_duration_ms: result.durationMs,
        threshold_ms: result.thresholdMs,
        measured_hold_ms: result.measuredHoldMs,
        key_code: result.keyCode ?? null,
        suppression_armed: result.suppressionArmed,
        focused_state: isFocusedRef.current,
        route: getAnalyticsCurrentRoute(),
        reason: result.reason,
      },
    });
  }, [data.id, data.name]);
  const onFavoriteRef = useRef(onFavorite);
  onFavoriteRef.current = onFavorite;
  if (!favoriteHoldRef.current) {
    favoriteHoldRef.current = createFavoriteHoldDetector({
      onStarted: (result) => {
        emitFavoriteHoldDiagnostic('favorite_hold_started', result, result.reason);
      },
      onTriggered: (result) => {
        longPressHandledRef.current = true;
        emitFavoriteHoldDiagnostic('favorite_hold_triggered', result, result.reason);
        onFavoriteRef.current(data.id);
      },
      onCancelled: (result) => {
        emitFavoriteHoldDiagnostic('favorite_hold_cancelled', result, result.reason);
      },
    });
  }
  const handleNativeFavoriteTvKey = useCallback((event: { keyCode?: number; action?: number; repeatCount?: number; eventTime?: number; downTime?: number; longPress?: boolean; deviceId?: number; source?: number }) => {
    if (!isTvRow || !isFocusedRef.current || event.keyCode !== 23) return;
    console.info('[NovaCast Native TV Key]', {
      keyCode: event.keyCode ?? null,
      action: event.action ?? null,
      repeatCount: event.repeatCount ?? null,
      eventTime: event.eventTime ?? null,
      downTime: event.downTime ?? null,
      longPress: event.longPress ?? false,
      deviceId: event.deviceId ?? null,
      source: event.source ?? null,
      focusedContentId: data.id,
    });
    if (focusedActionRef.current !== null) return;
    favoriteHoldRef.current?.handleEvent({ keyCode: event.keyCode, eventKeyAction: event.action });
  }, [data.id, isTvRow]);
  useEffect(() => {
    if (!isTvRow) return;
    const subscription = DeviceEventEmitter.addListener('onNovaCastNativeTvKey', handleNativeFavoriteTvKey);
    return () => subscription.remove();
  }, [handleNativeFavoriteTvKey, isTvRow]);
  useEffect(() => {
    return () => {
      favoriteHoldRef.current?.cancel('unmount');
    };
  }, []);
  // Edge trap handles must be in state so nextFocus* props update after layout.
  const [focusTrapHandle, setFocusTrapHandle] = useState<number | undefined>(undefined);

  const displayName = displayStreamTitle(data.name);
  const displayCurrent = resolveLiveTvNowPlaying(epg.current, data.name);
  const hasProgram = displayCurrent !== LIVE_TV_NO_PROGRAM_LABEL;
  const showSelected = rowVisualFlags.showSelectedHighlight && selected;
  const showPreviewing = rowVisualFlags.showPreviewingHighlight && previewing;
  const showRowActions = isFocused || selected;

  const assignRef = useCallback(
    (instance: ElementRef<typeof View> | null) => {
      registerRef(data.id, instance);
      if (Platform.OS === 'android' && instance && (trapFocusUp || trapFocusDown)) {
        const handle = findNodeHandle(instance) ?? undefined;
        setFocusTrapHandle((current) => (current === handle ? current : handle));
      } else if (!instance) {
        setFocusTrapHandle((current) => (current === undefined ? current : undefined));
      }
    },
    [data.id, registerRef, trapFocusDown, trapFocusUp],
  );

  return (
    <Pressable
      ref={assignRef}
      focusable
      hasTVPreferredFocus={preferFocus}
      {...(trapFocusUp && focusTrapHandle ? { nextFocusUp: focusTrapHandle } : null)}
      {...(trapFocusDown && focusTrapHandle ? { nextFocusDown: focusTrapHandle } : null)}
      {...(Platform.OS === 'android' && nextFocusLeft ? { nextFocusLeft } : null)}
      {...(Platform.OS === 'android' && nextFocusRight ? { nextFocusRight } : null)}
      onFocus={() => {
        isFocusedRef.current = true;
        setIsFocused(true);
        recordLiveTvChannelFocus();
        notifyLiveTvChannelFocusMove();
        onFocus(data.id);
      }}
      onBlur={() => {
        isFocusedRef.current = false;
        focusedActionRef.current = null;
        setFocusedAction(null);
        favoriteHoldRef.current?.cancel('focus_lost');
        setIsFocused(false);
      }}
      onLongPress={() => {
        if (isTvRow) return;
        longPressHandledRef.current = true;
        onFavorite(data.id);
      }}
      delayLongPress={650}
      accessibilityHint="Hold select to add or remove this channel from favorites"
      onPressIn={() => {
        longPressHandledRef.current = false;
      }}
      onPress={() => {
        if (longPressHandledRef.current || favoriteHoldRef.current?.consumeSuppressedPress()) {
          longPressHandledRef.current = false;
          return;
        }
        onTune(data.id);
      }}
      style={[
        styles.channelRow,
        showSelected && styles.selectedRow,
        showPreviewing && styles.previewingRow,
        isFocused && (selected ? styles.channelRowActiveFocused : styles.channelRowFocused),
      ]}>
      <View style={[styles.channelRail, selected && styles.selectedRail, isFocused && styles.focusRail]} />
      <Text style={[styles.channelNumber, selected && styles.selectedText, isFocused && styles.focusedText]}>{data.number}</Text>
      <View style={styles.channelCopy}>
        <View style={styles.channelTitleRow}>
          <Text numberOfLines={1} style={[styles.channelName, selected && styles.selectedText, isFocused && styles.focusedText]}>
            {displayName}
          </Text>
          {rowVisualFlags.showResolution ? <Text style={styles.resolution}>{data.resolution}</Text> : null}
        </View>
        <Text
          numberOfLines={1}
          style={[styles.nowPlaying, hasProgram && isFocused && styles.focusedSecondaryText, !hasProgram && styles.nowPlayingEmpty]}>
          {displayCurrent}
        </Text>
      </View>
      {showRowActions ? (
        <View style={styles.rowActions}>
          <Pressable
            ref={(instance) => registerFavoriteActionRef?.(data.id, instance)}
            focusable
            accessibilityRole="button"
            accessibilityLabel={isFavorite ? 'Favorited' : 'Favorite'}
            onFocus={() => {
              focusedActionRef.current = 'favorite';
              setFocusedAction('favorite');
            }}
            onBlur={() => {
              focusedActionRef.current = null;
              setFocusedAction(null);
            }}
            onPress={() => onFavorite(data.id)}
            style={[styles.rowAction, novaTvFocus.base, focusedAction === 'favorite' && novaTvFocus.active]}>
            <MaterialCommunityIcons name={isFavorite ? 'heart' : 'heart-outline'} size={20} color={theme.colors.textPrimary} />
          </Pressable>
          <Pressable
            ref={(instance) => registerPlayActionRef?.(data.id, instance)}
            focusable={playEnabled}
            accessibilityRole="button"
            accessibilityLabel="Play channel"
            onFocus={() => setFocusedAction('play')}
            onBlur={() => setFocusedAction(null)}
            onPress={() => onPlay(data.id)}
            style={[styles.rowAction, novaTvFocus.base, focusedAction === 'play' && novaTvFocus.active, !playEnabled && styles.rowActionDisabled]}>
            <MaterialCommunityIcons name="play" size={20} color={theme.colors.textPrimary} />
          </Pressable>
        </View>
      ) : null}
    </Pressable>
  );
}, channelRowPropsAreEqual);

function createStyles(theme: NovaTheme) {
  const focusText = createNovaTvFocusTextStyles(theme);
  const focusChrome = createNovaTvFocusChrome(theme);

  return StyleSheet.create({
    channelRow: {
      minHeight: 52,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 7,
      paddingHorizontal: 7,
      paddingVertical: 4,
      ...focusChrome.base,
    },
    channelRowFocused: {
      borderWidth: 1,
      backgroundColor: NOVA_GLASS.focused.backgroundColor,
      borderColor: NOVA_GLASS.focused.borderColor,
      borderRadius: NOVA_GLASS.radius.base,
    },
    channelRowActiveFocused: {
      borderWidth: 1,
      backgroundColor: NOVA_GLASS.activeFocused.backgroundColor,
      borderColor: NOVA_GLASS.activeFocused.borderColor,
      borderRadius: NOVA_GLASS.radius.base,
    },
    previewingRow: {
      backgroundColor: 'transparent',
    },
    channelNumber: {
      width: 24,
      color: theme.colors.textMuted,
      fontSize: 12,
      textAlign: 'center',
    },
    channelRail: {
      width: 3,
      height: 25,
      backgroundColor: 'transparent',
    },
    selectedRail: {
      backgroundColor: theme.colors.success,
    },
    focusRail: {
      // Glass box carries focus; keep rail slot for layout only.
      backgroundColor: 'transparent',
    },
    selectedText: {
      color: theme.colors.textPrimary,
    },
    focusedText: focusText.title,
    focusedSecondaryText: focusText.secondary,
    channelCopy: {
      flex: 1,
      minWidth: 0,
      gap: 1,
    },
    rowActions: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      marginLeft: 4,
    },
    rowAction: {
      width: 34,
      height: 34,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'transparent',
      borderRadius: 10,
    },
    rowActionDisabled: {
      opacity: 0.35,
    },
    channelTitleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    channelName: {
      flex: 1,
      minWidth: 0,
      color: theme.colors.textPrimary,
      fontSize: 14,
      fontWeight: '800',
    },
    nowPlaying: {
      color: '#B8C6DD',
      fontSize: 10,
      fontWeight: '600',
      lineHeight: 13,
    },
    nowPlayingEmpty: {
      color: '#AEBBD0',
      fontStyle: 'italic',
      opacity: 0.92,
    },
    resolution: {
      color: theme.colors.textSecondary,
      fontSize: 9,
      fontWeight: '900',
    },
    selectedRow: {
      backgroundColor: 'transparent',
    },
  });
}
