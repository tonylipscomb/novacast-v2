import { StyleSheet, Text, View } from 'react-native';

import { novaTheme } from '@/theme';

type BadgeTone = 'neutral' | 'success' | 'warning';

type NovaStatusBadgeProps = {
  label: string;
  tone?: BadgeTone;
};

export function NovaStatusBadge({ label, tone = 'neutral' }: NovaStatusBadgeProps) {
  return (
    <View style={[styles.badge, tone === 'success' && styles.success, tone === 'warning' && styles.warning]}>
      <Text style={styles.text}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingHorizontal: novaTheme.spacing.sm,
    paddingVertical: 6,
    backgroundColor: '#253755',
  },
  success: {
    backgroundColor: '#1E4B44',
  },
  warning: {
    backgroundColor: '#5C4324',
  },
  text: {
    color: novaTheme.colors.textPrimary,
    fontSize: novaTheme.typography.meta,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
});
