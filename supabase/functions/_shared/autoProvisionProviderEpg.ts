import { fetchLiveChannelsForEpgMapping } from './providerHealthRunner.ts';
import { decryptSecret, encryptSecret } from './security.ts';
import { testXmltvFeed, type EpgTestResult } from './xmltvEpg.ts';
import { getAdminClient } from './supabase.ts';

type AdminClient = ReturnType<typeof getAdminClient>;

type XtreamCredentials = {
  type: 'xtream';
  baseUrl: string;
  username: string;
  password: string;
};

type EpgSource = {
  id: string;
  managed_provider_id: string;
  source_kind: 'national' | 'local' | 'sports' | 'fallback';
  safe_label: string;
  priority: number;
  enabled: boolean;
  last_refresh_status?: string | null;
  url_ciphertext?: string;
  url_iv?: string;
  diagnostic_summary?: Record<string, unknown> | null;
};

const AUTO_SOURCE_MARKER = 'auto-provisioned-provider-xmltv';

export async function enqueueProviderEpgRefresh(client: AdminClient, source: Pick<EpgSource, 'id' | 'managed_provider_id'>) {
  const { data: active, error: activeError } = await client.from('managed_provider_epg_refresh_requests')
    .select('id,status')
    .eq('managed_provider_id', source.managed_provider_id)
    .eq('source_id', source.id)
    .in('status', ['pending', 'running'])
    .order('requested_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (activeError) throw new Error('refresh_request_lookup_failed');
  if (active) return { requestId: active.id, sourceId: source.id, status: active.status };

  const requestedAt = new Date().toISOString();
  const { data: request, error } = await client.from('managed_provider_epg_refresh_requests')
    .insert({ managed_provider_id: source.managed_provider_id, source_id: source.id, status: 'pending', requested_at: requestedAt })
    .select('id')
    .single();
  if (error?.code === '23505') return { sourceId: source.id, status: 'pending' };
  if (error || !request) throw new Error('refresh_request_insert_failed');
  return { requestId: request.id, sourceId: source.id, status: 'pending' };
}

export function deriveXtreamXmltvUrl(baseUrl: string, username: string, password: string) {
  const url = new URL(baseUrl);
  url.username = '';
  url.password = '';
  url.hash = '';
  url.search = '';
  const basePath = url.pathname.replace(/\/(?:player|panel)_api\.php$/i, '').replace(/\/+$/, '');
  url.pathname = `${basePath}/xmltv.php`;
  url.searchParams.set('username', username);
  url.searchParams.set('password', password);
  return url;
}

function autoSource(source: EpgSource) {
  return source.diagnostic_summary?.provisioning === AUTO_SOURCE_MARKER;
}

function safeEpgDiagnostic(result: EpgTestResult, status: string) {
  return {
    provisioning: AUTO_SOURCE_MARKER,
    discoveryStatus: status,
    httpStatus: result.httpStatus,
    contentType: result.contentType,
    xmltvChannels: result.xmltvChannels,
    xmltvPrograms: result.xmltvPrograms,
    mappedChannels: result.mappedChannels,
    mappingPercentage: result.usMappingPercentage,
    checkedAt: result.lastRefreshAt,
  };
}

async function recordDiscoveryStatus(client: AdminClient, providerId: string, result: EpgTestResult, status: string) {
  await client.from('managed_providers').update({
    epg_last_refresh_at: result.lastRefreshAt,
    epg_last_refresh_status: status,
    epg_last_refresh_summary: safeEpgDiagnostic(result, status),
    updated_at: result.lastRefreshAt,
  }).eq('id', providerId);
}

export type AutoProvisionResult = {
  status: 'existing-enabled' | 'provisioned' | 'unavailable' | 'queue-failed' | 'manual-source-conflict';
  sourceId?: string;
  discoveryStatus?: string;
};

export async function autoProvisionXtreamEpg(input: {
  client: AdminClient;
  providerId: string;
  displayName: string;
  credentials: XtreamCredentials;
  enqueueRefresh: (source: EpgSource) => Promise<unknown>;
}): Promise<AutoProvisionResult> {
  const { client, providerId, displayName, credentials } = input;
  const { data, error } = await client.from('managed_provider_epg_sources')
    .select('id,managed_provider_id,source_kind,safe_label,priority,enabled,last_refresh_status,url_ciphertext,url_iv,diagnostic_summary')
    .eq('managed_provider_id', providerId);
  if (error) return { status: 'unavailable', discoveryStatus: 'source_lookup_failed' };

  const sources = (data ?? []) as unknown as EpgSource[];
  const xmltvUrl = deriveXtreamXmltvUrl(credentials.baseUrl, credentials.username, credentials.password);
  const safeLabel = `${displayName.trim() || 'Provider'} EPG`.slice(0, 120);
  const existingAutoSource = sources.find(autoSource);
  const enabledSource = sources.find((source) => source.enabled);
  if (enabledSource && !autoSource(enabledSource)) return { status: 'existing-enabled', sourceId: enabledSource.id };
  if (enabledSource && autoSource(enabledSource)) {
    try {
      const currentUrl = enabledSource.url_ciphertext && enabledSource.url_iv
        ? await decryptSecret(enabledSource.url_ciphertext, enabledSource.url_iv)
        : null;
      if (currentUrl === xmltvUrl.toString() && enabledSource.last_refresh_status !== 'queue_failed') {
        return { status: 'existing-enabled', sourceId: enabledSource.id };
      }
    } catch {
      return { status: 'existing-enabled', sourceId: enabledSource.id };
    }
  }
  const sameLabelManualSource = sources.find((source) => source.safe_label === safeLabel && !autoSource(source));

  if (sameLabelManualSource && !existingAutoSource) {
    return { status: 'manual-source-conflict', sourceId: sameLabelManualSource.id };
  }

  let liveChannels: Awaited<ReturnType<typeof fetchLiveChannelsForEpgMapping>>['items'] = [];
  try {
    liveChannels = (await fetchLiveChannelsForEpgMapping(credentials)).items;
  } catch {
    liveChannels = [];
  }

  const result = await testXmltvFeed({ url: xmltvUrl.toString(), liveChannels });
  if (result.status !== 'success') {
    await recordDiscoveryStatus(client, providerId, result, result.status).catch(() => undefined);
    return { status: 'unavailable', discoveryStatus: result.status };
  }

  const encrypted = await encryptSecret(xmltvUrl.toString());
  const diagnosticSummary = safeEpgDiagnostic(result, 'success');
  let source: EpgSource | null = null;

  if (existingAutoSource) {
    const { data: updated, error: updateError } = await client.from('managed_provider_epg_sources')
      .update({
        enabled: true,
        url_ciphertext: encrypted.ciphertext,
        url_iv: encrypted.iv,
        diagnostic_summary: diagnosticSummary,
        last_refresh_status: 'queued',
        updated_at: result.lastRefreshAt,
      })
      .eq('id', existingAutoSource.id)
      .select('id,managed_provider_id,source_kind,safe_label,priority,enabled,last_refresh_status,url_ciphertext,url_iv,diagnostic_summary')
      .single();
    if (updateError || !updated) return { status: 'unavailable', discoveryStatus: 'source_update_failed' };
    source = updated as unknown as EpgSource;
  } else {
    const { data: inserted, error: insertError } = await client.from('managed_provider_epg_sources').insert({
      managed_provider_id: providerId,
      source_kind: 'fallback',
      safe_label: safeLabel,
      priority: 100,
      enabled: true,
      url_ciphertext: encrypted.ciphertext,
      url_iv: encrypted.iv,
      diagnostic_summary: diagnosticSummary,
      last_refresh_status: 'queued',
    }).select('id,managed_provider_id,source_kind,safe_label,priority,enabled,last_refresh_status,url_ciphertext,url_iv,diagnostic_summary').single();
    if (insertError?.code === '23505') {
      return { status: 'manual-source-conflict', discoveryStatus: 'source_identity_conflict' };
    }
    if (insertError || !inserted) return { status: 'unavailable', discoveryStatus: 'source_insert_failed' };
    source = inserted as unknown as EpgSource;
  }

  try {
    await input.enqueueRefresh(source);
  } catch {
    await recordDiscoveryStatus(client, providerId, result, 'queue_failed').catch(() => undefined);
    return { status: 'queue-failed', sourceId: source.id, discoveryStatus: 'queue_failed' };
  }

  await recordDiscoveryStatus(client, providerId, result, 'queued').catch(() => undefined);
  return { status: 'provisioned', sourceId: source.id, discoveryStatus: 'success' };
}
