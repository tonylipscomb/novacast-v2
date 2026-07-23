import type { ElementRef } from 'react';
import { memo, useCallback, useMemo, useState } from 'react';
import { findNodeHandle, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { displayStreamTitle } from '@/features/series/metadata/titleNormalization';
import { useAppTheme } from '@/theme/AppThemeProvider';
import type { NovaTheme } from '@/theme/tokens';

import { LIVE_TV_NO_PROGRAM_LABEL, resolveLiveTvNowPlaying } from './liveTvProgramText';

import type { LiveTvChannelEpgData, LiveTvChannelRowShellData } from './liveTvChannelRowData';
import { notifyLiveTvChannelFocusMove } from './liveTvFocusIdle';
import { getLiveTvRowVisualFlags } from './liveTvUiPerfMode';
import { recordLiveTvChannelFocus, recordLiveTvChannelRowRender } from './liveTvScrollPerf';

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
  onFocus: (channelId: string) => void;
  onTune: (channelId: string) => void;
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
    previous.onFocus === next.onFocus &&
    previous.onTune === next.onTune &&
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
  onFocus,
  onTune,
  registerRef,
}: LiveTvChannelRowProps) {
  recordLiveTvChannelRowRender();
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [isFocused, setIsFocused] = useState(false);
  const [focusTrapHandle, setFocusTrapHandle] = useState<number | undefined>(undefined);

  const displayName = displayStreamTitle(data.name);
  const displayCurrent = resolveLiveTvNowPlaying(epg.current, data.name);
  const hasProgram = displayCurrent !== LIVE_TV_NO_PROGRAM_LABEL;
  const showSelected = rowVisualFlags.showSelectedHighlight && selected;
  const showPreviewing = rowVisualFlags.showPreviewingHighlight && previewing;

  const assignRef = useCallback(
    (instance: ElementRef<typeof View> | null) => {
      registerRef(data.id, instance);
      if (Platform.OS === 'android' && instance && (trapFocusUp || trapFocusDown)) {
        const handle = findNodeHandle(instance);
        setFocusTrapHandle(handle ?? undefined);
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
      onFocus={() => {
        setIsFocused(true);
        recordLiveTvChannelFocus();
        notifyLiveTvChannelFocusMove();
        onFocus(data.id);
      }}
      onBlur={() => setIsFocused(false)}
      onPress={() => onTune(data.id)}
      style={[
        styles.channelRow,
        showSelected && styles.selectedRow,
        showPreviewing && styles.previewingRow,
        isFocused && styles.channelRowFocused,
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
    </Pressable>
  );
}, channelRowPropsAreEqual);

function createStyles(theme: NovaTheme) {
  const lightFocus = theme.scheme === 'light';

  return StyleSheet.create({
    channelRow: {
      minHeight: 52,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.borderSubtle,
      borderWidth: 1,
      borderColor: 'transparent',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 7,
      paddingHorizontal: 7,
      paddingVertical: 4,
    },
    channelRowFocused: lightFocus
      ? {
          borderColor: theme.colors.focusRing,
          backgroundColor: theme.colors.surfaceFocused,
        }
      : {
          backgroundColor: 'transparent',
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
      shadowColor: theme.colors.success,
      shadowOpacity: 0.85,
      shadowRadius: 7,
    },
    focusRail: {
      backgroundColor: theme.colors.accentHover,
      shadowColor: theme.colors.accentHover,
      shadowOpacity: lightFocus ? 0 : 0.9,
      shadowRadius: lightFocus ? 0 : 9,
    },
    selectedText: {
      color: theme.colors.textPrimary,
    },
    focusedText: lightFocus
      ? {
          color: theme.colors.accent,
        }
      : {
          color: theme.colors.accentHover,
          textShadowColor: theme.colors.accentHover,
          textShadowOffset: { width: 0, height: 0 },
          textShadowRadius: 9,
        },
    focusedSecondaryText: {
      color: theme.colors.textPrimary,
    },
    channelCopy: {
      flex: 1,
      minWidth: 0,
      gap: 1,
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
      color: theme.colors.textMuted,
      fontSize: 10,
      fontWeight: '600',
      lineHeight: 13,
    },
    nowPlayingEmpty: {
      color: theme.colors.textMuted,
      fontStyle: 'italic',
      opacity: 0.72,
    },
    resolution: {
      color: theme.colors.accentHover,
      fontSize: 9,
      fontWeight: '900',
    },
    selectedRow: {
      backgroundColor: 'transparent',
    },
  });
}
