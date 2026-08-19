import { jsonResponse, optionsResponse, readJson } from '../_shared/http.ts';
import { requireAdmin } from '../_shared/admin.ts';
import { decryptSecret, encryptSecret, normalizeProviderUrl } from '../_shared/security.ts';
import {
  canActivateFromHealth,
  sanitizeFailureMessage,
  sanitizeHealthSummary,
  type ProviderActivationStatus,
  type ProviderHealthStatus,
  type ProviderHealthSummary,
} from '../_shared/providerHealth.ts';
import { runProviderHealthCheck } from '../_shared/providerHealthRunner.ts';

const PROVIDER_SELECT =
  'id,slug,display_name,status,content_policy,notes,last_validated_at,last_tested_at,last_successful_test_at,health_status,live_channel_count,movie_count,series_count,validation_stale,last_health_summary,created_at,updated_at';

type ManagedProviderRow = {
  id: string;
  slug: string;
  display_name: string;
  status: ProviderActivationStatus;
  health_status?: ProviderHealthStatus;
  validation_stale?: boolean;
  credentials_ciphertext?: string;
  credentials_iv?: string;
  last_successful_test_at?: string | null;
};

type XtreamCredentials = { type: 'xtream'; baseUrl: string; username: string; password: string };

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

function mapError(error: unknown) {
  const message = error instanceof Error ? error.message : 'admin_request_failed';
  const known = [
    'admin_unauthorized',
    'invalid_request',
    'invalid_provider_url',
    'unsafe_provider_target',
    'http_provider_not_allowed',
    'provider_unreachable',
    'invalid_credentials',
    'activation_blocked',
    'provider_not_found',
    'provider_inactive',
    'validation_in_progress',
  ];
  if (known.includes(message)) return message;
  return 'admin_request_failed';
}

function statusCodeFor(category: string) {
  if (category === 'admin_unauthorized') return 401;
  if (category === 'activation_blocked' || category === 'provider_inactive' || category === 'validation_in_progress') return 409;
  if (
    [
      'invalid_request',
      'invalid_provider_url',
      'unsafe_provider_target',
      'http_provider_not_allowed',
      'invalid_credentials',
      'provider_not_found',
    ].includes(category)
  ) {
    return 400;
  }
  return 500;
}

async function readXtreamCredentials(raw: unknown): Promise<XtreamCredentials> {
  const creds = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const username = String(creds.username ?? '').trim();
  const password = String(creds.password ?? '');
  if (!username || !password || username.length > 128 || password.length > 256) {
    throw new Error('invalid_credentials');
  }
  const baseUrl = await normalizeProviderUrl(creds.baseUrl);
  return { type: 'xtream', baseUrl, username, password };
}

async function decryptXtream(row: ManagedProviderRow): Promise<XtreamCredentials> {
  if (!row.credentials_ciphertext || !row.credentials_iv) throw new Error('invalid_credentials');
  const plaintext = await decryptSecret(row.credentials_ciphertext, row.credentials_iv);
  const parsed = JSON.parse(plaintext) as Record<string, unknown>;
  return await readXtreamCredentials({
    baseUrl: parsed.baseUrl,
    username: parsed.username,
    password: parsed.password,
  });
}

function healthColumns(summary: ProviderHealthSummary, username: string, password: string, previousSuccess: string | null) {
  const cleaned = sanitizeHealthSummary(summary, username, password);
  const successful = summary.overall === 'healthy' || summary.overall === 'degraded';
  return {
    health_status: summary.overall,
    last_tested_at: summary.testedAt,
    live_channel_count: summary.catalogs?.liveChannels ?? 0,
    movie_count: summary.catalogs?.movies ?? 0,
    series_count: summary.catalogs?.series ?? 0,
    validation_stale: false,
    last_health_summary: cleaned,
    updated_at: new Date().toISOString(),
    ...(successful
      ? { last_successful_test_at: summary.testedAt, last_validated_at: summary.testedAt }
      : { last_successful_test_at: previousSuccess }),
  };
}

async function loadPublicProviders(client: Awaited<ReturnType<typeof requireAdmin>>['client']) {
  const { data, error } = await client.from('managed_providers').select(PROVIDER_SELECT).order('created_at', { ascending: false });
  if (error) throw new Error('admin_query_failed');
  const providers = [];
  for (const provider of data ?? []) {
    const { count } = await client
      .from('device_provider_assignments')
      .select('id', { count: 'exact', head: true })
      .eq('managed_provider_id', provider.id)
      .eq('status', 'active');
    providers.push({ ...provider, assignedDevices: count ?? 0 });
  }
  return providers;
}

async function loadProvider(client: Awaited<ReturnType<typeof requireAdmin>>['client'], id: string, withSecrets = false) {
  const select = withSecrets ? `${PROVIDER_SELECT},credentials_ciphertext,credentials_iv` : PROVIDER_SELECT;
  const { data, error } = await client.from('managed_providers').select(select).eq('id', id).maybeSingle();
  if (error) throw new Error('admin_query_failed');
  if (!data) throw new Error('provider_not_found');
  return data as ManagedProviderRow;
}

function canActivateRow(row: ManagedProviderRow) {
  return canActivateFromHealth({
    healthStatus: (row.health_status ?? 'unvalidated') as ProviderHealthStatus,
    validationStale: Boolean(row.validation_stale),
    activationStatus: (row.status ?? 'draft') as ProviderActivationStatus,
  });
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return optionsResponse();

  try {
    const { client } = await requireAdmin(request);

    if (request.method === 'GET') {
      return jsonResponse({ providers: await loadPublicProviders(client) });
    }

    if (request.method !== 'POST' && request.method !== 'PATCH') {
      return jsonResponse({ errorCategory: 'method_not_allowed' }, 405);
    }

    const body = await readJson(request);
    const action = typeof body?.action === 'string' ? body.action : request.method === 'PATCH' ? 'update' : 'create';

    if (action === 'probe') {
      const credentials = await readXtreamCredentials(body?.credentials);
      const summary = await runProviderHealthCheck(credentials);
      return jsonResponse({
        summary: sanitizeHealthSummary(summary, credentials.username, credentials.password),
        persisted: false,
      });
    }

    if (action === 'test') {
      const id = typeof body?.id === 'string' ? body.id : '';
      if (!id) throw new Error('invalid_request');
      const row = await loadProvider(client, id, true);
      if (row.health_status === 'testing') throw new Error('validation_in_progress');
      const credentials = await decryptXtream(row);
      const testingAt = new Date().toISOString();
      const { error: testingError } = await client
        .from('managed_providers')
        .update({ health_status: 'testing', updated_at: testingAt })
        .eq('id', id);
      if (testingError) throw new Error('admin_update_failed');

      try {
        const summary = await runProviderHealthCheck(credentials);
        const patch = healthColumns(summary, credentials.username, credentials.password, row.last_successful_test_at ?? null);
        const { error } = await client.from('managed_providers').update(patch).eq('id', id);
        if (error) throw new Error('admin_update_failed');
        return jsonResponse({ ok: true, summary: patch.last_health_summary, providerId: id });
      } catch (error) {
        const failedAt = new Date().toISOString();
        await client
          .from('managed_providers')
          .update({
            health_status: 'failed',
            last_tested_at: failedAt,
            validation_stale: false,
            last_health_summary: {
              overall: 'failed',
              overallLabel: 'Provider validation failed before checks completed.',
              testedAt: failedAt,
              durationMs: 0,
              checks: [],
              notes: [sanitizeFailureMessage(error, credentials.username, credentials.password)],
              decoderCaveat:
                'Stream Probe confirms the playback endpoint returns plausible media. Physical NovaCast decoder compatibility is still proven on-device.',
            },
            updated_at: failedAt,
          })
          .eq('id', id);
        throw error;
      }
    }

    if (action === 'activate') {
      const id = typeof body?.id === 'string' ? body.id : '';
      if (!id) throw new Error('invalid_request');
      const row = await loadProvider(client, id);
      if (row.status === 'revoked') throw new Error('activation_blocked');
      if (!canActivateRow(row)) throw new Error('activation_blocked');
      const now = new Date().toISOString();
      const { error } = await client.from('managed_providers').update({ status: 'active', updated_at: now }).eq('id', id);
      if (error) throw new Error('admin_update_failed');
      return jsonResponse({ ok: true, status: 'active' });
    }

    if (action === 'disable') {
      const id = typeof body?.id === 'string' ? body.id : '';
      if (!id) throw new Error('invalid_request');
      const now = new Date().toISOString();
      const { error } = await client.from('managed_providers').update({ status: 'paused', updated_at: now }).eq('id', id);
      if (error) throw new Error('admin_update_failed');
      return jsonResponse({ ok: true, status: 'paused' });
    }

    if (request.method === 'PATCH' || action === 'update') {
      const id = typeof body?.id === 'string' ? body.id : '';
      if (!id) throw new Error('invalid_request');
      const row = await loadProvider(client, id, true);
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (typeof body?.displayName === 'string') patch.display_name = body.displayName.slice(0, 120);
      if (typeof body?.notes === 'string') patch.notes = body.notes.slice(0, 2000);
      if (typeof body?.contentPolicy === 'string') patch.content_policy = body.contentPolicy.slice(0, 64);

      if (typeof body?.status === 'string') {
        if (body.status === 'active' && body?.credentials) throw new Error('activation_blocked');
        if (body.status === 'active') {
          if (!canActivateRow(row)) throw new Error('activation_blocked');
          patch.status = 'active';
        } else if (['draft', 'paused', 'revoked'].includes(body.status)) {
          patch.status = body.status;
        } else {
          throw new Error('invalid_request');
        }
      }

      if (body?.credentials && typeof body.credentials === 'object') {
        const current = await decryptXtream(row);
        const incoming = body.credentials as Record<string, unknown>;
        const credentials = await readXtreamCredentials({
          baseUrl: String(incoming.baseUrl ?? '').trim() || current.baseUrl,
          username: String(incoming.username ?? '').trim() || current.username,
          password: String(incoming.password ?? '') || current.password,
        });
        const encrypted = await encryptSecret(JSON.stringify(credentials));
        patch.credentials_ciphertext = encrypted.ciphertext;
        patch.credentials_iv = encrypted.iv;
        patch.last_validated_at = null;
        patch.health_status = 'unvalidated';
        patch.validation_stale = true;
      }

      const { error } = await client.from('managed_providers').update(patch).eq('id', id);
      if (error) throw new Error('admin_update_failed');
      return jsonResponse({ ok: true, validationStale: Boolean(patch.validation_stale) });
    }

    const displayName = String(body?.displayName ?? '').trim().slice(0, 120);
    if (!displayName) throw new Error('invalid_request');
    const slug = slugify(String(body?.slug ?? displayName)) || `provider-${crypto.randomUUID().slice(0, 8)}`;
    const credentials = await readXtreamCredentials(body?.credentials);
    const encrypted = await encryptSecret(JSON.stringify(credentials));
    const { data, error } = await client
      .from('managed_providers')
      .insert({
        slug,
        display_name: displayName,
        credentials_ciphertext: encrypted.ciphertext,
        credentials_iv: encrypted.iv,
        content_policy: typeof body?.contentPolicy === 'string' ? body.contentPolicy.slice(0, 64) : 'us_only',
        notes: typeof body?.notes === 'string' ? body.notes.slice(0, 2000) : null,
        status: 'draft',
        health_status: 'unvalidated',
        validation_stale: true,
      })
      .select(PROVIDER_SELECT)
      .single();

    if (error || !data) throw new Error('admin_create_failed');

    const then = typeof body?.then === 'string' ? body.then : 'draft';
    if (then === 'test' || then === 'activate') {
      try {
        const summary = await runProviderHealthCheck(credentials);
        const patch = healthColumns(summary, credentials.username, credentials.password, null);
        if (then === 'activate') {
          const eligible = canActivateFromHealth({
            healthStatus: summary.overall,
            validationStale: false,
            activationStatus: 'draft',
          });
          if (eligible) Object.assign(patch, { status: 'active' });
          await client.from('managed_providers').update(patch).eq('id', data.id);
          if (!eligible) {
            return jsonResponse(
              { errorCategory: 'activation_blocked', provider: { ...data, ...patch, status: 'draft' }, summary: patch.last_health_summary },
              409,
            );
          }
          return jsonResponse({ provider: { ...data, ...patch, status: 'active' }, summary: patch.last_health_summary });
        }
        await client.from('managed_providers').update(patch).eq('id', data.id);
        return jsonResponse({ provider: { ...data, ...patch }, summary: patch.last_health_summary });
      } catch (error) {
        const failedAt = new Date().toISOString();
        await client
          .from('managed_providers')
          .update({
            health_status: 'failed',
            last_tested_at: failedAt,
            validation_stale: false,
            last_health_summary: {
              overall: 'failed',
              overallLabel: 'Provider validation failed before checks completed.',
              testedAt: failedAt,
              durationMs: 0,
              checks: [],
              notes: [sanitizeFailureMessage(error, credentials.username, credentials.password)],
            },
            updated_at: failedAt,
          })
          .eq('id', data.id);
        throw error;
      }
    }

    return jsonResponse({ provider: data });
  } catch (error) {
    const category = mapError(error);
    return jsonResponse({ errorCategory: category }, statusCodeFor(category));
  }
});
