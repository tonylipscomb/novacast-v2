import { StyleSheet, View } from 'react-native';

import { NOVA_FOCUS } from './novaGlassTheme';

/** Static directional glass edge for focused poster art. It never receives input. */
export function NovaPosterFocusOverlay() {
  return (
    <View pointerEvents="none" style={styles.frame}>
      <View style={styles.violetTop} />
      <View style={styles.violetLeft} />
      <View style={styles.cyanBottom} />
      <View style={styles.cyanRight} />
      <View style={styles.innerHighlight} />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    ...StyleSheet.absoluteFillObject,
    borderWidth: 1,
    borderColor: NOVA_FOCUS.poster.borderColor,
    borderRadius: 3,
    shadowColor: NOVA_FOCUS.poster.violetEdge,
    shadowOpacity: 0.45,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 0 },
  },
  violetTop: {
    position: 'absolute',
    top: -1,
    left: -1,
    right: '42%',
    height: 2,
    backgroundColor: NOVA_FOCUS.poster.violetEdge,
  },
  violetLeft: {
    position: 'absolute',
    top: -1,
    bottom: '38%',
    left: -1,
    width: 2,
    backgroundColor: NOVA_FOCUS.poster.violetEdge,
  },
  cyanBottom: {
    position: 'absolute',
    right: -1,
    bottom: -1,
    left: '42%',
    height: 2,
    backgroundColor: NOVA_FOCUS.poster.cyanEdge,
  },
  cyanRight: {
    position: 'absolute',
    top: '38%',
    right: -1,
    bottom: -1,
    width: 2,
    backgroundColor: NOVA_FOCUS.poster.cyanEdge,
  },
  innerHighlight: {
    ...StyleSheet.absoluteFillObject,
    borderWidth: 1,
    borderColor: NOVA_FOCUS.poster.innerHighlight,
    borderRadius: 1,
  },
});
