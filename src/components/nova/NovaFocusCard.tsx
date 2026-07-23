import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useState } from 'react';

import { novaTheme } from '@/theme';

type NovaFocusCardProps = {
  icon: string;
  title: string;
  label: string;
  hasTVPreferredFocus?: boolean;
  onPress?: () => void;
};

export function NovaFocusCard({
  icon,
  title,
  label,
  hasTVPreferredFocus,
  onPress,
}: NovaFocusCardProps) {
  const [isFocused, setIsFocused] = useState(false);

  return (
    <Pressable
      focusable
      hasTVPreferredFocus={hasTVPreferredFocus}
      onFocus={() => setIsFocused(true)}
      onBlur={() => setIsFocused(false)}
      onPress={onPress}
      style={[styles.card, isFocused && styles.focused]}>
      <View style={styles.iconWrap}>
        <Text style={styles.iconText}>{icon}</Text>
      </View>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.label}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    width: 176,
    height: 220,
    borderRadius: novaTheme.radius.md,
    borderWidth: novaTheme.glow.borderWidth,
    borderColor: 'transparent',
    backgroundColor: novaTheme.colors.surface,
    padding: novaTheme.spacing.md,
    justifyContent: 'space-between',
  },
  focused: {
    borderColor: novaTheme.colors.focusRing,
    backgroundColor: novaTheme.colors.surfaceFocused,
    shadowColor: novaTheme.colors.focusRing,
    shadowOpacity: novaTheme.glow.focusShadowOpacity,
    shadowRadius: novaTheme.glow.focusShadowRadius,
  },
  iconWrap: {
    width: 66,
    height: 66,
    borderRadius: novaTheme.radius.sm,
    backgroundColor: '#233047',
    justifyContent: 'center',
    alignItems: 'center',
  },
  iconText: {
    color: novaTheme.colors.textPrimary,
    fontSize: 22,
    fontWeight: '700',
  },
  title: {
    color: novaTheme.colors.textPrimary,
    fontSize: novaTheme.typography.cardTitle,
    fontWeight: '700',
  },
  label: {
    color: novaTheme.colors.textSecondary,
    fontSize: novaTheme.typography.cardBody,
    lineHeight: 22,
  },
});
