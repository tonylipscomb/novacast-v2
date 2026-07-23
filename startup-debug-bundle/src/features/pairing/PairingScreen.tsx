import { useCallback, useEffect, useRef, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import { NovaButton, NovaLogo, NovaScreen } from '@/components/nova';
import { useAppNotification } from '@/features/notifications/useAppNotification';
import { consumePendingPairingPayload } from '@/features/pairing/pairingBridge';
import { markPairingCompleted } from '@/features/pairing/pairingState';
import { useMockPairing } from '@/features/pairing/useMockPairing';
import { connectXtreamProvider } from '@/features/providers/providerStore';
import { ONBOARDING_GUIDES } from '@/features/onboarding/onboardingGuides';
import { WalkthroughOverlay } from '@/features/onboarding/WalkthroughOverlay';
import { useGuideWalkthrough } from '@/features/onboarding/useGuideWalkthrough';
import {
  AUTH_NOTIFICATION_DURATION_MS,
  AUTH_PAIRING_NOTIFICATION_ID,
  resolveAuthPairingNotification,
} from '@/features/startup/authScreenLogic';
import { novaTheme } from '@/theme';

const qrAsset = require('@/assets/images/pairing-qr.png');

const STEPS = [
  {
    icon: 'cellphone' as const,
    title: 'Scan the QR code',
    copy: 'Open your phone camera and scan the code on the right.',
  },
  {
    icon: 'link-variant' as const,
    title: 'Visit on your phone or computer',
    copy: 'novacast.tv/connect',
    accent: true,
  },
  {
    icon: 'form-textbox-password' as const,
    title: 'Enter the code below',
    copy: 'The TV connects automatically after setup is complete.',
  },
];

export function PairingScreen() {
  const router = useRouter();
  const pairingRetryAttemptedRef = useRef(false);
  const lastPairingRetryAtRef = useRef(0);
  const mountedRef = useRef(true);
  const { status, statusText, code, shortUrl, countdownLabel, regenerateCode, isAvailable, connectionPayload } = useMockPairing();
  const guide = useGuideWalkthrough(ONBOARDING_GUIDES.pairing.key);
  const { showNotification, dismissNotification, clearScope } = useAppNotification();
  const [connectionFailed, setConnectionFailed] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [pairingAttempt, setPairingAttempt] = useState(0);

  const completePairing = useCallback(async () => {
    setIsConnecting(true);
    setConnectionFailed(false);

    try {
      const payload = connectionPayload ?? (await consumePendingPairingPayload());
      if (payload) {
        await connectXtreamProvider(payload);
      } else {
        throw new Error('Pairing session completed without provider details.');
      }

      if (!mountedRef.current) {
        return;
      }

      pairingRetryAttemptedRef.current = false;
      markPairingCompleted();
      router.replace('/main-menu');
    } catch {
      if (!mountedRef.current) {
        return;
      }

      setConnectionFailed(true);
      setIsConnecting(false);
    }
  }, [connectionPayload, router]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (status !== 'connected') {
      return;
    }

    void completePairing();
  }, [completePairing, pairingAttempt, status]);

  const handlePairingRetry = useCallback(() => {
    const now = Date.now();
    if (now - lastPairingRetryAtRef.current < 400) {
      return;
    }

    lastPairingRetryAtRef.current = now;
    pairingRetryAttemptedRef.current = true;
    setPairingAttempt((current) => current + 1);
  }, []);

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

  const previewApp = () => {
    markPairingCompleted();
    router.replace('/content-hub');
  };

  return (
    <NovaScreen>
      <View style={styles.layout}>
        <View style={styles.leftColumn}>
          <NovaLogo variant="full" size="lg" subtitle="ENTERTAINMENT STARTS HERE" />
          <View style={styles.rule} />
          <Text style={styles.heading}>Pair your TV in seconds.</Text>
          <Text style={styles.intro}>
            {isAvailable
              ? 'Set up NovaCast from your phone. No usernames or passwords are entered on the TV.'
              : 'Pairing service unavailable. Retry later or open Settings for help.'}
          </Text>

          {isAvailable ? (
            <View style={styles.steps}>
              {STEPS.map((step) => (
                <View key={step.title} style={styles.stepRow}>
                  <View style={styles.stepIcon}>
                    <MaterialCommunityIcons name={step.icon} size={23} color={novaTheme.colors.accentHover} />
                  </View>
                  <View style={styles.stepCopy}>
                    <Text style={styles.stepTitle}>{step.title}</Text>
                    <Text style={[styles.stepText, step.accent && styles.stepAccent]}>{step.copy}</Text>
                  </View>
                </View>
              ))}
            </View>
          ) : (
            <View style={styles.unavailableCard}>
              <MaterialCommunityIcons name="cloud-alert-outline" size={28} color={novaTheme.colors.warning} />
              <Text style={styles.stepTitle}>No live pairing session</Text>
              <Text style={styles.stepText}>This build has no configured pairing backend.</Text>
            </View>
          )}
        </View>

        <View style={styles.divider} />

        <View style={styles.rightColumn}>
          {isAvailable ? (
            <View style={styles.qrCard}>
              <Image source={qrAsset} style={styles.qrImage} resizeMode="contain" />
            </View>
          ) : (
            <View style={styles.qrUnavailable}>
              <MaterialCommunityIcons name="qrcode-remove" size={44} color={novaTheme.colors.textMuted} />
              <Text style={styles.unavailableText}>Pairing unavailable</Text>
            </View>
          )}

          {code ? (
            <>
              <Text style={styles.enterLabel}>Enter this code</Text>
              <View style={styles.codeCard}>
                <Text style={styles.code}>{code}</Text>
              </View>
              <Text style={styles.expiry}>
                {shortUrl ? `${shortUrl} · ` : ''}Code expires in <Text style={styles.expiryAccent}>{countdownLabel}</Text>
              </Text>
            </>
          ) : null}

          <View style={styles.actions}>
            <NovaButton
              label={isAvailable ? 'Generate New Code' : 'Retry Pairing'}
              onPress={regenerateCode}
              hasTVPreferredFocus
              style={styles.primaryButton}
            />
            {__DEV__ ? (
              <NovaButton label="Preview TV UI" onPress={previewApp} style={styles.previewButton} />
            ) : null}
          </View>

          <View style={styles.securityRow}>
            <MaterialCommunityIcons name="lock-outline" size={16} color={novaTheme.colors.textMuted} />
            <Text style={styles.security}>Secure connection · Your provider details stay protected.</Text>
          </View>
          <Text style={styles.status}>{isConnecting ? 'Connecting provider...' : statusText}</Text>
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
  layout: {
    flex: 1,
    width: '100%',
    maxWidth: 1420,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 42,
  },
  leftColumn: {
    flex: 1,
    maxWidth: 620,
    gap: 18,
  },
  rule: {
    width: 210,
    height: 2,
    backgroundColor: novaTheme.colors.accent,
    opacity: 0.72,
  },
  heading: {
    color: novaTheme.colors.textPrimary,
    fontSize: 34,
    lineHeight: 40,
    fontWeight: '800',
  },
  intro: {
    maxWidth: 540,
    color: novaTheme.colors.textSecondary,
    fontSize: 16,
    lineHeight: 23,
  },
  steps: {
    gap: 18,
    marginTop: 6,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 15,
  },
  stepIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(97,165,255,0.28)',
    backgroundColor: 'rgba(59,130,246,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepCopy: {
    flex: 1,
    gap: 3,
  },
  stepTitle: {
    color: novaTheme.colors.textPrimary,
    fontSize: 17,
    fontWeight: '700',
  },
  stepText: {
    color: novaTheme.colors.textSecondary,
    fontSize: 15,
    lineHeight: 20,
  },
  unavailableCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 18,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: novaTheme.colors.borderSubtle,
    backgroundColor: novaTheme.colors.surface,
  },
  qrUnavailable: {
    width: 318,
    height: 318,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: novaTheme.colors.borderSubtle,
    backgroundColor: novaTheme.colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  unavailableText: {
    color: novaTheme.colors.textMuted,
    fontSize: 16,
    fontWeight: '700',
  },
  stepAccent: {
    color: novaTheme.colors.accentHover,
    fontWeight: '700',
  },
  divider: {
    width: 1,
    height: '72%',
    backgroundColor: novaTheme.colors.borderSubtle,
  },
  rightColumn: {
    width: 470,
    alignItems: 'center',
    gap: 11,
  },
  qrCard: {
    width: 318,
    height: 318,
    borderRadius: novaTheme.radius.lg,
    borderWidth: 2,
    borderColor: novaTheme.colors.focusRing,
    backgroundColor: '#FFFFFF',
    padding: 16,
    shadowColor: novaTheme.colors.accent,
    shadowOpacity: 0.24,
    shadowRadius: 16,
  },
  qrImage: {
    width: '100%',
    height: '100%',
  },
  enterLabel: {
    marginTop: 4,
    color: novaTheme.colors.textSecondary,
    fontSize: 15,
  },
  codeCard: {
    width: 410,
    height: 82,
    borderRadius: novaTheme.radius.md,
    borderWidth: 1,
    borderColor: novaTheme.colors.borderStrong,
    backgroundColor: novaTheme.colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  code: {
    paddingLeft: 10,
    color: novaTheme.colors.textPrimary,
    fontFamily: novaTheme.typography.families.mono,
    fontSize: novaTheme.typography.code,
    fontWeight: '800',
    letterSpacing: 10,
  },
  expiry: {
    color: novaTheme.colors.textSecondary,
    fontSize: 14,
  },
  expiryAccent: {
    color: novaTheme.colors.accentHover,
    fontWeight: '700',
  },
  actions: {
    width: 410,
    gap: 9,
    marginTop: 5,
  },
  primaryButton: {
    width: 410,
    minHeight: 58,
    backgroundColor: novaTheme.colors.surfaceMuted,
  },
  previewButton: {
    width: 410,
    minHeight: 50,
    backgroundColor: 'transparent',
    borderColor: novaTheme.colors.borderSubtle,
  },
  securityRow: {
    marginTop: 3,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  security: {
    color: novaTheme.colors.textMuted,
    fontSize: 12,
  },
  status: {
    color: novaTheme.colors.textSecondary,
    fontSize: 12,
  },
});
