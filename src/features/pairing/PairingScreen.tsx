import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Platform, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import QRCode from 'react-native-qrcode-svg';
import { useRouter } from 'expo-router';

import { NovaButton, NovaLogo, NovaScreen, NovaSpaceLoader } from '@/components/nova';
import { useAppNotification } from '@/features/notifications/useAppNotification';
import { consumePendingPairingPayload } from '@/features/pairing/pairingBridge';
import {
  pairingTransactionFailure,
  pairingTransactionStart,
  pairingTransactionSuccess,
  runPairingTransactionStep,
} from '@/features/pairing/pairingTransactionLog';
import { markPairingCompleted } from '@/features/pairing/pairingState';
import { completePersistedPairing, usePairing } from '@/features/pairing/useMockPairing';
import { isPairingSetupInProgress } from '@/features/pairing/pairingResume';
import { logPairingEvent } from '@/features/pairing/pairingDiagnostics';
import { waitForHomeChannelsReady } from '@/features/pairing/waitForHomeChannelsReady';
import { getProviderState } from '@/features/providers/providerStore';
import { hasSavedProvider } from '@/features/providers/providerModel';
import { ONBOARDING_GUIDES } from '@/features/onboarding/onboardingGuides';
import { WalkthroughOverlay } from '@/features/onboarding/WalkthroughOverlay';
import { useGuideWalkthrough } from '@/features/onboarding/useGuideWalkthrough';
import {
  AUTH_NOTIFICATION_DURATION_MS,
  AUTH_PAIRING_NOTIFICATION_ID,
  resolveAuthPairingNotification,
} from '@/features/startup/authScreenLogic';
import { completeLaunchOverlay, getLaunchOverlayState, requestLaunchOverlayExit } from '@/features/startup/launchOverlay';
import { novaTheme } from '@/theme';

const PAIRING_HOME_ROUTE = '/main-menu';

const PAIRING_OVERSCAN = {
  top: 16,
  bottom: 16,
} as const;

const STEPS = [
  {
    icon: 'cellphone' as const,
    title: 'Scan the QR code',
    copy: 'Open your phone camera and scan the code on the right.',
  },
  {
    icon: 'link-variant' as const,
    title: 'Visit on your phone or computer',
    copy: 'Open the pairing link shown by the QR code.',
    accent: true,
  },
  {
    icon: 'form-textbox-password' as const,
    title: 'Enter the code below',
    copy: 'The TV connects automatically after setup is complete.',
  },
];

function PairingPulseText({ message, large = false }: { message: string; large?: boolean }) {
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0.2,
          duration: 650,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: 650,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );

    loop.start();
    return () => loop.stop();
  }, [opacity]);

  return (
    <Animated.Text
      accessibilityLiveRegion="polite"
      style={[styles.pulseText, large && styles.pulseTextLarge, { opacity }]}>
      {message}
    </Animated.Text>
  );
}

function isAwaitingServerActivation(status: string, isConnecting: boolean, connectionFailed: boolean) {
  return !isConnecting && !connectionFailed && (status === 'waiting' || status === 'initializing');
}

export function PairingScreen({
  returnToPortal = false,
  onPairingComplete,
}: {
  returnToPortal?: boolean;
  onPairingComplete?: () => void;
} = {}) {
  const router = useRouter();
  const completionRoute = PAIRING_HOME_ROUTE;
  const pairingRetryAttemptedRef = useRef(false);
  const lastPairingRetryAtRef = useRef(0);
  const pairingCompleteStartedRef = useRef(false);
  const pairingNavigationCompletedRef = useRef(false);
  const mountedRef = useRef(true);
  const { status, statusText, code, shortUrl, countdownLabel, regenerateCode, retrySession, isAvailable, connectionPayload } =
    usePairing();
  const guide = useGuideWalkthrough(ONBOARDING_GUIDES.pairing.key);
  const { showNotification, dismissNotification, clearScope } = useAppNotification();
  const [connectionFailed, setConnectionFailed] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [preparingChannels, setPreparingChannels] = useState(false);
  const [pairingAttempt, setPairingAttempt] = useState(0);
  const prepareCancelRef = useRef({ cancelled: false });

  const navigateHome = useCallback(async () => {
    onPairingComplete?.();
    if (returnToPortal) {
      return;
    }
    await runPairingTransactionStep(`router.replace('${completionRoute}')`, async () => {
      router.replace(completionRoute);
    });
  }, [completionRoute, onPairingComplete, returnToPortal, router]);

  const prepareChannelsThenHome = useCallback(async () => {
    if (returnToPortal) {
      await navigateHome();
      return;
    }

    setPreparingChannels(true);
    prepareCancelRef.current.cancelled = false;
    await runPairingTransactionStep('waitForHomeChannelsReady', () =>
      waitForHomeChannelsReady({ signal: prepareCancelRef.current }),
    );
    if (!mountedRef.current || prepareCancelRef.current.cancelled) {
      return;
    }
    await navigateHome();
  }, [navigateHome, returnToPortal]);

  const completePairing = useCallback(async () => {
    setIsConnecting(true);
    setConnectionFailed(false);
    setPreparingChannels(false);

    try {
      pairingTransactionStart('completePairing');

      const payload =
        connectionPayload ??
        (await runPairingTransactionStep('consumePendingPairingPayload', () => consumePendingPairingPayload()));

      if (payload) {
        await completePersistedPairing(payload);
      } else {
        const state = await runPairingTransactionStep('getProviderState', () => getProviderState());
        if (hasSavedProvider(state)) {
          pairingNavigationCompletedRef.current = true;
          await runPairingTransactionStep('markPairingCompleted', async () => {
            markPairingCompleted();
          });
          await prepareChannelsThenHome();
          pairingTransactionSuccess('completePairing', { path: 'existing-provider' });
          return;
        }

        throw new Error('Pairing session completed without provider details.');
      }

      if (!mountedRef.current) {
        pairingTransactionFailure('completePairing', new Error('Pairing screen unmounted before navigation'));
        return;
      }

      pairingRetryAttemptedRef.current = false;
      pairingNavigationCompletedRef.current = true;
      await prepareChannelsThenHome();
      pairingTransactionSuccess('completePairing');
    } catch (error) {
      pairingTransactionFailure('completePairing', error);

      if (!mountedRef.current) {
        return;
      }

      setConnectionFailed(true);
      setIsConnecting(false);
      setPreparingChannels(false);
    } finally {
      requestLaunchOverlayExit();
      setTimeout(() => {
        if (getLaunchOverlayState().visible) {
          completeLaunchOverlay();
        }
      }, 2_500);

      setTimeout(() => {
        if (!mountedRef.current || !pairingNavigationCompletedRef.current) {
          return;
        }

        logPairingEvent('navigation_fallback', { route: completionRoute, returnToPortal });
        onPairingComplete?.();
        if (!returnToPortal) {
          router.replace(completionRoute);
        }
      }, 1_500);
    }
  }, [completionRoute, connectionPayload, prepareChannelsThenHome, onPairingComplete, returnToPortal, router]);

  useEffect(() => {
    mountedRef.current = true;
    prepareCancelRef.current.cancelled = false;
    return () => {
      mountedRef.current = false;
      prepareCancelRef.current.cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (status === 'waiting' || status === 'failed' || status === 'binding_error' || status === 'expired') {
      pairingCompleteStartedRef.current = false;
      pairingNavigationCompletedRef.current = false;
      if (status !== 'waiting') {
        setIsConnecting(false);
        setPreparingChannels(false);
      }
    }
  }, [status]);

  useEffect(() => {
    // The Hub can intentionally open pairing to add another provider while one
    // is already saved. In that case do not treat the saved provider as a
    // startup-resume signal and immediately navigate away from the pairing UI.
    if (returnToPortal) {
      return;
    }

    let cancelled = false;

    void (async () => {
      if (pairingNavigationCompletedRef.current) {
        return;
      }

      const state = await getProviderState();
      if (cancelled || pairingNavigationCompletedRef.current || !hasSavedProvider(state)) {
        return;
      }

      pairingCompleteStartedRef.current = true;
      pairingNavigationCompletedRef.current = true;
      pairingTransactionStart('completePairing.resumeSavedProvider');
      onPairingComplete?.();
      await runPairingTransactionStep(`router.replace('${completionRoute}')`, async () => {
        router.replace(completionRoute);
      });
      pairingTransactionSuccess('completePairing.resumeSavedProvider');
      completeLaunchOverlay();
    })();

    return () => {
      cancelled = true;
    };
  }, [completionRoute, onPairingComplete, returnToPortal, router]);

  useEffect(() => {
    if (status !== 'connected' || !connectionPayload || pairingCompleteStartedRef.current) {
      return;
    }

    pairingCompleteStartedRef.current = true;
    setIsConnecting(true);
    void completePairing();
  }, [completePairing, connectionPayload, pairingAttempt, status]);

  const handlePairingRetry = useCallback(() => {
    const now = Date.now();
    if (now - lastPairingRetryAtRef.current < 400) {
      return;
    }

    lastPairingRetryAtRef.current = now;
    pairingRetryAttemptedRef.current = true;
    pairingCompleteStartedRef.current = false;
    pairingNavigationCompletedRef.current = false;
    setConnectionFailed(false);
    setIsConnecting(false);
    setPreparingChannels(false);
    setPairingAttempt((current) => current + 1);
    void retrySession();
  }, [retrySession]);

  useEffect(() => {
    const spec = resolveAuthPairingNotification(connectionFailed && !isConnecting, pairingRetryAttemptedRef.current);
    if (!spec) {
      dismissNotification(AUTH_PAIRING_NOTIFICATION_ID);
      return;
    }

    showNotification({
      id: AUTH_PAIRING_NOTIFICATION_ID,
      type: 'error',
      title: spec.title,
      message: spec.message,
      actionLabel: 'Retry',
      onAction: handlePairingRetry,
      duration: AUTH_NOTIFICATION_DURATION_MS,
      persistent: spec.persistent,
      position: 'bottom-right',
      scope: 'auth',
    });
  }, [connectionFailed, dismissNotification, handlePairingRetry, isConnecting, showNotification]);

  useEffect(() => {
    if (!connectionFailed) {
      pairingRetryAttemptedRef.current = false;
    }
  }, [connectionFailed]);

  useEffect(() => {
    return () => {
      clearScope('auth');
    };
  }, [clearScope]);

  const { height: windowHeight } = useWindowDimensions();
  const compact = Platform.isTV || windowHeight < 980;
  const layout = useMemo(
    () => ({
      qrCardSize: compact ? 152 : 240,
      qrPadding: compact ? 7 : 12,
      qrQuietZone: 3,
      codeCardHeight: compact ? 44 : 64,
      codeFontSize: compact ? 22 : 34,
      columnGap: compact ? 3 : 8,
      actionMinHeight: compact ? 40 : 52,
      actionWidth: compact ? 280 : 360,
      logoSize: compact ? ('sm' as const) : ('md' as const),
      leftGap: compact ? 5 : 12,
      stepsGap: compact ? 6 : 12,
      headingSize: compact ? 24 : 34,
      introSize: compact ? 13 : 16,
    }),
    [compact],
  );
  const qrCodeSize = layout.qrCardSize - layout.qrPadding * 2 - layout.qrQuietZone * 2;
  const awaitingActivation = isAwaitingServerActivation(status, isConnecting, connectionFailed);
  const setupInProgress = isPairingSetupInProgress(status, isConnecting);
  const codeExpired = status === 'expired';

  return (
    <NovaScreen
      padded={false}
      contentStyle={[
        styles.screenFrame,
        {
          paddingTop: novaTheme.safeArea.top + PAIRING_OVERSCAN.top,
          paddingBottom: novaTheme.safeArea.bottom + PAIRING_OVERSCAN.bottom,
        },
      ]}>
      <View style={styles.fitPage}>
        <View style={[styles.layout, compact && styles.layoutCompact]}>
          <View style={[styles.leftColumn, { gap: layout.leftGap }]}>
            <NovaLogo variant="full" size={layout.logoSize} subtitle={compact ? undefined : 'ENTERTAINMENT STARTS HERE'} />
            {!compact ? <View style={styles.rule} /> : null}
            <Text style={[styles.heading, { fontSize: layout.headingSize, lineHeight: layout.headingSize + 4 }]}>
              {setupInProgress ? (preparingChannels ? 'Preparing your channels…' : 'Setting up NovaCast...') : 'Pair your TV in seconds.'}
            </Text>
            <Text style={[styles.intro, { fontSize: layout.introSize, lineHeight: layout.introSize + 6 }]}>
              {setupInProgress
                ? preparingChannels
                  ? 'Provider connected. Loading live channels for Home…'
                  : 'Your phone setup is complete. Connecting your provider…'
                : isAvailable
                  ? compact
                    ? 'Scan the QR or enter the code on your phone. No passwords on the TV.'
                    : 'Set up NovaCast from your phone. No usernames or passwords are entered on the TV.'
                  : 'Pairing service unavailable. Retry later or open Settings for help.'}
            </Text>

            {!isAvailable ? (
              <View style={styles.unavailableCard}>
                <MaterialCommunityIcons name="cloud-alert-outline" size={24} color={novaTheme.colors.warning} />
                <Text style={styles.stepTitle}>No live pairing session</Text>
              </View>
            ) : !setupInProgress ? (
              <View style={[styles.steps, { gap: compact ? 6 : layout.stepsGap }]}>
                {STEPS.map((step) => (
                  <View key={step.title} style={[styles.stepRow, compact && styles.stepRowCompact]}>
                    <View style={[styles.stepIcon, compact && styles.stepIconCompact]}>
                      <MaterialCommunityIcons name={step.icon} size={compact ? 16 : 20} color={novaTheme.colors.accentHover} />
                    </View>
                    <View style={styles.stepCopy}>
                      <Text style={[styles.stepTitle, compact && styles.stepTitleCompact]}>{step.title}</Text>
                      {!compact ? (
                        <Text style={[styles.stepText, step.accent && styles.stepAccent]}>{step.copy}</Text>
                      ) : null}
                    </View>
                  </View>
                ))}
              </View>
            ) : null}
          </View>

          <View style={styles.divider} />

          <View style={[styles.rightColumn, { gap: layout.columnGap }]}>
            {setupInProgress ? (
              <View style={[styles.setupMinimal, { width: layout.actionWidth }]}>
                <View style={styles.authorizationBadge}>
                  <MaterialCommunityIcons name="shield-check" size={22} color="#4ADE80" />
                  <Text style={styles.authorizationBadgeText}>Authorization received</Text>
                </View>
                <NovaSpaceLoader
                  label={preparingChannels ? 'Preparing channels…' : 'Connecting provider…'}
                  variant="panel"
                />
                <Text style={styles.setupMinimalHint}>
                  {preparingChannels ? 'Opening Home next…' : statusText}
                </Text>
              </View>
            ) : (
              <>
                {isAvailable ? (
                  <View
                    style={[
                      styles.qrCard,
                      {
                        width: layout.qrCardSize,
                        height: layout.qrCardSize,
                        padding: layout.qrPadding,
                      },
                    ]}>
                    {shortUrl ? (
                      <QRCode
                        value={shortUrl}
                        size={qrCodeSize}
                        backgroundColor="#FFFFFF"
                        color="#071021"
                        quietZone={layout.qrQuietZone}
                      />
                    ) : null}
                  </View>
                ) : (
                  <View style={[styles.qrUnavailable, { width: layout.qrCardSize, height: layout.qrCardSize }]}>
                    <MaterialCommunityIcons name="qrcode-remove" size={36} color={novaTheme.colors.textMuted} />
                    <Text style={styles.unavailableText}>Pairing unavailable</Text>
                  </View>
                )}

                {code ? (
                  <>
                    <View style={[styles.codeCard, { width: layout.actionWidth, height: layout.codeCardHeight }, codeExpired && styles.codeCardExpired]}>
                      <Text style={[styles.code, { fontSize: layout.codeFontSize }, codeExpired && styles.codeExpired]}>{code}</Text>
                    </View>
                    <Text style={styles.expiry}>
                      {codeExpired ? (
                        <>Code expired — refresh below</>
                      ) : (
                        <>
                          Expires in <Text style={styles.expiryAccent}>{countdownLabel}</Text>
                        </>
                      )}
                    </Text>
                  </>
                ) : null}

                <View style={[styles.actions, { width: layout.actionWidth }]}>
                  <NovaButton
                    label={!isAvailable ? 'Retry Pairing' : codeExpired ? 'Refresh Code' : 'Generate New Code'}
                    onPress={() => void regenerateCode()}
                    hasTVPreferredFocus={status !== 'failed' && status !== 'binding_error' && !connectionFailed}
                    style={{ ...styles.primaryButton, minHeight: layout.actionMinHeight, width: layout.actionWidth }}
                  />
                  {status === 'failed' || status === 'binding_error' || connectionFailed ? (
                    <NovaButton
                      label="Retry Same Code"
                      onPress={handlePairingRetry}
                      hasTVPreferredFocus
                      style={{ ...styles.retryButton, minHeight: layout.actionMinHeight, width: layout.actionWidth }}
                    />
                  ) : null}
                </View>

                {awaitingActivation ? (
                  <PairingPulseText message={statusText} />
                ) : connectionFailed || status === 'failed' || status === 'binding_error' || status === 'unavailable' || codeExpired ? (
                  <Text style={[styles.inlineStatus, { width: layout.actionWidth }]}>{statusText}</Text>
                ) : null}
              </>
            )}
          </View>
        </View>
      </View>

      <WalkthroughOverlay
        key={guide.visible ? 'pairing-guide-open' : 'pairing-guide-closed'}
        visible={guide.visible}
        title={ONBOARDING_GUIDES.pairing.title}
        steps={ONBOARDING_GUIDES.pairing.steps}
        onDismiss={guide.dismiss}
        onSkip={guide.skip}
        onDontShowAgain={guide.dontShowAgain}
        onComplete={guide.complete}
      />
    </NovaScreen>
  );
}

const styles = StyleSheet.create({
  screenFrame: {
    flex: 1,
    paddingLeft: novaTheme.safeArea.left,
    paddingRight: novaTheme.safeArea.right,
  },
  fitPage: {
    flex: 1,
    justifyContent: 'center',
  },
  layout: {
    width: '100%',
    maxWidth: 1280,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 36,
  },
  layoutCompact: {
    gap: 24,
    maxWidth: 1100,
  },
  leftColumn: {
    flex: 1,
    maxWidth: 520,
  },
  rule: {
    width: 160,
    height: 2,
    backgroundColor: novaTheme.colors.accent,
    opacity: 0.72,
  },
  heading: {
    color: novaTheme.colors.textPrimary,
    fontWeight: '800',
  },
  intro: {
    maxWidth: 480,
    color: novaTheme.colors.textSecondary,
  },
  steps: {
    marginTop: 2,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  stepRowCompact: {
    gap: 8,
  },
  stepIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(97,165,255,0.28)',
    backgroundColor: 'rgba(59,130,246,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepIconCompact: {
    width: 28,
    height: 28,
    borderRadius: 14,
  },
  stepCopy: {
    flex: 1,
    gap: 2,
  },
  stepTitle: {
    color: novaTheme.colors.textPrimary,
    fontSize: 15,
    fontWeight: '700',
  },
  stepTitleCompact: {
    fontSize: 13,
  },
  stepText: {
    color: novaTheme.colors.textSecondary,
    fontSize: 13,
    lineHeight: 18,
  },
  unavailableCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: novaTheme.colors.borderSubtle,
    backgroundColor: novaTheme.colors.surface,
  },
  qrUnavailable: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: novaTheme.colors.borderSubtle,
    backgroundColor: novaTheme.colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  unavailableText: {
    color: novaTheme.colors.textMuted,
    fontSize: 14,
    fontWeight: '700',
  },
  stepAccent: {
    color: novaTheme.colors.accentHover,
    fontWeight: '700',
  },
  divider: {
    width: 1,
    alignSelf: 'stretch',
    maxHeight: 420,
    marginVertical: 8,
    backgroundColor: novaTheme.colors.borderSubtle,
  },
  rightColumn: {
    width: 340,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qrCard: {
    borderRadius: novaTheme.radius.lg,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  codeCard: {
    borderRadius: novaTheme.radius.md,
    borderWidth: 1,
    borderColor: novaTheme.colors.borderStrong,
    backgroundColor: novaTheme.colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  codeCardExpired: {
    opacity: 0.55,
    borderColor: novaTheme.colors.border,
  },
  code: {
    paddingLeft: 6,
    color: novaTheme.colors.textPrimary,
    fontFamily: novaTheme.typography.families.mono,
    fontWeight: '800',
    letterSpacing: 6,
  },
  codeExpired: {
    color: novaTheme.colors.textMuted,
  },
  expiry: {
    color: novaTheme.colors.textSecondary,
    fontSize: 13,
  },
  expiryAccent: {
    color: novaTheme.colors.accentHover,
    fontWeight: '700',
  },
  actions: {
    marginTop: 2,
  },
  primaryButton: {
    backgroundColor: novaTheme.colors.surfaceMuted,
  },
  retryButton: {
    backgroundColor: novaTheme.colors.accent,
  },
  inlineStatus: {
    marginTop: 2,
    color: novaTheme.colors.textSecondary,
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
  },
  pulseText: {
    color: novaTheme.colors.accentHover,
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'center',
    lineHeight: 20,
  },
  pulseTextLarge: {
    fontSize: 17,
    lineHeight: 24,
    marginTop: 6,
  },
  setupMinimal: {
    minHeight: 220,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 12,
  },
  authorizationBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: novaTheme.radius.md,
    borderWidth: 1,
    borderColor: 'rgba(74,222,128,0.5)',
    backgroundColor: 'rgba(34,197,94,0.14)',
  },
  authorizationBadgeText: {
    color: '#BBF7D0',
    fontSize: 15,
    fontWeight: '800',
  },
  setupMinimalHint: {
    color: novaTheme.colors.textSecondary,
    fontSize: 13,
    textAlign: 'center',
  },
});

