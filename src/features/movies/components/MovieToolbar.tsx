import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { createNovaTvFocusChrome, createNovaTvFocusTextStyles } from '@/components/nova/novaTvFocus';
import { useAppTheme } from '@/theme/AppThemeProvider';
import type { NovaTheme } from '@/theme/tokens';

type MovieToolbarProps = {
  onSearchPress: () => void;
  /** Stage 3D.1: disable Search preferred/native focus during detail close stabilization. */
  focusable?: boolean;
};

export function MovieToolbar({ onSearchPress, focusable = true }: MovieToolbarProps) {
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const focusChrome = useMemo(() => createNovaTvFocusChrome(theme), [theme]);
  const [focused, setFocused] = useState(false);

  return (
    <View style={styles.toolbar}>
      <Pressable
        focusable={focusable}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onPress={onSearchPress}
        {...(Platform.isTV ? ({ onClick: onSearchPress } as object) : null)}
        style={[styles.actionButton, focusChrome.base, focused && focusChrome.active]}>
        <MaterialCommunityIcons name="magnify" size={18} color={theme.colors.textPrimary} />
        <Text style={[styles.actionText, focused && styles.actionTextFocused]}>Search</Text>
      </Pressable>
    </View>
  );
}

function createStyles(theme: NovaTheme) {
  const focusText = createNovaTvFocusTextStyles(theme);
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
      backgroundColor: 'transparent',
      paddingHorizontal: 8,
      paddingVertical: 6,
    },
    actionText: {
      color: theme.colors.textPrimary,
      fontSize: 12,
      fontWeight: '800',
    },
    actionTextFocused: focusText.title,
  });
}
