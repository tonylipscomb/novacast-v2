import { getClientAddress, jsonResponse, optionsResponse, readJson } from '../_shared/http.ts';
import { consumeRateLimit, getAdminClient } from '../_shared/supabase.ts';
import { createPublicDeviceCode, hashDeviceSecret, hashInstallation, hashToken, normalizeInstallationId } from '../_shared/security.ts';

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return optionsResponse();
  if (request.method !== 'POST') return jsonResponse({ errorCategory: 'method_not_allowed' }, 405);
  try {
    const body = await readJson(request);
    const installationId = normalizeInstallationId(body?.installationId);
    const secret = typeof body?.deviceSecret === 'string' ? body.deviceSecret : '';
    if (secret.length < 32 || secret.length > 256) throw new Error('invalid_device');
    const client = getAdminClient();
    if (!(await consumeRateLimit(client, await hashToken(`${getClientAddress(request)}:device-register`), 8, 600))) return jsonResponse({ errorCategory: 'rate_limited' }, 429);
    const installationHash = await hashInstallation(installationId);
    const secretHash = await hashDeviceSecret(secret);
    const metadata = body?.metadata && typeof body.metadata === 'object' ? body.metadata as Record<string, unknown> : {};
    const patch = {
      platform: typeof metadata.platform === 'string' ? metadata.platform.slice(0, 40) : null,
      manufacturer: typeof metadata.manufacturer === 'string' ? metadata.manufacturer.slice(0, 80) : null,
      model: typeof metadata.model === 'string' ? metadata.model.slice(0, 120) : null,
      device_type: typeof metadata.deviceType === 'string' ? metadata.deviceType.slice(0, 40) : null,
      os_version: typeof metadata.osVersion === 'string' ? metadata.osVersion.slice(0, 40) : null,
      app_version: typeof metadata.appVersion === 'string' ? metadata.appVersion.slice(0, 40) : null,
      app_build: typeof metadata.appBuild === 'string' ? metadata.appBuild.slice(0, 40) : null,
      last_ip_hash: await hashToken(getClientAddress(request)),
      last_seen_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    const { data: existing, error: lookupError } = await client.from('devices').select('id,public_device_code,status').eq('installation_id_hash', installationHash).maybeSingle();
    if (lookupError) throw new Error('server_configuration_error');
    if (existing) {
      const { error } = await client.from('devices').update({ ...patch, device_secret_hash: secretHash }).eq('id', existing.id);
      if (error) throw new Error('server_configuration_error');
      return jsonResponse({ deviceId: existing.id, publicDeviceCode: existing.public_device_code, status: existing.status });
    }
    let inserted = null;
    for (let attempt = 0; attempt < 3 && !inserted; attempt += 1) {
      const result = await client.from('devices').insert({ installation_id_hash: installationHash, device_secret_hash: secretHash, public_device_code: createPublicDeviceCode(), ...patch }).select('id,public_device_code,status').single();
      if (!result.error) inserted = result.data;
      else if (!result.error.message.toLowerCase().includes('duplicate')) throw new Error('server_configuration_error');
    }
    if (!inserted) throw new Error('device_registration_failed');
    return jsonResponse({ deviceId: inserted.id, publicDeviceCode: inserted.public_device_code, status: inserted.status });
  } catch (error) {
    const category = error instanceof Error ? error.message : 'device_registration_failed';
    return jsonResponse({ errorCategory: ['invalid_device', 'rate_limited'].includes(category) ? category : 'device_registration_failed' }, category === 'rate_limited' ? 429 : 400);
  }
});
