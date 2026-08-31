import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Image,
  ImageBackground,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';

import { NovaSpaceLoader } from '@/components/nova';
import { novaTvFocus } from '@/components/nova/novaTvFocus';
import { activateAndBootstrapManagedProvider } from '@/features/device/inviteActivation';
import { initializeDevice, useDeviceState } from '@/features/device/deviceActivation';
import { novaTheme } from '@/theme';
import { NOVA_GLASS } from '@/components/nova/novaGlassTheme';

const backgroundAsset = require('@/assets/images/pairingbackground.png');
const logoAsset = require('@/assets/images/novacast-logo.png');

type Phase = 'enter' | 'activating' | 'error';

export function BetaInviteActivationScreen({ onActivated }: { onActivated?: () => void }) {
  const { width, height } = useWindowDimensions();
  const scale = Math.min(1, Math.max(0.72, Math.min(width / 1280, height / 720)));
  const device = useDeviceState();
  const [code, setCode] = useState('');
  const [phase, setPhase] = useState<Phase>('enter');
  const [error, setError] = useState<string | null>(null);
  const [focused, setFocused] = useState<'code' | 'submit' | null>('code');
  const submittingRef = useRef(false);

  const deviceCode = device.status?.publicDeviceCode ?? device.identity?.publicDeviceCode ?? (device.state === 'registering' ? 'REGISTERING…' : 'UNAVAILABLE');
  const registrationError = device.state === 'error'
    ? 'Device registration could not finish. Retry registration, then enter your invitation code.'
    : null;

  const normalizedCode = useMemo(() => code.replace(/[^A-Z0-9]/gi, '').toUpperCase().slice(0, 12), [code]);

  const retryRegistration = useCallback(() => {
    setError(null);
    console.info('[NovaCast Device Registration]', JSON.stringify({ phase: 'retry-start' }));
    void initializeDevice().catch(() => undefined);
  }, []);

  const submit = useCallback(async () => {
    if (submittingRef.current) return;
    if (normalizedCode.length < 6) {
      setError('Enter the invitation code from your NovaCast beta invite.');
      setPhase('error');
      return;
    }

    submittingRef.current = true;
    setPhase('activating');
    setError(null);
    try {
      await activateAndBootstrapManagedProvider(normalizedCode);
      onActivated?.();
    } catch (activationError) {
      const message =
        activationError instanceof Error ? activationError.message : 'activation_unavailable';
      const friendly =
        message === 'rate_limited'
          ? 'Too many attempts. Wait a moment and try again.'
          : message === 'pairing_api_unconfigured' || message === 'environment_mismatch'
            ? 'This TV build is missing pairing API configuration. Install a closed-beta build with pairing env baked in.'
            : message === 'beta_invites_disabled'
              ? 'Invitation activation is disabled in this build. Enable closed-beta invites and try again.'
              : message === 'device_code_missing'
                ? 'This TV has no Device ID yet. Wait for registration, then try again.'
                : message === 'invite_not_found'
            ? 'That invitation code was not recognized. Create a new invite and copy it carefully.'
            : message === 'invite_exhausted' || message === 'invite_inactive' || message === 'invite_expired'
              ? 'That invitation can no longer be used. Create a new one in admin.'
              : message === 'device_not_found'
                ? 'This TV is not registered yet. Wait for the Device ID, then try again.'
                : message === 'device_blocked'
                  ? 'This TV has been blocked. Ask admin to restore it.'
                  : message === 'provider_not_assigned' || message === 'managed_provider_unavailable'
                    ? 'Invite accepted, but no provider was assigned. Recreate the invite with BetaTester selected.'
                    : message === 'provider_unavailable' || message === 'provider_download_failed'
                      ? 'Invite accepted, but the library download failed. Try again or check provider credentials/encryption.'
                      : message === 'activation_rpc_missing'
                        ? 'Backend activation is outdated. Apply the closed-beta migration, then try a new invite.'
                        : message === 'activation_expired'
                          ? 'This device activation has expired. Ask admin to extend access.'
                          : message === 'invalid_device' || message === 'device_registration_failed'
                            ? 'This TV could not register with NovaCast. Check network and try again.'
                            : `That invitation code could not be used (${message}). Check the code and try again.`;
      setError(friendly);
      setPhase('error');
    } finally {
      submittingRef.current = false;
    }
  }, [normalizedCode, onActivated]);

  useEffect(() => {
    console.info('[NovaCast Device Registration]', JSON.stringify({
      phase: 'screen-mounted',
      screenPhase: phase,
      deviceState: device.state,
      installationIdentityPresent: Boolean(device.identity?.installationId),
      privateCredentialPresent: Boolean(device.identity?.deviceSecret),
      publicDeviceIdPresent: Boolean(device.identity?.publicDeviceCode),
    }));
  }, [device.identity, device.state, phase]);

  if (phase === 'activating') {
    return (
      <ImageBackground source={backgroundAsset} resizeMode="cover" style={styles.screen}>
        <View style={styles.overlay} />
        <View style={styles.center}>
          <NovaSpaceLoader label="Activating NovaCast…" />
          <Text style={[styles.hint, { fontSize: 18 * scale, marginTop: 18 }]}>
            Assigning your library and preparing channels
          </Text>
        </View>
      </ImageBackground>
    );
  }

  return (
    <ImageBackground source={backgroundAsset} resizeMode="cover" style={styles.screen}>
      <View pointerEvents="none" style={styles.overlay} />
      <View style={[styles.layout, styles.glassPanel, { paddingHorizontal: 72 * scale, paddingVertical: 48 * scale }]}>
        <Image source={logoAsset} resizeMode="contain" style={{ width: 280 * scale, height: 210 * scale }} />
        <Text style={[styles.eyebrow, { fontSize: 18 * scale }]}>NOVACAST CLOSED BETA</Text>
        <Text style={[styles.title, { fontSize: 42 * scale }]}>Enter your invitation code</Text>
        <Text style={[styles.body, { fontSize: 18 * scale }]}>
          No provider setup. No pairing website. Your invitation unlocks NovaCast on this TV.
        </Text>

        <Text style={[styles.deviceLabel, { fontSize: 14 * scale }]}>DEVICE ID</Text>
        <Text style={[styles.deviceCode, { fontSize: 28 * scale }]}>{deviceCode}</Text>

        <TextInput
          value={normalizedCode}
          onChangeText={setCode}
          placeholder="INVITE CODE"
          placeholderTextColor="rgba(255,255,255,0.35)"
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={12}
          onFocus={() => setFocused('code')}
          style={[
            styles.codeInput,
            novaTvFocus.base,
            focused === 'code' && novaTvFocus.active,
            { fontSize: 28 * scale, minWidth: 360 * scale },
          ]}
        />

        {error || registrationError ? <Text style={[styles.error, { fontSize: 16 * scale }]}>{error ?? registrationError}</Text> : null}

        {device.state === 'error' ? (
          <Pressable
            focusable
            onPress={retryRegistration}
            style={[styles.submit, novaTvFocus.base, { paddingVertical: 12 * scale, paddingHorizontal: 22 * scale }]}>
            <Text style={[styles.submitText, { fontSize: 16 * scale }]}>Retry registration</Text>
          </Pressable>
        ) : null}

        <Pressable
          focusable
          hasTVPreferredFocus
          onFocus={() => setFocused('submit')}
          onPress={() => void submit()}
          style={[
            styles.submit,
            novaTvFocus.base,
            focused === 'submit' && novaTvFocus.active,
            { paddingVertical: 14 * scale, paddingHorizontal: 28 * scale },
          ]}>
          <Text style={[styles.submitText, { fontSize: 18 * scale }]}>Activate NovaCast</Text>
        </Pressable>
      </View>
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(2,6,17,0.55)' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 48 },
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
    marginTop: 10,
    color: novaTheme.colors.textSecondary,
    lineHeight: 26,
    maxWidth: 620,
  },
  deviceLabel: {
    marginTop: 28,
    color: novaTheme.colors.textMuted,
    fontWeight: '800',
    letterSpacing: 1.2,
  },
  deviceCode: {
    marginTop: 4,
    color: novaTheme.colors.textPrimary,
    fontWeight: '900',
    letterSpacing: 2,
  },
  codeInput: {
    marginTop: 22,
    borderWidth: 1,
    borderColor: NOVA_GLASS.focused.borderColor,
    borderRadius: NOVA_GLASS.radius.base,
    backgroundColor: NOVA_GLASS.focused.backgroundColor,
    color: '#F5F8FF',
    paddingHorizontal: 18,
    paddingVertical: 14,
    letterSpacing: 4,
    fontWeight: '800',
  },
  error: {
    marginTop: 12,
    color: '#FCA5A5',
    fontWeight: '700',
  },
  submit: {
    marginTop: 22,
    alignSelf: 'flex-start',
    borderRadius: NOVA_GLASS.radius.base,
    backgroundColor: NOVA_GLASS.active.backgroundColor,
    borderWidth: 1,
    borderColor: NOVA_GLASS.active.borderColor,
  },
  submitText: {
    color: '#F5F8FF',
    fontWeight: '800',
  },
  hint: {
    color: novaTheme.colors.textSecondary,
    textAlign: 'center',
  },
});
