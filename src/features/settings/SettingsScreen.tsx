import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, findNodeHandle, Platform, StyleSheet, Text, View } from 'react-native';
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';

import { NovaButton, NovaScreen, NovaSpaceLoader, NovaTvShell } from '@/components/nova';
import { NOVA_GLASS } from '@/components/nova/novaGlassTheme';
import { wrapOnnMoviesBackHandler } from '@/features/diagnostics/onnMoviesTrace';
import { TV_HOME_ROUTE } from '@/features/navigation/tvRoutes';
import { createTvNavigationGate, tryAcquireTvNavigationGate } from '@/features/navigation/tvNavigation';
import { useAppNotification } from '@/features/notifications/useAppNotification';
import { ONBOARDING_GUIDES } from '@/features/onboarding/onboardingGuides';
import { WalkthroughOverlay } from '@/features/onboarding/WalkthroughOverlay';
import { resetOnboarding } from '@/features/onboarding/onboardingStore';
import { useGuideWalkthrough } from '@/features/onboarding/useGuideWalkthrough';
import { useAccessExpirationDisplay } from '@/features/device/betaAccessCountdown';
import { getSafeDeviceDiagnostics } from '@/features/device/deviceDiagnostics';
import { useMoviesSettingsStore } from '@/features/movies/smart/moviesSettingsStore';
import { useProviderLibrarySummary } from '@/features/providers/providerLibrarySummaryStore';
import { retryProviderInitialization, useProviderStore } from '@/features/providers/providerStore';
import { useNovaPulseProviderHealth } from '@/features/providers/providerHealth';
import { resolveProviderAccess, type ProviderAccessState } from '@/features/providers/providerAccess';
import { clearAssignmentRetryBackoff } from '@/features/device/deviceAssignmentReconcile';
import { logOverlayFocus } from '@/features/diagnostics/overlayFocusDiagnostics';
import { getOfflineSnapshot } from '@/features/resilience/offlineStatus';
import { buildDiagnosticCode, getSanitizedDiagnostics } from '@/features/resilience/sanitizedDiagnostics';
import { useAppTheme } from '@/theme/AppThemeProvider';
import { novaTheme } from '@/theme';

import {
  useAppSettingsStore,
} from './appSettingsStore';
import { SettingsDetailPanel } from './components/SettingsDetailPanel';
import { SettingsRail, type SettingsSectionId } from './components/SettingsRail';
import {
  resolveSettingsActionNotification,
  SETTINGS_ACTION_NOTIFICATION_ID,
  SETTINGS_NOTIFICATION_DURATION_MS,
  type SettingsActionKind,
} from './settingsScreenLogic';

function formatSyncLabel(timestamp: number) {
  if (!timestamp) {
    return 'Not synced yet';
  }

  return new Date(timestamp).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function SettingsScreen() {
  const router = useRouter();
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const navigationGateRef = useRef(createTvNavigationGate());
  const settingsRetryAttemptedRef = useRef(false);
  const lastRetryAtRef = useRef(0);
  const [selectedSection, setSelectedSection] = useState<SettingsSectionId>('account');
  const [detailFocusHandle, setDetailFocusHandle] = useState<number | undefined>();
  const [railFocusHandle, setRailFocusHandle] = useState<number | undefined>();
  const [failedAction, setFailedAction] = useState<SettingsActionKind | null>(null);
  const guide = useGuideWalkthrough(ONBOARDING_GUIDES.settings.key);
  const { hideSmartCategories, setHideSmartCategories } = useMoviesSettingsStore();
  const {
    selectedProvider,
    selectedProviderLabel,
    selectedProviderExpiration,
    providerInitialized,
    isSwitchingProvider,
    providerSwitchError,
    ready: providerStoreReady,
    bundleGeneration,
  } = useProviderStore();
  const providerHealth = useNovaPulseProviderHealth(selectedProvider?.id ?? '', bundleGeneration);
  const providerAccess = resolveProviderAccess({
    ready: providerStoreReady,
    provider: selectedProvider,
    providerHealth,
    providerInitialized,
    isSwitchingProvider,
    providerSwitchError,
  });
  const accessExpiration = useAccessExpirationDisplay({
    provider: selectedProvider,
    account: selectedProvider?.account ?? null,
  });
  const providerId = selectedProvider?.id ?? 'no-provider';
  const { summary } = useProviderLibrarySummary(providerId);
  const {
    settings,
    pinConfigured,
    setAppearanceTheme,
    setPlaybackQuality,
    setPlaybackAudio,
    setAutoplayNextEpisode,
    setResumePlayback,
    setParentalEnabled,
    setParentalMaxRating,
    setParentalPin,
    clearParentalPin,
  } = useAppSettingsStore();
  const { showNotification, dismissNotification, clearScope } = useAppNotification();

  const handleSelectSection = useCallback(
    (id: SettingsSectionId) => {
      if (id !== selectedSection) {
        setDetailFocusHandle(undefined);
      }
      setSelectedSection(id);
    },
    [selectedSection],
  );

  const railItems = useMemo(
    () => [
      { id: 'account' as const, icon: 'account-circle-outline' as const, title: 'Account' },
      { id: 'playback' as const, icon: 'play-circle-outline' as const, title: 'Playback' },
      { id: 'appearance' as const, icon: 'palette-outline' as const, title: 'Appearance' },
      { id: 'parental' as const, icon: 'shield-lock-outline' as const, title: 'Parental Controls' },
      { id: 'smart-categories' as const, icon: 'compass-outline' as const, title: 'Discover Zone' },
      { id: 'about' as const, icon: 'information-outline' as const, title: 'About' },
    ],
    [],
  );

  const accountInfo = useMemo(
    () => ({
      providerName: selectedProvider?.name ?? 'No provider connected',
      providerStatus: providerInitialized ? 'Connected' : selectedProvider ? 'Unavailable' : 'Not connected',
      expirationCaption: accessExpiration.caption,
      expirationLabel: accessExpiration.closedBeta
        ? accessExpiration.value
        : (selectedProviderExpiration ?? 'Unknown'),
      connectionType: selectedProvider?.connection?.type === 'xtream' ? 'Xtream Codes' : selectedProvider ? 'Provider' : 'None',
      username: selectedProvider?.connection?.type === 'xtream' ? 'Linked account' : '—',
      initialized: providerInitialized,
      movieCount: summary.movieCount,
      seriesCount: summary.seriesCount,
      liveChannelCount: summary.liveChannelCount,
      lastSyncLabel: formatSyncLabel(summary.lastProviderSyncAt),
    }),
    [accessExpiration, providerInitialized, selectedProvider, selectedProviderExpiration, summary],
  );

  const betaSupport = useMemo(() => {
    const device = getSafeDeviceDiagnostics();
    const network = getOfflineSnapshot().status;
    const lastError = getSanitizedDiagnostics().at(-1)?.errorType;
    return {
      deviceId: device.deviceId,
      deviceModel: Constants.deviceName ?? Platform.OS,
      osVersion: String(Platform.Version),
      activation: device.activation,
      network,
      diagnosticCode: buildDiagnosticCode({
        version: Constants.expoConfig?.version ?? '1.0.1',
        activation: device.activation,
        network,
        lastErrorType: lastError,
      }),
    };
  }, [selectedProvider?.id, summary.lastProviderSyncAt]);

  useEffect(() => {
    if (Platform.OS !== 'android') {
      return;
    }

    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      wrapOnnMoviesBackHandler(
        'settings',
        () => {
          if (guide.visible) {
            return true;
          }

          if (!tryAcquireTvNavigationGate(navigationGateRef.current)) {
            return true;
          }

          router.replace(TV_HOME_ROUTE);
          return true;
        },
        () => ({
          screen: 'SettingsScreen',
          guideVisible: guide.visible,
        }),
      ),
    );

    return () => subscription.remove();
  }, [guide.visible, router]);

  const toggleSmartCategories = useCallback(async () => {
    try {
      await setHideSmartCategories(!hideSmartCategories);
      setFailedAction(null);
      settingsRetryAttemptedRef.current = false;
    } catch {
      setFailedAction('smart-categories');
    }
  }, [hideSmartCategories, setHideSmartCategories]);

  const replayGuides = useCallback(async () => {
    try {
      await resetOnboarding();
      setFailedAction(null);
      settingsRetryAttemptedRef.current = false;
      guide.reopen();
    } catch {
      setFailedAction('replay-guides');
    }
  }, [guide]);

  const suppressGuides = useCallback(async () => {
    try {
      await guide.suppressAll();
      setFailedAction(null);
      settingsRetryAttemptedRef.current = false;
    } catch {
      setFailedAction('suppress-guides');
    }
  }, [guide]);

  const handleSettingsRetry = useCallback(() => {
    const now = Date.now();
    if (!failedAction || now - lastRetryAtRef.current < 400) {
      return;
    }

    lastRetryAtRef.current = now;
    settingsRetryAttemptedRef.current = true;

    if (failedAction === 'smart-categories') {
      void toggleSmartCategories();
      return;
    }

    if (failedAction === 'replay-guides') {
      void replayGuides();
      return;
    }

    void suppressGuides();
  }, [failedAction, replayGuides, suppressGuides, toggleSmartCategories]);

  useEffect(() => {
    const spec = resolveSettingsActionNotification(failedAction, settingsRetryAttemptedRef.current);
    if (!spec) {
      dismissNotification(SETTINGS_ACTION_NOTIFICATION_ID);
      return;
    }

    showNotification({
      id: SETTINGS_ACTION_NOTIFICATION_ID,
      type: 'error',
      title: spec.title,
      message: spec.message,
      duration: SETTINGS_NOTIFICATION_DURATION_MS,
      persistent: spec.persistent,
      position: 'bottom-right',
      scope: 'settings',
    });
  }, [dismissNotification, failedAction, showNotification]);

  useEffect(() => {
    return () => {
      clearScope('settings');
    };
  }, [clearScope]);

  if (providerAccess.state !== 'allowed') {
    return <RestrictedSettingsSurface state={providerAccess.state} />;
  }

  return (
    <NovaTvShell
      activeId="settings"
      providerLabel={selectedProviderLabel}
      compactNavigationRail>
      <View style={styles.screen}>
        <View style={styles.topBar}>
          <View style={styles.headingBlock}>
            <Text style={styles.heading}>Settings</Text>
            <Text style={styles.copy}>Manage NovaCast without the clutter.</Text>
          </View>
        </View>

        <View style={styles.contentRow}>
          <SettingsRail
            items={railItems}
            selectedId={selectedSection}
            onSelect={handleSelectSection}
            nextFocusRightHandle={selectedSection === 'account' ? undefined : detailFocusHandle}
            onSelectedFocusHandleReady={setRailFocusHandle}
          />

          <SettingsDetailPanel
            sectionId={selectedSection}
            settings={settings}
            pinConfigured={pinConfigured}
            hideSmartCategories={hideSmartCategories}
            account={accountInfo}
            betaSupport={betaSupport}
            onAppearanceTheme={(value) => void setAppearanceTheme(value)}
            onPlaybackQuality={(value) => void setPlaybackQuality(value)}
            onPlaybackAudio={(value) => void setPlaybackAudio(value)}
            onAutoplayNextEpisode={(value) => void setAutoplayNextEpisode(value)}
            onResumePlayback={(value) => void setResumePlayback(value)}
            onParentalEnabled={(value) => void setParentalEnabled(value)}
            onParentalMaxRating={(value) => void setParentalMaxRating(value)}
            onSavePin={setParentalPin}
            onClearPin={async () => {
              await clearParentalPin();
              await setParentalEnabled(false);
            }}
            onToggleSmartCategories={() => void toggleSmartCategories()}
            onReplayGuides={() => void replayGuides()}
            onSuppressGuides={() => void suppressGuides()}
            onFocusHandleReady={setDetailFocusHandle}
            nextFocusLeftHandle={railFocusHandle}
          />
        </View>
      </View>

      <WalkthroughOverlay
        key={guide.visible ? 'settings-guide-open' : 'settings-guide-closed'}
        visible={guide.visible}
        title={ONBOARDING_GUIDES.settings.title}
        steps={ONBOARDING_GUIDES.settings.steps}
        onDismiss={guide.dismiss}
        onSkip={guide.skip}
        onDontShowAgain={guide.dontShowAgain}
        onComplete={guide.complete}
      />
    </NovaTvShell>
  );
}

function RestrictedSettingsSurface({ state }: { state: ProviderAccessState }) {
  const router = useRouter();
  const [retrying, setRetrying] = useState(false);
  const [focusTargets, setFocusTargets] = useState({ portal: null as number | null, pair: null as number | null, retry: null as number | null });
  const portalRef = useRef<View | null>(null);
  const pairRef = useRef<View | null>(null);
  const retryRef = useRef<View | null>(null);
  const retryAvailable = state !== 'no_provider';

  useEffect(() => {
    setFocusTargets({
      portal: findNodeHandle(portalRef.current),
      pair: findNodeHandle(pairRef.current),
      retry: retryAvailable ? findNodeHandle(retryRef.current) : null,
    });
  }, [retryAvailable]);

  const retry = async () => {
    if (retrying) return;
    setRetrying(true);
    clearAssignmentRetryBackoff();
    try {
      await retryProviderInitialization();
    } catch {
      // The provider access gate will continue to expose the restricted state.
    } finally {
      setRetrying(false);
    }
  };

  if (retrying) {
    return <View style={restrictedStyles.screen}><NovaSpaceLoader label="Checking your provider…" /></View>;
  }

  return (
    <NovaScreen padded={false} contentStyle={restrictedStyles.screenFrame}>
      <View style={restrictedStyles.screen}>
        <View style={restrictedStyles.card}>
          <Text style={restrictedStyles.badge}>LIMITED SETTINGS</Text>
          <Text style={restrictedStyles.title}>Provider access required</Text>
          <Text style={restrictedStyles.message}>
            Settings is available for recovery, but Home, Movies, Series, Live, Guide, and Search remain locked until provider access is confirmed.
          </Text>
          <View style={restrictedStyles.actions}>
            <NovaButton
              label="Provider Portal"
              nativeRef={portalRef}
              hasTVPreferredFocus
              nextFocusDown={focusTargets.pair ?? undefined}
              onFocus={() => logOverlayFocus('restricted-settings', 'provider-portal', 'focus-received')}
              onPress={() => { logOverlayFocus('restricted-settings', 'provider-portal', 'press'); router.replace('/'); }}
              style={restrictedStyles.action}
            />
            <NovaButton
              label="Pair Provider"
              nativeRef={pairRef}
              nextFocusUp={focusTargets.portal ?? undefined}
              nextFocusDown={(retryAvailable ? focusTargets.retry : focusTargets.portal) ?? undefined}
              onFocus={() => logOverlayFocus('restricted-settings', 'pair-provider', 'focus-received')}
              onPress={() => { logOverlayFocus('restricted-settings', 'pair-provider', 'press'); router.replace('/pair'); }}
              style={restrictedStyles.action}
            />
            {retryAvailable ? (
              <NovaButton
                label="Retry Provider"
                nativeRef={retryRef}
                nextFocusUp={focusTargets.pair ?? undefined}
                onFocus={() => logOverlayFocus('restricted-settings', 'retry-provider', 'focus-received')}
                onPress={() => { logOverlayFocus('restricted-settings', 'retry-provider', 'press'); void retry(); }}
                style={restrictedStyles.action}
              />
            ) : null}
          </View>
        </View>
      </View>
    </NovaScreen>
  );
}

const restrictedStyles = StyleSheet.create({
  screenFrame: { flex: 1 },
  screen: { flex: 1, backgroundColor: novaTheme.colors.background, alignItems: 'center', justifyContent: 'center', padding: 48 },
  card: { width: '72%', maxWidth: 1100, padding: 48, borderRadius: NOVA_GLASS.radius.base, backgroundColor: 'rgba(7,9,22,0.82)', borderWidth: 1, borderColor: NOVA_GLASS.focused.borderColor },
  badge: { color: NOVA_GLASS.text.secondary, fontSize: 18, fontWeight: '800', letterSpacing: 2 },
  title: { color: NOVA_GLASS.text.primary, fontSize: 42, fontWeight: '800', marginTop: 18 },
  message: { color: NOVA_GLASS.text.secondary, fontSize: 24, lineHeight: 34, marginTop: 16 },
  actions: { flexDirection: 'row', gap: 18, marginTop: 34 },
  action: { minWidth: 190, minHeight: 60, paddingHorizontal: 24, paddingVertical: 18, borderRadius: NOVA_GLASS.radius.base, backgroundColor: NOVA_GLASS.active.backgroundColor, borderColor: NOVA_GLASS.active.borderColor },
});

function createStyles(theme: ReturnType<typeof useAppTheme>['theme']) {
  return StyleSheet.create({
    screen: {
      flex: 1,
      minHeight: 0,
      paddingTop: 4,
      gap: 12,
    },
    topBar: {
      minHeight: 48,
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: 12,
    },
    headingBlock: {
      flex: 1,
      minWidth: 0,
    },
    heading: {
      color: theme.colors.textPrimary,
      fontSize: 32,
      fontWeight: '900',
      letterSpacing: -0.5,
    },
    copy: {
      marginTop: 2,
      color: theme.colors.textSecondary,
      fontSize: 14,
    },
    contentRow: {
      flex: 1,
      minHeight: 0,
      flexDirection: 'row',
      gap: 14,
      alignItems: 'stretch',
    },
  });
}
