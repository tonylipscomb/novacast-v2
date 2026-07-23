import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { Redirect } from 'expo-router';

import { getActiveRepositoryBundle } from '@/features/providers/providerBundle';
import { isProviderConnectionReady } from '@/features/providers/providerModel';
import { useProviderStore } from '@/features/providers/providerStore';
import { ProviderInitErrorScreen } from '@/features/startup/ProviderInitErrorScreen';
import { markStartupReady } from '@/features/startup/startupReadiness';
import { novaTheme } from '@/theme';

export function StartupGate() {
  const {
    ready,
    hasSavedProvider,
    selectedProvider,
    providerSwitchError,
    isSwitchingProvider,
  } = useProviderStore();
  const providerInitialized =
    Boolean(getActiveRepositoryBundle()) && !providerSwitchError;

  useEffect(() => {
    if (ready && !isSwitchingProvider) {
      markStartupReady();
    }
  }, [isSwitchingProvider, ready]);

  if (!ready || isSwitchingProvider) {
    return <View accessibilityElementsHidden style={styles.loading} />;
  }

  if (!hasSavedProvider || !selectedProvider || !isProviderConnectionReady(selectedProvider)) {
    return <Redirect href="/pair" />;
  }

  if (providerSwitchError || !providerInitialized) {
    return <ProviderInitErrorScreen />;
  }

  return <Redirect href="/main-menu" />;
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: novaTheme.colors.background,
  },
});
