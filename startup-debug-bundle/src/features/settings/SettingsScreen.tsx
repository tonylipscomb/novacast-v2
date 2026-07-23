import { useCallback, useEffect, useRef, useState } from 'react';
import Constants from 'expo-constants';
import { BackHandler, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import { NovaLogo, NovaTvShell } from '@/components/nova';
import { createTvNavigationGate, tryAcquireTvNavigationGate } from '@/features/navigation/tvNavigation';
import { useAppNotification } from '@/features/notifications/useAppNotification';
import { ONBOARDING_GUIDES } from '@/features/onboarding/onboardingGuides';
import { WalkthroughOverlay } from '@/features/onboarding/WalkthroughOverlay';
import { resetOnboarding } from '@/features/onboarding/onboardingStore';
import { useGuideWalkthrough } from '@/features/onboarding/useGuideWalkthrough';
import { useMoviesSettingsStore } from '@/features/movies/smart/moviesSettingsStore';
import { useProviderStore } from '@/features/providers/providerStore';
import { novaTheme } from '@/theme';

import {
  resolveSettingsActionNotification,
  SETTINGS_ACTION_NOTIFICATION_ID,
  SETTINGS_NOTIFICATION_DURATION_MS,
  type SettingsActionKind,
} from './settingsScreenLogic';

const SETTINGS = [
  { id: 'account', icon: 'account-circle-outline' as const, title: 'Account', copy: 'Provider account' },
  { id: 'playback', icon: 'play-circle-outline' as const, title: 'Playback', copy: 'Auto quality · Stereo' },
  { id: 'appearance', icon: 'palette-outline' as const, title: 'Appearance', copy: 'Nova dark theme' },
  { id: 'parental', icon: 'shield-lock-outline' as const, title: 'Parental Controls', copy: 'Not configured' },
];

export function SettingsScreen() {
  const router = useRouter();
  const version = Constants.expoConfig?.version ?? '1.0.0';
  const navigationGateRef = useRef(createTvNavigationGate());
  const settingsRetryAttemptedRef = useRef(false);
  const lastRetryAtRef = useRef(0);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [failedAction, setFailedAction] = useState<SettingsActionKind | null>(null);
  const guide = useGuideWalkthrough(ONBOARDING_GUIDES.settings.key);
  const { hideSmartCategories, setHideSmartCategories } = useMoviesSettingsStore();
  const { selectedProvider, selectedProviderLabel } = useProviderStore();
  const { showNotification, dismissNotification, clearScope } = useAppNotification();

  const accountCopy = selectedProvider
    ? `${selectedProvider.name} connected`
    : 'No provider connected';

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

      router.replace('/content-hub');
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
    if (!failedAction) {
      settingsRetryAttemptedRef.current = false;
    }
  }, [failedAction]);

  useEffect(() => {
    return () => {
      clearScope('settings');
    };
  }, [clearScope]);

  return (
    <NovaTvShell
      activeId="settings"
      title="Settings"
      subtitle="Manage NovaCast without the clutter."
      providerLabel={selectedProviderLabel}>
      <View style={styles.layout}>
        <View style={styles.settingsList}>
          {SETTINGS.map((item, index) => {
            const focused = focusedId === item.id;
            const copy = item.id === 'account' ? accountCopy : item.copy;

            return (
              <Pressable
                key={item.id}
                focusable
                hasTVPreferredFocus={index === 0}
                onFocus={() => setFocusedId(item.id)}
                onBlur={() => setFocusedId(null)}
                style={[styles.settingRow, focused && styles.focused]}>
                <View style={styles.settingIcon}>
                  <MaterialCommunityIcons name={item.icon} size={25} color={focused ? '#FFFFFF' : novaTheme.colors.accentHover} />
                </View>
                <View style={styles.settingCopy}>
                  <Text style={styles.settingTitle}>{item.title}</Text>
                  <Text style={styles.settingMeta}>{copy}</Text>
                </View>
                <MaterialCommunityIcons name="chevron-right" size={24} color={novaTheme.colors.textMuted} />
              </Pressable>
            );
          })}

          <Pressable
            focusable
            onFocus={() => setFocusedId('smart-categories')}
            onBlur={() => setFocusedId(null)}
            onPress={() => void toggleSmartCategories()}
            style={[styles.settingRow, focusedId === 'smart-categories' && styles.focused]}>
            <View style={styles.settingIcon}>
              <MaterialCommunityIcons
                name="compass-outline"
                size={25}
                color={focusedId === 'smart-categories' ? '#FFFFFF' : novaTheme.colors.accentHover}
              />
            </View>
            <View style={styles.settingCopy}>
              <Text style={styles.settingTitle}>Smart Categories</Text>
              <Text style={styles.settingMeta}>
                {hideSmartCategories ? 'Discover collections hidden' : 'Show Discover collections'}
              </Text>
            </View>
            <MaterialCommunityIcons
              name={hideSmartCategories ? 'toggle-switch-off-outline' : 'toggle-switch'}
              size={28}
              color={hideSmartCategories ? novaTheme.colors.textMuted : novaTheme.colors.accentHover}
            />
          </Pressable>
        </View>

        <View style={styles.identityPanel}>
          <NovaLogo variant="mark" size="xl" />
          <Text style={styles.identityTitle}>NovaCast TV</Text>
          <Text style={styles.identityCopy}>Entertainment. Anytime. Anywhere.</Text>
          <View style={styles.identityDivider} />
          <View style={styles.versionRow}>
            <Text style={styles.versionLabel}>Version</Text>
            <Text style={styles.versionValue}>{version}</Text>
          </View>
          <View style={styles.versionRow}>
            <Text style={styles.versionLabel}>Build</Text>
            <Text style={styles.versionValue}>V2 Preview</Text>
          </View>
          <View style={styles.statusBadge}>
            <View style={styles.statusDot} />
            <Text style={styles.statusText}>System ready</Text>
          </View>

          <View style={styles.walkthroughBlock}>
            <Text style={styles.walkthroughLabel}>Walkthroughs</Text>
            <Pressable
              focusable
              onFocus={() => setFocusedId('replay')}
              onBlur={() => setFocusedId(null)}
              onPress={() => void replayGuides()}
              style={[styles.walkthroughButton, focusedId === 'replay' && styles.focused]}>
              <MaterialCommunityIcons name="reload" size={18} color={novaTheme.colors.textPrimary} />
              <Text style={styles.walkthroughButtonText}>Replay guides</Text>
            </Pressable>
            <Pressable
              focusable
              onFocus={() => setFocusedId('suppress')}
              onBlur={() => setFocusedId(null)}
              onPress={() => void suppressGuides()}
              style={[styles.walkthroughButton, focusedId === 'suppress' && styles.focused]}>
              <MaterialCommunityIcons name="shield-off-outline" size={18} color={novaTheme.colors.textPrimary} />
              <Text style={styles.walkthroughButtonText}>Disable guides</Text>
            </Pressable>
          </View>
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

const styles = StyleSheet.create({
  layout: { flex: 1, minHeight: 0, flexDirection: 'row', gap: 18 },
  settingsList: { flex: 1.2, gap: 10 },
  settingRow: { flex: 1, minHeight: 0, borderRadius: novaTheme.radius.lg, borderWidth: 2, borderColor: novaTheme.colors.borderSubtle, backgroundColor: novaTheme.colors.surface, flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 18 },
  settingIcon: { width: 50, height: 50, borderRadius: novaTheme.radius.md, backgroundColor: novaTheme.colors.surfaceMuted, alignItems: 'center', justifyContent: 'center' },
  settingCopy: { flex: 1 },
  settingTitle: { color: novaTheme.colors.textPrimary, fontSize: 19, fontWeight: '800' },
  settingMeta: { marginTop: 4, color: novaTheme.colors.textSecondary, fontSize: 13 },
  identityPanel: { flex: 0.8, minWidth: 320, borderRadius: novaTheme.radius.xl, borderWidth: 1, borderColor: novaTheme.colors.borderSubtle, backgroundColor: novaTheme.colors.backgroundRaised, alignItems: 'center', justifyContent: 'center', padding: 28 },
  identityTitle: { marginTop: -8, color: novaTheme.colors.textPrimary, fontSize: 29, fontWeight: '900' },
  identityCopy: { marginTop: 5, color: novaTheme.colors.textSecondary, fontSize: 14 },
  identityDivider: { width: '70%', height: 1, backgroundColor: novaTheme.colors.borderSubtle, marginVertical: 20 },
  versionRow: { width: '70%', flexDirection: 'row', justifyContent: 'space-between', marginBottom: 9 },
  versionLabel: { color: novaTheme.colors.textMuted, fontSize: 13 },
  versionValue: { color: novaTheme.colors.textPrimary, fontSize: 13, fontWeight: '700' },
  statusBadge: { marginTop: 18, borderRadius: 999, backgroundColor: 'rgba(51,211,154,0.10)', flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 12, paddingVertical: 7 },
  statusDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: novaTheme.colors.success },
  statusText: { color: novaTheme.colors.success, fontSize: 12, fontWeight: '700' },
  walkthroughBlock: {
    width: '100%',
    marginTop: 18,
    gap: 8,
  },
  walkthroughLabel: {
    color: novaTheme.colors.textMuted,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  walkthroughButton: {
    minHeight: 42,
    borderRadius: novaTheme.radius.md,
    borderWidth: 2,
    borderColor: 'transparent',
    backgroundColor: novaTheme.colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  walkthroughButtonText: {
    color: novaTheme.colors.textPrimary,
    fontSize: 13,
    fontWeight: '800',
  },
  focused: { borderColor: novaTheme.colors.focusRing, backgroundColor: novaTheme.colors.surfaceFocused, shadowColor: novaTheme.colors.focusRing, shadowOpacity: novaTheme.glow.focusShadowOpacity, shadowRadius: novaTheme.glow.focusShadowRadius },
});
