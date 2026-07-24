import { StyleSheet, View } from 'react-native';

import { NovaSpaceLoader } from '@/components/nova/NovaSpaceLoader';

type UnifiedPlayerLoadingStateProps = {
  title?: string;
};

/** Centered compact spaceship pulse — no label, no energy bar, no dim panel. */
export function UnifiedPlayerLoadingState({ title }: UnifiedPlayerLoadingStateProps) {
  const label = title ? `Loading ${title}` : 'Starting playback';

  return (
    <View style={styles.container} pointerEvents="none" accessibilityLabel={label}>
      <NovaSpaceLoader label={label} variant="badge" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
    // Below control chrome (zIndex 3) so the badge never covers title / seek UI.
    zIndex: 2,
  },
});
