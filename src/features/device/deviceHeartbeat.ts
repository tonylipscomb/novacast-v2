import { deviceAuthHeaders, deviceMetadata } from './deviceRegistration';
import type { DeviceHeartbeatResponse, DevicePendingCommand } from './deviceTypes';
import { checkDeviceStatus } from './deviceActivation';
import { setContentPolicyOverride } from '@/features/content-policy/ContentPolicyService';
import { downloadManagedProviderAssignment } from './managedProviderDownload';
import { resetPairingKeepDevice, factoryResetNovacast } from '@/features/pairing/resetPairing';
import { scheduleProviderCatalogSync } from '@/features/providers/providerCatalogSync';
import { getActiveRepositoryBundle } from '@/features/providers/providerBundle';

type CommandHandlerResult = { id: string; status: 'completed' | 'failed'; result?: Record<string, unknown> };

async function executeRemoteCommand(command: DevicePendingCommand): Promise<CommandHandlerResult> {
  try {
    switch (command.command) {
      case 'refresh_library': {
        const bundle = getActiveRepositoryBundle();
        if (bundle) {
          await scheduleProviderCatalogSync({
            providerId: bundle.providerId,
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
      case 'push_configuration':
        if (typeof command.payload?.contentPolicy === 'string') {
          setContentPolicyOverride(
            command.payload.contentPolicy === 'unrestricted' ? 'unrestricted' : 'us_only',
          );
        }
        if (command.payload?.redownloadProvider === true) {
          await downloadManagedProviderAssignment();
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
  if (!apiUrl || !anonKey) return null;

  const response = await fetch(`${apiUrl}/device-heartbeat`, {
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
      diagnostics: options?.diagnostics,
    }),
  }).catch(() => null);

  if (!response || !response.ok) {
    return null;
  }

  const payload = (await response.json().catch(() => null)) as DeviceHeartbeatResponse | null;
  if (!payload) return null;

  if (payload.contentPolicy === 'us_only' || payload.contentPolicy === 'unrestricted') {
    setContentPolicyOverride(payload.contentPolicy);
  }

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
        acknowledgedCommandIds: pending.map((command) => command.id),
        commandResults: results,
      }),
    }).catch(() => undefined);
  }

  return payload;
}
