import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { novaTvFocus } from '@/components/nova/novaTvFocus';
import { useAppTheme } from '@/theme/AppThemeProvider';
import type { NovaTheme } from '@/theme/tokens';

type MovieToolbarProps = {
  onSearchPress: () => void;
};

export function MovieToolbar({ onSearchPress }: MovieToolbarProps) {
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [focused, setFocused] = useState(false);

  return (
    <View style={styles.toolbar}>
      <Pressable
        focusable
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onPress={onSearchPress}
        {...(Platform.isTV ? ({ onClick: onSearchPress } as object) : null)}
        style={[styles.actionButton, novaTvFocus.base, focused && styles.actionButtonFocused]}>
        <MaterialCommunityIcons
          name="magnify"
          size={18}
          color={
            focused
              ? theme.scheme === 'light'
                ? theme.colors.accent
                : theme.colors.accentHover
              : theme.colors.textPrimary
          }
        />
        <Text style={[styles.actionText, focused && styles.actionTextFocused]}>Search</Text>
      </Pressable>
    </View>
  );
}

function createStyles(theme: NovaTheme) {
  return StyleSheet.create({
    toolbar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    actionButton: {
      minHeight: 38,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 7,
      borderRadius: 0,
      borderWidth: 1,
      borderColor: 'transparent',
      backgroundColor: 'transparent',
      paddingHorizontal: 8,
      paddingVertical: 6,
    },
    actionButtonFocused:
      theme.scheme === 'light'
        ? {
            borderColor: theme.colors.focusRing,
            backgroundColor: theme.colors.surfaceFocused,
          }
        : {
            shadowColor: theme.colors.focusRing,
            shadowOpacity: theme.glow.focusShadowOpacity * 0.65,
            shadowRadius: 7,
          },
    actionText: {
      color: theme.colors.textPrimary,
      fontSize: 12,
      fontWeight: '800',
    },
    actionTextFocused:
      theme.scheme === 'light'
        ? {
            color: theme.colors.accent,
          }
        : {
            color: theme.colors.accentHover,
            textShadowColor: theme.colors.focusRing,
            textShadowRadius: 8,
          },
  });
}
