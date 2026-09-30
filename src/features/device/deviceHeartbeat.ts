import { deviceAuthHeaders, deviceMetadata } from './deviceRegistration';
import type { DeviceHeartbeatResponse, DevicePendingCommand } from './deviceTypes';
import { applyHeartbeatAccess, checkDeviceStatus, getDeviceState } from './deviceActivation';
import { isLocalActivationBypassEnabled } from './deviceFeatureFlags';
import { setContentPolicyOverride } from '@/features/content-policy/ContentPolicyService';
import {
  assignmentFromHeartbeat,
  getAppliedAssignmentDiagnostics,
  reconcileDeviceAssignment,
} from './deviceAssignmentReconcile';
import { resetPairingKeepDevice, factoryResetNovacast } from '@/features/pairing/resetPairing';
import { scheduleProviderCatalogSync } from '@/features/providers/providerCatalogSync';
import { getActiveRepositoryBundle } from '@/features/providers/providerBundle';
import { closeUnifiedPlayback, getUnifiedPlayerState } from '@/features/playback/unified/unifiedPlayerStore';
import { isUnifiedPlaybackActive } from '@/features/playback/unified/unifiedPlayerLogic';
import { reportNetworkOutcome } from '@/features/resilience/offlineStatus';
import { router } from 'expo-router';
import { setDiagnosticsEnabled } from '@/features/diagnostics/diagnosticsConfig';
import { applyDiagnosticCaptureCommand } from '@/features/diagnostics/diagnosticCapture';
import { acknowledgeInventoryReports, getPendingInventoryReports, loadPendingInventoryReports } from './inventoryTelemetry';
import type { DeviceInventoryReport } from './deviceTypes';

type CommandHandlerResult = { id: string; status: 'completed' | 'failed'; result?: Record<string, unknown> };

function logHeartbeat(event: string, fields: Record<string, unknown> = {}) {
  console.info('[NovaCast Device Heartbeat]', { event, ...fields });
}

function statusCategory(status: number) {
  return `${Math.floor(status / 100)}xx`;
}

async function executeRemoteCommand(command: DevicePendingCommand): Promise<CommandHandlerResult> {
  try {
    switch (command.command) {
      case 'refresh_library': {
        const bundle = getActiveRepositoryBundle();
        if (bundle) {
          await scheduleProviderCatalogSync({
            providerId: bundle.providerId,
            requestSource: 'device-heartbeat-refresh-library',
            movies: bundle.movies,
            series: bundle.series,
            live: bundle.live,
          });
        }
        return { id: command.id, status: 'completed', result: { action: 'refresh_library' } };
      }
      case 'refresh_guide':
        return { id: command.id, status: 'completed', result: { action: 'refresh_guide', note: 'guide_will_reload_on_next_open' } };
      case 'run_diagnostics':
        await checkDeviceStatus();
        return { id: command.id, status: 'completed', result: { action: 'run_diagnostics' } };
      case 'start_diagnostics_capture':
      case 'stop_diagnostics_capture':
        await applyDiagnosticCaptureCommand(command.payload);
        return { id: command.id, status: 'completed', result: { action: command.command } };
      case 'push_configuration':
        if (typeof command.payload?.contentPolicy === 'string') {
          setContentPolicyOverride(
            command.payload.contentPolicy === 'unrestricted' ? 'unrestricted' : 'us_only',
          );
        }
        if (command.payload?.redownloadProvider === true) {
          await reconcileDeviceAssignment({ source: 'heartbeat' });
        }
        return { id: command.id, status: 'completed', result: { action: 'push_configuration' } };
      case 'reset_pairing':
        await resetPairingKeepDevice();
        return { id: command.id, status: 'completed', result: { action: 'reset_pairing' } };
      case 'factory_reset':
        await factoryResetNovacast();
        return { id: command.id, status: 'completed', result: { action: 'factory_reset' } };
      case 'clear_image_cache':
      case 'clear_metadata_cache':
      case 'rebuild_search_index':
      case 'rebuild_categories':
      case 'restart_player':
      case 'restart_app':
      case 'show_notification':
        return {
          id: command.id,
          status: 'completed',
          result: { action: command.command, note: 'acknowledged' },
        };
      default:
        return { id: command.id, status: 'failed', result: { error: 'unsupported_command' } };
    }
  } catch (error) {
    return {
      id: command.id,
      status: 'failed',
      result: { error: error instanceof Error ? error.message : 'command_failed' },
    };
  }
}

export async function sendDeviceHeartbeat(options?: {
  currentRoute?: string;
  appFocus?: string;
  diagnostics?: Record<string, unknown>;
}): Promise<DeviceHeartbeatResponse | null> {
  const apiUrl = process.env.EXPO_PUBLIC_NOVACAST_PAIRING_API_URL?.trim().replace(/\/+$/, '');
  const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!apiUrl || !anonKey) {
    logHeartbeat('config-missing', {
      pairingApiConfigured: Boolean(apiUrl),
      publicKeyConfigured: Boolean(anonKey),
    });
    return null;
  }
  logHeartbeat('request-started');
  await loadPendingInventoryReports();

  const inventoryReports = getPendingInventoryReports();
  let response: Response;
  try {
    response = await fetch(`${apiUrl}/device-heartbeat`, {
      method: 'POST',
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
        'Content-Type': 'application/json',
        ...(await deviceAuthHeaders()),
      },
      body: JSON.stringify({
        metadata: deviceMetadata(),
        currentRoute: options?.currentRoute,
        appFocus: options?.appFocus,
        diagnostics: {
          ...(options?.diagnostics ?? {}),
          ...getAppliedAssignmentDiagnostics(),
        },
        ...(inventoryReports.length ? { inventoryReports } : {}),
      }),
    });
  } catch {
    logHeartbeat('network-failure', { errorCategory: 'network' });
    reportNetworkOutcome(false);
    return null;
  }
  logHeartbeat('http-result', { statusCategory: statusCategory(response.status), ok: response.ok });
  if (!response.ok) {
    reportNetworkOutcome(false);
    return null;
  }
  acknowledgeInventoryReports(inventoryReports as DeviceInventoryReport[]);

  // A successful heartbeat response is direct evidence that the device is
  // online, even if a malformed/empty payload prevents the rest of the
  // heartbeat state from being applied.
  reportNetworkOutcome(true);
  const payload = (await response.json().catch(() => null)) as DeviceHeartbeatResponse | null;
  if (!payload) {
    logHeartbeat('response-invalid', { reason: 'empty-or-malformed' });
    return null;
  }
  logHeartbeat('success');
  setDiagnosticsEnabled(payload.diagnosticsEnabled === true);

  const localBypass = isLocalActivationBypassEnabled({ log: false });

  const explicitRevocation =
    payload.activationStatus === 'revoked' ||
    payload.activationStatus === 'suspended';

  const ambiguousInactive =
    payload.deviceActive === false &&
    !localBypass &&
    !explicitRevocation;

  const wasAuthorized =
    getDeviceState().authorization.effectiveAuthorized;

  let confirmedRevocation = false;
  let heartbeatAccessApplied = false;

  // A heartbeat can transiently report deviceActive=false even while the
  // authoritative device-status endpoint still considers this device active.
  // Preserve an already-authorized playback session until revocation is confirmed.
  if (ambiguousInactive && wasAuthorized) {
    console.info(
      '[NovaCast Device Activation]',
      JSON.stringify({
        event: 'heartbeat-inactive-confirmation-start',
        activationStatus: payload.activationStatus ?? null,
        deviceActive: false,
        preservedAuthorizedSession: true,
      }),
    );

    const confirmed = await checkDeviceStatus().catch(() => null);

    confirmedRevocation = confirmed?.state === 'revoked';

    console.info(
      '[NovaCast Device Activation]',
      JSON.stringify({
        event: 'heartbeat-inactive-confirmation-complete',
        confirmedRevocation,
        resultingDeviceState:
          confirmed?.state ?? 'status-check-failed',
        preservedAuthorizedSession: !confirmedRevocation,
      }),
    );

    if (confirmedRevocation) {
      applyHeartbeatAccess(payload);
      heartbeatAccessApplied = true;
    }
  } else {
    applyHeartbeatAccess(payload);
    heartbeatAccessApplied = true;
  }
  logHeartbeat('activation-state-applied', {
    activationStatus: payload.activationStatus,
    deviceActive: payload.deviceActive,
    applied: heartbeatAccessApplied,
  });

  const shouldRevokeSession =
    explicitRevocation ||
    (ambiguousInactive &&
      (wasAuthorized ? confirmedRevocation : true));

  if (shouldRevokeSession) {
    const player = getUnifiedPlayerState();

    if (isUnifiedPlaybackActive(player.machineState, player.item)) {
      closeUnifiedPlayback();
    }

    try {
      router.replace('/');
    } catch {
      // Navigation may be unavailable during teardown.
    }
  } else if (payload.activationStatus === 'expired' && !localBypass) {
    try {
      router.replace('/');
    } catch {
      // Ignore.
    }
  }

  if (payload.contentPolicy === 'us_only' || payload.contentPolicy === 'unrestricted') {
    setContentPolicyOverride(payload.contentPolicy);
  }

  const reconciliation = await reconcileDeviceAssignment({
    source: 'heartbeat',
    snapshot: assignmentFromHeartbeat(payload),
  });
  logHeartbeat('provider-assignment-reconciled', {
    decision: reconciliation.decision,
    refreshed: reconciliation.refreshed,
    assignmentPresent: Boolean(reconciliation.managedProviderId),
  });

  const pending = Array.isArray(payload.pendingCommands) ? payload.pendingCommands : [];
  if (pending.length) {
    const results: CommandHandlerResult[] = [];
    for (const command of pending) {
      results.push(await executeRemoteCommand(command));
    }

    await fetch(`${apiUrl}/device-heartbeat`, {
      method: 'POST',
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
        'Content-Type': 'application/json',
        ...(await deviceAuthHeaders()),
      },
      body: JSON.stringify({
        metadata: deviceMetadata(),
        diagnostics: getAppliedAssignmentDiagnostics(),
        acknowledgedCommandIds: pending.map((command) => command.id),
        commandResults: results,
      }),
    }).catch(() => undefined);
  }

  return payload;
}
