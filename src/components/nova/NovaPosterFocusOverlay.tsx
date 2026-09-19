import { StyleSheet, View } from 'react-native';

import { NOVA_FOCUS } from './novaGlassTheme';

/** Minimal static outline for focused poster art. It never receives input. */
export function NovaPosterFocusOverlay() {
  return <View pointerEvents="none" style={styles.frame} />;
}

const styles = StyleSheet.create({
  frame: {
    ...StyleSheet.absoluteFillObject,
    borderWidth: 1,
    borderColor: NOVA_FOCUS.poster.borderColor,
    borderRadius: 3,
    shadowColor: NOVA_FOCUS.poster.violetEdge,
    shadowOpacity: 0.14,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 0 },
  },
});
