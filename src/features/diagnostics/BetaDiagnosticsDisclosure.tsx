import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { novaTheme } from '@/theme';
import { setSecureValue } from '@/features/providers/providerCredentialStore';
import { DIAGNOSTICS_DISCLOSURE_KEY, DIAGNOSTICS_DISCLOSURE_VERSION } from './diagnosticsConfig';

export function BetaDiagnosticsDisclosure({ onAcknowledged, onExit }: { onAcknowledged: () => void; onExit: () => void }) {
  const [busy, setBusy] = useState(false);
  const body = useMemo(() => 'To help us improve NovaCast during the beta, the app collects technical diagnostic information including device and app details, connection and provider response times, playback startup times, buffering events, playback errors, and the channel, movie, or episode involved when a problem occurs.\n\nNovaCast Beta Diagnostics are used to identify playback, network, device, and provider issues. Stream passwords, provider credentials, authentication tokens, and full stream URLs are never included in diagnostic reports.\n\nDiagnostics are required while participating in the NovaCast beta.', []);
  const continueToNovaCast = async () => {
    setBusy(true);
    try {
      await setSecureValue(DIAGNOSTICS_DISCLOSURE_KEY, DIAGNOSTICS_DISCLOSURE_VERSION);
      onAcknowledged();
    } finally {
      setBusy(false);
    }
  };
  return (
    <View style={styles.screen}>
      <View style={styles.card}>
        <Text style={styles.eyebrow}>NOVACAST BETA</Text>
        <Text style={styles.title}>NovaCast Beta Diagnostics</Text>
        <Text style={styles.body}>{body}</Text>
        <Pressable focusable hasTVPreferredFocus disabled={busy} onPress={() => void continueToNovaCast()} style={styles.primary}>
          <Text style={styles.primaryText}>{busy ? 'PREPARING NOVACAST…' : 'CONTINUE TO NOVACAST'}</Text>
        </Pressable>
        <Pressable focusable disabled={busy} onPress={onExit} style={styles.secondary}>
          <Text style={styles.secondaryText}>EXIT BETA</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 48, backgroundColor: 'transparent' },
  card: { width: '72%', maxWidth: 900, padding: 34, borderRadius: 22, borderWidth: 1, borderColor: 'rgba(160,185,255,0.38)', backgroundColor: 'rgba(8,14,28,0.9)', shadowColor: '#6D56FF', shadowOpacity: 0.28, shadowRadius: 28 },
  eyebrow: { color: '#A982FF', fontSize: 13, fontWeight: '800', letterSpacing: 2 },
  title: { color: novaTheme.colors.textPrimary, fontSize: 30, fontWeight: '800', marginTop: 8, marginBottom: 18 },
  body: { color: novaTheme.colors.textSecondary, fontSize: 16, lineHeight: 25 },
  primary: { alignSelf: 'flex-start', marginTop: 26, paddingHorizontal: 22, paddingVertical: 14, borderRadius: 12, backgroundColor: 'rgba(112,79,255,0.72)', borderWidth: 1, borderColor: '#B9A9FF' },
  primaryText: { color: '#FFF', fontSize: 14, fontWeight: '900', letterSpacing: 0.8 },
  secondary: { alignSelf: 'flex-start', marginTop: 12, paddingHorizontal: 4, paddingVertical: 8 },
  secondaryText: { color: novaTheme.colors.textMuted, fontSize: 12, fontWeight: '800', letterSpacing: 1 },
});
