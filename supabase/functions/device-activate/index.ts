import { jsonResponse, optionsResponse, readJson } from '../_shared/http.ts';
import { consumeRateLimit, getAdminClient } from '../_shared/supabase.ts';
import { hashCode, hashToken, normalizeCode, normalizePublicDeviceCode } from '../_shared/security.ts';

function logActivationServer(details: Record<string, string | number | boolean | null>) {
  console.info('[NovaCast Activation Server] ' + JSON.stringify(details));
}

function logActivationDb(details: Record<string, string | number | boolean | null>) {
  console.info('[NovaCast Activation DB] ' + JSON.stringify(details));
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return optionsResponse();
  if (request.method !== 'POST') return jsonResponse({ errorCategory: 'method_not_allowed' }, 405);
  try {
    const body = await readJson(request);
    const deviceCode = normalizePublicDeviceCode(body?.deviceId);
    const inviteCode = normalizeCode(body?.invitationCode);
    if (!inviteCode || inviteCode.length < 6 || inviteCode.length > 32) {
      logActivationServer({
        function: 'device-activate',
        stage: 'validate-invite-code',
        deviceRowFound: false,
        inviteRowFound: false,
        inviteActive: false,
        inviteExpired: false,
        providerFound: false,
        sessionFound: false,
        credentialValid: false,
        activationWriteAttempted: false,
        activationWriteSucceeded: false,
        affectedRows: 0,
        originalErrorCode: 'activation_unavailable',
        returnedErrorCode: 'activation_unavailable',
      });
      throw new Error('activation_unavailable');
    }

    const client = getAdminClient();
    if (!(await consumeRateLimit(client, await hashToken(`${deviceCode}:activation`), 10, 600))) {
      return jsonResponse({ errorCategory: 'rate_limited' }, 429);
    }

    logActivationServer({
      function: 'device-activate',
      stage: 'rpc-start',
      deviceRowFound: false,
      inviteRowFound: false,
      inviteActive: false,
      inviteExpired: false,
      providerFound: false,
      sessionFound: false,
      credentialValid: true,
      activationWriteAttempted: true,
      activationWriteSucceeded: false,
      affectedRows: 0,
      originalErrorCode: null,
      returnedErrorCode: null,
    });

    const { data, error } = await client.rpc('activate_device_with_invite', {
      p_public_device_code: deviceCode,
      p_code_hash: await hashCode(inviteCode),
      p_friendly_name: typeof body?.friendlyName === 'string' ? body.friendlyName : null,
    });

    if (error || !data?.[0]) {
      const detail = typeof error?.message === 'string' ? error.message : '';
      const known = [
        'device_not_found',
        'device_blocked',
        'invite_not_found',
        'invite_inactive',
        'invite_not_started',
        'invite_expired',
        'invite_exhausted',
        'activation_unavailable',
      ] as const;
      const category = known.find((code) => detail.includes(code))
        ?? (detail.includes('Could not find the function') || detail.includes('function public.activate_device_with_invite')
          ? 'activation_rpc_missing'
          : 'activation_unavailable');

      logActivationDb({
        operation: 'activate_device_with_invite',
        table: 'devices+beta_invites+device_activations',
        rowFound: false,
        rowsAffected: 0,
        constraintName: null,
        postgresCode: typeof error?.code === 'string' ? error.code : null,
        rlsSuspected: typeof error?.code === 'string' && error.code === '42501',
        success: false,
      });
      logActivationServer({
        function: 'device-activate',
        stage: 'rpc-failed',
        deviceRowFound: category !== 'device_not_found',
        inviteRowFound: category !== 'invite_not_found',
        inviteActive: category !== 'invite_inactive',
        inviteExpired: category === 'invite_expired',
        providerFound: false,
        sessionFound: false,
        credentialValid: true,
        activationWriteAttempted: true,
        activationWriteSucceeded: false,
        affectedRows: 0,
        originalErrorCode: category,
        returnedErrorCode: category,
      });
      return jsonResponse({ errorCategory: category }, 400);
    }

    const row = data[0] as {
      device_id: string;
      activation_status: string;
      expires_at: string | null;
      managed_provider_id: string | null;
      content_policy: string;
      provider_assigned: boolean;
    };

    logActivationDb({
      operation: 'activate_device_with_invite',
      table: 'devices+beta_invites+device_activations',
      rowFound: true,
      rowsAffected: 1,
      constraintName: null,
      postgresCode: null,
      rlsSuspected: false,
      success: true,
    });
    logActivationServer({
      function: 'device-activate',
      stage: 'rpc-success',
      deviceRowFound: true,
      inviteRowFound: true,
      inviteActive: true,
      inviteExpired: false,
      providerFound: Boolean(row.managed_provider_id),
      sessionFound: false,
      credentialValid: true,
      activationWriteAttempted: true,
      activationWriteSucceeded: true,
      affectedRows: 1,
      originalErrorCode: null,
      returnedErrorCode: null,
    });

    return jsonResponse({
      activated: true,
      deviceId: row.device_id,
      activationStatus: row.activation_status,
      expiresAt: row.expires_at,
      managedProviderId: row.managed_provider_id,
      contentPolicy: row.content_policy ?? 'us_only',
      providerAssigned: Boolean(row.provider_assigned),
      requiresProviderDownload: Boolean(row.provider_assigned),
      serverTime: new Date().toISOString(),
    });
  } catch (error) {
    const category =
      error instanceof Error && ['rate_limited', 'activation_unavailable', 'invalid_device'].includes(error.message)
        ? error.message
        : 'activation_unavailable';
    logActivationServer({
      function: 'device-activate',
      stage: 'catch',
      deviceRowFound: false,
      inviteRowFound: false,
      inviteActive: false,
      inviteExpired: false,
      providerFound: false,
      sessionFound: false,
      credentialValid: category !== 'invalid_device',
      activationWriteAttempted: false,
      activationWriteSucceeded: false,
      affectedRows: 0,
      originalErrorCode: error instanceof Error ? error.message.slice(0, 64) : 'unknown',
      returnedErrorCode: category,
    });
    return jsonResponse({ errorCategory: category }, category === 'rate_limited' ? 429 : 400);
  }
});
