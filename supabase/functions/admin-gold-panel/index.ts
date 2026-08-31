import { adminJsonResponse, adminOptionsResponse, readJson } from '../_shared/http.ts';
import { requireAdmin } from '../_shared/admin.ts';
import { decryptSecret, encryptSecret, normalizeProviderUrl } from '../_shared/security.ts';
import { canActivateFromHealth, sanitizeHealthSummary } from '../_shared/providerHealth.ts';
import { runProviderHealthCheck } from '../_shared/providerHealthRunner.ts';
import { checkGoldRoute, createM3uAccount, getDeviceInfo, getPackages, getReseller, parseM3uUrl, renewAccount, safeGoldBaseUrl, setAccountStatus, GoldPanelError } from '../_shared/goldPanelClient.ts';
import { sanitizeGoldError, sanitizeGoldText } from '../_shared/goldPanelSanitization.ts';

type Client = Awaited<ReturnType<typeof requireAdmin>>['client'];
type Credentials = { type: 'xtream'; baseUrl: string; username: string; password: string; upstreamUrl?: string };

const ACCOUNT_SELECT = 'id,managed_provider_id,gold_user_id,gold_package_id,gold_package_name,gold_country,gold_expiration,gold_enabled,gold_notes,gold_upstream_url,route_mode,route_domain,last_synced_at,last_sync_error,created_at,updated_at';

function errorResponse(request: Request, error: unknown) {
  const category = error instanceof GoldPanelError ? error.category : error instanceof Error && error.message === 'admin_unauthorized' ? 'admin_unauthorized' : 'gold_request_failed';
  const status = error instanceof GoldPanelError ? error.status : category === 'admin_unauthorized' ? 401 : 500;
  return adminJsonResponse(request, { errorCategory: category, error: sanitizeGoldError(error instanceof Error ? error.message : 'Gold Panel request failed') }, status);
}

function slugify(value: string) { return value.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64) || `gold-${crypto.randomUUID().slice(0, 8)}`; }

async function providerCredentials(client: Client, providerId: string): Promise<Credentials> {
  const { data, error } = await client.from('managed_providers').select('credentials_ciphertext,credentials_iv').eq('id', providerId).maybeSingle();
  if (error || !data) throw new GoldPanelError('provider_not_found', 'NovaCast provider was not found.', 404);
  return JSON.parse(await decryptSecret(data.credentials_ciphertext, data.credentials_iv)) as Credentials;
}

async function syncAccount(client: Client, account: Record<string, any>) {
  const credentials = await providerCredentials(client, account.managed_provider_id);
  let info;
  try { info = await getDeviceInfo(credentials.username, credentials.password); }
  catch (error) {
    const safeError = sanitizeGoldError(error instanceof Error ? error.message : 'Gold account sync failed');
    await client.from('gold_panel_accounts').update({ last_sync_error: safeError, updated_at: new Date().toISOString() }).eq('id', account.id);
    throw new GoldPanelError('gold_sync_failed', safeError, 502);
  }
  const patch = {
    gold_user_id: info.goldUserId || account.gold_user_id,
    gold_country: info.country || account.gold_country,
    gold_enabled: info.enabled,
    gold_notes: info.notes || account.gold_notes,
    gold_upstream_url: safeGoldBaseUrl(info.upstreamUrl) || account.gold_upstream_url,
    gold_expiration: info.expire ? info.expire.slice(0, 10) : account.gold_expiration,
    last_synced_at: new Date().toISOString(), last_sync_error: null, updated_at: new Date().toISOString(),
  };
  const { data, error } = await client.from('gold_panel_accounts').update(patch).eq('id', account.id).select(ACCOUNT_SELECT).single();
  if (error) throw new Error('gold_metadata_update_failed');
  return data;
}

async function createNovaCastProvider(client: Client, input: { displayName: string; credentials: Credentials; notes?: string }) {
  const encrypted = await encryptSecret(JSON.stringify({ type: 'xtream', baseUrl: await normalizeProviderUrl(input.credentials.baseUrl), username: input.credentials.username, password: input.credentials.password }));
  const { data, error } = await client.from('managed_providers').insert({
    slug: slugify(input.displayName), display_name: input.displayName.slice(0, 120),
    credentials_ciphertext: encrypted.ciphertext, credentials_iv: encrypted.iv,
    notes: input.notes?.slice(0, 2000) ?? null, status: 'draft', health_status: 'unvalidated', validation_stale: true,
  }).select('id,slug,display_name,status,health_status,validation_stale').single();
  if (error || !data) throw new Error('novacast_provider_create_failed');
  return data;
}

async function listAccounts(client: Client) {
  const { data: accounts, error } = await client.from('gold_panel_accounts').select(ACCOUNT_SELECT).order('created_at', { ascending: false });
  if (error) throw new Error('gold_query_failed');
  const providerIds = (accounts ?? []).map((row) => row.managed_provider_id);
  const providers = providerIds.length ? await client.from('managed_providers').select('id,display_name,status,health_status,last_health_summary').in('id', providerIds) : { data: [], error: null };
  if (providers.error) throw new Error('gold_query_failed');
  const assignments = providerIds.length ? await client.from('device_provider_assignments').select('managed_provider_id,device_id').in('managed_provider_id', providerIds).eq('status', 'active') : { data: [], error: null };
  const deviceIds = (assignments.data ?? []).map((row) => row.device_id);
  const devices = deviceIds.length ? await client.from('devices').select('id,public_device_code,friendly_name,assigned_tester_name').in('id', deviceIds) : { data: [], error: null };
  const providerById = new Map((providers.data ?? []).map((row) => [row.id, row]));
  const deviceById = new Map((devices.data ?? []).map((row) => [row.id, row]));
  const assignmentByProvider = new Map((assignments.data ?? []).map((row) => [row.managed_provider_id, deviceById.get(row.device_id) ?? null]));
  return (accounts ?? []).map((account) => ({ ...account, provider: providerById.get(account.managed_provider_id) ?? null, assignedDevice: assignmentByProvider.get(account.managed_provider_id) ?? null }));
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return adminOptionsResponse(request);
  try {
    const { client } = await requireAdmin(request);
    if (request.method === 'GET') return adminJsonResponse(request, { accounts: await listAccounts(client) });
    if (request.method !== 'POST') return adminJsonResponse(request, { errorCategory: 'method_not_allowed' }, 405);
    const body = await readJson(request); const action = String(body?.action ?? '');
    if (action === 'reseller') return adminJsonResponse(request, { reseller: await getReseller() });
    if (action === 'packages') return adminJsonResponse(request, { packages: await getPackages() });
    if (action === 'list_accounts') return adminJsonResponse(request, { accounts: await listAccounts(client) });
    if (action === 'route_health') return adminJsonResponse(request, { route: await checkGoldRoute(String(body?.domain ?? '')) });

    if (action === 'retry_recovery') {
      const reference = typeof body?.recoveryReference === 'string' ? body.recoveryReference : '';
      const { data: recovery, error: recoveryError } = await client.from('gold_panel_recoveries').select('*').eq('id', reference).is('used_at', null).gt('expires_at', new Date().toISOString()).maybeSingle();
      if (recoveryError || !recovery) throw new GoldPanelError('recovery_not_found', 'Recovery record was not found or has expired.', 404);
      const credentials = JSON.parse(await decryptSecret(recovery.credentials_ciphertext, recovery.credentials_iv)) as Credentials;
      const provider = await createNovaCastProvider(client, { displayName: String(body?.displayName ?? `Gold ${credentials.username}`), credentials, notes: recovery.gold_notes ?? '' });
      const { data: account, error: metadataError } = await client.from('gold_panel_accounts').insert({ managed_provider_id: provider.id, gold_user_id: recovery.gold_user_id, gold_package_id: recovery.gold_package_id, gold_package_name: recovery.gold_package_name, gold_country: recovery.gold_country, gold_notes: recovery.gold_notes, gold_upstream_url: credentials.baseUrl, gold_enabled: true }).select(ACCOUNT_SELECT).single();
      if (metadataError || !account) throw new GoldPanelError('gold_metadata_create_failed', 'NovaCast provider was created but Gold metadata could not be attached.', 502);
      await client.from('gold_panel_recoveries').update({ used_at: new Date().toISOString() }).eq('id', reference);
      return adminJsonResponse(request, { success: true, recoveryRequired: false, novaCastProviderCreated: true, managedProviderId: provider.id, account, provider });
    }

    const accountId = typeof body?.accountId === 'string' ? body.accountId : '';
    if (action === 'create_account' || action === 'import_account') {
      let credentials: Credentials; let goldCreated = false;
      if (action === 'create_account') {
        const sub = ['1', '3', '6', '12'].includes(String(body?.sub)) ? String(body.sub) : '';
        const pack = String(body?.packageId ?? '').trim(); const country = String(body?.country ?? 'US').trim().toUpperCase();
        if (!sub || !pack || !/^(?:ALL|[A-Z]{2})$/.test(country)) throw new GoldPanelError('invalid_request', 'Subscription, package, and country are required.', 400);
        const created = await createM3uAccount({ sub, pack, country, notes: String(body?.notes ?? '').slice(0, 500) });
        credentials = created; goldCreated = true;
      } else {
        credentials = parseM3uUrl(body?.m3uUrl);
        goldCreated = true;
      }
      const displayName = String(body?.displayName ?? `Gold ${credentials.username}`).trim().slice(0, 120) || `Gold ${credentials.username}`;
      let provider: any;
      try { provider = await createNovaCastProvider(client, { displayName, credentials, notes: String(body?.notes ?? '') }); }
      catch (error) {
        const encrypted = await encryptSecret(JSON.stringify(credentials));
        const recovery = await client.from('gold_panel_recoveries').insert({ gold_user_id: String(body?.goldUserId ?? credentials.username), credentials_ciphertext: encrypted.ciphertext, credentials_iv: encrypted.iv, gold_package_id: body?.packageId ?? null, gold_package_name: body?.packageName ?? null, gold_country: body?.country ?? null, gold_notes: String(body?.notes ?? '').slice(0, 500) || null }).select('id,gold_user_id').single();
        if (recovery.error || !recovery.data) return adminJsonResponse(request, { success: false, goldCreated, novaCastProviderCreated: false, recoveryRequired: false, errorCategory: 'recovery_persistence_failed' }, 502);
        return adminJsonResponse(request, { success: false, goldCreated, novaCastProviderCreated: false, recoveryRequired: true, recoveryReference: recovery.data.id, goldUserId: recovery.data.gold_user_id, errorCategory: 'novacast_provider_create_failed', error: sanitizeGoldError(error instanceof Error ? error.message : 'Provider creation failed') }, 502);
      }
      const info = await getDeviceInfo(credentials.username, credentials.password).catch(() => null);
      const { data: account, error } = await client.from('gold_panel_accounts').insert({
        managed_provider_id: provider.id, gold_user_id: String(body?.goldUserId ?? info?.goldUserId ?? credentials.username), gold_package_id: body?.packageId ?? null, gold_package_name: body?.packageName ?? null, gold_country: body?.country ?? info?.country ?? null, gold_expiration: info?.expire?.slice(0, 10) ?? null, gold_enabled: info?.enabled ?? true, gold_notes: String(body?.notes ?? '').slice(0, 500) || null, gold_upstream_url: credentials.baseUrl, route_mode: body?.routeMode ?? null, route_domain: body?.routeDomain ?? null, last_synced_at: info ? new Date().toISOString() : null,
      }).select(ACCOUNT_SELECT).single();
      if (error || !account) return adminJsonResponse(request, { goldCreated, novaCastProviderCreated: true, managedProviderId: provider.id, errorCategory: 'gold_metadata_create_failed' }, 502);
      let summary = null;
      if (body?.runDiagnostics === true) {
        const health = await runProviderHealthCheck({ baseUrl: credentials.baseUrl, username: credentials.username, password: credentials.password });
        summary = sanitizeHealthSummary(health, credentials.username, credentials.password);
        await client.from('managed_providers').update({ health_status: health.overall, last_tested_at: health.testedAt, last_successful_test_at: canActivateFromHealth({ healthStatus: health.overall, validationStale: false, activationStatus: 'draft' }) ? health.testedAt : null, validation_stale: false, last_health_summary: summary, live_channel_count: health.catalogs?.liveChannels ?? 0, movie_count: health.catalogs?.movies ?? 0, series_count: health.catalogs?.series ?? 0, updated_at: new Date().toISOString(), ...(body?.activateIfHealthy === true && canActivateFromHealth({ healthStatus: health.overall, validationStale: false, activationStatus: 'draft' }) ? { status: 'active' } : {}) }).eq('id', provider.id);
      }
      return adminJsonResponse(request, { success: true, goldCreated, novaCastProviderCreated: true, managedProviderId: provider.id, account, provider, summary });
    }

    if (!accountId) throw new GoldPanelError('invalid_request', 'Gold account is required.', 400);
    const { data: account, error: accountError } = await client.from('gold_panel_accounts').select('*').eq('id', accountId).maybeSingle();
    if (accountError || !account) throw new GoldPanelError('gold_account_not_found', 'Gold account was not found.', 404);
    if (action === 'account_info' || action === 'sync_account') return adminJsonResponse(request, { account: await syncAccount(client, account) });
    if (action === 'run_diagnostics') {
      const credentials = await providerCredentials(client, account.managed_provider_id);
      const health = await runProviderHealthCheck(credentials);
      const safeHealth = sanitizeHealthSummary(health, credentials.username, credentials.password);
      await client.from('managed_providers').update({ health_status: health.overall, last_tested_at: health.testedAt, validation_stale: false, last_health_summary: safeHealth, live_channel_count: health.catalogs?.liveChannels ?? 0, movie_count: health.catalogs?.movies ?? 0, series_count: health.catalogs?.series ?? 0, updated_at: new Date().toISOString() }).eq('id', account.managed_provider_id);
      return adminJsonResponse(request, { summary: safeHealth, account });
    }
    if (action === 'renew_account') { const credentials = await providerCredentials(client, account.managed_provider_id); await renewAccount({ username: credentials.username, password: credentials.password, sub: String(body?.sub ?? '1') }); return adminJsonResponse(request, { account: await syncAccount(client, account) }); }
    if (action === 'set_account_status') { await setAccountStatus(account.gold_user_id, body?.enabled !== false); return adminJsonResponse(request, { account: await syncAccount(client, account) }); }
    if (action === 'account_credentials') { const credentials = await providerCredentials(client, account.managed_provider_id); return adminJsonResponse(request, { username: credentials.username, password: credentials.password, baseUrl: credentials.baseUrl }); }
    if (action === 'update_route') { const { data, error } = await client.from('gold_panel_accounts').update({ route_mode: String(body?.routeMode ?? '').slice(0, 80) || null, route_domain: String(body?.routeDomain ?? '').slice(0, 240) || null, updated_at: new Date().toISOString() }).eq('id', accountId).select(ACCOUNT_SELECT).single(); if (error) throw new Error('gold_metadata_update_failed'); return adminJsonResponse(request, { account: data }); }
    throw new GoldPanelError('invalid_request', 'Unsupported Gold Panel action.', 400);
  } catch (error) { return errorResponse(request, error); }
});
