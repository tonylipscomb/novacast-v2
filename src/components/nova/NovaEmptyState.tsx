import { StyleSheet, Text, View } from 'react-native';

import { novaTheme } from '@/theme';

type NovaEmptyStateProps = {
  title: string;
  message: string;
};

export function NovaEmptyState({ title, message }: NovaEmptyStateProps) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.message}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: novaTheme.spacing.lg,
    borderRadius: novaTheme.radius.md,
    borderWidth: 1,
    borderColor: novaTheme.colors.borderSubtle,
    backgroundColor: novaTheme.colors.surface,
    gap: 8,
  },
  title: {
    color: novaTheme.colors.textPrimary,
    fontSize: novaTheme.typography.sectionTitle,
    fontWeight: '600',
  },
  message: {
    color: novaTheme.colors.textSecondary,
    fontSize: novaTheme.typography.cardBody,
  },
});
