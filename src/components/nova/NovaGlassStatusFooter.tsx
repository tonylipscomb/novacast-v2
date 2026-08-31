import { memo, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { useAccessExpirationDisplay } from '@/features/device/betaAccessCountdown';
import { isClosedBetaManagedFlow } from '@/features/device/deviceFeatureFlags';
import { useDeviceState } from '@/features/device/deviceActivation';
import { useProviderChrome } from '@/features/providers/providerStore';
import { useAppTheme } from '@/theme/AppThemeProvider';

import type { GlassNavDensity } from './NovaGlassNavbar';
import { NOVA_GLASS } from './novaGlassTheme';

type NovaGlassStatusFooterProps = {
  density: GlassNavDensity;
  providerLabel?: string;
  expirationLabel?: string;
};

function formatClock(date: Date) {
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/** Isolated so the clock tick cannot reach the navbar tree. */
const FooterClock = memo(function FooterClock({
  style,
}: {
  style: { color?: string; fontSize?: number; fontWeight?: '600' | '700' | '800' | '900' };
}) {
  const [clock, setClock] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setClock(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);
  return <Text accessible={false} style={style}>{formatClock(clock)}</Text>;
});

const FooterBetaExpiration = memo(function FooterBetaExpiration({
  captionStyle,
  valueStyle,
}: {
  captionStyle: { color?: string; fontSize?: number; fontWeight?: '600' | '700' | '800' | '900'; textTransform?: 'uppercase'; letterSpacing?: number };
  valueStyle: { color?: string; fontSize?: number; fontWeight?: '600' | '700' | '800' | '900' };
}) {
  const { selectedProvider } = useProviderChrome();
  const accessExpiration = useAccessExpirationDisplay({
    provider: selectedProvider,
    account: selectedProvider?.account ?? null,
  });
  if (!accessExpiration.closedBeta || !accessExpiration.value) return null;
  return (
    <View style={styles.betaCluster} pointerEvents="none">
      <Text accessible={false} style={captionStyle}>{accessExpiration.caption}</Text>
      <Text accessible={false} style={valueStyle}>{accessExpiration.value}</Text>
    </View>
  );
});

/** Passive TV status HUD. Never focusable and never part of navbar focus ownership. */
export const NovaGlassStatusFooter = memo(function NovaGlassStatusFooter({
  density,
  providerLabel,
  expirationLabel,
}: NovaGlassStatusFooterProps) {
  const { theme } = useAppTheme();
  const { selectedProviderName, selectedProviderExpiration } = useProviderChrome();
  const device = useDeviceState();
  const resolvedProviderLabel = providerLabel ?? selectedProviderName;
  const nonBetaExpirationLabel = expirationLabel ?? selectedProviderExpiration;
  const publicDeviceId = device.status?.publicDeviceCode ?? device.identity?.publicDeviceCode ?? 'Unavailable';
  const compact = density === 'compact';

  return (
    <View
      pointerEvents="none"
      focusable={false}
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      collapsable={false}
      style={[styles.slot, compact && styles.slotCompact]}>
      <View style={styles.leftCluster}>
        <MaterialCommunityIcons name="wifi" size={compact ? 15 : 16} color={theme.colors.success} />
        {resolvedProviderLabel ? <Text numberOfLines={1} accessible={false} style={styles.provider}>{resolvedProviderLabel}</Text> : null}
      </View>

      <View style={[styles.deviceCapsule, compact && styles.deviceCapsuleCompact]}>
        <Text accessible={false} style={styles.deviceCaption}>DEVICE ID</Text>
        <Text numberOfLines={1} accessible={false} style={styles.deviceValue}>{publicDeviceId}</Text>
      </View>

      <View style={styles.centerCluster}>
        {isClosedBetaManagedFlow() ? (
          <FooterBetaExpiration captionStyle={styles.betaCaption} valueStyle={styles.betaValue} />
        ) : nonBetaExpirationLabel ? (
          <View style={styles.betaCluster} pointerEvents="none">
            <Text accessible={false} style={styles.betaCaption}>Expires</Text>
            <Text accessible={false} style={styles.betaValue}>{nonBetaExpirationLabel}</Text>
          </View>
        ) : null}
        <FooterClock style={styles.clock} />
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  slot: {
    width: '100%', minHeight: 44, flexShrink: 0, zIndex: 3, marginTop: 8, marginBottom: 2,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16,
  },
  slotCompact: { minHeight: 40, marginTop: 4, gap: 10 },
  leftCluster: { flex: 1, flexDirection: 'row', alignItems: 'center', minWidth: 0, gap: 7 },
  brand: { color: NOVA_GLASS.text.primary, fontSize: 13, fontWeight: '700', letterSpacing: 0.2 },
  provider: { color: NOVA_GLASS.text.muted, fontSize: 12, fontWeight: '600', maxWidth: 220, flexShrink: 1 },
  centerCluster: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', minWidth: 0, gap: 14 },
  betaCluster: { flexDirection: 'row', alignItems: 'baseline', gap: 7 },
  betaCaption: { color: 'rgba(51, 211, 154, 0.92)', fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.9 },
  betaValue: { color: NOVA_GLASS.text.primary, fontSize: 12, fontWeight: '700' },
  clock: { color: NOVA_GLASS.text.secondary, fontSize: 12, fontWeight: '700', flexShrink: 0 },
  deviceCapsule: { minHeight: 40, maxWidth: 250, flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 14, borderRadius: NOVA_GLASS.radius.subtle, backgroundColor: NOVA_GLASS.subtle.backgroundColor, borderWidth: 1, borderColor: NOVA_GLASS.subtle.borderColor },
  deviceCapsuleCompact: { minHeight: 36, paddingHorizontal: 11, gap: 7 },
  deviceCaption: { color: NOVA_GLASS.text.muted, fontSize: 9, fontWeight: '800', letterSpacing: 1 },
  deviceValue: { color: NOVA_GLASS.text.primary, fontSize: 14, fontWeight: '700', letterSpacing: 0.3, flexShrink: 1 },
});
