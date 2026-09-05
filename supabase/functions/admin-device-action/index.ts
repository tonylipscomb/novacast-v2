import { adminJsonResponse, adminOptionsResponse, readJson } from '../_shared/http.ts';
import { requireAdmin } from '../_shared/admin.ts';
import {
  broadcastDeviceAssignmentChanged,
  isAdminDeviceOnline,
} from '../_shared/deviceAssignmentBroadcast.ts';
import { recordGoldAdminEvent } from '../_shared/goldAdminEvents.ts';

const MIN_EXTENSION_HOURS = 1;
const MAX_EXTENSION_HOURS = 24 * 365 * 100;
const adminActionResponse = adminJsonResponse;

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return adminOptionsResponse(request);
  if (request.method !== 'POST') return adminJsonResponse(request, { errorCategory: 'method_not_allowed' }, 405);

  try {
    const { client, user } = await requireAdmin(request);
    const body = await readJson(request);
    const deviceId = typeof body?.deviceId === 'string' ? body.deviceId : '';
    const action = typeof body?.action === 'string' ? body.action : '';
    if (!deviceId || !action) return adminActionResponse(request, { errorCategory: 'invalid_request' }, 400);

    if (action === 'start_diagnostics_capture' || action === 'stop_diagnostics_capture') {
      let captureDeviceId = deviceId;
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(deviceId)) {
        const target = await client.from('devices').select('id').eq('public_device_code', deviceId.trim().toUpperCase()).maybeSingle();
        if (target.error || !target.data?.id) return adminActionResponse(request, { errorCategory: 'device_not_found' }, 400);
        captureDeviceId = target.data.id;
      }
      const captureId = crypto.randomUUID();
      const enabled = action === 'start_diagnostics_capture';
      const expiresAt = enabled ? new Date(Date.now() + 15 * 60 * 1000).toISOString() : new Date().toISOString();
      const { data, error } = await client.from('device_commands').insert({
        device_id: captureDeviceId,
        command: action,
        payload: { enabled, captureId, expiresAt },
        status: 'pending',
        created_by: user.id,
      }).select('id').single();
      if (error) throw new Error('admin_update_failed');
      return adminActionResponse(request, { ok: true, commandId: data?.id ?? null, captureId: enabled ? captureId : null, expiresAt });
    }

    if (action === 'extend') {
      const hours = Number(body?.hours);
      if (
        !Number.isInteger(hours) ||
        hours < MIN_EXTENSION_HOURS ||
        hours > MAX_EXTENSION_HOURS
      ) {
        return adminActionResponse(request, { errorCategory: 'invalid_extension' }, 400);
      }
      const { data, error } = await client.rpc('extend_device_activation', {
        p_device_id: deviceId,
        p_hours: hours,
      });

      if (!error && data?.[0]) {
        return adminActionResponse(request, { ok: true, expiresAt: data[0].expires_at, mode: 'rpc' });
      }

      const { data: activations, error: activationReadError } = await client
        .from('device_activations')
        .select('id, expires_at, status')
        .eq('device_id', deviceId)
        .in('status', ['active', 'expired'])
        .order('created_at', { ascending: false })
        .limit(1);

      if (activationReadError || !activations?.[0]) {
        return adminActionResponse(request,
          {
            errorCategory: 'activation_not_found',
            detail: activationReadError?.message ?? error?.message ?? null,
          },
          400,
        );
      }

      const currentExpiration = Date.parse(String(activations[0].expires_at ?? ''));
      const baseTime = Number.isFinite(currentExpiration)
        ? Math.max(Date.now(), currentExpiration)
        : Date.now();
      const expiresAt = new Date(baseTime + hours * 60 * 60 * 1000).toISOString();

      const { error: activationUpdateError } = await client
        .from('device_activations')
        .update({
          status: 'active',
          expires_at: expiresAt,
          revoked_at: null,
          revoked_reason: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', activations[0].id);

      if (activationUpdateError) {
        return adminActionResponse(request,
          { errorCategory: 'activation_update_failed', detail: activationUpdateError.message },
          500,
        );
      }

      const { error: deviceUpdateError } = await client
        .from('devices')
        .update({
          status: 'registered',
          activation_status: 'active',
          updated_at: new Date().toISOString(),
        })
        .eq('id', deviceId);

      if (deviceUpdateError) {
        return adminActionResponse(request,
          { errorCategory: 'device_update_failed', detail: deviceUpdateError.message },
          500,
        );
      }

      return adminActionResponse(request, { ok: true, expiresAt, mode: 'fallback' });
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
      return adminActionResponse(request, { ok: true });
    }

    if (action === 'assign_invite') {
      const inviteId = typeof body?.inviteId === 'string' ? body.inviteId : '';
      const publicDeviceCode =
        typeof body?.publicDeviceCode === 'string' ? body.publicDeviceCode.trim().toUpperCase() : '';
      if (!inviteId || !publicDeviceCode) {
        return adminActionResponse(request, { errorCategory: 'invalid_request' }, 400);
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
        return adminActionResponse(request, { errorCategory: category }, 400);
      }
      return adminActionResponse(request, {
        ok: true,
        deviceId: data[0].device_id,
        expiresAt: data[0].expires_at,
        managedProviderId: data[0].managed_provider_id,
        providerAssigned: Boolean(data[0].provider_assigned),
      });
    }

    // Reassign an activated beta device to a different managed provider package.
    if (action === 'assign_provider') {
      const managedProviderId =
        typeof body?.managedProviderId === 'string' ? body.managedProviderId.trim() : '';
      if (!managedProviderId) {
        return adminActionResponse(request, { errorCategory: 'invalid_request' }, 400);
      }

      const { data: device, error: deviceError } = await client
        .from('devices')
        .select('id,status,managed_provider_id,last_seen_at')
        .eq('id', deviceId)
        .maybeSingle();
      if (deviceError || !device) {
        return adminActionResponse(request, { errorCategory: 'device_not_found' }, 400);
      }
      if (['revoked', 'disabled'].includes(String(device.status ?? ''))) {
        return adminActionResponse(request, { errorCategory: 'device_blocked' }, 400);
      }

      const { data: provider, error: providerError } = await client
        .from('managed_providers')
        .select('id,display_name,status,content_policy')
        .eq('id', managedProviderId)
        .maybeSingle();
      if (providerError || !provider) {
        return adminActionResponse(request, { errorCategory: 'provider_not_found' }, 400);
      }
      if (String(provider.status ?? '') !== 'active') {
        return adminActionResponse(request, { errorCategory: 'provider_inactive' }, 400);
      }

      if (device.managed_provider_id === managedProviderId) {
        return adminActionResponse(request, {
          ok: true,
          managedProviderId,
          providerName: provider.display_name,
          unchanged: true,
        });
      }

      const now = new Date().toISOString();
      const contentPolicy =
        typeof provider.content_policy === 'string' && provider.content_policy.trim()
          ? provider.content_policy.trim().slice(0, 64)
          : 'us_only';

      const { error: supersedeError } = await client
        .from('device_provider_assignments')
        .update({ status: 'superseded', revoked_at: now, updated_at: now })
        .eq('device_id', deviceId)
        .eq('status', 'active');
      if (supersedeError) {
        return adminActionResponse(request,
          { errorCategory: 'assignment_update_failed', detail: supersedeError.message },
          500,
        );
      }

      const { data: createdAssignment, error: insertError } = await client
        .from('device_provider_assignments')
        .insert({
          device_id: deviceId,
          managed_provider_id: managedProviderId,
          content_policy: contentPolicy,
          status: 'active',
        })
        .select('id,assigned_at,managed_provider_id')
        .single();
      if (insertError || !createdAssignment) {
        return adminActionResponse(request,
          { errorCategory: 'assignment_create_failed', detail: insertError?.message ?? null },
          500,
        );
      }

      const { error: deviceUpdateError } = await client
        .from('devices')
        .update({
          managed_provider_id: managedProviderId,
          content_policy: contentPolicy,
          updated_at: now,
        })
        .eq('id', deviceId);
      if (deviceUpdateError) {
        return adminActionResponse(request,
          { errorCategory: 'device_update_failed', detail: deviceUpdateError.message },
          500,
        );
      }

      await client
        .from('device_activations')
        .update({
          managed_provider_id: managedProviderId,
          content_policy: contentPolicy,
          updated_at: now,
        })
        .eq('device_id', deviceId)
        .eq('status', 'active');

      // Queue a config push so the TV re-downloads credentials for the new provider.
      const { data: queuedCommand } = await client
        .from('device_commands')
        .insert({
          device_id: deviceId,
          command: 'push_configuration',
          payload: {
            reason: 'admin_assign_provider',
            managedProviderId,
            assignmentId: createdAssignment.id,
            contentPolicy,
            redownloadProvider: true,
          },
          status: 'pending',
          created_by: user.id,
        })
        .select('id')
        .single();

      await broadcastDeviceAssignmentChanged({
        deviceId,
        assignmentId: createdAssignment.id,
        managedProviderId,
        assignedAt: createdAssignment.assigned_at ?? now,
      });

      const goldAccount = await client.from('gold_panel_accounts').select('id,gold_user_id').eq('managed_provider_id', managedProviderId).maybeSingle();
      await recordGoldAdminEvent(client, { action: 'provider_assigned', goldAccountId: goldAccount.data?.id ?? null, managedProviderId, goldUserId: goldAccount.data?.gold_user_id ?? null, actorUserId: user.id, metadata: { deviceId } });

      return adminActionResponse(request, {
        ok: true,
        managedProviderId,
        providerName: provider.display_name,
        contentPolicy,
        assignmentId: createdAssignment.id,
        assignedAt: createdAssignment.assigned_at ?? now,
        assignmentCommandId: queuedCommand?.id ?? null,
        deviceOnline: isAdminDeviceOnline(device.last_seen_at, device.status),
        unchanged: false,
      });
    }

    return adminActionResponse(request, { errorCategory: 'invalid_request' }, 400);
  } catch (error) {
    const category =
      error instanceof Error && error.message === 'admin_unauthorized' ? error.message : 'admin_update_failed';
    return adminActionResponse(request, { errorCategory: category }, category === 'admin_unauthorized' ? 401 : 500);
  }
});
