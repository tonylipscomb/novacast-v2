import { jsonResponse, optionsResponse, readJson } from '../_shared/http.ts';
import { authenticateDevice, deviceRateKey, hasDeviceAuthHeaders } from '../_shared/device.ts';
import { consumeRateLimit, getAdminClient } from '../_shared/supabase.ts';
import { decryptSecret } from '../_shared/security.ts';

const STORED_EMULATOR_SIGNATURE_RE =
  /sdk_gphone|sdk_googletv|sdk_google_atv|google_sdk|android sdk built for|generic_x86|generic_x86_64|aosp_on_x86|ranchu|goldfish|qemu|emulator|gphone|sdk_phone|android tv on|\bsdk_/;

function logAssignmentAuth(event: string, fields: Record<string, unknown>) {
  console.info('[NovaCast Provider Assignment Auth] ' + JSON.stringify({ event, ...fields }));
}

function localBypassHeaderPresent(request: Request) {
  const value = request.headers.get('x-novacast-local-test-bypass')?.trim().toLowerCase();
  return value === '1' || value === 'true';
}

function normalizeDeviceTypeEnum(value: string | null | undefined) {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return 'unknown';
  if (normalized === 'android_emulator') return 'android_emulator';
  if (normalized === 'tv' || normalized === '4') return 'tv';
  if (normalized === 'phone' || normalized === '1') return 'phone';
  if (normalized === 'tablet' || normalized === '2') return 'tablet';
  if (normalized === 'desktop' || normalized === '3') return 'desktop';
  return 'unknown';
}

function storedMetadataPresent(meta: {
  model?: string | null;
  manufacturer?: string | null;
  platform?: string | null;
  device_type?: string | null;
} | null) {
  return Boolean(meta?.model || meta?.manufacturer || meta?.platform || meta?.device_type);
}

function storedEmulatorSignatureMatched(meta: {
  model?: string | null;
  manufacturer?: string | null;
  platform?: string | null;
} | null) {
  const identity = [meta?.model, meta?.manufacturer, meta?.platform]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .join(' ')
    .toLowerCase();
  return identity.length > 0 && STORED_EMULATOR_SIGNATURE_RE.test(identity);
}

function storedExplicitEmulatorClassification(deviceType: string | null | undefined) {
  return normalizeDeviceTypeEnum(deviceType) === 'android_emulator';
}

function looksLikeStoredAndroidEmulator(meta: {
  model?: string | null;
  manufacturer?: string | null;
  platform?: string | null;
  device_type?: string | null;
} | null) {
  return storedExplicitEmulatorClassification(meta?.device_type) || storedEmulatorSignatureMatched(meta);
}

function metadataFromBody(body: Record<string, unknown> | null) {
  const metadata = body?.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata)
    ? body.metadata as Record<string, unknown>
    : {};
  return {
    model: typeof metadata.model === 'string' ? metadata.model.slice(0, 120) : null,
    manufacturer: typeof metadata.manufacturer === 'string' ? metadata.manufacturer.slice(0, 80) : null,
    platform: typeof metadata.platform === 'string' ? metadata.platform.slice(0, 40) : null,
    device_type: typeof metadata.deviceType === 'string' ? metadata.deviceType.slice(0, 40) : null,
  };
}

function requestLooksLikeEmulator(meta: ReturnType<typeof metadataFromBody>) {
  return storedExplicitEmulatorClassification(meta.device_type) || storedEmulatorSignatureMatched(meta);
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return optionsResponse();
  if (request.method !== 'POST') return jsonResponse({ errorCategory: 'method_not_allowed' }, 405);

  const bypassHeaderPresent = localBypassHeaderPresent(request);
  const deviceCredentialPresent = hasDeviceAuthHeaders(request);
  const publicDeviceIdPresent = Boolean(request.headers.get('x-novacast-device-id')?.trim());

  logAssignmentAuth('request-received', {
    localBypassHeaderPresent: bypassHeaderPresent,
    deviceCredentialPresent,
    publicDeviceIdPresent,
  });

  try {
    const client = getAdminClient();
    const device = await authenticateDevice(request, client);
    if (!(await consumeRateLimit(client, await deviceRateKey(request, device.id, 'provider-download'), 12, 600))) {
      return jsonResponse({ errorCategory: 'rate_limited' }, 429);
    }

    const body = await readJson(request);
    const requestMeta = metadataFromBody(body);

    const { data: activation } = await client
      .from('device_activations')
      .select('status,expires_at,content_policy')
      .eq('device_id', device.id)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const activationExpired = Boolean(
      activation?.expires_at && new Date(activation.expires_at).getTime() <= Date.now(),
    );
    const activationActive = Boolean(activation) && !activationExpired;

    const { data: storedMeta } = await client
      .from('devices')
      .select('model,manufacturer,platform,device_type')
      .eq('id', device.id)
      .maybeSingle();

    const storedMetadataEmulatorMatched = looksLikeStoredAndroidEmulator(storedMeta);
    const requestMetadataEmulatorMatched = requestLooksLikeEmulator(requestMeta);
    const ownDeviceAuthenticated = true;
    const localBypassPermitted =
      !activationActive &&
      bypassHeaderPresent &&
      storedMetadataEmulatorMatched &&
      ownDeviceAuthenticated;

    logAssignmentAuth('device-authenticated', {
      ownDeviceAuthenticated,
      activationActive,
      emulatorMetadataMatched: storedMetadataEmulatorMatched,
    });

    let decision = 'activation-required';
    if (activationActive) {
      decision = 'normal-active';
    } else if (localBypassPermitted) {
      decision = 'local-emulator-own-device';
    } else if (bypassHeaderPresent && !storedMetadataEmulatorMatched) {
      decision = 'emulator-check-failed';
    }

    logAssignmentAuth('authorization-decision', {
      activationActive,
      localBypassHeaderPresent: bypassHeaderPresent,
      storedMetadataPresent: storedMetadataPresent(storedMeta),
      storedMetadataEmulatorMatched,
      requestMetadataEmulatorMatched,
      storedDeviceType: normalizeDeviceTypeEnum(storedMeta?.device_type),
      requestDeviceType: normalizeDeviceTypeEnum(requestMeta.device_type),
      ownDeviceAuthenticated,
      localBypassPermitted,
      decision,
    });

    if (!activationActive && !localBypassPermitted) {
      return jsonResponse({ errorCategory: 'activation_required' }, 403);
    }

    const { data: assignment } = await client
      .from('device_provider_assignments')
      .select('id,managed_provider_id,content_policy')
      .eq('device_id', device.id)
      .eq('status', 'active')
      .order('assigned_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!assignment) {
      return jsonResponse({ errorCategory: 'provider_not_assigned' }, 404);
    }

    const { data: provider, error } = await client
      .from('managed_providers')
      .select('id,display_name,slug,credentials_ciphertext,credentials_iv,content_policy,status')
      .eq('id', assignment.managed_provider_id)
      .maybeSingle();

    if (error || !provider || provider.status !== 'active') {
      return jsonResponse({ errorCategory: 'provider_unavailable' }, 404);
    }

    const credentials = JSON.parse(
      await decryptSecret(provider.credentials_ciphertext, provider.credentials_iv),
    ) as {
      type: 'xtream';
      baseUrl: string;
      username: string;
      password: string;
    };

    if (credentials.type !== 'xtream' || !credentials.baseUrl || !credentials.username || !credentials.password) {
      return jsonResponse({ errorCategory: 'provider_unavailable' }, 500);
    }

    return jsonResponse({
      providerId: provider.id,
      providerName: provider.display_name,
      providerSlug: provider.slug,
      contentPolicy: assignment.content_policy ?? provider.content_policy ?? activation?.content_policy ?? 'us_only',
      type: 'xtream',
      baseUrl: credentials.baseUrl,
      username: credentials.username,
      password: credentials.password,
      serverTime: new Date().toISOString(),
    });
  } catch (error) {
    logAssignmentAuth('authorization-decision', {
      activationActive: false,
      localBypassHeaderPresent: bypassHeaderPresent,
      storedMetadataPresent: false,
      storedMetadataEmulatorMatched: false,
      requestMetadataEmulatorMatched: false,
      storedDeviceType: 'unknown',
      requestDeviceType: 'unknown',
      ownDeviceAuthenticated: false,
      localBypassPermitted: false,
      decision: 'device-auth-failed',
    });
    const category =
      error instanceof Error && ['invalid_device', 'rate_limited'].includes(error.message)
        ? error.message
        : 'provider_download_failed';
    return jsonResponse({ errorCategory: category }, category === 'rate_limited' ? 429 : 401);
  }
});
