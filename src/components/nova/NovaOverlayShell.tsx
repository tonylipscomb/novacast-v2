import type { PropsWithChildren } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

/**
 * Static outer frame for major NovaCast overlays.
 *
 * This is deliberately presentation-only: it never participates in TV focus,
 * preferred focus, or input routing. The values mirror the established Live
 * Search frame so major overlays share one visual language.
 */
export function NovaOverlayShell({
  children,
  style,
}: PropsWithChildren<{ style?: StyleProp<ViewStyle> }>) {
  return (
    <View focusable={false} accessible={false} style={[styles.shell, style]}>
      {children}
    </View>
  );
}

export const NOVA_OVERLAY_SHELL = {
  backgroundColor: 'rgba(7, 9, 22, 0.88)',
  borderColor: 'rgba(130, 145, 220, 0.34)',
  borderRadius: 26,
  shadowColor: '#4c5cff',
  shadowOpacity: 0.22,
  shadowRadius: 18,
  shadowOffset: { width: 0, height: 8 },
  elevation: 12,
} as const;

const styles = StyleSheet.create({
  shell: {
    ...NOVA_OVERLAY_SHELL,
    borderWidth: 1,
    overflow: 'hidden',
  },
});
