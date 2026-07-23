import { Pressable, StyleSheet, Text } from 'react-native';
import { useState } from 'react';
import type { ViewStyle } from 'react-native';

import { novaTvFocus } from '@/components/nova/novaTvFocus';
import { novaTheme } from '@/theme';

type NovaButtonProps = {
  label: string;
  onPress: () => void;
  hasTVPreferredFocus?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
};

export function NovaButton({
  label,
  onPress,
  hasTVPreferredFocus,
  disabled,
  style,
}: NovaButtonProps) {
  const [isFocused, setIsFocused] = useState(false);

  return (
    <Pressable
      disabled={disabled}
      focusable
      hasTVPreferredFocus={hasTVPreferredFocus}
      onFocus={() => setIsFocused(true)}
      onBlur={() => setIsFocused(false)}
      onPress={onPress}
      style={[
        styles.button,
        novaTvFocus.base,
        isFocused && novaTvFocus.active,
        disabled && styles.disabled,
        style,
      ]}>
      <Text style={styles.text}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 60,
    minWidth: 280,
    borderRadius: 0,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: novaTheme.colors.surface,
  },
  disabled: {
    opacity: 0.6,
  },
  text: {
    color: novaTheme.colors.textPrimary,
    fontSize: novaTheme.typography.button,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
});
