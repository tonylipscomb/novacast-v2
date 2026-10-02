import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useState, type RefObject } from 'react';
import type { ViewStyle } from 'react-native';

import { novaTvFocus } from '@/components/nova/novaTvFocus';
import { novaTheme } from '@/theme';

type NovaButtonProps = {
  label: string;
  onPress: () => void;
  hasTVPreferredFocus?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
  nativeRef?: RefObject<View | null>;
  nextFocusLeft?: number;
  nextFocusRight?: number;
  nextFocusUp?: number;
  nextFocusDown?: number;
  onFocus?: () => void;
  onBlur?: () => void;
};

export function NovaButton({
  label,
  onPress,
  hasTVPreferredFocus,
  disabled,
  style,
  nativeRef,
  nextFocusLeft,
  nextFocusRight,
  nextFocusUp,
  nextFocusDown,
  onFocus,
  onBlur,
}: NovaButtonProps) {
  const [isFocused, setIsFocused] = useState(false);

  return (
    <Pressable
      ref={nativeRef}
      collapsable={false}
      disabled={disabled}
      focusable
      hasTVPreferredFocus={hasTVPreferredFocus}
      onFocus={() => {
        setIsFocused(true);
        onFocus?.();
      }}
      onBlur={() => {
        setIsFocused(false);
        onBlur?.();
      }}
      onPress={onPress}
      {...(nextFocusLeft != null ? { nextFocusLeft } : null)}
      {...(nextFocusRight != null ? { nextFocusRight } : null)}
      {...(nextFocusUp != null ? { nextFocusUp } : null)}
      {...(nextFocusDown != null ? { nextFocusDown } : null)}
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
