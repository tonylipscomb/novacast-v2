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
    // Keep the loader centered in the video area, above the bottom control
    // glass instead of placing it behind the play/pause button.
    bottom: 116,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
    // Above the control chrome so the loader remains visible while the player
    // is resolving its source instead of being hidden behind the play button.
    zIndex: 4,
    elevation: 4,
  },
});
