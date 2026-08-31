import { Image, ImageBackground, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { novaTvFocus } from '@/components/nova/novaTvFocus';
import { formatBetaCountdown, getRemainingMs } from '@/features/device/betaAccessCountdown';
import { useDeviceState } from '@/features/device/deviceActivation';
import { novaTheme } from '@/theme';
import { NOVA_GLASS } from '@/components/nova/novaGlassTheme';

const backgroundAsset = require('@/assets/images/pairingbackground.png');
const logoAsset = require('@/assets/images/novacast-logo.png');

export function BetaExpiredScreen({
  expiresAt,
  onRefresh,
}: {
  expiresAt: string | null;
  onRefresh: () => void;
}) {
  const { width, height } = useWindowDimensions();
  const scale = Math.min(1, Math.max(0.72, Math.min(width / 1280, height / 720)));
  const device = useDeviceState();
  const remainingMs = getRemainingMs(expiresAt) ?? device.status?.remainingBetaMs ?? 0;
  const publicDeviceCode =
    device.status?.publicDeviceCode ?? device.identity?.publicDeviceCode ?? 'Unavailable';

  return (
    <ImageBackground source={backgroundAsset} resizeMode="cover" style={styles.screen}>
      <View pointerEvents="none" style={styles.overlay} />
      <View style={[styles.layout, styles.glassPanel, { paddingHorizontal: 72 * scale, paddingVertical: 48 * scale }]}>
        <Image source={logoAsset} resizeMode="contain" style={{ width: 260 * scale, height: 196 * scale }} />
        <Text style={[styles.eyebrow, { fontSize: 18 * scale }]}>NOVACAST CLOSED BETA</Text>
        <Text style={[styles.title, { fontSize: 42 * scale }]}>Your beta invitation has expired</Text>
        <Text style={[styles.body, { fontSize: 18 * scale }]}>
          Your library stays on this TV, but access is paused until an administrator extends your invitation.
        </Text>

        <View style={styles.statRow}>
          <View style={styles.stat}>
            <Text style={styles.statLabel}>Device ID</Text>
            <Text style={[styles.statValue, { fontSize: 28 * scale }]}>{publicDeviceCode}</Text>
          </View>
          <View style={styles.stat}>
            <Text style={styles.statLabel}>Countdown</Text>
            <Text style={[styles.statValue, { fontSize: 28 * scale }]}>
              {formatBetaCountdown(Math.max(0, remainingMs)) ?? '0:00:00'}
            </Text>
          </View>
        </View>

        <Text style={[styles.help, { fontSize: 16 * scale }]}>
          Give your Device ID to the administrator, then select Check for extension.
        </Text>

        <Pressable
          focusable
          hasTVPreferredFocus
          onPress={onRefresh}
          style={[styles.button, novaTvFocus.base, novaTvFocus.active]}>
          <Text style={styles.buttonText}>Check for extension</Text>
        </Pressable>
      </View>
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(2,6,17,0.62)' },
  layout: { flex: 1, justifyContent: 'center', maxWidth: 860 },
  glassPanel: {
    borderRadius: NOVA_GLASS.radius.base,
    borderWidth: 1,
    borderColor: NOVA_GLASS.focused.borderColor,
    backgroundColor: 'rgba(5,10,24,0.46)',
  },
  eyebrow: {
    marginTop: 8,
    color: novaTheme.colors.accentHover,
    fontWeight: '900',
    letterSpacing: 1.4,
  },
  title: {
    marginTop: 8,
    color: novaTheme.colors.textPrimary,
    fontWeight: '900',
  },
  body: {
    marginTop: 12,
    color: novaTheme.colors.textSecondary,
    lineHeight: 26,
    maxWidth: 640,
  },
  statRow: {
    flexDirection: 'row',
    gap: 24,
    marginTop: 28,
  },
  stat: {
    minWidth: 180,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: NOVA_GLASS.focused.borderColor,
    backgroundColor: NOVA_GLASS.focused.backgroundColor,
  },
  statLabel: {
    color: novaTheme.colors.textMuted,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  statValue: {
    marginTop: 8,
    color: novaTheme.colors.textPrimary,
    fontWeight: '900',
  },
  help: {
    marginTop: 22,
    color: novaTheme.colors.textSecondary,
  },
  button: {
    marginTop: 24,
    alignSelf: 'flex-start',
    paddingHorizontal: 22,
    paddingVertical: 12,
    borderRadius: NOVA_GLASS.radius.base,
    backgroundColor: NOVA_GLASS.activeFocused.backgroundColor,
    borderWidth: 1,
    borderColor: NOVA_GLASS.activeFocused.borderColor,
  },
  buttonText: {
    color: '#F5F8FF',
    fontWeight: '800',
    fontSize: 16,
  },
});
