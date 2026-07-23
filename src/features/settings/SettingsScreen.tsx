import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, Platform, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { NovaTvShell } from '@/components/nova';
import { TV_HOME_ROUTE } from '@/features/navigation/tvRoutes';
import { createTvNavigationGate, tryAcquireTvNavigationGate } from '@/features/navigation/tvNavigation';
import { useAppNotification } from '@/features/notifications/useAppNotification';
import { ONBOARDING_GUIDES } from '@/features/onboarding/onboardingGuides';
import { WalkthroughOverlay } from '@/features/onboarding/WalkthroughOverlay';
import { resetOnboarding } from '@/features/onboarding/onboardingStore';
import { useGuideWalkthrough } from '@/features/onboarding/useGuideWalkthrough';
import { useMoviesSettingsStore } from '@/features/movies/smart/moviesSettingsStore';
import { useProviderLibrarySummary } from '@/features/providers/providerLibrarySummaryStore';
import { useProviderStore } from '@/features/providers/providerStore';
import { useAppTheme } from '@/theme/AppThemeProvider';

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
  } = useProviderStore();
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
      { id: 'smart-categories' as const, icon: 'compass-outline' as const, title: 'Smart Categories' },
      { id: 'about' as const, icon: 'information-outline' as const, title: 'About' },
    ],
    [],
  );

  const accountInfo = useMemo(
    () => ({
      providerName: selectedProvider?.name ?? 'No provider connected',
      providerStatus: providerInitialized ? 'Connected' : selectedProvider ? 'Unavailable' : 'Not connected',
      expirationLabel: selectedProviderExpiration ?? 'Unknown',
      connectionType: selectedProvider?.connection?.type === 'xtream' ? 'Xtream Codes' : selectedProvider ? 'Provider' : 'None',
      username: selectedProvider?.connection?.type === 'xtream' ? 'Linked account' : '—',
      initialized: providerInitialized,
      movieCount: summary.movieCount,
      seriesCount: summary.seriesCount,
      liveChannelCount: summary.liveChannelCount,
      lastSyncLabel: formatSyncLabel(summary.lastProviderSyncAt),
    }),
    [providerInitialized, selectedProvider, selectedProviderExpiration, summary],
  );

  useEffect(() => {
    if (Platform.OS !== 'android') {
      return;
    }

    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (guide.visible) {
        return true;
      }

      if (!tryAcquireTvNavigationGate(navigationGateRef.current)) {
        return true;
      }

      router.replace(TV_HOME_ROUTE);
      return true;
    });

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
      actionLabel: 'Retry',
      onAction: handleSettingsRetry,
      duration: SETTINGS_NOTIFICATION_DURATION_MS,
      persistent: spec.persistent,
      position: 'bottom-right',
      scope: 'settings',
    });
  }, [dismissNotification, failedAction, handleSettingsRetry, showNotification]);

  useEffect(() => {
    return () => {
      clearScope('settings');
    };
  }, [clearScope]);

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
