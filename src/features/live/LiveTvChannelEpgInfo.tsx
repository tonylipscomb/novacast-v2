import { memo, useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useAppTheme } from '@/theme/AppThemeProvider';
import type { NovaTheme } from '@/theme/tokens';

import { recordLiveTvEpgChildRender } from './liveTvScrollPerf';

export type LiveTvChannelEpgInfoProps = {
  current: string;
  progress: number;
  showProgress: boolean;
};

function epgPropsAreEqual(previous: LiveTvChannelEpgInfoProps, next: LiveTvChannelEpgInfoProps): boolean {
  return (
    previous.current === next.current &&
    previous.progress === next.progress &&
    previous.showProgress === next.showProgress
  );
}

export const LiveTvChannelEpgInfo = memo(function LiveTvChannelEpgInfo({
  current,
  progress,
  showProgress,
}: LiveTvChannelEpgInfoProps) {
  recordLiveTvEpgChildRender();
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  return (
    <>
      <Text numberOfLines={1} style={styles.nowPlaying}>
        {current}
      </Text>
      {showProgress ? (
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${progress}%` }]} />
        </View>
      ) : (
        <View style={styles.progressSpacer} />
      )}
    </>
  );
}, epgPropsAreEqual);

function createStyles(theme: NovaTheme) {
  return StyleSheet.create({
    nowPlaying: {
      marginTop: 2,
      color: theme.colors.textSecondary,
      fontSize: 11,
    },
    progressTrack: {
      height: 3,
      marginTop: 5,
      borderRadius: 999,
      backgroundColor: theme.colors.borderSubtle,
    },
    progressFill: {
      height: '100%',
      borderRadius: 999,
      backgroundColor: theme.colors.accent,
    },
    progressSpacer: {
      height: 3,
      marginTop: 5,
    },
  });
}
