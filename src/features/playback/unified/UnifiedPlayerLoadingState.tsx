import { StyleSheet, Text, View } from 'react-native';

import { NovaSpaceLoader } from '@/components/nova/NovaSpaceLoader';
import { novaTheme } from '@/theme';

type UnifiedPlayerLoadingStateProps = {
  title?: string;
};

export function UnifiedPlayerLoadingState({ title }: UnifiedPlayerLoadingStateProps) {
  return (
    <View style={styles.container}>
      <NovaSpaceLoader label={title ? `Loading ${title}…` : 'Starting playback…'} />
      <Text style={styles.hint}>Buffering stream</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    gap: 10,
    zIndex: 4,
  },
  hint: {
    color: novaTheme.colors.textMuted,
    fontSize: 12,
    fontWeight: '600',
  },
});
