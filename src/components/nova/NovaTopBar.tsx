import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { NovaLogo } from '@/components/nova/NovaLogo';
import { novaTheme } from '@/theme';

type NovaTopBarProps = {
  title: string;
  providerLabel: string;
  onPressSettings?: () => void;
};

function formatClock(date: Date) {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function NovaTopBar({ title, providerLabel, onPressSettings }: NovaTopBarProps) {
  const [clock, setClock] = useState(() => new Date());
  const [settingsFocused, setSettingsFocused] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => setClock(new Date()), 15000);
    return () => clearInterval(timer);
  }, []);

  const clockLabel = useMemo(() => formatClock(clock), [clock]);

  return (
    <View style={styles.row}>
      <View style={styles.left}>
        <NovaLogo variant="compact" size="sm" />
      </View>

      <View style={styles.center}>
        <Text style={styles.title}>{title}</Text>
      </View>

      <View style={styles.right}>
        <Text style={styles.meta}>{clockLabel}</Text>
        <Text style={styles.meta}>{providerLabel}</Text>
        <Pressable
          focusable
          disabled={!onPressSettings}
          onFocus={() => setSettingsFocused(true)}
          onBlur={() => setSettingsFocused(false)}
          onPress={onPressSettings}
          style={[styles.settingsButton, settingsFocused && styles.settingsFocused]}>
          <Text style={styles.settingsText}>Settings</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: novaTheme.spacing.lg,
  },
  left: {
    minWidth: 230,
  },
  center: {
    flex: 1,
    alignItems: 'center',
  },
  right: {
    minWidth: 340,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: novaTheme.spacing.md,
  },
  title: {
    color: novaTheme.colors.textPrimary,
    fontSize: 34,
    fontWeight: '600',
    letterSpacing: 0.4,
  },
  meta: {
    color: novaTheme.colors.textSecondary,
    fontSize: novaTheme.typography.cardBody,
  },
  settingsButton: {
    borderRadius: novaTheme.radius.md,
    borderWidth: 1,
    borderColor: novaTheme.colors.borderSubtle,
    paddingVertical: 10,
    paddingHorizontal: 16,
    backgroundColor: novaTheme.colors.surface,
  },
  settingsFocused: {
    borderColor: novaTheme.colors.focusRing,
    backgroundColor: novaTheme.colors.surfaceMuted,
  },
  settingsText: {
    color: novaTheme.colors.textPrimary,
    fontSize: novaTheme.typography.cardBody,
    fontWeight: '600',
  },
});