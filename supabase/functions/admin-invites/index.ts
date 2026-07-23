import { jsonResponse, optionsResponse, readJson } from '../_shared/http.ts';
import { requireAdmin } from '../_shared/admin.ts';
import { createPairingCode, hashCode } from '../_shared/security.ts';

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return optionsResponse();

  try {
    const { client, user } = await requireAdmin(request);

    if (request.method === 'GET') {
      const { data, error } = await client
        .from('beta_invites')
        .select(
          'id,display_label,status,maximum_devices,redeemed_count,starts_at,expires_at,content_policy,managed_provider_id,assigned_email,assigned_name,notes,activation_duration_hours,created_at,updated_at',
        )
        .order('created_at', { ascending: false });
      if (error) throw new Error('admin_query_failed');
      return jsonResponse({ invitations: data ?? [] });
    }

    if (request.method !== 'POST' && request.method !== 'PATCH') {
      return jsonResponse({ errorCategory: 'method_not_allowed' }, 405);
    }

    const body = await readJson(request);

    if (request.method === 'PATCH') {
      const id = typeof body?.id === 'string' ? body.id : '';
      if (!id) return jsonResponse({ errorCategory: 'invalid_request' }, 400);

      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (['active', 'paused', 'revoked'].includes(String(body?.status))) patch.status = body.status;
      if (typeof body?.label === 'string') patch.display_label = body.label.slice(0, 120);
      if (typeof body?.notes === 'string') patch.notes = body.notes.slice(0, 2000);
      if (typeof body?.assignedEmail === 'string') patch.assigned_email = body.assignedEmail.slice(0, 200);
      if (typeof body?.assignedName === 'string') patch.assigned_name = body.assignedName.slice(0, 120);
      if (typeof body?.contentPolicy === 'string') patch.content_policy = body.contentPolicy.slice(0, 64);
      if (typeof body?.managedProviderId === 'string' || body?.managedProviderId === null) {
        patch.managed_provider_id = body.managedProviderId;
      }
      if (body?.activationDurationHours !== undefined) {
        const hours = Number(body.activationDurationHours);
        patch.activation_duration_hours =
          Number.isFinite(hours) && hours > 0 ? Math.min(8760, Math.floor(hours)) : null;
      }
      if (typeof body?.expiresAt === 'string' || body?.expiresAt === null) patch.expires_at = body.expiresAt;
      if (typeof body?.startsAt === 'string' || body?.startsAt === null) patch.starts_at = body.startsAt;
      if (body?.maximumDevices !== undefined) {
        patch.maximum_devices = Math.max(1, Math.min(10000, Number(body.maximumDevices) || 1));
      }

      const { error } = await client.from('beta_invites').update(patch).eq('id', id);
      if (error) throw new Error('admin_update_failed');
      return jsonResponse({ ok: true });
    }

    const code = createPairingCode();
    const durationHours = Number(body?.activationDurationHours);
    const { data, error } = await client
      .from('beta_invites')
      .insert({
        code_hash: await hashCode(code),
        display_label: typeof body?.label === 'string' ? body.label.slice(0, 120) : null,
        maximum_devices: Math.max(1, Math.min(10000, Number(body?.maximumDevices) || 1)),
        starts_at: typeof body?.startsAt === 'string' ? body.startsAt : null,
        expires_at: typeof body?.expiresAt === 'string' ? body.expiresAt : null,
        content_policy: typeof body?.contentPolicy === 'string' ? body.contentPolicy.slice(0, 64) : 'us_only',
        managed_provider_id: typeof body?.managedProviderId === 'string' ? body.managedProviderId : null,
        assigned_email: typeof body?.assignedEmail === 'string' ? body.assignedEmail.slice(0, 200) : null,
        assigned_name: typeof body?.assignedName === 'string' ? body.assignedName.slice(0, 120) : null,
        notes: typeof body?.notes === 'string' ? body.notes.slice(0, 2000) : null,
        activation_duration_hours:
          Number.isFinite(durationHours) && durationHours > 0 ? Math.min(8760, Math.floor(durationHours)) : 72,
        created_by: user.id,
      })
      .select(
        'id,display_label,status,maximum_devices,starts_at,expires_at,content_policy,managed_provider_id,assigned_email,assigned_name,notes,activation_duration_hours,created_at',
      )
      .single();

    if (error || !data) throw new Error('admin_create_failed');
    return jsonResponse({ invitation: data, code });
  } catch (error) {
    const category =
      error instanceof Error && error.message === 'admin_unauthorized' ? error.message : 'admin_request_failed';
    return jsonResponse({ errorCategory: category }, category === 'admin_unauthorized' ? 401 : 500);
  }
});
