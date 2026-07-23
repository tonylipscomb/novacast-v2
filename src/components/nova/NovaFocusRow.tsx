import type { RefObject } from 'react';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { novaTvFocus } from '@/components/nova/novaTvFocus';
import { novaTheme } from '@/theme';

type NovaFocusRowProps = {
  title: string;
  subtitle?: string;
  meta?: string;
  focused?: boolean;
  emphasized?: boolean;
  onPress?: () => void;
  onFocus?: () => void;
  accessibilityLabel?: string;
  trailing?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  nextFocusUp?: number;
  nextFocusDown?: number;
  nextFocusLeft?: number;
  nativeRef?: RefObject<View | null>;
};

export function NovaFocusRow({
  title,
  subtitle,
  meta,
  focused = false,
  onPress,
  onFocus,
  accessibilityLabel,
  trailing,
  style,
  nextFocusUp,
  nextFocusDown,
  nextFocusLeft,
  nativeRef,
}: NovaFocusRowProps) {
  const [selfFocused, setSelfFocused] = useState(false);
  const showFocused = selfFocused;

  return (
    <Pressable
      ref={nativeRef}
      focusable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      onPress={onPress}
      onFocus={() => {
        setSelfFocused(true);
        onFocus?.();
      }}
      onBlur={() => setSelfFocused(false)}
      {...(nextFocusUp ? { nextFocusUp } : null)}
      {...(nextFocusDown ? { nextFocusDown } : null)}
      {...(nextFocusLeft ? { nextFocusLeft } : null)}
      style={[styles.row, novaTvFocus.base, showFocused && novaTvFocus.active, style]}>
      {meta ? (
        <Text style={[styles.meta, showFocused && styles.metaFocused]} numberOfLines={1}>
          {meta}
        </Text>
      ) : null}
      <View style={styles.copy}>
        <Text numberOfLines={1} style={[styles.title, showFocused && styles.titleFocused]}>
          {title}
        </Text>
        {subtitle ? (
          <Text numberOfLines={1} style={styles.subtitle}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {trailing}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: novaTheme.density.rowHeight,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 0,
    paddingHorizontal: 6,
    paddingVertical: 4,
    marginBottom: 2,
  },
  meta: {
    minWidth: 54,
    color: novaTheme.colors.textMuted,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  metaFocused: {
    color: novaTheme.colors.accentHover,
  },
  copy: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  title: {
    color: novaTheme.colors.textPrimary,
    fontSize: 15,
    fontWeight: '700',
  },
  titleFocused: {
    color: novaTheme.colors.textPrimary,
  },
  subtitle: {
    color: novaTheme.colors.textSecondary,
    fontSize: 12,
  },
});
