import { StyleSheet, Text, View, ViewStyle } from 'react-native';

import { novaTheme } from '@/theme';

type NovaSectionTitleProps = {
  title: string;
  subtitle?: string;
  style?: ViewStyle;
};

export function NovaSectionTitle({ title, subtitle, style }: NovaSectionTitleProps) {
  return (
    <View style={style}>
      <Text style={styles.title}>{title}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  title: {
    color: novaTheme.colors.textPrimary,
    fontSize: novaTheme.typography.sectionTitle,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  subtitle: {
    color: novaTheme.colors.textSecondary,
    marginTop: 6,
    fontSize: novaTheme.typography.cardBody,
  },
});
