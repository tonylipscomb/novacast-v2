import { jsonResponse, optionsResponse, readJson } from '../_shared/http.ts';
import { requireAdmin } from '../_shared/admin.ts';

const EXTENSION_HOURS = new Set([24, 72, 168]);

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return optionsResponse();
  if (request.method !== 'POST') return jsonResponse({ errorCategory: 'method_not_allowed' }, 405);

  try {
    const { client } = await requireAdmin(request);
    const body = await readJson(request);
    const deviceId = typeof body?.deviceId === 'string' ? body.deviceId : '';
    const action = typeof body?.action === 'string' ? body.action : '';
    if (!deviceId || !action) return jsonResponse({ errorCategory: 'invalid_request' }, 400);

    if (action === 'extend') {
      const hours = Number(body?.hours);
      if (!EXTENSION_HOURS.has(hours)) {
        return jsonResponse({ errorCategory: 'invalid_extension' }, 400);
      }
      const { data, error } = await client.rpc('extend_device_activation', {
        p_device_id: deviceId,
        p_hours: hours,
      });
      if (error || !data?.[0]) {
        return jsonResponse({ errorCategory: 'admin_update_failed' }, 500);
      }
      return jsonResponse({ ok: true, expiresAt: data[0].expires_at });
    }

    if (action === 'revoke' || action === 'restore') {
      const patch =
        action === 'revoke'
          ? {
              status: 'revoked',
              activation_status: 'revoked',
              revoked_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            }
          : {
              status: 'registered',
              activation_status: 'inactive',
              revoked_at: null,
              updated_at: new Date().toISOString(),
            };
      const { error } = await client.from('devices').update(patch).eq('id', deviceId);
      if (error) throw new Error('admin_update_failed');
      if (action === 'revoke') {
        await client
          .from('device_activations')
          .update({
            status: 'revoked',
            revoked_at: new Date().toISOString(),
            revoked_reason:
              typeof body?.reason === 'string' ? body.reason.slice(0, 200) : 'Revoked by administrator',
            updated_at: new Date().toISOString(),
          })
          .eq('device_id', deviceId)
          .eq('status', 'active');
        await client
          .from('device_provider_assignments')
          .update({ status: 'revoked', revoked_at: new Date().toISOString(), updated_at: new Date().toISOString() })
          .eq('device_id', deviceId)
          .eq('status', 'active');
      }
      return jsonResponse({ ok: true });
    }

    if (action === 'assign_invite') {
      const inviteId = typeof body?.inviteId === 'string' ? body.inviteId : '';
      const publicDeviceCode =
        typeof body?.publicDeviceCode === 'string' ? body.publicDeviceCode.trim().toUpperCase() : '';
      if (!inviteId || !publicDeviceCode) {
        return jsonResponse({ errorCategory: 'invalid_request' }, 400);
      }
      const { data, error } = await client.rpc('admin_activate_device_with_invite_id', {
        p_public_device_code: publicDeviceCode,
        p_invite_id: inviteId,
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
        ] as const;
        const category = known.find((code) => detail.includes(code)) ?? 'admin_update_failed';
        return jsonResponse({ errorCategory: category }, 400);
      }
      return jsonResponse({
        ok: true,
        deviceId: data[0].device_id,
        expiresAt: data[0].expires_at,
        managedProviderId: data[0].managed_provider_id,
        providerAssigned: Boolean(data[0].provider_assigned),
      });
    }

    return jsonResponse({ errorCategory: 'invalid_request' }, 400);
  } catch (error) {
    const category =
      error instanceof Error && error.message === 'admin_unauthorized' ? error.message : 'admin_update_failed';
    return jsonResponse({ errorCategory: category }, category === 'admin_unauthorized' ? 401 : 500);
  }
});
