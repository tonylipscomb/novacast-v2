import { StyleSheet, Text, View } from 'react-native';

import { NovaStatusBadge } from '@/components/nova/NovaStatusBadge';
import { novaTheme } from '@/theme';

type NovaQrPanelProps = {
  shortUrl: string;
  pairingCode: string;
  statusText: string;
  countdownLabel: string;
  connected: boolean;
};

export function NovaQrPanel({
  shortUrl,
  pairingCode,
  statusText,
  countdownLabel,
  connected,
}: NovaQrPanelProps) {
  return (
    <View style={styles.panel}>
      <View style={styles.qrPlaceholder}>
        <Text style={styles.qrLabel}>QR</Text>
      </View>

      <View style={styles.metaRow}>
        <Text style={styles.url}>{shortUrl}</Text>
        <Text style={styles.code}>{pairingCode}</Text>
      </View>

      <View style={styles.statusRow}>
        <NovaStatusBadge label={connected ? 'Connected' : 'Pending'} tone={connected ? 'success' : 'neutral'} />
        <Text style={styles.timer}>Expires in {countdownLabel}</Text>
      </View>

      <Text style={styles.statusText}>{statusText}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    width: 560,
    minHeight: 460,
    borderRadius: novaTheme.radius.lg,
    borderWidth: 1,
    borderColor: novaTheme.colors.borderSubtle,
    backgroundColor: novaTheme.colors.surface,
    padding: novaTheme.spacing.xl,
    gap: novaTheme.spacing.md,
  },
  qrPlaceholder: {
    width: 260,
    height: 260,
    alignSelf: 'center',
    borderRadius: novaTheme.radius.md,
    borderWidth: 1,
    borderColor: novaTheme.colors.borderSubtle,
    backgroundColor: '#0D162A',
    justifyContent: 'center',
    alignItems: 'center',
  },
  qrLabel: {
    color: novaTheme.colors.textSecondary,
    fontSize: 36,
    fontWeight: '600',
    letterSpacing: 1,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  url: {
    color: novaTheme.colors.textPrimary,
    fontSize: 28,
    fontWeight: '500',
  },
  code: {
    color: novaTheme.colors.accent,
    fontSize: novaTheme.typography.code,
    fontWeight: '700',
    letterSpacing: 4,
  },
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  timer: {
    color: novaTheme.colors.textSecondary,
    fontSize: novaTheme.typography.cardBody,
  },
  statusText: {
    color: novaTheme.colors.textSecondary,
    fontSize: 20,
  },
});
