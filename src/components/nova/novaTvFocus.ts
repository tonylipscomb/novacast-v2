import { StyleSheet } from 'react-native';

import { novaTheme } from '@/theme';

/** Static TV focus chrome — sharp box, minimal padding. */
export const novaTvFocus = StyleSheet.create({
  base: {
    borderWidth: novaTheme.glow.borderWidth,
    borderColor: 'transparent',
    borderRadius: 0,
  },
  active: {
    borderColor: novaTheme.colors.focusRing,
    backgroundColor: novaTheme.colors.surfaceFocused,
    shadowColor: novaTheme.colors.focusRing,
    shadowOpacity: novaTheme.glow.focusShadowOpacity * 0.65,
    shadowRadius: 6,
    borderRadius: 0,
  },
});
