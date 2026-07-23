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
import { useDeviceState } from '@/features/device/deviceActivation';
import { novaTheme } from '@/theme';

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

  const deviceCode = device.status?.publicDeviceCode ?? device.identity?.publicDeviceCode ?? 'REGISTERING…';

  const normalizedCode = useMemo(() => code.replace(/[^A-Z0-9]/gi, '').toUpperCase().slice(0, 12), [code]);

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
      setError(
        message === 'rate_limited'
          ? 'Too many attempts. Wait a moment and try again.'
          : 'That invitation code could not be used. Check the code and try again.',
      );
      setPhase('error');
    } finally {
      submittingRef.current = false;
    }
  }, [normalizedCode, onActivated]);

  useEffect(() => {
    if (phase === 'activating') return;
  }, [phase]);

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
      <View style={[styles.layout, { paddingHorizontal: 72 * scale, paddingVertical: 48 * scale }]}>
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

        {error ? <Text style={[styles.error, { fontSize: 16 * scale }]}>{error}</Text> : null}

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
    borderColor: 'rgba(131,180,255,0.35)',
    backgroundColor: 'rgba(8,18,38,0.72)',
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
    backgroundColor: 'rgba(59,130,246,0.28)',
    borderWidth: 1,
    borderColor: 'rgba(96,165,255,0.55)',
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
