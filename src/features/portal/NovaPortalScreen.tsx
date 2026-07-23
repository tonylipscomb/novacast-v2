import { MaterialCommunityIcons } from '@expo/vector-icons';
import QRCode from 'react-native-qrcode-svg';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode, type RefObject } from 'react';
import * as ReactNative from 'react-native';
import {
  BackHandler,
  Image,
  ImageBackground,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

import { novaTvFocus } from '@/components/nova/novaTvFocus';
import { markOnboardingGuideSeen, useOnboardingStore } from '@/features/onboarding/onboardingStore';
import { focusNativeViewWhenReady } from '@/features/navigation/focusNativeViewWhenReady';
import { ExitConfirmOverlay } from '@/features/navigation/ExitConfirmOverlay';
import { PairingScreen } from '@/features/pairing/PairingScreen';
import { factoryResetNovacast, resetPairingKeepDevice } from '@/features/pairing/resetPairing';
import { completeLaunchOverlay } from '@/features/startup/launchOverlay';
import { getActiveRepositoryBundle } from '@/features/providers/providerBundle';
import { refreshProviderLiveChannelCount } from '@/features/providers/providerCatalogSync';
import { getProviderRuntime, retryProviderInitialization, selectProvider, useProviderStore } from '@/features/providers/providerStore';
import { formatProviderExpirationLabel } from '@/features/providers/providerExpiration';
import { useProviderLibrarySummary } from '@/features/providers/providerLibrarySummaryStore';
import { initializeDevice, isDeviceActivationRequired, useDeviceState } from '@/features/device';
import { BetaExpiredScreen } from '@/features/device/BetaExpiredScreen';
import { BetaInviteActivationScreen } from '@/features/device/BetaInviteActivationScreen';
import { downloadManagedProviderAssignment } from '@/features/device/managedProviderDownload';
import { isClosedBetaManagedFlow } from '@/features/device/deviceFeatureFlags';
import { checkDeviceStatus } from '@/features/device/deviceActivation';
import type { ProviderRecord } from '@/features/providers/providerModel';
import { novaTheme } from '@/theme';

type PortalPanel = 'switch' | 'manage' | 'diagnostics' | null;
type PortalIcon = keyof typeof MaterialCommunityIcons.glyphMap;

const GLASS = {
  fill: 'rgba(8, 18, 38, 0.42)',
  fillStrong: 'rgba(10, 22, 48, 0.58)',
  fillFocus: 'rgba(18, 36, 72, 0.62)',
  border: 'rgba(255, 255, 255, 0.16)',
  borderBright: 'rgba(120, 196, 255, 0.42)',
  borderFocus: 'rgba(131, 180, 255, 0.72)',
  accentFill: 'rgba(59, 130, 246, 0.18)',
} as const;

const backgroundAsset = require('@/assets/images/pairingbackground.png');
const logoAsset = require('@/assets/images/novacast-logo.png');

const MENU_ITEMS: readonly { id: string; icon: PortalIcon; title: string; subtitle: string }[] = [
  { id: 'pair', icon: 'plus-circle-outline', title: 'Pair New Provider', subtitle: 'Add a new provider to NovaCast' },
  { id: 'switch', icon: 'swap-horizontal', title: 'Switch Provider', subtitle: 'Change to a different provider' },
  { id: 'manage', icon: 'account-multiple-outline', title: 'Manage Providers', subtitle: 'View, edit or remove providers' },
  { id: 'settings', icon: 'cog-outline', title: 'Settings', subtitle: 'App preferences and configuration' },
  { id: 'diagnostics', icon: 'stethoscope', title: 'Diagnostics', subtitle: 'System information and tools' },
];

function formatCount(count: number, ready: boolean) {
  return ready && count > 0 ? count.toLocaleString() : '—';
}

function safeProviderName(provider: ProviderRecord | null) {
  if (!provider) return 'No provider yet';
  const name = provider.name?.trim();
  if (name) return name;
  return provider.connection?.type === 'xtream' ? 'TV Provider' : 'Provider';
}

function ProviderCounts({ providerId, scale }: { providerId: string; scale: number }) {
  const { summary, ready } = useProviderLibrarySummary(providerId);
  const liveCountRefreshRef = useRef<string | null>(null);

  useEffect(() => {
    if (!ready) {
      return;
    }

    const bundle = getActiveRepositoryBundle();
    if (!bundle || bundle.providerId !== providerId) {
      return;
    }

    if (liveCountRefreshRef.current === providerId) {
      return;
    }

    liveCountRefreshRef.current = providerId;
    void refreshProviderLiveChannelCount(providerId, bundle.live).catch(() => undefined);
  }, [providerId, ready]);

  const items = [
    ['Channels', formatCount(summary.liveChannelCount, ready)],
    ['Movies', formatCount(summary.movieCount, ready)],
    ['Series', formatCount(summary.seriesCount, ready)],
  ];

  return (
    <View style={styles.counts}>
      {items.map(([label, count], index) => (
        <View key={label} style={styles.countGroup}>
          {index > 0 ? <View style={[styles.countDivider, { height: 48 * scale }]} /> : null}
          <View style={styles.countCopy}>
            <Text style={[styles.countLabel, { fontSize: 18 * scale }]}>{label}</Text>
            <Text style={[styles.countValue, { fontSize: 24 * scale }]}>{count}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

function PortalMenuItem({
  item,
  index,
  scale,
  preferred,
  onPress,
}: {
  item: (typeof MENU_ITEMS)[number];
  index: number;
  scale: number;
  preferred: boolean;
  onPress: () => void;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      accessible
      accessibilityRole="button"
      accessibilityLabel={`${item.title}. ${item.subtitle}`}
      focusable
      hasTVPreferredFocus={preferred}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPress={onPress}
      style={[styles.menuItem, { height: 112 * scale }, focused && styles.menuItemFocused]}>
      <MaterialCommunityIcons name={item.icon} size={46 * scale} color={focused ? novaTheme.colors.accentHover : '#7DD3FC'} />
      <View style={styles.menuCopy}>
        <Text numberOfLines={1} style={[styles.menuTitle, focused && styles.menuTitleFocused, { fontSize: 27 * scale }]}>{item.title}</Text>
        <Text numberOfLines={1} style={[styles.menuSubtitle, focused && styles.menuSubtitleFocused, { fontSize: 19 * scale }]}>{item.subtitle}</Text>
      </View>
      <MaterialCommunityIcons name="chevron-right" size={34 * scale} color={focused ? '#F5F8FF' : '#8592A9'} />
    </Pressable>
  );
}

function PortalPanelCloseButton({ onPress, focusRef }: { onPress: () => void; focusRef?: RefObject<View | null> }) {
  const [focused, setFocused] = useState(false);

  return (
    <Pressable
      ref={focusRef}
      accessible
      accessibilityRole="button"
      accessibilityLabel="Close panel"
      focusable
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPress={onPress}
      {...(Platform.isTV ? ({ onClick: onPress } as object) : null)}
      style={[styles.panelCloseButton, novaTvFocus.base, focused && styles.panelCloseButtonFocused]}>
      <MaterialCommunityIcons name="close" size={25} color={focused ? novaTheme.colors.accentHover : novaTheme.colors.textPrimary} />
    </Pressable>
  );
}

function PortalSwitchProviderRow({
  provider,
  selected,
  preferredFocus,
  focusRef,
  onPress,
}: {
  provider: ProviderRecord;
  selected: boolean;
  preferredFocus: boolean;
  focusRef?: RefObject<View | null>;
  onPress: () => void;
}) {
  const [focused, setFocused] = useState(false);

  return (
    <Pressable
      ref={focusRef}
      accessible
      accessibilityRole="button"
      accessibilityLabel={`Use ${provider.name}`}
      focusable
      hasTVPreferredFocus={preferredFocus && Platform.isTV}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPress={onPress}
      {...(Platform.isTV ? ({ onClick: onPress } as object) : null)}
      style={[styles.providerRow, novaTvFocus.base, focused && styles.providerRowFocused]}>
      <View style={styles.providerRowCopy}>
        <Text style={[styles.providerRowName, focused && styles.providerRowNameFocused]}>{provider.name}</Text>
        <Text style={styles.providerRowStatus}>{provider.status}</Text>
      </View>
      {selected ? <MaterialCommunityIcons name="check-circle" size={24} color="#20E878" /> : null}
    </Pressable>
  );
}

function PortalManageProviderRow({
  provider,
  selected,
  preferredFocus,
  focusRef,
  onPress,
}: {
  provider: ProviderRecord;
  selected: boolean;
  preferredFocus: boolean;
  focusRef?: RefObject<View | null>;
  onPress: () => void;
}) {
  const [useFocused, setUseFocused] = useState(false);

  return (
    <View style={styles.manageRow}>
      <View style={styles.providerRowCopy}>
        <Text style={styles.providerRowName}>{provider.name}</Text>
        <Text style={styles.providerRowStatus}>
          {provider.status} · {formatProviderExpirationLabel(provider, provider.account)}
        </Text>
      </View>
      <Pressable
        ref={focusRef}
        accessible
        accessibilityRole="button"
        accessibilityLabel={`Use ${provider.name}`}
        focusable
        hasTVPreferredFocus={preferredFocus && Platform.isTV}
        onFocus={() => setUseFocused(true)}
        onBlur={() => setUseFocused(false)}
        onPress={onPress}
        {...(Platform.isTV ? ({ onClick: onPress } as object) : null)}
        style={[styles.useButton, novaTvFocus.base, useFocused && styles.useButtonFocused]}>
        <Text style={[styles.useButtonText, useFocused && styles.useButtonTextFocused]}>{selected ? 'Active' : 'Use'}</Text>
      </Pressable>
    </View>
  );
}

function PortalAddProviderButton({
  onPress,
  preferredFocus,
  focusRef,
}: {
  onPress: () => void;
  preferredFocus: boolean;
  focusRef?: RefObject<View | null>;
}) {
  const [focused, setFocused] = useState(false);

  return (
    <Pressable
      ref={focusRef}
      accessible
      accessibilityRole="button"
      accessibilityLabel="Add another provider"
      focusable
      hasTVPreferredFocus={preferredFocus && Platform.isTV}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPress={onPress}
      {...(Platform.isTV ? ({ onClick: onPress } as object) : null)}
      style={[styles.addProviderButton, novaTvFocus.base, focused && styles.addProviderButtonFocused]}>
      <MaterialCommunityIcons name="plus" size={22} color={focused ? novaTheme.colors.accentHover : '#18D7FF'} />
      <Text style={[styles.addProviderText, focused && styles.addProviderTextFocused]}>Add another provider</Text>
    </Pressable>
  );
}

function PortalActionButton({
  label,
  accessibilityLabel,
  icon,
  danger = false,
  preferredFocus = false,
  focusRef,
  onPress,
}: {
  label: string;
  accessibilityLabel: string;
  icon: PortalIcon;
  danger?: boolean;
  preferredFocus?: boolean;
  focusRef?: RefObject<View | null>;
  onPress: () => void;
}) {
  const [focused, setFocused] = useState(false);

  return (
    <Pressable
      ref={focusRef}
      accessible
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      focusable
      hasTVPreferredFocus={preferredFocus && Platform.isTV}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPress={onPress}
      {...(Platform.isTV ? ({ onClick: onPress } as object) : null)}
      style={[
        styles.addProviderButton,
        danger && styles.dangerActionButton,
        novaTvFocus.base,
        focused && (danger ? styles.dangerActionButtonFocused : styles.addProviderButtonFocused),
      ]}>
      <MaterialCommunityIcons
        name={icon}
        size={22}
        color={focused ? novaTheme.colors.accentHover : danger ? '#FF8FA3' : '#18D7FF'}
      />
      <Text style={[styles.addProviderText, focused && styles.addProviderTextFocused]}>{label}</Text>
    </Pressable>
  );
}

function DeviceActivationRequiredScreen({
  scale,
  deviceCode,
  onRetry,
  onSettings,
  onDiagnostics,
}: {
  scale: number;
  deviceCode: string;
  onRetry: () => void;
  onSettings: () => void;
  onDiagnostics: () => void;
}) {
  const website = process.env.EXPO_PUBLIC_NOVACAST_PAIRING_WEBSITE_URL?.trim().replace(/\/+$/, '') ?? '';
  const activationUrl = website ? `${website}/activate?device=${encodeURIComponent(deviceCode)}` : '';
  return (
    <ImageBackground source={backgroundAsset} resizeMode="cover" style={styles.screen}>
      <View pointerEvents="none" style={styles.overlay} />
      <View style={[styles.activationLayout, { paddingHorizontal: 70 * scale, paddingVertical: 48 * scale }]}>
        <View style={styles.activationCopy}>
          <Image source={logoAsset} resizeMode="contain" style={[styles.logo, { width: 300 * scale, height: 230 * scale }]} />
          <Text style={[styles.portalLabel, { fontSize: 23 * scale }]}>NOVACAST DEVICE ACTIVATION</Text>
          <Text style={[styles.activationTitle, { fontSize: 49 * scale }]}>Activate NovaCast</Text>
          <Text style={[styles.activationBody, { fontSize: 20 * scale }]}>Enter the invitation code provided to you on NovaCast Connect.</Text>
          <Text style={[styles.deviceCodeLabel, { fontSize: 18 * scale }]}>DEVICE ID</Text>
          <Text style={[styles.deviceCode, { fontSize: 34 * scale }]}>{deviceCode || 'REGISTERING...'}</Text>
          <View style={styles.activationActions}>
            <Pressable focusable hasTVPreferredFocus onPress={onRetry} style={styles.activationButton}><Text style={styles.activationButtonText}>Check Activation</Text></Pressable>
            <Pressable focusable onPress={onSettings} style={styles.activationButtonSecondary}><Text style={styles.activationButtonText}>Limited Settings</Text></Pressable>
            <Pressable focusable onPress={onDiagnostics} style={styles.activationButtonSecondary}><Text style={styles.activationButtonText}>Diagnostics</Text></Pressable>
          </View>
        </View>
        <View style={styles.activationQrCard}>
          {activationUrl ? <QRCode value={activationUrl} size={Math.round(250 * scale)} backgroundColor="#F5F8FF" color="#020611" /> : <Text style={styles.activationBody}>Configure the Connect website URL to show an activation QR code.</Text>}
          <Text style={styles.qrHint}>Scan with your phone</Text>
        </View>
      </View>
    </ImageBackground>
  );
}

function ProviderCard({
  scale,
  state,
  selectedProvider,
  providerSwitchError,
  launchable,
  focusRef,
  preferredFocus,
  onLaunch,
}: {
  scale: number;
  state: 'checking' | 'first-time' | 'expired' | 'loading' | 'offline' | 'connected';
  selectedProvider: ProviderRecord | null;
  providerSwitchError: string | null;
  launchable: boolean;
  focusRef?: RefObject<View | null>;
  preferredFocus: boolean;
  onLaunch: () => void;
}) {
  const [focused, setFocused] = useState(false);
  const statusLabel =
    state === 'connected'
      ? 'Provider active'
      : state === 'expired'
        ? 'Expired'
        : state === 'offline'
          ? 'Unavailable'
          : state === 'loading'
            ? 'Connecting'
            : state === 'checking'
              ? 'Checking'
              : 'Ready to pair';
  const expiration = selectedProvider ? formatProviderExpirationLabel(selectedProvider, selectedProvider.account) : null;

  const cardBody = (
    <>
      <View style={styles.statusLine}>
        <View style={[styles.statusDot, state === 'connected' ? styles.connected : styles.notConnected]} />
        <Text style={[styles.statusText, { fontSize: 20 * scale }]}>{statusLabel}</Text>
        {launchable ? (
          <MaterialCommunityIcons
            name="chevron-right"
            size={28 * scale}
            color={focused ? '#F5F8FF' : '#8592A9'}
            style={styles.cardLaunchHint}
          />
        ) : null}
      </View>
      <View style={styles.providerMain}>
        <View style={[styles.tvIcon, { width: 112 * scale, height: 84 * scale, borderRadius: 12 * scale }]}>
          <MaterialCommunityIcons name="play-outline" size={48 * scale} color="#18D7FF" />
        </View>
        <View style={styles.providerCopy}>
          <Text
            numberOfLines={2}
            style={[
              styles.providerName,
              launchable && focused && styles.providerNameFocused,
              { fontSize: selectedProvider ? 34 * scale : 28 * scale },
            ]}>
            {safeProviderName(selectedProvider)}
          </Text>
          <Text numberOfLines={1} style={[styles.expiration, { fontSize: 19 * scale }]}>
            {expiration
              ? `Expires ${expiration}`
              : selectedProvider
                ? 'Expiration unavailable'
                : 'Pair a provider to continue'}
          </Text>
        </View>
      </View>
      <View style={styles.cardDivider} />
      {selectedProvider ? (
        <ProviderCounts providerId={selectedProvider.id} scale={scale} />
      ) : (
        <Text style={styles.emptyCounts}>Catalog counts will appear here after pairing.</Text>
      )}
      {providerSwitchError ? <Text numberOfLines={1} style={styles.error}>{providerSwitchError}</Text> : null}
    </>
  );

  if (!launchable) {
    return <View style={[styles.providerCard, styles.providerCardStatic, { height: 340 * scale }]}>{cardBody}</View>;
  }

  return (
    <Pressable
      ref={focusRef}
      accessible
      accessibilityRole="button"
      accessibilityLabel={`Continue with ${safeProviderName(selectedProvider)}`}
      focusable
      hasTVPreferredFocus={preferredFocus && Platform.isTV}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPress={onLaunch}
      {...(Platform.isTV ? ({ onClick: onLaunch } as object) : null)}
      style={[
        styles.providerCard,
        styles.providerCardLaunch,
        novaTvFocus.base,
        { height: 340 * scale },
        focused && styles.providerCardFocused,
      ]}>
      {cardBody}
    </Pressable>
  );
}

export function NovaPortalScreen() {
  const router = useRouter();
  const { width, height } = useWindowDimensions();
  const scale = Math.max(0.66, Math.min(1.08, Math.min(width / 1920, height / 1080)));
  const {
    ready,
    providers,
    selectedProvider,
    hasSavedProvider,
    providerInitialized,
    providerSwitchError,
    isSwitchingProvider,
  } = useProviderStore();
  const { state: onboardingState, ready: onboardingReady } = useOnboardingStore();
  const device = useDeviceState();
  const [panel, setPanel] = useState<PortalPanel>(null);
  const [pairingVisible, setPairingVisible] = useState(false);
  const [exitConfirmVisible, setExitConfirmVisible] = useState(false);
  const providerCardRef = useRef<View | null>(null);
  const panelFirstFocusRef = useRef<View | null>(null);
  const panelCloseRef = useRef<View | null>(null);
  const initRetryRef = useRef(false);
  const portalBlocked = panel !== null || pairingVisible;

  const reactNative = ReactNative as typeof ReactNative & {
    TVFocusGuideView?: typeof View;
  };
  const PortalFocusGuide = (reactNative.TVFocusGuideView ?? View) as ComponentType<{
    children?: ReactNode;
    style?: unknown;
    autoFocus?: boolean;
    trapFocusLeft?: boolean;
    trapFocusRight?: boolean;
    trapFocusUp?: boolean;
    trapFocusDown?: boolean;
  }>;
  const PanelFocusGuide = PortalFocusGuide;

  useEffect(() => {
    if (!panel) {
      return;
    }

    const focusTarget =
      panel === 'diagnostics' || providers.length === 0 ? panelCloseRef.current : panelFirstFocusRef.current;

    focusNativeViewWhenReady(() => focusTarget, () => {
      focusTarget?.focus();
    });
  }, [panel, providers.length]);

  const state = useMemo(() => {
    if (!ready || isSwitchingProvider) return 'checking' as const;
    if (!hasSavedProvider || !selectedProvider) return 'first-time' as const;
    if (selectedProvider.status === 'expired') return 'expired' as const;
    if (providerSwitchError) return 'offline' as const;
    if (!providerInitialized) return 'loading' as const;
    return 'connected' as const;
  }, [hasSavedProvider, isSwitchingProvider, providerInitialized, providerSwitchError, ready, selectedProvider]);

  const canEnterApp =
    ready &&
    !isSwitchingProvider &&
    hasSavedProvider &&
    Boolean(selectedProvider) &&
    selectedProvider.status !== 'expired';

  const welcomeTitle =
    onboardingReady && onboardingState.portalWelcomeSeen ? 'Welcome Back' : 'Welcome to NovaCast';

  useEffect(() => {
    completeLaunchOverlay();
  }, []);

  useEffect(() => {
    if (!canEnterApp || portalBlocked) {
      return;
    }

    focusNativeViewWhenReady(() => providerCardRef.current, () => {
      providerCardRef.current?.focus();
    });
  }, [canEnterApp, portalBlocked]);

  useEffect(() => {
    if (!ready || isSwitchingProvider || !hasSavedProvider || providerInitialized || initRetryRef.current) {
      return;
    }

    initRetryRef.current = true;
    void retryProviderInitialization().catch(() => {
      // Provider store retains the sanitized runtime error for the UI.
    });
  }, [hasSavedProvider, isSwitchingProvider, providerInitialized, ready]);

  const launchAction = useCallback(() => {
    completeLaunchOverlay();
    void markOnboardingGuideSeen('portalWelcomeSeen');
    router.replace('/main-menu');

    if (selectedProvider && !providerInitialized && !isSwitchingProvider) {
      void retryProviderInitialization().catch(() => undefined);
    }
  }, [isSwitchingProvider, providerInitialized, router, selectedProvider]);

  const closePairing = useCallback(() => {
    setPairingVisible(false);
    completeLaunchOverlay();
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'android') {
      return;
    }

    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (pairingVisible) {
        closePairing();
        return true;
      }
      if (panel) {
        setPanel(null);
        return true;
      }
      if (exitConfirmVisible) {
        return true;
      }
      setExitConfirmVisible(true);
      return true;
    });

    return () => subscription.remove();
  }, [closePairing, exitConfirmVisible, pairingVisible, panel]);

  const openPairing = useCallback(() => setPairingVisible(true), []);
  const openSwitchProvider = useCallback(() => setPanel('switch'), []);
  const openManageProviders = useCallback(() => setPanel('manage'), []);
  const handleResetPairing = useCallback(async () => {
    setPanel(null);
    await resetPairingKeepDevice();
    openPairing();
  }, [openPairing]);
  const handleFactoryReset = useCallback(async () => {
    setPanel(null);
    await factoryResetNovacast();
    await initializeDevice().catch(() => undefined);
    openPairing();
  }, [openPairing]);
  const selectAndContinue = useCallback(async (providerId: string) => {
    try {
      await selectProvider(providerId);
      setPanel(null);
    } catch {
      // The provider store retains the active provider and exposes the sanitized error.
    }
  }, []);

  const menuAction = useCallback((id: string) => {
    if (id === 'pair') return openPairing();
    if (id === 'switch') return openSwitchProvider();
    if (id === 'manage') return openManageProviders();
    if (id === 'settings') return router.push('/settings');
    return setPanel('diagnostics');
  }, [openManageProviders, openPairing, openSwitchProvider, router]);

  if (isDeviceActivationRequired() && device.status && device.status.activationStatus !== 'active') {
    if (device.status.activationStatus === 'expired') {
      return (
        <BetaExpiredScreen
          expiresAt={device.status.activationExpiresAt}
          onRefresh={() => void checkDeviceStatus()}
        />
      );
    }

    return (
      <BetaInviteActivationScreen
        onActivated={() => {
          if (isClosedBetaManagedFlow()) {
            void downloadManagedProviderAssignment().catch(() => undefined);
          }
          void initializeDevice();
        }}
      />
    );
  }

  return (
    <ImageBackground source={backgroundAsset} resizeMode="cover" style={styles.screen}>
      <View pointerEvents="none" style={styles.overlay} />
      <View
        style={styles.portalRoot}
        pointerEvents={portalBlocked ? 'none' : 'box-none'}
        importantForAccessibility={portalBlocked ? 'no-hide-descendants' : 'auto'}>
        <PortalFocusGuide
          style={[styles.content, { paddingHorizontal: 70 * scale, paddingVertical: 48 * scale, gap: 58 * scale }]}
          {...(Platform.OS === 'android' && !portalBlocked
            ? {
                autoFocus: true,
                trapFocusLeft: true,
                trapFocusRight: true,
                trapFocusUp: true,
                trapFocusDown: true,
              }
            : {})}>
        <View style={[styles.leftColumn, { width: '43%' }]}>
          <Image source={logoAsset} resizeMode="contain" style={[styles.logo, { width: 300 * scale, height: 230 * scale }]} />
          <Text style={[styles.welcome, { fontSize: 49 * scale }]}>{welcomeTitle}</Text>
          <Text style={[styles.deviceStatus, { fontSize: 15 * scale }]}>
            NovaCast {device.status?.activationStatus === 'active' ? 'Active' : device.status?.status === 'revoked' ? 'Revoked' : 'Registered'}
          </Text>

          <ProviderCard
            scale={scale}
            state={state}
            selectedProvider={selectedProvider}
            providerSwitchError={providerSwitchError}
            launchable={canEnterApp}
            focusRef={providerCardRef}
            preferredFocus
            onLaunch={launchAction}
          />
        </View>

        <View style={[styles.rightColumn, { width: '52%' }]}>
          <Text style={[styles.portalLabel, { fontSize: 23 * scale }]}>PORTAL</Text>
          <View style={styles.menuList}>
            {MENU_ITEMS.map((item, index) => (
              <PortalMenuItem
                key={item.id}
                item={item}
                index={index}
                scale={scale}
                preferred={!canEnterApp && index === 0}
                onPress={() => menuAction(item.id)}
              />
            ))}
          </View>
        </View>
      </PortalFocusGuide>
      </View>

      <Modal visible={pairingVisible} animationType="slide" onRequestClose={closePairing}>
        <View style={styles.modalRoot}>
          <PairingScreen
            returnToPortal
            onPairingComplete={closePairing}
          />
          <Pressable accessible accessibilityRole="button" accessibilityLabel="Close pairing" focusable onPress={closePairing} style={styles.closeButton}>
            <MaterialCommunityIcons name="close" size={25} color={novaTheme.colors.textPrimary} />
            <Text style={styles.closeLabel}>Close</Text>
          </Pressable>
        </View>
      </Modal>

      <Modal
        visible={panel !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setPanel(null)}
        onShow={() => {
          const focusTarget =
            panel === 'diagnostics' || providers.length === 0 ? panelCloseRef.current : panelFirstFocusRef.current;
          focusNativeViewWhenReady(() => focusTarget, () => {
            focusTarget?.focus();
          });
        }}>
        <View style={styles.panelBackdrop}>
          <View style={styles.panelScrim} pointerEvents="none" />
          <PanelFocusGuide
            style={styles.panelFocusGuide}
            {...(Platform.OS === 'android'
              ? {
                  autoFocus: true,
                  trapFocusLeft: true,
                  trapFocusRight: true,
                  trapFocusUp: true,
                  trapFocusDown: true,
                }
              : {})}>
            <View style={styles.panel}>
              <View style={styles.panelHeader}>
                <Text style={styles.panelTitle}>
                  {panel === 'switch' ? 'Switch Provider' : panel === 'manage' ? 'Manage Providers' : 'Diagnostics'}
                </Text>
                <PortalPanelCloseButton
                  focusRef={panel === 'diagnostics' || providers.length === 0 ? panelCloseRef : undefined}
                  onPress={() => setPanel(null)}
                />
              </View>
              {panel === 'switch' ? (
                <>
                  <Text style={styles.panelHint}>Choose which saved provider NovaCast should use.</Text>
                  {providers.map((provider, index) => (
                    <PortalSwitchProviderRow
                      key={provider.id}
                      provider={provider}
                      selected={provider.id === selectedProvider?.id}
                      preferredFocus={index === 0}
                      focusRef={index === 0 ? panelFirstFocusRef : undefined}
                      onPress={() => void selectAndContinue(provider.id)}
                    />
                  ))}
                  {!providers.length ? <Text style={styles.diagnosticCopy}>No saved providers are available.</Text> : null}
                </>
              ) : panel === 'manage' ? (
                <>
                  <Text style={styles.panelHint}>
                    Review saved providers or reset pairing. Reset pairing keeps this TV’s identity and only removes the provider.
                  </Text>
                  {providers.map((provider, index) => (
                    <PortalManageProviderRow
                      key={provider.id}
                      provider={provider}
                      selected={provider.id === selectedProvider?.id}
                      preferredFocus={index === 0}
                      focusRef={index === 0 ? panelFirstFocusRef : undefined}
                      onPress={() => void selectAndContinue(provider.id)}
                    />
                  ))}
                  <PortalAddProviderButton
                    preferredFocus={providers.length === 0}
                    focusRef={providers.length === 0 ? panelFirstFocusRef : undefined}
                    onPress={() => {
                      setPanel(null);
                      openPairing();
                    }}
                  />
                  <PortalActionButton
                    label="Reset Pairing"
                    accessibilityLabel="Reset pairing and keep this device identity"
                    icon="link-off"
                    onPress={() => void handleResetPairing()}
                  />
                </>
              ) : (
                <>
                  <Text style={styles.diagnosticCopy}>
                    Provider runtime: {getProviderRuntime().lastError ?? 'No active errors'}
                    {`\n`}Saved providers: {providers.length}
                    {`\n`}Active provider: {selectedProvider?.name ?? 'None'}
                    {`\n`}Device status: {device.status?.status ?? 'Unknown'}
                    {`\n`}Activation: {device.status?.activationStatus ?? 'Unknown'}
                  </Text>
                  <PortalActionButton
                    label="Factory Reset NovaCast"
                    accessibilityLabel="Factory reset NovaCast and create a new device identity"
                    icon="delete-forever-outline"
                    danger
                    preferredFocus={providers.length === 0}
                    focusRef={panelFirstFocusRef}
                    onPress={() => void handleFactoryReset()}
                  />
                </>
              )}
            </View>
          </PanelFocusGuide>
        </View>
      </Modal>
      <ExitConfirmOverlay
        visible={exitConfirmVisible}
        onCancel={() => setExitConfirmVisible(false)}
        onConfirm={() => {
          setExitConfirmVisible(false);
          BackHandler.exitApp();
        }}
      />
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#020611' },
  portalRoot: { flex: 1 },
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0, 3, 12, 0.18)' },
  content: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  leftColumn: { justifyContent: 'center', gap: 12 },
  rightColumn: { justifyContent: 'center' },
  logo: { alignSelf: 'flex-start', marginBottom: -4 },
  welcome: { color: '#F5F8FF', fontWeight: '700', letterSpacing: -1.2 },
  deviceStatus: { color: '#7DD3FC', fontWeight: '700', letterSpacing: 1.1, marginTop: -5 },
  activationLayout: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 60 },
  activationCopy: { width: '55%', justifyContent: 'center' },
  activationTitle: { color: '#F5F8FF', fontWeight: '700', marginTop: 12 },
  activationBody: { color: '#AAB6CC', lineHeight: 29, marginTop: 18, maxWidth: 620 },
  deviceCodeLabel: { color: '#00AEEF', fontWeight: '700', letterSpacing: 2, marginTop: 28 },
  deviceCode: { color: '#F5F8FF', fontWeight: '800', letterSpacing: 4, marginTop: 7 },
  activationActions: { flexDirection: 'row', gap: 12, marginTop: 30, flexWrap: 'wrap' },
  activationButton: { minHeight: 58, paddingHorizontal: 22, borderRadius: 12, backgroundColor: '#087CE8', justifyContent: 'center', borderWidth: 1, borderColor: '#56D5FF' },
  activationButtonSecondary: { minHeight: 58, paddingHorizontal: 22, borderRadius: 12, backgroundColor: 'rgba(5,24,66,.9)', justifyContent: 'center', borderWidth: 1, borderColor: '#3D7FDC' },
  activationButtonText: { color: '#F5F8FF', fontSize: 17, fontWeight: '700' },
  activationQrCard: { minWidth: 320, minHeight: 360, padding: 28, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(4,13,31,.9)', borderWidth: 1, borderColor: '#3D7FDC' },
  qrHint: { color: '#AAB6CC', fontSize: 16, marginTop: 18 },
  providerCard: {
    paddingHorizontal: 38,
    paddingVertical: 30,
    borderRadius: 18,
    backgroundColor: GLASS.fill,
    borderWidth: 1,
    borderColor: GLASS.borderBright,
    justifyContent: 'space-between',
  },
  providerCardStatic: {
    borderRadius: 20,
  },
  providerCardLaunch: {
    overflow: 'hidden',
  },
  providerCardFocused: {
    backgroundColor: GLASS.fillFocus,
    borderColor: GLASS.borderFocus,
  },
  providerNameFocused: {
    color: novaTheme.colors.accentHover,
    textShadowColor: novaTheme.colors.focusRing,
    textShadowRadius: 8,
  },
  cardLaunchHint: { marginLeft: 'auto' },
  statusLine: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  statusDot: { width: 14, height: 14, borderRadius: 7 },
  connected: { backgroundColor: '#20E878' },
  notConnected: { backgroundColor: '#18D7FF' },
  statusText: { color: '#F5F8FF', fontWeight: '600' },
  providerMain: { flexDirection: 'row', alignItems: 'center', gap: 28 },
  tvIcon: {
    borderWidth: 1,
    borderColor: GLASS.borderBright,
    backgroundColor: GLASS.accentFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  providerCopy: { flex: 1, minWidth: 0 },
  providerName: { color: '#F5F8FF', fontWeight: '700' },
  expiration: { color: '#AAB6CC', marginTop: 6 },
  cardDivider: { height: 1, backgroundColor: 'rgba(126, 157, 207, 0.3)' },
  counts: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around' },
  countGroup: { flex: 1, flexDirection: 'row', justifyContent: 'center' },
  countCopy: { alignItems: 'center', minWidth: 92 },
  countLabel: { color: '#00AEEF', fontWeight: '600' },
  countValue: { color: '#F5F8FF', fontWeight: '500', marginTop: 4 },
  countDivider: { width: 1, backgroundColor: 'rgba(126, 157, 207, 0.35)', marginRight: 18 },
  emptyCounts: { color: '#AAB6CC', textAlign: 'center', fontSize: 16 },
  error: { color: '#FF9CA7', fontSize: 14 },
  portalLabel: { color: '#00AEEF', fontWeight: '700', letterSpacing: 6, marginBottom: 24 },
  menuList: { gap: 12 },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 34,
    gap: 26,
    borderRadius: 18,
    backgroundColor: GLASS.fill,
    borderWidth: 1,
    borderColor: GLASS.border,
    elevation: 0,
    shadowOpacity: 0,
    shadowRadius: 0,
  },
  menuItemFocused: {
    backgroundColor: GLASS.fillFocus,
    borderColor: GLASS.borderFocus,
    elevation: 0,
    shadowOpacity: 0,
    shadowRadius: 0,
  },
  menuTitleFocused: { color: novaTheme.colors.accentHover },
  menuSubtitleFocused: { color: '#D7E6FF' },
  menuCopy: { flex: 1, minWidth: 0 },
  menuTitle: { color: '#F5F8FF', fontWeight: '700' },
  menuSubtitle: { color: '#AAB6CC', marginTop: 4 },
  modalRoot: { flex: 1, backgroundColor: '#020611' },
  closeButton: { position: 'absolute', top: 22, right: 28, padding: 10, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(17,21,28,0.92)' },
  closeLabel: { color: '#F5F8FF', fontWeight: '700' },
  panelBackdrop: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 48 },
  panelScrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(7, 9, 13, 0.88)' },
  panelFocusGuide: { flex: 1, width: '100%', justifyContent: 'center', alignItems: 'center' },
  panel: {
    width: '100%',
    maxWidth: 760,
    padding: 26,
    borderRadius: 18,
    backgroundColor: GLASS.fillStrong,
    borderWidth: 1,
    borderColor: GLASS.borderBright,
    shadowColor: '#000000',
    shadowOpacity: 0.35,
    shadowRadius: 24,
    elevation: 12,
  },
  panelHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 14, gap: 12 },
  panelCloseButton: {
    width: 44,
    height: 44,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: GLASS.fill,
    borderWidth: 1,
    borderColor: GLASS.border,
  },
  panelCloseButtonFocused: {
    shadowColor: novaTheme.colors.focusRing,
    shadowOpacity: 0.65,
    shadowRadius: 7,
  },
  panelTitle: { flex: 1, color: '#F5F8FF', fontSize: 25, fontWeight: '800' },
  panelHint: { color: '#AAB6CC', fontSize: 16, lineHeight: 23, marginBottom: 14 },
  providerRow: {
    minHeight: 76,
    padding: 16,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: GLASS.border,
    backgroundColor: GLASS.fill,
    marginBottom: 10,
  },
  providerRowFocused: {
    borderColor: GLASS.borderFocus,
    backgroundColor: GLASS.fillFocus,
    shadowColor: novaTheme.colors.focusRing,
    shadowOpacity: 0.55,
    shadowRadius: 8,
  },
  manageRow: {
    minHeight: 76,
    padding: 16,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: GLASS.border,
    backgroundColor: GLASS.fill,
    marginBottom: 10,
  },
  providerRowCopy: { flex: 1, gap: 5 },
  providerRowName: { color: '#F5F8FF', fontSize: 18, fontWeight: '800' },
  providerRowNameFocused: { color: novaTheme.colors.accentHover },
  providerRowStatus: { color: '#AAB6CC', fontSize: 14 },
  useButton: {
    paddingHorizontal: 15,
    paddingVertical: 9,
    borderRadius: 9,
    backgroundColor: GLASS.accentFill,
    borderWidth: 1,
    borderColor: GLASS.borderBright,
  },
  useButtonFocused: {
    borderColor: GLASS.borderFocus,
    backgroundColor: GLASS.fillFocus,
    shadowColor: novaTheme.colors.focusRing,
    shadowOpacity: 0.65,
    shadowRadius: 7,
  },
  useButtonText: { color: '#18D7FF', fontWeight: '700' },
  useButtonTextFocused: { color: novaTheme.colors.accentHover },
  addProviderButton: {
    minHeight: 52,
    marginTop: 4,
    paddingHorizontal: 16,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: GLASS.fill,
    borderWidth: 1,
    borderColor: GLASS.border,
  },
  dangerActionButton: {
    borderColor: 'rgba(255, 116, 139, 0.55)',
    backgroundColor: 'rgba(80, 18, 36, 0.72)',
  },
  dangerActionButtonFocused: {
    borderColor: GLASS.borderFocus,
    backgroundColor: 'rgba(90, 24, 42, 0.92)',
    shadowColor: novaTheme.colors.focusRing,
    shadowOpacity: 0.65,
    shadowRadius: 7,
  },
  addProviderButtonFocused: {
    borderColor: GLASS.borderFocus,
    backgroundColor: GLASS.fillFocus,
    shadowColor: novaTheme.colors.focusRing,
    shadowOpacity: 0.65,
    shadowRadius: 7,
  },
  addProviderText: { color: '#F5F8FF', fontSize: 16, fontWeight: '700' },
  addProviderTextFocused: { color: novaTheme.colors.accentHover },
  diagnosticCopy: { color: '#AAB6CC', fontSize: 16, lineHeight: 28, paddingVertical: 10 },
});
