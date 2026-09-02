import {
  getDeviceState,
  initializeDevice,
  isClosedBetaManagedFlow,
} from '@/features/device';
import {
  assignmentFromDeviceStatus,
  markDeviceAssignmentApplied,
  runManagedProviderRefresh,
} from '@/features/device/deviceAssignmentReconcile';
import { setContentPolicyOverride } from '@/features/content-policy';
import { getActiveRepositoryBundle } from '@/features/providers/providerBundle';
import {
  getSelectedProvider,
  hasSavedProvider,
  isProviderConnectionReady,
} from '@/features/providers/providerModel';
import { clearProviderSwitchError, getProviderState, retryProviderInitialization } from '@/features/providers/providerStore';
import {
  STARTUP_BOOTSTRAP_TIMEOUT_MS,
  STARTUP_NETWORK_TIMEOUT_MS,
  withTimeout,
} from '@/features/startup/startupTimeouts';

export type StartupProviderSource = 'startup' | 'retry';

export type StartupProviderResolution = {
  ok: boolean;
  errorCode: string | null;
  effectiveAuthorized: boolean;
  providerAssignmentPresent: boolean;
  libraryAssignmentPresent: boolean;
  requiresProviderDownload: boolean;
  providerBootstrapRequested: boolean;
  libraryMissing: boolean;
};

type ResolveOptions = {
  source?: StartupProviderSource;
};

let inFlight: Promise<StartupProviderResolution> | null = null;

function safeErrorCode(error: unknown, fallback = 'startup_provider_failed') {
  const message = error instanceof Error ? error.message : '';
  return /^[a-z][a-z0-9_]{1,63}$/i.test(message) ? message.toLowerCase() : fallback;
}

function assignmentFlags(status: ReturnType<typeof getDeviceState>['status']) {
  return {
    providerAssignmentPresent: Boolean(status?.providerAssigned || status?.managedProviderId),
    libraryAssignmentPresent: Boolean(status?.providerAssigned || status?.requiresProviderDownload),
    requiresProviderDownload: Boolean(status?.requiresProviderDownload || status?.providerAssigned),
  };
}

function logAssignmentResolved(
  current: ReturnType<typeof getDeviceState>,
  flags: ReturnType<typeof assignmentFlags>,
  providerBootstrapRequested: boolean,
) {
  console.info('[NovaCast Startup Provider Assignment]', JSON.stringify({
    event: 'assignment-resolved',
    publicDeviceIdPresent: Boolean(current.identity?.publicDeviceCode || current.status?.publicDeviceCode),
    providerAssignmentPresent: flags.providerAssignmentPresent,
    libraryAssignmentPresent: flags.libraryAssignmentPresent,
    localBypassAuthorized: current.authorization.localBypassAuthorized,
    providerBootstrapRequested,
  }));
}

function logRetry(event: string, fields: Record<string, unknown>) {
  console.info('[NovaCast Startup Retry]', JSON.stringify({ event, ...fields }));
}

function logProviderPhase(event: string, fields: Record<string, unknown>) {
  console.info('[NovaCast Startup Provider]', JSON.stringify({ event, ...fields }));
}

const PROVIDER_RESOLUTION_AUDIT_ENABLED =
  Boolean(__DEV__) ||
  (typeof process !== 'undefined' && process.env?.EXPO_PUBLIC_NOVACAST_HOME_PRESENTATION_AUDIT === '1');

function logResolverResult(
  branch: string,
  current: ReturnType<typeof getDeviceState>,
  result: Pick<StartupProviderResolution, 'ok' | 'errorCode' | 'providerBootstrapRequested'>,
  selectedProviderId: string | null,
  connectionReady: boolean,
) {
  if (!PROVIDER_RESOLUTION_AUDIT_ENABLED) {
    return;
  }
  const bundle = getActiveRepositoryBundle();
  console.info('[NovaCast Startup Provider Resolution Audit]', JSON.stringify({
    event: 'resolver-result',
    branch,
    managedFlow: isClosedBetaManagedFlow(),
    ok: result.ok,
    resolverProviderBootstrapRequested: result.providerBootstrapRequested,
    errorCode: result.errorCode,
    bundlePresentAtReturn: Boolean(bundle),
    bundleProviderIdAtReturn: bundle?.providerId ?? null,
    selectedProviderId,
    connectionReady,
    timestamp: Date.now(),
  }));
}

function resolution(
  current: ReturnType<typeof getDeviceState>,
  flags: ReturnType<typeof assignmentFlags>,
  extras: Pick<StartupProviderResolution, 'ok' | 'errorCode' | 'providerBootstrapRequested' | 'libraryMissing'>,
): StartupProviderResolution {
  return {
    effectiveAuthorized: current.authorization.effectiveAuthorized,
    ...flags,
    ...extras,
  };
}

async function runResolveStartupProvider(source: StartupProviderSource): Promise<StartupProviderResolution> {
  const isRetry = source === 'retry';
  if (isRetry) {
    logRetry('retry-start', {});
  }

  await withTimeout(initializeDevice(), STARTUP_NETWORK_TIMEOUT_MS, 'device_status_timeout');

  const current = getDeviceState();
  const flags = assignmentFlags(current.status);
  const retryBase = {
    effectiveAuthorized: current.authorization.effectiveAuthorized,
    providerAssignmentPresent: flags.providerAssignmentPresent,
    libraryAssignmentPresent: flags.libraryAssignmentPresent,
    requiresProviderDownload: flags.requiresProviderDownload,
  };

  if (isRetry) {
    logRetry('retry-device-status-resolved', retryBase);
  }

  if (!isClosedBetaManagedFlow()) {
    const result = resolution(current, flags, {
      ok: true,
      errorCode: null,
      providerBootstrapRequested: false,
      libraryMissing: false,
    });
    logResolverResult('non-managed-flow', current, result, null, false);
    return result;
  }

  if (!current.status || !current.authorization.effectiveAuthorized) {
    logAssignmentResolved(current, flags, false);
    if (isRetry) {
      logRetry('retry-assignment-resolved', { ...retryBase, providerBootstrapRequested: false });
      logRetry('retry-failed', { ...retryBase, providerBootstrapRequested: false, errorCode: 'not_authorized' });
    }
    const result = resolution(current, flags, {
      ok: false,
      errorCode: 'not_authorized',
      providerBootstrapRequested: false,
      libraryMissing: false,
    });
    logResolverResult('assignment-missing', current, result, null, false);
    return result;
  }

  if (current.status.contentPolicy === 'us_only' || current.status.contentPolicy === 'unrestricted') {
    setContentPolicyOverride(current.status.contentPolicy);
  }

  const providerState = await getProviderState();
  const selected = getSelectedProvider(providerState);
  const activeBundle = getActiveRepositoryBundle();
  const alreadyActive =
    hasSavedProvider(providerState) &&
    Boolean(activeBundle && selected && activeBundle.providerId === selected.id) &&
    Boolean(selected && isProviderConnectionReady(selected));

  if (alreadyActive) {
    clearProviderSwitchError();
    logAssignmentResolved(current, flags, false);
    if (isRetry) {
      logRetry('retry-assignment-resolved', { ...retryBase, providerBootstrapRequested: false });
      logRetry('retry-success', { ...retryBase, providerBootstrapRequested: false });
    }
    const result = resolution(current, flags, {
      ok: true,
      errorCode: null,
      providerBootstrapRequested: false,
      libraryMissing: false,
    });
    logResolverResult('already-active', current, result, selected?.id ?? null, Boolean(selected && isProviderConnectionReady(selected)));
    return result;
  }

  if (!flags.requiresProviderDownload) {
    logAssignmentResolved(current, flags, false);
    if (isRetry) {
      logRetry('retry-assignment-resolved', { ...retryBase, providerBootstrapRequested: false });
      logRetry('retry-failed', { ...retryBase, providerBootstrapRequested: false, errorCode: 'no_library_assigned' });
    }
    const result = resolution(current, flags, {
      ok: false,
      errorCode: 'no_library_assigned',
      providerBootstrapRequested: false,
      libraryMissing: true,
    });
    logResolverResult(selected ? 'assignment-missing' : 'provider-missing', current, result, selected?.id ?? null, false);
    return result;
  }

  logAssignmentResolved(current, flags, true);
  if (isRetry) {
    logRetry('retry-assignment-resolved', { ...retryBase, providerBootstrapRequested: true });
    logRetry('retry-provider-download-start', { ...retryBase, providerBootstrapRequested: true });
  }
  logProviderPhase('provider-download-start', {
    source,
    ...retryBase,
    providerBootstrapRequested: true,
  });

  try {
    await withTimeout(
      runManagedProviderRefresh(),
      STARTUP_BOOTSTRAP_TIMEOUT_MS,
      'managed_provider_timeout',
    );
    await markDeviceAssignmentApplied(assignmentFromDeviceStatus(getDeviceState().status));
  } catch (error) {
    const errorCode = safeErrorCode(error, 'managed_provider_unavailable');
    logProviderPhase('provider-download-failed', {
      source,
      ...retryBase,
      providerBootstrapRequested: true,
      errorCode,
    });

    if (selected && isProviderConnectionReady(selected)) {
      if (isRetry) {
        logRetry('retry-provider-activation-start', { ...retryBase, providerBootstrapRequested: true });
      }
      try {
        await retryProviderInitialization();
        if (isRetry) {
          logRetry('retry-provider-activation-complete', { ...retryBase, providerBootstrapRequested: true });
          logRetry('retry-success', { ...retryBase, providerBootstrapRequested: true });
        }
        const result = resolution(current, flags, {
          ok: true,
          errorCode: null,
          providerBootstrapRequested: true,
          libraryMissing: false,
        });
        logResolverResult('managed-refresh-success', current, result, selected?.id ?? null, true);
        return result;
      } catch (activationError) {
        const activationCode = safeErrorCode(activationError, 'provider_activation_failed');
        if (isRetry) {
          logRetry('retry-failed', { ...retryBase, providerBootstrapRequested: true, errorCode: activationCode });
        }
        const result = resolution(current, flags, {
          ok: false,
          errorCode: activationCode,
          providerBootstrapRequested: true,
          libraryMissing: false,
        });
        logResolverResult('managed-refresh-failure', current, result, selected?.id ?? null, true);
        return result;
      }
    }

    if (isRetry) {
      logRetry('retry-failed', { ...retryBase, providerBootstrapRequested: true, errorCode });
    }
    const result = resolution(current, flags, {
      ok: false,
      errorCode,
      providerBootstrapRequested: true,
      libraryMissing: false,
    });
    logResolverResult('managed-refresh-failure', current, result, selected?.id ?? null, Boolean(selected && isProviderConnectionReady(selected)));
    return result;
  }

  logProviderPhase('provider-download-complete', {
    source,
    ...retryBase,
    providerBootstrapRequested: true,
  });
  if (isRetry) {
    logRetry('retry-provider-download-complete', { ...retryBase, providerBootstrapRequested: true });
    logRetry('retry-provider-activation-start', { ...retryBase, providerBootstrapRequested: true });
  }

  if (!getActiveRepositoryBundle()) {
    if (isRetry) {
      logRetry('retry-failed', {
        ...retryBase,
        providerBootstrapRequested: true,
        errorCode: 'provider_bundle_unavailable',
      });
    }
    const result = resolution(current, flags, {
      ok: false,
      errorCode: 'provider_bundle_unavailable',
      providerBootstrapRequested: true,
      libraryMissing: false,
    });
    logResolverResult('provider-bundle-unavailable', current, result, selected?.id ?? null, Boolean(selected && isProviderConnectionReady(selected)));
    return result;
  }

  if (isRetry) {
    logRetry('retry-provider-activation-complete', { ...retryBase, providerBootstrapRequested: true });
    logRetry('retry-success', { ...retryBase, providerBootstrapRequested: true });
  }

  const result = resolution(current, flags, {
    ok: true,
    errorCode: null,
    providerBootstrapRequested: true,
    libraryMissing: false,
  });
  logResolverResult('managed-refresh-success', current, result, selected?.id ?? null, Boolean(selected && isProviderConnectionReady(selected)));
  return result;
}

export function resolveStartupProvider(options: ResolveOptions = {}) {
  const source = options.source ?? 'startup';
  if (inFlight) {
    return inFlight;
  }
  inFlight = runResolveStartupProvider(source).finally(() => {
    inFlight = null;
  });
  return inFlight;
}
