import { useCallback, useEffect, useState } from 'react';
import { Redirect } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { NovaSpaceLoader } from '@/components/nova';
import {
  checkDeviceStatus,
  getDeviceState,
  initializeDevice,
  isClosedBetaManagedFlow,
  isDeviceActivationRequired,
  isPersonalPairingEnabled,
  useDeviceState,
} from '@/features/device';
import { downloadManagedProviderAssignment } from '@/features/device/managedProviderDownload';
import { setContentPolicyOverride } from '@/features/content-policy';
import { getActiveRepositoryBundle } from '@/features/providers/providerBundle';
import { hasSavedProvider, isProviderConnectionReady } from '@/features/providers/providerModel';
import { getProviderState, useProviderStore } from '@/features/providers/providerStore';
import { BetaInviteActivationScreen } from '@/features/device/BetaInviteActivationScreen';
import { BetaExpiredScreen } from '@/features/device/BetaExpiredScreen';
import { ProviderInitErrorScreen } from '@/features/startup/ProviderInitErrorScreen';
import { markStartupReady } from '@/features/startup/startupReadiness';
import { novaTheme } from '@/theme';

/**
 * Central closed-beta / production startup coordinator.
 * Preserves personal pairing as a fallback when closed-beta managed flow is off.
 */
export function StartupGate() {
  const device = useDeviceState();
  const {
    ready,
    hasSavedProvider: storeHasProvider,
    selectedProvider,
    providerSwitchError,
    isSwitchingProvider,
  } = useProviderStore();

  const [bootstrapping, setBootstrapping] = useState(false);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const providerInitialized = Boolean(getActiveRepositoryBundle()) && !providerSwitchError;

  useEffect(() => {
    void initializeDevice();
  }, []);

  useEffect(() => {
    if (ready && !isSwitchingProvider && !bootstrapping) {
      markStartupReady();
    }
  }, [bootstrapping, isSwitchingProvider, ready]);

  const ensureManagedProvider = useCallback(async () => {
    if (!isClosedBetaManagedFlow()) {
      return;
    }
    const status = getDeviceState().status;
    if (!status || status.activationStatus !== 'active') {
      return;
    }
    if (status.contentPolicy === 'us_only' || status.contentPolicy === 'unrestricted') {
      setContentPolicyOverride(status.contentPolicy);
    }

    const providerState = await getProviderState();
    if (hasSavedProvider(providerState) && getActiveRepositoryBundle()) {
      return;
    }

    if (!status.providerAssigned && !status.requiresProviderDownload) {
      return;
    }

    setBootstrapping(true);
    setBootstrapError(null);
    try {
      await downloadManagedProviderAssignment();
    } catch (error) {
      setBootstrapError(error instanceof Error ? error.message : 'managed_provider_unavailable');
    } finally {
      setBootstrapping(false);
    }
  }, []);

  useEffect(() => {
    if (!device.status || device.status.activationStatus !== 'active') {
      return;
    }
    void ensureManagedProvider();
  }, [device.status?.activationStatus, device.status?.providerAssigned, ensureManagedProvider]);

  if (device.state === 'idle' || device.state === 'registering' || device.state === 'checking' || bootstrapping) {
    return (
      <View style={styles.loading}>
        <NovaSpaceLoader label={bootstrapping ? 'Preparing your library…' : 'Starting NovaCast…'} />
      </View>
    );
  }

  if (isDeviceActivationRequired()) {
    const activation = device.status?.activationStatus;
    if (activation === 'expired') {
      return (
        <BetaExpiredScreen
          expiresAt={device.status?.activationExpiresAt ?? null}
          onRefresh={() => void checkDeviceStatus()}
        />
      );
    }
    if (!activation || activation === 'inactive' || activation === 'revoked' || activation === 'suspended') {
      return <BetaInviteActivationScreen onActivated={() => void ensureManagedProvider()} />;
    }
  }

  if (!ready || isSwitchingProvider) {
    return (
      <View style={styles.loading}>
        <NovaSpaceLoader label="Loading your provider…" />
      </View>
    );
  }

  if (bootstrapError) {
    return <ProviderInitErrorScreen />;
  }

  if (!storeHasProvider || !selectedProvider || !isProviderConnectionReady(selectedProvider)) {
    if (isClosedBetaManagedFlow()) {
      return (
        <View style={styles.loading}>
          <NovaSpaceLoader label="Downloading your NovaCast library…" />
        </View>
      );
    }
    if (isPersonalPairingEnabled()) {
      return <Redirect href="/pair" />;
    }
    return <BetaInviteActivationScreen onActivated={() => void ensureManagedProvider()} />;
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
