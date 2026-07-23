import { memo, useMemo } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';

import { useAppTheme } from '@/theme/AppThemeProvider';
import type { NovaTheme } from '@/theme/tokens';

import type { ProviderLiveChannel } from '@/features/providers/providerRepositories';
import { LiveGlassBadge } from './LiveGlassBadge';
import { displayLiveProgramText } from './liveTvProgramText';

const androidTextFit = Platform.OS === 'android' ? ({ includeFontPadding: false } as const) : {};

type LiveTvProgramDetailPanelProps = {
  channel: ProviderLiveChannel | null;
  previewWindow: string;
};

function panelPropsAreEqual(previous: LiveTvProgramDetailPanelProps, next: LiveTvProgramDetailPanelProps): boolean {
  if (previous.previewWindow !== next.previewWindow) {
    return false;
  }

  const prevChannel = previous.channel;
  const nextChannel = next.channel;

  if (prevChannel === nextChannel) {
    return true;
  }

  if (!prevChannel || !nextChannel || prevChannel.id !== nextChannel.id) {
    return false;
  }

  return (
    prevChannel.current === nextChannel.current &&
    prevChannel.currentStart === nextChannel.currentStart &&
    prevChannel.currentEnd === nextChannel.currentEnd &&
    prevChannel.remaining === nextChannel.remaining &&
    prevChannel.description === nextChannel.description
  );
}

export const LiveTvProgramDetailPanel = memo(function LiveTvProgramDetailPanel({
  channel,
  previewWindow,
}: LiveTvProgramDetailPanelProps) {
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const channelName = channel?.name ? displayLiveProgramText(channel.name, 'No channel selected') : 'No channel selected';
  const currentProgram = displayLiveProgramText(channel?.current, 'No program information available.');
  const description = displayLiveProgramText(channel?.description, 'No program information available.');

  return (
    <View style={styles.programInfo}>
      <View style={styles.programTopRow}>
        <View style={styles.programCopy}>
          <View style={styles.titleRow}>
            <Text numberOfLines={1} style={styles.previewChannelName}>
              {channelName}
            </Text>
            <LiveGlassBadge />
          </View>
          <Text numberOfLines={2} style={styles.previewProgram}>
            {currentProgram}
          </Text>
          <Text style={styles.previewWindow}>{previewWindow}</Text>
        </View>
      </View>
      <Text numberOfLines={2} style={styles.description}>
        {description}
      </Text>
    </View>
  );
}, panelPropsAreEqual);

function createStyles(theme: NovaTheme) {
  return StyleSheet.create({
    programInfo: {
      minHeight: 0,
      flexShrink: 1,
      gap: 10,
      paddingTop: 0,
      paddingBottom: 0,
    },
    programTopRow: {
      flexDirection: 'column',
      alignItems: 'stretch',
      gap: 8,
    },
    programCopy: {
      flex: 0,
      minWidth: 0,
      gap: 4,
    },
    titleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      minWidth: 0,
    },
    previewChannelName: {
      flex: 1,
      minWidth: 0,
      color: theme.colors.textPrimary,
      fontSize: 18,
      lineHeight: 24,
      fontWeight: '800',
      ...androidTextFit,
    },
    previewProgram: {
      color: theme.colors.textSecondary,
      fontSize: 13,
      lineHeight: 18,
      fontWeight: '600',
      ...androidTextFit,
    },
    previewWindow: {
      color: theme.colors.textMuted,
      fontSize: 12,
      lineHeight: 16,
      fontWeight: '700',
      ...androidTextFit,
    },
    description: {
      color: theme.colors.textSecondary,
      fontSize: 12,
      lineHeight: 18,
      ...androidTextFit,
    },
  });
}
