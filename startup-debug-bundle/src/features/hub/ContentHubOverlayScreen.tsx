import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  BackHandler,
  ImageBackground,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import { NovaLogo } from '@/components/nova/NovaLogo';
import { createTvNavigationGate, tryAcquireTvNavigationGate } from '@/features/navigation/tvNavigation';
import { useAppNotification } from '@/features/notifications/useAppNotification';
import { markOnboardingGuideSeen } from '@/features/onboarding/onboardingStore';
import { type ProviderRecord, type ProviderStatus } from '@/features/providers/providerModel';
import { formatProviderExpirationLabel } from '@/features/providers/providerExpiration';
import { selectProvider, useProviderStore } from '@/features/providers/providerStore';
import { novaTheme } from '@/theme';

import {
  CONTENT_HUB_NOTIFICATION_DURATION_MS,
  CONTENT_HUB_SWITCH_NOTIFICATION_ID,
  resolveContentHubProviderSwitchNotification,
} from './contentHubScreenLogic';

type IconName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

const splashArtwork = require('../../../splash.png');

const PROVIDER_VISUALS: Record<string, { icon: IconName; accent: string }> = {
  'demo-provider': { icon: 'television-play', accent: '#8B5CF6' },
  'family-tv': { icon: 'account-group', accent: '#3B82F6' },
  'backup-iptv': { icon: 'television-classic', accent: '#F5A623' },
};

const FALLBACK_VISUAL = { icon: 'television' as IconName, accent: novaTheme.colors.accent };

function getProviderVisual(id: string) {
  return PROVIDER_VISUALS[id] ?? FALLBACK_VISUAL;
}

function getStatusMeta(status: ProviderStatus) {
  if (status === 'active') {
    return { label: 'Active', dot: novaTheme.colors.success, expiryPrefix: 'Expires' };
  }
  if (status === 'expired') {
    return { label: 'Inactive', dot: novaTheme.colors.textMuted, expiryPrefix: 'Expired' };
  }
  if (status === 'unknown') {
    return { label: 'Unknown', dot: novaTheme.colors.textMuted, expiryPrefix: 'Expires' };
  }
  return { label: 'Offline', dot: novaTheme.colors.textMuted, expiryPrefix: 'Expires' };
}

function getDaysRemainingLabel(expirationAt: number | null | undefined, status: ProviderStatus) {
  if (status === 'expired') {
    return 'Subscription expired';
  }

  if (!expirationAt) {
    return null;
  }

  const expiry = new Date(expirationAt);
  if (Number.isNaN(expiry.getTime())) {
    return null;
  }

  const diffMs = expiry.getTime() - Date.now();
  const days = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

  if (days <= 0) {
    return 'Expires today';
  }

  return `${days} ${days === 1 ? 'day' : 'days'} remaining`;
}

export function ContentHubOverlayScreen() {
  const router = useRouter();
  const navigationGateRef = useRef(createTvNavigationGate());
  const switchRetryAttemptedRef = useRef(false);
  const lastRetryAtRef = useRef(0);
  const { providers, selectedProvider, providerSwitchError, isSwitchingProvider } = useProviderStore();
  const { showNotification, dismissNotification, clearScope } = useAppNotification();
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [retryProviderId, setRetryProviderId] = useState<string | null>(null);
  const [enterAnim] = useState(() => new Animated.Value(0));

  useEffect(() => {
    Animated.timing(enterAnim, {
      toValue: 1,
      duration: 220,
      useNativeDriver: true,
    }).start();
  }, [enterAnim]);

  useEffect(() => {
    if (Platform.OS !== 'android') {
      return;
    }

    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!tryAcquireTvNavigationGate(navigationGateRef.current)) {
        return true;
      }

      void (async () => {
        await markOnboardingGuideSeen('hubGuideSeen');
        router.replace('/main-menu');
      })();
      return true;
    });

    return () => subscription.remove();
  }, [router]);

  const goHome = async () => {
    if (!tryAcquireTvNavigationGate(navigationGateRef.current)) {
      return;
    }

    await markOnboardingGuideSeen('hubGuideSeen');
    router.replace('/main-menu');
  };

  const activateProvider = useCallback(async (providerId: string) => {
    if (!tryAcquireTvNavigationGate(navigationGateRef.current)) {
      return;
    }

    try {
      await selectProvider(providerId);
      switchRetryAttemptedRef.current = false;
      setRetryProviderId(null);
      await markOnboardingGuideSeen('hubGuideSeen');
      router.replace('/main-menu');
    } catch {
      setRetryProviderId(providerId);
    }
  }, [router]);

  const handleSwitchRetry = useCallback(() => {
    const now = Date.now();
    if (!retryProviderId || now - lastRetryAtRef.current < 400) {
      return;
    }

    lastRetryAtRef.current = now;
    switchRetryAttemptedRef.current = true;
    void activateProvider(retryProviderId);
  }, [activateProvider, retryProviderId]);

  useEffect(() => {
    if (isSwitchingProvider || !providerSwitchError) {
      dismissNotification(CONTENT_HUB_SWITCH_NOTIFICATION_ID);
      return;
    }

    const spec = resolveContentHubProviderSwitchNotification(
      providerSwitchError,
      switchRetryAttemptedRef.current,
    );
    if (!spec) {
      dismissNotification(CONTENT_HUB_SWITCH_NOTIFICATION_ID);
      return;
    }

    showNotification({
      id: CONTENT_HUB_SWITCH_NOTIFICATION_ID,
      type: 'error',
      title: spec.title,
      message: spec.message,
      actionLabel: retryProviderId ? 'Retry' : undefined,
      onAction: retryProviderId ? handleSwitchRetry : undefined,
      duration: CONTENT_HUB_NOTIFICATION_DURATION_MS,
      persistent: spec.persistent,
      position: 'bottom-right',
      scope: 'content-hub',
    });
  }, [
    dismissNotification,
    handleSwitchRetry,
    isSwitchingProvider,
    providerSwitchError,
    retryProviderId,
    showNotification,
  ]);

  useEffect(() => {
    if (!providerSwitchError) {
      switchRetryAttemptedRef.current = false;
    }
  }, [providerSwitchError]);

  useEffect(() => {
    return () => {
      clearScope('content-hub');
    };
  }, [clearScope]);

  const openPairing = () => {
    if (!tryAcquireTvNavigationGate(navigationGateRef.current)) {
      return;
    }

    void markOnboardingGuideSeen('hubGuideSeen');
    router.push('/pair');
  };

  const openSettings = () => {
    if (!tryAcquireTvNavigationGate(navigationGateRef.current)) {
      return;
    }

    void markOnboardingGuideSeen('hubGuideSeen');
    router.replace('/settings');
  };

  const currentProvider = selectedProvider ?? providers[0] ?? null;
  const currentStatusMeta = currentProvider ? getStatusMeta(currentProvider.status) : null;
  const daysRemainingLabel = currentProvider
    ? getDaysRemainingLabel(currentProvider.expirationAt, currentProvider.status)
    : null;

  const selectedIndex = useMemo(
    () => providers.findIndex((provider) => provider.id === selectedProvider?.id),
    [providers, selectedProvider?.id],
  );

  return (
    <View style={styles.backdrop}>
      <Animated.View
        pointerEvents="none"
        style={[
          styles.backdropLayer,
          { opacity: enterAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 1] }) },
        ]}>
        <ImageBackground source={splashArtwork} blurRadius={38} resizeMode="cover" style={styles.backgroundArtwork}>
          <View style={styles.backgroundShade} />
        </ImageBackground>
      </Animated.View>

      <Animated.View
        style={[
          styles.card,
          {
            opacity: enterAnim,
            transform: [{ scale: enterAnim.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) }],
          },
        ]}>
        <Pressable
          focusable
          onFocus={() => setFocusedId('close-x')}
          onBlur={() => setFocusedId((current) => (current === 'close-x' ? null : current))}
          onPress={goHome}
          style={[styles.closeX, focusedId === 'close-x' && styles.closeXFocused]}>
          <MaterialCommunityIcons name="close" size={22} color={novaTheme.colors.textPrimary} />
        </Pressable>

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
          <View style={styles.header}>
            <NovaLogo variant="mark" size="lg" />
            <Text style={styles.wordmark}>NOVACAST</Text>
            <Text style={styles.title}>Content Hub</Text>
            <Text style={styles.subtitle}>Manage your providers and settings</Text>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Choose Your Provider</Text>
            <View style={styles.providerRow}>
              {providers.map((provider: ProviderRecord, index) => {
                const visual = getProviderVisual(provider.id);
                const statusMeta = getStatusMeta(provider.status);
                const selected = provider.id === selectedProvider?.id;
                const focused = focusedId === provider.id;

                return (
                  <Pressable
                    key={provider.id}
                    focusable
                    hasTVPreferredFocus={selectedIndex < 0 ? index === 0 : selected}
                    onFocus={() => setFocusedId(provider.id)}
                    onBlur={() => setFocusedId((current) => (current === provider.id ? null : current))}
                    onPress={() => {
                      void activateProvider(provider.id);
                    }}
                    style={[
                      styles.providerCard,
                      selected && styles.providerCardSelected,
                      focused && styles.providerCardFocused,
                    ]}>
                    <View style={styles.providerCardTop}>
                      <View style={[styles.providerIcon, { backgroundColor: `${visual.accent}2E`, borderColor: `${visual.accent}66` }]}>
                        <MaterialCommunityIcons name={visual.icon} size={22} color={visual.accent} />
                      </View>
                      {selected ? (
                        <View style={styles.selectedBadge}>
                          <MaterialCommunityIcons name="check" size={14} color="#FFFFFF" />
                        </View>
                      ) : null}
                    </View>
                    <Text numberOfLines={1} style={styles.providerName}>
                      {provider.name}
                    </Text>
                    <View style={styles.providerStatusRow}>
                      <View style={[styles.statusDot, { backgroundColor: statusMeta.dot }]} />
                      <Text style={styles.providerStatusText}>{statusMeta.label}</Text>
                    </View>
                    <Text style={styles.providerExpiry}>
                      {statusMeta.expiryPrefix} {formatProviderExpirationLabel(provider, null)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <View style={styles.manageRow}>
              <Pressable
                focusable
                onFocus={() => setFocusedId('manage')}
                onBlur={() => setFocusedId((current) => (current === 'manage' ? null : current))}
                onPress={openPairing}
                style={[styles.manageButton, focusedId === 'manage' && styles.manageButtonFocused]}>
                <MaterialCommunityIcons name="tune-variant" size={18} color={novaTheme.colors.accentHover} />
                <Text style={styles.manageButtonText}>Manage Providers</Text>
              </Pressable>
            </View>
            {isSwitchingProvider ? <Text style={styles.switchStatus}>Validating provider...</Text> : null}
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Quick Actions</Text>
            <View style={styles.quickRow}>
              <QuickAction
                icon="home-outline"
                title="Return to Home"
                subtitle="Continue watching"
                focused={focusedId === 'qa-home'}
                onFocus={() => setFocusedId('qa-home')}
                onBlur={() => setFocusedId((current) => (current === 'qa-home' ? null : current))}
                onPress={goHome}
              />
              <QuickAction
                icon="qrcode-scan"
                title="Add New Provider"
                subtitle="Scan QR code"
                focused={focusedId === 'qa-add'}
                onFocus={() => setFocusedId('qa-add')}
                onBlur={() => setFocusedId((current) => (current === 'qa-add' ? null : current))}
                onPress={openPairing}
              />
              <QuickAction
                icon="cog-outline"
                title="Settings"
                subtitle="App preferences"
                focused={focusedId === 'qa-settings'}
                onFocus={() => setFocusedId('qa-settings')}
                onBlur={() => setFocusedId((current) => (current === 'qa-settings' ? null : current))}
                onPress={openSettings}
              />
            </View>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Subscription Information</Text>
            <View style={styles.subCard}>
              <View style={styles.subColumn}>
                <Text style={styles.subLabel}>Connected Provider</Text>
                <Text style={styles.subValue}>{currentProvider?.name ?? 'No provider'}</Text>
                {currentStatusMeta ? (
                  <Text style={[styles.subBadgeText, { color: currentProvider?.status === 'active' ? novaTheme.colors.success : novaTheme.colors.warning }]}>
                    {currentStatusMeta.label}
                  </Text>
                ) : null}
              </View>
              <View style={styles.subDivider} />
              <View style={styles.subColumn}>
                <Text style={styles.subLabel}>Subscription Expires</Text>
                <Text style={styles.subValue}>{formatProviderExpirationLabel(currentProvider, null)}</Text>
                {daysRemainingLabel ? <Text style={styles.subDays}>{daysRemainingLabel}</Text> : null}
              </View>
              <View style={styles.subDivider} />
              <View style={styles.subColumn}>
                <Text style={styles.subLabel}>Status</Text>
                <View style={[styles.statusPill, currentProvider?.status === 'active' ? styles.statusPillActive : styles.statusPillMuted]}>
                  <MaterialCommunityIcons
                    name={currentProvider?.status === 'active' ? 'check-circle' : 'alert-circle-outline'}
                    size={14}
                    color={currentProvider?.status === 'active' ? novaTheme.colors.success : novaTheme.colors.warning}
                  />
                  <Text style={[styles.statusPillText, { color: currentProvider?.status === 'active' ? novaTheme.colors.success : novaTheme.colors.warning }]}>
                    {currentStatusMeta?.label ?? 'Unknown'}
                  </Text>
                </View>
              </View>
            </View>
          </View>

          <Pressable
            focusable
            onFocus={() => setFocusedId('close-hub')}
            onBlur={() => setFocusedId((current) => (current === 'close-hub' ? null : current))}
            onPress={goHome}
            style={[styles.closeHub, focusedId === 'close-hub' && styles.closeHubFocused]}>
            <View style={styles.closeHubIcon}>
              <MaterialCommunityIcons name="close" size={18} color={novaTheme.colors.textSecondary} />
            </View>
            <View style={styles.closeHubCopy}>
              <Text style={styles.closeHubTitle}>Close Hub</Text>
              <Text style={styles.closeHubSubtitle}>Resume Home Screen</Text>
            </View>
          </Pressable>
        </ScrollView>
      </Animated.View>
    </View>
  );
}

type QuickActionProps = {
  icon: IconName;
  title: string;
  subtitle: string;
  focused: boolean;
  onFocus: () => void;
  onBlur: () => void;
  onPress: () => void;
};

function QuickAction({ icon, title, subtitle, focused, onFocus, onBlur, onPress }: QuickActionProps) {
  return (
    <Pressable
      focusable
      onFocus={onFocus}
      onBlur={onBlur}
      onPress={onPress}
      style={[styles.quickCard, focused && styles.quickCardFocused]}>
      <View style={styles.quickIcon}>
        <MaterialCommunityIcons name={icon} size={20} color={novaTheme.colors.accentHover} />
      </View>
      <View style={styles.quickCopy}>
        <Text numberOfLines={1} style={styles.quickTitle}>
          {title}
        </Text>
        <Text numberOfLines={1} style={styles.quickSubtitle}>
          {subtitle}
        </Text>
      </View>
      <MaterialCommunityIcons name="chevron-right" size={22} color={novaTheme.colors.textMuted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
    backgroundColor: 'rgba(3,6,12,0.55)',
  },
  backdropLayer: {
    ...StyleSheet.absoluteFill,
  },
  backgroundArtwork: {
    ...StyleSheet.absoluteFill,
    transform: [{ scale: 1.08 }],
  },
  backgroundShade: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(2,4,8,0.62)',
  },
  card: {
    width: '100%',
    maxWidth: 760,
    maxHeight: '94%',
    borderRadius: 30,
    borderWidth: 1,
    borderColor: 'rgba(139,152,255,0.30)',
    backgroundColor: 'rgba(10,14,22,0.96)',
    paddingHorizontal: 26,
    paddingVertical: 22,
    shadowColor: '#000',
    shadowOpacity: 0.55,
    shadowRadius: 32,
  },
  scrollContent: {
    gap: 20,
    paddingBottom: 4,
  },
  closeX: {
    position: 'absolute',
    top: 18,
    right: 18,
    zIndex: 10,
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(30,38,54,0.9)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  closeXFocused: {
    borderColor: novaTheme.colors.focusRing,
    backgroundColor: novaTheme.colors.surfaceFocused,
  },
  header: {
    alignItems: 'center',
    gap: 6,
  },
  wordmark: {
    color: novaTheme.colors.textPrimary,
    fontSize: 20,
    fontWeight: '900',
    letterSpacing: 3,
    marginTop: 2,
  },
  title: {
    color: novaTheme.colors.textPrimary,
    fontSize: 28,
    fontWeight: '900',
    marginTop: 6,
  },
  subtitle: {
    color: novaTheme.colors.textSecondary,
    fontSize: 14,
    fontWeight: '600',
  },
  section: {
    gap: 12,
  },
  sectionLabel: {
    color: novaTheme.colors.textPrimary,
    fontSize: 16,
    fontWeight: '800',
  },
  providerRow: {
    flexDirection: 'row',
    gap: 12,
  },
  providerCard: {
    flex: 1,
    minWidth: 0,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: 'rgba(18,24,36,0.94)',
    padding: 14,
    gap: 10,
  },
  providerCardSelected: {
    borderColor: 'rgba(96,165,255,0.9)',
    backgroundColor: 'rgba(28,45,73,0.7)',
  },
  providerCardFocused: {
    borderColor: novaTheme.colors.focusRing,
    backgroundColor: 'rgba(28,45,73,0.92)',
    shadowColor: novaTheme.colors.focusRing,
    shadowOpacity: novaTheme.glow.focusShadowOpacity,
    shadowRadius: novaTheme.glow.focusShadowRadius,
  },
  providerCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  providerIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectedBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: novaTheme.colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  providerName: {
    color: novaTheme.colors.textPrimary,
    fontSize: 15,
    fontWeight: '800',
  },
  providerStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  providerStatusText: {
    color: novaTheme.colors.textSecondary,
    fontSize: 12,
    fontWeight: '700',
  },
  providerExpiry: {
    color: novaTheme.colors.textMuted,
    fontSize: 11,
    fontWeight: '600',
  },
  manageRow: {
    alignItems: 'center',
  },
  manageButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(96,165,255,0.4)',
    backgroundColor: 'rgba(59,130,246,0.12)',
  },
  manageButtonFocused: {
    borderColor: novaTheme.colors.focusRing,
    backgroundColor: novaTheme.colors.surfaceFocused,
  },
  manageButtonText: {
    color: novaTheme.colors.accentHover,
    fontSize: 14,
    fontWeight: '800',
  },
  switchStatus: {
    color: novaTheme.colors.textSecondary,
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
  },
  quickRow: {
    flexDirection: 'row',
    gap: 12,
  },
  quickCard: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: 'rgba(18,24,36,0.94)',
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  quickCardFocused: {
    borderColor: novaTheme.colors.focusRing,
    backgroundColor: 'rgba(28,45,73,0.92)',
    shadowColor: novaTheme.colors.focusRing,
    shadowOpacity: novaTheme.glow.focusShadowOpacity,
    shadowRadius: novaTheme.glow.focusShadowRadius,
  },
  quickIcon: {
    width: 38,
    height: 38,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(96,165,255,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(96,165,255,0.28)',
  },
  quickCopy: {
    flex: 1,
    minWidth: 0,
  },
  quickTitle: {
    color: novaTheme.colors.textPrimary,
    fontSize: 13,
    fontWeight: '800',
  },
  quickSubtitle: {
    color: novaTheme.colors.textMuted,
    fontSize: 11,
    fontWeight: '600',
  },
  subCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: novaTheme.colors.borderSubtle,
    backgroundColor: 'rgba(18,24,36,0.9)',
    paddingHorizontal: 18,
    paddingVertical: 16,
  },
  subColumn: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  subLabel: {
    color: novaTheme.colors.textMuted,
    fontSize: 11,
    fontWeight: '700',
  },
  subValue: {
    color: novaTheme.colors.textPrimary,
    fontSize: 16,
    fontWeight: '900',
  },
  subBadgeText: {
    fontSize: 12,
    fontWeight: '800',
  },
  subDays: {
    color: novaTheme.colors.accentHover,
    fontSize: 12,
    fontWeight: '700',
  },
  subDivider: {
    width: 1,
    alignSelf: 'stretch',
    backgroundColor: novaTheme.colors.borderSubtle,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
  },
  statusPillActive: {
    backgroundColor: 'rgba(51,211,154,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(51,211,154,0.4)',
  },
  statusPillMuted: {
    backgroundColor: 'rgba(255,184,106,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255,184,106,0.36)',
  },
  statusPillText: {
    fontSize: 12,
    fontWeight: '800',
  },
  closeHub: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: 'rgba(16,21,31,0.94)',
    paddingHorizontal: 18,
    paddingVertical: 14,
  },
  closeHubFocused: {
    borderColor: novaTheme.colors.focusRing,
    backgroundColor: 'rgba(28,45,73,0.92)',
  },
  closeHubIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(30,38,54,0.9)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  closeHubCopy: {
    flex: 1,
    minWidth: 0,
  },
  closeHubTitle: {
    color: novaTheme.colors.textPrimary,
    fontSize: 15,
    fontWeight: '800',
  },
  closeHubSubtitle: {
    color: novaTheme.colors.textMuted,
    fontSize: 12,
    fontWeight: '600',
  },
});
