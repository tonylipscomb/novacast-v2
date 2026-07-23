import { Image, ImageBackground, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { novaTvFocus } from '@/components/nova/novaTvFocus';
import { useDeviceState } from '@/features/device/deviceActivation';
import { novaTheme } from '@/theme';

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
  const remainingHours = device.status?.remainingBetaHours ?? 0;

  return (
    <ImageBackground source={backgroundAsset} resizeMode="cover" style={styles.screen}>
      <View pointerEvents="none" style={styles.overlay} />
      <View style={[styles.layout, { paddingHorizontal: 72 * scale, paddingVertical: 48 * scale }]}>
        <Image source={logoAsset} resizeMode="contain" style={{ width: 260 * scale, height: 196 * scale }} />
        <Text style={[styles.eyebrow, { fontSize: 18 * scale }]}>NOVACAST CLOSED BETA</Text>
        <Text style={[styles.title, { fontSize: 42 * scale }]}>Your beta invitation has expired</Text>
        <Text style={[styles.body, { fontSize: 18 * scale }]}>
          Your library stays on this TV, but access is paused until an administrator extends your invitation.
        </Text>

        <View style={styles.statRow}>
          <View style={styles.stat}>
            <Text style={styles.statLabel}>Remaining access</Text>
            <Text style={[styles.statValue, { fontSize: 28 * scale }]}>{remainingHours} Hours</Text>
          </View>
          <View style={styles.stat}>
            <Text style={styles.statLabel}>Expired at</Text>
            <Text style={[styles.statValue, { fontSize: 18 * scale }]}>
              {expiresAt ? new Date(expiresAt).toLocaleString() : 'Unknown'}
            </Text>
          </View>
        </View>

        <Text style={[styles.help, { fontSize: 16 * scale }]}>
          Contact your administrator for an extension (+24h, +72h, or +7 days).
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
    borderColor: 'rgba(131,180,255,0.28)',
    backgroundColor: 'rgba(8,18,38,0.72)',
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
    backgroundColor: 'rgba(59,130,246,0.28)',
    borderWidth: 1,
    borderColor: 'rgba(96,165,255,0.55)',
  },
  buttonText: {
    color: '#F5F8FF',
    fontWeight: '800',
    fontSize: 16,
  },
});
