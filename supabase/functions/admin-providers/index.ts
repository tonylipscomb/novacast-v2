import { adminJsonResponse, adminOptionsResponse, readJson } from '../_shared/http.ts';
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
import { fetchLiveChannelsForEpgMapping } from '../_shared/providerHealthRunner.ts';
import { canonicalizeEpgName, normalizeEpgName, normalizeEpgMode, safeEpgUrl, testXmltvFeed, traceXmltvFeed, type EpgLiveChannel, type EpgMode, type XmltvStreamSink } from '../_shared/xmltvEpg.ts';

const PROVIDER_SELECT =
  'id,slug,display_name,status,content_policy,notes,last_validated_at,last_tested_at,last_successful_test_at,health_status,live_channel_count,movie_count,series_count,validation_stale,last_health_summary,epg_mode,custom_epg_url_ciphertext,epg_last_refresh_at,epg_last_refresh_status,epg_last_refresh_summary,created_at,updated_at';
const EPG_SOURCE_SELECT = 'id,managed_provider_id,source_kind,safe_label,priority,enabled,last_refresh_at,last_refresh_status,channel_count,programme_count,diagnostic_summary,active_cache_generation,created_at,updated_at';
const EPG_SOURCE_SELECT_WITH_SECRETS = `${EPG_SOURCE_SELECT},url_ciphertext,url_iv`;
const EPG_SOURCE_KINDS = ['national', 'local', 'sports', 'fallback'] as const;
type EpgSourceKind = typeof EPG_SOURCE_KINDS[number];
const EPG_REFRESH_BUCKET = 'epg-refresh-artifacts';
const EPG_REFRESH_PROGRAMME_CHUNK_SIZE = 5_000;
const EPG_REFRESH_RETENTION_MS = 24 * 60 * 60 * 1000;
const ACTIVE_REFRESH_STATUSES = ['queued', 'fetching', 'processing', 'finalizing'];

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
  epg_mode?: EpgMode;
  custom_epg_url_ciphertext?: string | null;
  custom_epg_url_iv?: string | null;
};

type ManagedProviderEpgSourceRow = {
  id: string;
  managed_provider_id: string;
  source_kind: EpgSourceKind;
  safe_label: string;
  priority: number;
  enabled: boolean;
  url_ciphertext?: string;
  url_iv?: string;
  last_refresh_at?: string | null;
  last_refresh_status?: string | null;
  channel_count?: number | null;
  programme_count?: number | null;
  diagnostic_summary?: Record<string, unknown> | null;
  created_at?: string;
  updated_at?: string;
  active_cache_generation?: string | null;
};

type ProviderCatalogSnapshotRow = {
  provider_stream_id: string;
  channel_name: string;
  epg_channel_id?: string | null;
  category_id?: string | null;
  category_name?: string | null;
  canonical_name?: string | null;
  snapshot_generation: string;
};

type EpgRefreshJobRow = {
  id: string;
  managed_provider_id: string;
  source_id: string;
  generation: string;
  status: 'queued' | 'fetching' | 'processing' | 'finalizing' | 'complete' | 'failed';
  stage?: string | null;
  processed_channels: number;
  processed_programmes: number;
  processed_mappings: number;
  total_channels?: number | null;
  total_programmes?: number | null;
  progress_percent?: number | null;
  checkpoint?: Record<string, unknown> | null;
  failure_code?: string | null;
  failure_message?: string | null;
  artifact_path?: string | null;
  created_at: string;
  started_at?: string | null;
  updated_at: string;
  completed_at?: string | null;
};

type XtreamCredentials = { type: 'xtream'; baseUrl: string; username: string; password: string };

type AdminRefreshDiagnostic = { operation: string; code?: string; message?: string; details?: string; hint?: string };

class AdminRefreshRequestFailure extends Error {
  errorCategory = 'admin_refresh_job_failed' as const;
  diagnostic: AdminRefreshDiagnostic;

  constructor(operation: string, error: { code?: unknown; message?: unknown; details?: unknown; hint?: unknown }) {
    super('admin_refresh_request_failed');
    this.name = 'AdminRefreshRequestFailure';
    const fields = Object.fromEntries(
      Object.entries({ code: error.code, message: error.message, details: error.details, hint: error.hint })
        .map(([key, value]) => [key, safeRefreshDatabaseField(value)])
        .filter(([, value]) => value !== null),
    ) as Omit<AdminRefreshDiagnostic, 'operation'>;
    this.diagnostic = { operation, ...fields };
  }
}

class AdminRefreshRequestLookupFailure extends AdminRefreshRequestFailure {
  constructor(error: { code?: unknown; message?: unknown; details?: unknown; hint?: unknown }) {
    super('lookup_active_refresh_request', error);
    this.name = 'AdminRefreshRequestLookupFailure';
  }
}

class AdminRefreshRequestInsertFailure extends AdminRefreshRequestFailure {
  constructor(error: { code?: unknown; message?: unknown; details?: unknown; hint?: unknown }) {
    super('insert_refresh_request', error);
    this.name = 'AdminRefreshRequestInsertFailure';
  }
}

function isAdminRefreshRequestDiagnostic(error: unknown): error is AdminRefreshRequestFailure {
  return Boolean(error && typeof error === 'object' && (error as { errorCategory?: unknown }).errorCategory === 'admin_refresh_job_failed' && (error as { diagnostic?: unknown }).diagnostic);
}

function safeRefreshDatabaseField(value: unknown) {
  if (typeof value !== 'string') return null;
  return value
    .replace(/https?:\/\/[^\s"']+/gi, '[redacted-url]')
    .replace(/Bearer\s+[^\s,;]+/gi, 'Bearer [redacted]')
    .replace(/(password|passwd|username|user|token|secret|authorization|api[_-]?key|key)\s*[=:]\s*[^\s,;]+/gi, '$1=[redacted]')
    .slice(0, 240) || null;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
    'source_not_found',
    'provider_inactive',
    'validation_in_progress',
    'unsafe_url',
    'dns_failure',
    'timeout',
    'http_403',
    'http_404',
    'http_5xx',
    'response_too_large',
    'compressed_response_too_large',
    'decompressed_response_too_large',
    'unsupported_compression',
    'invalid_xmltv',
    'empty_feed',
    'parse_failure',
    'duplicate_source',
    'refresh_in_progress',
    'refresh_job_not_found',
    'admin_refresh_job_failed',
    'admin_refresh_request_lookup_failed',
    'admin_refresh_artifact_failed',
    'refresh_failed',
    'refresh_expired',
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
      'source_not_found',
      'refresh_job_not_found',
    ].includes(category)
  ) {
    return 400;
  }
  if (category === 'duplicate_source') return 409;
  if (category === 'refresh_in_progress') return 409;
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

function toPublicProvider(provider: Record<string, unknown>) {
  const { custom_epg_url_ciphertext: _ciphertext, custom_epg_url_iv: _iv, ...publicProvider } = provider;
  return {
    ...publicProvider,
    epg_mode: normalizeEpgMode(provider.epg_mode),
    custom_url_configured: Boolean(provider.custom_epg_url_ciphertext),
  };
}

function toPublicEpgSource(source: ManagedProviderEpgSourceRow) {
  const summary = source.diagnostic_summary ?? {};
  return {
    id: source.id,
    sourceKind: source.source_kind,
    safeLabel: source.safe_label,
    priority: source.priority,
    enabled: source.enabled,
    urlConfigured: true,
    lastRefreshAt: source.last_refresh_at ?? null,
    lastRefreshStatus: source.last_refresh_status ?? null,
    channelCount: source.channel_count ?? null,
    programmeCount: source.programme_count ?? null,
    mappedChannels: typeof summary.mappedChannels === 'number' ? summary.mappedChannels : null,
    mappingPercentage: typeof summary.usMappingPercentage === 'number' ? summary.usMappingPercentage : null,
    currentProgramCoverage: typeof summary.currentProgramCoverage === 'number' ? summary.currentProgramCoverage : null,
    futureProgramCoverage: typeof summary.futureProgramCoverage === 'number' ? summary.futureProgramCoverage : null,
    diagnosticSummary: source.diagnostic_summary ?? null,
    activeCacheGeneration: source.active_cache_generation ?? null,
  };
}

function parseEpgSourceKind(value: unknown): EpgSourceKind {
  if (typeof value !== 'string' || !EPG_SOURCE_KINDS.includes(value as EpgSourceKind)) throw new Error('invalid_request');
  return value as EpgSourceKind;
}

function parseEpgSourceLabel(value: unknown) {
  const label = String(value ?? '').trim().slice(0, 120);
  if (!label) throw new Error('invalid_request');
  return label;
}

function parseEpgSourcePriority(value: unknown, fallback = 100) {
  const priority = value == null || value === '' ? fallback : Number(value);
  if (!Number.isInteger(priority) || priority < 0 || priority > 1_000_000) throw new Error('invalid_request');
  return priority;
}

function parseEpgSourceEnabled(value: unknown, fallback = true) {
  if (value == null) return fallback;
  if (typeof value !== 'boolean') throw new Error('invalid_request');
  return value;
}

function throwEpgSourceDatabaseError(error: unknown, fallback: 'admin_query_failed' | 'admin_insert_failed' | 'admin_update_failed' | 'admin_delete_failed') {
  const code = (error as { code?: string } | null)?.code;
  if (code === '23505') throw new Error('duplicate_source');
  throw new Error(fallback);
}

async function loadEpgSource(client: Awaited<ReturnType<typeof requireAdmin>>['client'], id: string, withSecrets = false) {
  if (!id) throw new Error('invalid_request');
  const select = withSecrets ? EPG_SOURCE_SELECT_WITH_SECRETS : EPG_SOURCE_SELECT;
  const { data, error } = await client.from('managed_provider_epg_sources').select(select).eq('id', id).maybeSingle();
  if (error) throwEpgSourceDatabaseError(error, 'admin_query_failed');
  if (!data) throw new Error('source_not_found');
  return data as unknown as ManagedProviderEpgSourceRow;
}

async function listEpgSources(client: Awaited<ReturnType<typeof requireAdmin>>['client'], providerId?: string) {
  let query = client.from('managed_provider_epg_sources').select(EPG_SOURCE_SELECT).order('enabled', { ascending: false }).order('priority', { ascending: true }).order('created_at', { ascending: true });
  if (providerId) query = query.eq('managed_provider_id', providerId);
  const { data, error } = await query;
  if (error) throwEpgSourceDatabaseError(error, 'admin_query_failed');
  return (data ?? []).map((source) => toPublicEpgSource(source as ManagedProviderEpgSourceRow));
}

async function runEpgSourceTest(client: Awaited<ReturnType<typeof requireAdmin>>['client'], source: ManagedProviderEpgSourceRow, mode: 'diagnostic' | 'cache' = 'diagnostic', sink?: XmltvStreamSink) {
  if (!source.url_ciphertext || !source.url_iv) throw new Error('invalid_request');
  const provider = await loadProvider(client, source.managed_provider_id, true);
  const url = await decryptSecret(source.url_ciphertext, source.url_iv);
  const credentials = await decryptXtream(provider);
  let liveChannels: EpgLiveChannel[] = [];
  try {
    liveChannels = (await fetchLiveChannelsForEpgMapping(credentials)).items;
  } catch {
    liveChannels = [];
  }
  return await testXmltvFeed({ url, liveChannels, mode, sink });
}

const EPG_CACHE_BATCH_SIZE = 1_000;

async function insertBatches(client: Awaited<ReturnType<typeof requireAdmin>>['client'], table: string, rows: Record<string, unknown>[]) {
  for (let offset = 0; offset < rows.length; offset += EPG_CACHE_BATCH_SIZE) {
    const { error } = await client.from(table).insert(rows.slice(offset, offset + EPG_CACHE_BATCH_SIZE));
    if (error) throw new Error('admin_cache_write_failed');
  }
}

async function deleteCacheGeneration(client: Awaited<ReturnType<typeof requireAdmin>>['client'], sourceId: string, generation: string) {
  for (const table of ['managed_provider_epg_source_channels', 'managed_provider_epg_source_programmes', 'managed_provider_epg_source_mappings']) {
    const { error } = await client.from(table).delete().eq('source_id', sourceId).eq('cache_generation', generation);
    if (error) throw new Error('admin_cache_write_failed');
  }
}

function publicEpgResult(result: Record<string, unknown>) {
  const { cachePayload: _cachePayload, mappingRecords: _mappingRecords, ...safeResult } = result;
  return safeResult;
}

function refreshArtifactPath(jobId: string, name: string) {
  return `${jobId}/${name}`;
}

async function uploadRefreshArtifact(client: Awaited<ReturnType<typeof requireAdmin>>['client'], path: string, value: unknown) {
  const { error } = await client.storage.from(EPG_REFRESH_BUCKET).upload(path, new Blob([JSON.stringify(value)], { type: 'application/json' }), { contentType: 'application/json', upsert: false });
  if (error) throw new Error('admin_refresh_artifact_failed');
}

async function downloadRefreshArtifact<T>(client: Awaited<ReturnType<typeof requireAdmin>>['client'], path: string): Promise<T> {
  const { data, error } = await client.storage.from(EPG_REFRESH_BUCKET).download(path);
  if (error || !data) throw new Error('admin_refresh_artifact_failed');
  try { return JSON.parse(await data.text()) as T; } catch { throw new Error('admin_refresh_artifact_failed'); }
}

async function removeRefreshArtifacts(client: Awaited<ReturnType<typeof requireAdmin>>['client'], job: Pick<EpgRefreshJobRow, 'id' | 'checkpoint'>) {
  const checkpoint = job.checkpoint ?? {};
  const paths = [checkpoint.channelsPath, checkpoint.mappingsPath].filter((value): value is string => typeof value === 'string');
  const chunkCount = typeof checkpoint.programmeChunkCount === 'number' ? checkpoint.programmeChunkCount : 0;
  for (let index = 0; index < chunkCount; index += 1) paths.push(refreshArtifactPath(job.id, `programmes-${String(index).padStart(5, '0')}.json`));
  if (paths.length) await client.storage.from(EPG_REFRESH_BUCKET).remove(paths);
}

function refreshProgress(processedProgrammes: number, totalProgrammes: number | null | undefined, processedChannels: number, totalChannels: number | null | undefined, processedMappings: number, totalMappings: number | null | undefined) {
  const processed = processedProgrammes + processedChannels + processedMappings;
  const total = (totalProgrammes ?? 0) + (totalChannels ?? 0) + (totalMappings ?? 0);
  return total > 0 ? Math.min(100, Number(((processed / total) * 100).toFixed(2))) : null;
}

async function markRefreshJobFailed(client: Awaited<ReturnType<typeof requireAdmin>>['client'], job: EpgRefreshJobRow, code: string) {
  try { await deleteCacheGeneration(client, job.source_id, job.generation); } catch { /* preserve safe failure response */ }
  try { await removeRefreshArtifacts(client, job); } catch { /* expiration cleanup can retry */ }
  await client.from('managed_provider_epg_refresh_jobs').update({ status: 'failed', stage: null, failure_code: code, failure_message: code, updated_at: new Date().toISOString() }).eq('id', job.id);
}

async function enqueueEpgRefresh(client: Awaited<ReturnType<typeof requireAdmin>>['client'], source: ManagedProviderEpgSourceRow) {
  if (!UUID_PATTERN.test(source.id) || !UUID_PATTERN.test(source.managed_provider_id)) {
    throw new AdminRefreshRequestInsertFailure({ message: 'invalid_refresh_request_identity' });
  }
  const { data: active, error: activeError } = await client.from('managed_provider_epg_refresh_requests').select('id,status').eq('managed_provider_id', source.managed_provider_id).eq('source_id', source.id).in('status', ['pending', 'running']).order('requested_at', { ascending: false }).limit(1).maybeSingle();
  if (activeError) throw new AdminRefreshRequestLookupFailure(activeError);
  if (active) throw new Error('refresh_in_progress');
  const now = new Date().toISOString();
  const { data: request, error: requestError } = await client.from('managed_provider_epg_refresh_requests').insert({ managed_provider_id: source.managed_provider_id, source_id: source.id, status: 'pending', requested_at: now }).select('id').single();
  if (requestError?.code === '23505') throw new Error('refresh_in_progress');
  if (requestError) throw new AdminRefreshRequestInsertFailure(requestError);
  if (!request) throw new AdminRefreshRequestInsertFailure({ message: 'invalid_database_response' });
  return { requestId: request.id, sourceId: source.id, status: 'pending', requestedAt: now };
}

async function startEpgRefresh(client: Awaited<ReturnType<typeof requireAdmin>>['client'], source: ManagedProviderEpgSourceRow) {
  const expiredBefore = new Date(Date.now() - EPG_REFRESH_RETENTION_MS).toISOString();
  const { data: expiredJobs } = await client.from('managed_provider_epg_refresh_jobs').select('id').eq('source_id', source.id).in('status', ACTIVE_REFRESH_STATUSES).lt('updated_at', expiredBefore);
  for (const expired of expiredJobs ?? []) {
    try { await markRefreshJobFailed(client, await getRefreshJob(client, String(expired.id)), 'refresh_expired'); } catch { /* stale cleanup must not block a new refresh */ }
  }
  const { data: active, error: activeError } = await client.from('managed_provider_epg_refresh_jobs').select('id,status,started_at').eq('source_id', source.id).in('status', ACTIVE_REFRESH_STATUSES).maybeSingle();
  if (activeError) throw new Error('admin_refresh_job_failed');
  if (active) throw new Error('refresh_in_progress');
  const jobId = crypto.randomUUID();
  const generation = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  const { data, error } = await client.from('managed_provider_epg_refresh_jobs').insert({ id: jobId, managed_provider_id: source.managed_provider_id, source_id: source.id, generation, status: 'queued', stage: 'fetching', started_at: startedAt, updated_at: startedAt, artifact_path: refreshArtifactPath(jobId, '') }).select('id,source_id,status,started_at').single();
  if (error || !data) throw new Error('admin_refresh_job_failed');
  const job = { id: jobId, generation };
  const staged = { programmeChunkCount: 0, channelsPath: undefined as string | undefined, mappingsPath: undefined as string | undefined };
  try {
    await client.from('managed_provider_epg_refresh_jobs').update({ status: 'fetching', stage: 'fetching', updated_at: new Date().toISOString() }).eq('id', jobId);
    const channels: Record<string, unknown>[] = [];
    const programmeChunk: Record<string, unknown>[] = [];
    let programmeChunkIndex = 0;
    let programmeChunkCount = 0;
    const sink: XmltvStreamSink = {
      onChannel: (channel) => { channels.push({ id: channel.id, displayNames: channel.displayNames.slice(0, 6).map((name) => name.slice(0, 500)) }); },
      onProgramme: async (programme) => {
        programmeChunk.push(programme);
        if (programmeChunk.length >= EPG_REFRESH_PROGRAMME_CHUNK_SIZE) {
          await uploadRefreshArtifact(client, refreshArtifactPath(jobId, `programmes-${String(programmeChunkIndex).padStart(5, '0')}.json`), programmeChunk.splice(0));
          programmeChunkIndex += 1;
          programmeChunkCount += 1;
          staged.programmeChunkCount = programmeChunkCount;
        }
      },
    };
    const result = await runEpgSourceTest(client, source, 'cache', sink);
    if (result.status !== 'success') {
      await markRefreshJobFailed(client, { ...job, source_id: source.id, checkpoint: { programmeChunkCount } } as EpgRefreshJobRow, result.status);
      return { jobId, sourceId: source.id, status: 'failed', startedAt };
    }
    if (programmeChunk.length) {
      await uploadRefreshArtifact(client, refreshArtifactPath(jobId, `programmes-${String(programmeChunkIndex).padStart(5, '0')}.json`), programmeChunk.splice(0));
      programmeChunkCount += 1;
      staged.programmeChunkCount = programmeChunkCount;
    }
    const channelsPath = refreshArtifactPath(jobId, 'channels.json');
    const mappingsPath = refreshArtifactPath(jobId, 'mappings.json');
    staged.channelsPath = channelsPath;
    staged.mappingsPath = mappingsPath;
    await uploadRefreshArtifact(client, channelsPath, channels);
    await uploadRefreshArtifact(client, mappingsPath, (result.mappingRecords ?? []).filter((mapping) => mapping.matchConfidenceClass === 'proven'));
    const checkpoint = { nextProgrammeChunk: 0, programmeChunkCount, channelsPath, mappingsPath, channelsProcessed: false, mappingsProcessed: false, diagnosticSummary: publicEpgResult(result as unknown as Record<string, unknown>) };
    const updatedAt = new Date().toISOString();
    await client.from('managed_provider_epg_refresh_jobs').update({ status: 'processing', stage: 'channels', total_channels: result.xmltvChannels, total_programmes: result.xmltvPrograms, progress_percent: 0, checkpoint, updated_at: updatedAt }).eq('id', jobId);
    return { jobId, sourceId: source.id, status: 'processing', startedAt };
  } catch (error) {
    await markRefreshJobFailed(client, { ...job, source_id: source.id, checkpoint: staged } as EpgRefreshJobRow, error instanceof Error && ['admin_refresh_artifact_failed', 'admin_cache_write_failed'].includes(error.message) ? error.message : 'refresh_failed');
    throw error;
  }
}

function publicRefreshJob(job: EpgRefreshJobRow) {
  return { jobId: job.id, sourceId: job.source_id, status: job.status, stage: job.stage ?? null, processedChannels: job.processed_channels, processedProgrammes: job.processed_programmes, processedMappings: job.processed_mappings, totalChannels: job.total_channels ?? null, totalProgrammes: job.total_programmes ?? null, progressPercent: job.progress_percent ?? null, startedAt: job.started_at ?? null, updatedAt: job.updated_at, completedAt: job.completed_at ?? null, failureCode: job.failure_code ?? null, failureMessage: job.failure_message ?? null };
}

async function getRefreshJob(client: Awaited<ReturnType<typeof requireAdmin>>['client'], jobId: string) {
  const { data, error } = await client.from('managed_provider_epg_refresh_jobs').select('id,managed_provider_id,source_id,generation,status,stage,processed_channels,processed_programmes,processed_mappings,total_channels,total_programmes,progress_percent,checkpoint,failure_code,failure_message,created_at,started_at,updated_at,completed_at').eq('id', jobId).maybeSingle();
  if (error) throw new Error('admin_refresh_job_failed');
  if (!data) throw new Error('refresh_job_not_found');
  return data as unknown as EpgRefreshJobRow;
}

async function upsertProgrammeBatches(client: Awaited<ReturnType<typeof requireAdmin>>['client'], rows: Record<string, unknown>[]) {
  for (let offset = 0; offset < rows.length; offset += 1_000) {
    const { error } = await client.from('managed_provider_epg_source_programmes').upsert(rows.slice(offset, offset + 1_000), { onConflict: 'source_id,cache_generation,xmltv_channel_id,start_at,stop_at,title', ignoreDuplicates: true });
    if (error) throw new Error('admin_cache_write_failed');
  }
}

async function continueEpgRefresh(client: Awaited<ReturnType<typeof requireAdmin>>['client'], jobId: string) {
  let job = await getRefreshJob(client, jobId);
  if (job.status === 'complete' || job.status === 'failed') return publicRefreshJob(job);
  const checkpoint = { ...(job.checkpoint ?? {}) } as { nextProgrammeChunk?: number; programmeChunkCount?: number; channelsPath?: string; mappingsPath?: string; channelsProcessed?: boolean; mappingsProcessed?: boolean; diagnosticSummary?: Record<string, unknown> };
  try {
    if (!checkpoint.channelsProcessed) {
      const channels = await downloadRefreshArtifact<Array<{ id: string; displayNames: string[] }>>(client, String(checkpoint.channelsPath));
      await insertBatches(client, 'managed_provider_epg_source_channels', channels.map((channel) => ({ source_id: job.source_id, managed_provider_id: job.managed_provider_id, cache_generation: job.generation, xmltv_channel_id: channel.id, display_name: channel.displayNames[0] || channel.id, canonical_name: canonicalizeEpgName(channel.displayNames[0] || channel.id), alternate_names: channel.displayNames.slice(1, 6), refreshed_at: job.started_at ?? job.updated_at })));
      checkpoint.channelsProcessed = true;
      job = (await updateRefreshJob(client, job, checkpoint, { stage: 'programmes', processedChannels: channels.length })) as EpgRefreshJobRow;
    }
    const nextChunk = checkpoint.nextProgrammeChunk ?? 0;
    const chunkCount = checkpoint.programmeChunkCount ?? 0;
    if (nextChunk < chunkCount) {
      const programmes = await downloadRefreshArtifact<Array<Record<string, string | null>>>(client, refreshArtifactPath(job.id, `programmes-${String(nextChunk).padStart(5, '0')}.json`));
      await upsertProgrammeBatches(client, programmes.map((programme) => ({ source_id: job.source_id, managed_provider_id: job.managed_provider_id, cache_generation: job.generation, xmltv_channel_id: programme.channelId, start_at: programme.startAt, stop_at: programme.stopAt, title: programme.title, subtitle: programme.subtitle, description: programme.description, category: programme.category, refreshed_at: job.started_at ?? job.updated_at })));
      checkpoint.nextProgrammeChunk = nextChunk + 1;
      const processed = Math.min(job.total_programmes ?? 0, job.processed_programmes + programmes.length);
      job = (await updateRefreshJob(client, job, checkpoint, { stage: 'programmes', processedProgrammes: processed })) as EpgRefreshJobRow;
      return publicRefreshJob(job);
    }
    if (!checkpoint.mappingsProcessed) {
      const mappings = await downloadRefreshArtifact<Array<Record<string, string | null>>>(client, String(checkpoint.mappingsPath));
      await insertBatches(client, 'managed_provider_epg_source_mappings', mappings.map((mapping) => ({ source_id: job.source_id, managed_provider_id: job.managed_provider_id, cache_generation: job.generation, provider_stream_id: String(mapping.providerStreamId).slice(0, 200), xmltv_channel_id: mapping.xmltvChannelId, match_type: mapping.matchType, match_confidence_class: mapping.matchConfidenceClass, provider_canonical: String(mapping.providerCanonical).slice(0, 500), xmltv_canonical: mapping.xmltvCanonical ? String(mapping.xmltvCanonical).slice(0, 500) : null, mapped_at: job.started_at ?? job.updated_at })));
      checkpoint.mappingsProcessed = true;
      job = (await updateRefreshJob(client, job, checkpoint, { stage: 'finalizing', processedMappings: mappings.length })) as EpgRefreshJobRow;
    }
    const summary = checkpoint.diagnosticSummary ?? {};
    const { error: sourceError } = await client.from('managed_provider_epg_sources').update({ active_cache_generation: job.generation, last_refresh_at: job.updated_at, last_refresh_status: 'success', channel_count: job.total_channels ?? null, programme_count: job.total_programmes ?? null, diagnostic_summary: summary, updated_at: job.updated_at }).eq('id', job.source_id);
    if (sourceError) throw new Error('admin_update_failed');
    await removeRefreshArtifacts(client, job);
    const completedAt = new Date().toISOString();
    const { data, error } = await client.from('managed_provider_epg_refresh_jobs').update({ status: 'complete', stage: null, progress_percent: 100, completed_at: completedAt, updated_at: completedAt }).eq('id', job.id).select('id,managed_provider_id,source_id,generation,status,stage,processed_channels,processed_programmes,processed_mappings,total_channels,total_programmes,progress_percent,checkpoint,failure_code,failure_message,created_at,started_at,updated_at,completed_at').single();
    if (error || !data) throw new Error('admin_refresh_job_failed');
    return publicRefreshJob(data as unknown as EpgRefreshJobRow);
  } catch (error) {
    await markRefreshJobFailed(client, job, error instanceof Error ? (['admin_cache_write_failed', 'admin_refresh_artifact_failed'].includes(error.message) ? error.message : 'refresh_failed') : 'refresh_failed');
    return publicRefreshJob(await getRefreshJob(client, job.id));
  }
}

async function updateRefreshJob(client: Awaited<ReturnType<typeof requireAdmin>>['client'], job: EpgRefreshJobRow, checkpoint: Record<string, unknown>, values: { stage: string; processedChannels?: number; processedProgrammes?: number; processedMappings?: number }) {
  const processedChannels = values.processedChannels ?? job.processed_channels;
  const processedProgrammes = values.processedProgrammes ?? job.processed_programmes;
  const processedMappings = values.processedMappings ?? job.processed_mappings;
  const updatedAt = new Date().toISOString();
  const progress = refreshProgress(processedProgrammes, job.total_programmes, processedChannels, job.total_channels, processedMappings, null);
  const { data, error } = await client.from('managed_provider_epg_refresh_jobs').update({ status: values.stage === 'finalizing' ? 'finalizing' : 'processing', stage: values.stage, processed_channels: processedChannels, processed_programmes: processedProgrammes, processed_mappings: processedMappings, progress_percent: progress, checkpoint, updated_at: updatedAt }).eq('id', job.id).select('id,managed_provider_id,source_id,generation,status,stage,processed_channels,processed_programmes,processed_mappings,total_channels,total_programmes,progress_percent,checkpoint,failure_code,failure_message,created_at,started_at,updated_at,completed_at').single();
  if (error || !data) throw new Error('admin_refresh_job_failed');
  return data;
}

async function previewEpgResolution(client: Awaited<ReturnType<typeof requireAdmin>>['client'], providerId: string) {
  const provider = await loadProvider(client, providerId, true);
  const credentials = await decryptXtream(provider);
  const liveChannels = (await fetchLiveChannelsForEpgMapping(credentials)).items;
  const { data: sources, error: sourceError } = await client.from('managed_provider_epg_sources').select(EPG_SOURCE_SELECT).eq('managed_provider_id', providerId).eq('enabled', true).order('priority', { ascending: true }).order('created_at', { ascending: true });
  if (sourceError) throwEpgSourceDatabaseError(sourceError, 'admin_query_failed');
  const mappingsBySource = new Map<string, Map<string, Record<string, unknown>>>();
  for (const source of (sources ?? []) as ManagedProviderEpgSourceRow[]) {
    const rows = source.active_cache_generation ? await client.from('managed_provider_epg_source_mappings').select('provider_stream_id,xmltv_channel_id,match_type,match_confidence_class').eq('source_id', source.id).eq('cache_generation', source.active_cache_generation) : { data: [], error: null };
    if (rows.error) throw new Error('admin_query_failed');
    mappingsBySource.set(source.id, new Map((rows.data ?? []).map((row) => [String(row.provider_stream_id), row as Record<string, unknown>])));
  }
  const resolvedBySource: Record<string, number> = {};
  const resolvedByMatchType: Record<string, number> = {};
  let resolved = 0;
  let duplicateCandidateConflicts = 0;
  const unresolvedSamples: Array<Record<string, string | null>> = [];
  const resolvedSamples: Array<Record<string, string | null>> = [];
  for (const channel of liveChannels) {
    const key = channel.streamId ?? channel.epgChannelId ?? channel.name;
    const candidates = (sources ?? []).map((source) => ({ source: source as ManagedProviderEpgSourceRow, mapping: mappingsBySource.get(source.id)?.get(key) })).filter((item) => item.mapping?.match_confidence_class === 'proven');
    if (candidates.length > 1) duplicateCandidateConflicts += 1;
    const winner = candidates[0];
    if (!winner) {
      if (unresolvedSamples.length < 10) unresolvedSamples.push({ channelName: channel.name.slice(0, 200), epgChannelId: channel.epgChannelId });
      continue;
    }
    resolved += 1;
    resolvedBySource[winner.source.safe_label] = (resolvedBySource[winner.source.safe_label] ?? 0) + 1;
    const matchType = String(winner.mapping?.match_type ?? 'unknown');
    resolvedByMatchType[matchType] = (resolvedByMatchType[matchType] ?? 0) + 1;
    if (resolvedSamples.length < 10) resolvedSamples.push({ channelName: channel.name.slice(0, 200), epgChannelId: channel.epgChannelId, source: winner.source.safe_label });
  }
  return { providerId, totalProviderChannelsConsidered: liveChannels.length, resolvedChannels: resolved, unresolvedChannels: liveChannels.length - resolved, resolvedBySource, resolvedByMatchType, duplicateCandidateConflicts, samples: { resolved: resolvedSamples, unresolved: unresolvedSamples } };
}

async function previewEpgMappingAudit(client: Awaited<ReturnType<typeof requireAdmin>>['client'], providerId: string, sourceId: string) {
  const source = await loadEpgSource(client, sourceId);
  if (source.managed_provider_id !== providerId) throw new Error('invalid_request');
  const { data: snapshotRows, error: snapshotError } = await client
    .from('managed_provider_epg_catalog_snapshot')
    .select('provider_stream_id,channel_name,epg_channel_id,category_id,category_name,canonical_name,snapshot_generation')
    .eq('managed_provider_id', providerId)
    .eq('is_active', true)
    .order('captured_at', { ascending: false });
  if (snapshotError) throw new Error('admin_query_failed');
  const { data: xmltvRows, error: xmltvError } = source.active_cache_generation
    ? await client.from('managed_provider_epg_source_channels').select('xmltv_channel_id,display_name,canonical_name,alternate_names').eq('source_id', sourceId).eq('cache_generation', source.active_cache_generation)
    : { data: [], error: null };
  if (xmltvError) throw new Error('admin_query_failed');
  const { data: mappingRows, error: mappingError } = source.active_cache_generation
    ? await client.from('managed_provider_epg_source_mappings').select('provider_stream_id,xmltv_channel_id,match_type,match_confidence_class').eq('source_id', sourceId).eq('cache_generation', source.active_cache_generation)
    : { data: [], error: null };
  if (mappingError) throw new Error('admin_query_failed');

  const providers = (snapshotRows ?? []) as ProviderCatalogSnapshotRow[];
  const xmltv = (xmltvRows ?? []) as Array<{ xmltv_channel_id: string; display_name: string; canonical_name: string; alternate_names?: unknown }>;
  const byId = new Map(xmltv.map((row) => [row.xmltv_channel_id, row]));
  const byLowerId = new Map<string, typeof xmltv>([]);
  const byRawName = new Map<string, typeof xmltv>([]);
  const byNormalized = new Map<string, typeof xmltv>([]);
  const byCanonical = new Map<string, typeof xmltv>([]);
  const add = (index: Map<string, typeof xmltv>, key: string, row: typeof xmltv[number]) => { if (key) index.set(key, [...(index.get(key) ?? []), row]); };
  for (const row of xmltv) {
    add(byLowerId, row.xmltv_channel_id.toLocaleLowerCase(), row);
    add(byRawName, row.display_name.trim(), row);
    add(byNormalized, normalizeEpgName(row.display_name), row);
    add(byCanonical, canonicalizeEpgName(row.display_name), row);
    const alternates = Array.isArray(row.alternate_names) ? row.alternate_names.filter((value): value is string => typeof value === 'string') : [];
    for (const alternate of alternates) {
      add(byRawName, alternate.trim(), row);
      add(byNormalized, normalizeEpgName(alternate), row);
      add(byCanonical, canonicalizeEpgName(alternate), row);
    }
  }
  const unique = (rows: typeof xmltv) => [...new Map(rows.map((row) => [row.xmltv_channel_id, row])).values()];
  const directIdPotential = providers.filter((row) => row.epg_channel_id && byId.has(row.epg_channel_id)).length;
  const caseInsensitiveIdPotential = providers.filter((row) => row.epg_channel_id && !byId.has(row.epg_channel_id) && unique(byLowerId.get(row.epg_channel_id.toLocaleLowerCase()) ?? []).length === 1).length;
  const exactNamePotential = providers.filter((row) => unique(byRawName.get(row.channel_name.trim()) ?? []).length === 1).length;
  const normalizedNamePotential = providers.filter((row) => unique(byNormalized.get(normalizeEpgName(row.channel_name)) ?? []).length === 1).length;
  const canonicalPotential = providers.filter((row) => unique(byCanonical.get(canonicalizeEpgName(row.channel_name)) ?? []).length === 1).length;
  const ambiguousPotential = providers.filter((row) => unique(byNormalized.get(normalizeEpgName(row.channel_name)) ?? []).length > 1 || unique(byCanonical.get(canonicalizeEpgName(row.channel_name)) ?? []).length > 1).length;
  const nationalTerms = ['ABC', 'CBS', 'NBC', 'FOX', 'ESPN', 'TNT', 'TBS', 'USA NETWORK', 'NFL', 'NBA', 'HBO', 'CNN', 'MSNBC', 'CNBC'];
  const groupCounts = {
    PRIME: providers.filter((row) => /\bPRIME\b/i.test(`${row.channel_name} ${row.category_name ?? ''}`)).length,
    US: providers.filter((row) => /(^|[^A-Z])(US|USA|UNITED STATES)([^A-Z]|$)/i.test(`${row.channel_name} ${row.category_name ?? ''}`)).length,
    USA: providers.filter((row) => /(^|[^A-Z])USA([^A-Z]|$)/i.test(`${row.channel_name} ${row.category_name ?? ''}`)).length,
    NBA: providers.filter((row) => /\bNBA\b/i.test(`${row.channel_name} ${row.category_name ?? ''}`)).length,
    NFL: providers.filter((row) => /\bNFL\b/i.test(`${row.channel_name} ${row.category_name ?? ''}`)).length,
    majorNationalNetworks: providers.filter((row) => nationalTerms.some((term) => new RegExp(`(^|[^A-Z])${term.replace(/[+&]/g, '\\$&')}(?=[^A-Z]|$)`, 'i').test(row.channel_name))).length,
    likelyLocals: providers.filter((row) => /\b(?:LOCAL|LOCALS|AFFILIATE)\b/i.test(`${row.channel_name} ${row.category_name ?? ''}`)).length,
  };
  const targetVariants = new Map<string, ProviderCatalogSnapshotRow[]>();
  for (const row of providers) {
    const targets = unique(byCanonical.get(canonicalizeEpgName(row.channel_name)) ?? []);
    if (targets.length === 1) targetVariants.set(targets[0].xmltv_channel_id, [...(targetVariants.get(targets[0].xmltv_channel_id) ?? []), row]);
  }
  const duplicateVariants = [...targetVariants.entries()].filter(([, rows]) => rows.length > 1).slice(0, 10).map(([xmltvChannelId, rows]) => ({ xmltvChannelId, providerRowCount: rows.length, providerStreamIds: rows.slice(0, 10).map((row) => row.provider_stream_id), names: rows.slice(0, 10).map((row) => row.channel_name) }));
  const namespaceCounts = new Map<string, number>();
  for (const row of providers) { const match = row.epg_channel_id?.match(/\.([A-Za-z0-9]{2,})$/); const key = match ? `.${match[1].toLowerCase()}` : '(no suffix)'; namespaceCounts.set(key, (namespaceCounts.get(key) ?? 0) + 1); }
  const namespaceFamilies = [...namespaceCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([suffix, count]) => ({ suffix, count }));
  const mapped = new Set((mappingRows ?? []).filter((row) => row.match_confidence_class === 'proven').map((row) => row.provider_stream_id));
  const sample = (predicate: (row: ProviderCatalogSnapshotRow) => boolean) => providers.filter((row) => predicate(row)).slice(0, 10).map((row) => ({ providerStreamId: row.provider_stream_id, channelName: row.channel_name, epgChannelId: row.epg_channel_id ?? null }));
  return {
    providerId,
    sourceId,
    snapshot: { providerRows: providers.length, snapshotGeneration: providers[0]?.snapshot_generation ?? null },
    providerRows: providers.length,
    uniqueProviderCanonicalNames: new Set(providers.map((row) => row.canonical_name || canonicalizeEpgName(row.channel_name)).filter(Boolean)).size,
    providerRowsWithEpgId: providers.filter((row) => Boolean(row.epg_channel_id)).length,
    providerRowsWithoutEpgId: providers.filter((row) => !row.epg_channel_id).length,
    xmltvChannels: xmltv.length,
    currentMapped: mapped.size,
    groups: groupCounts,
    directIdPotential,
    caseInsensitiveIdPotential,
    exactNamePotential,
    normalizedNamePotential,
    canonicalPotential,
    ambiguousPotential,
    manyToOne: { providerRowCount: duplicateVariants.reduce((sum, row) => sum + row.providerRowCount, 0), uniqueXmltvTargetCount: duplicateVariants.length, duplicateQualityVariantCount: duplicateVariants.filter((row) => row.names.some((name) => /\b(?:HD|FHD|UHD|4K)\b/i.test(name))).length, ambiguityCount: ambiguousPotential },
    samples: { unmatchedNational: sample((row) => !mapped.has(row.provider_stream_id) && /\b(?:US|USA|ESPN|FOX|NBC|CBS|ABC|TNT|TBS|NFL|NBA)\b/i.test(`${row.channel_name} ${row.category_name ?? ''}`)), unmatchedLocal: sample((row) => !mapped.has(row.provider_stream_id) && /\b(?:LOCAL|LOCALS|AFFILIATE)\b/i.test(`${row.channel_name} ${row.category_name ?? ''}`)), duplicateProviderVariants: duplicateVariants, namespaceFamilies },
  };
}

async function loadPublicProviders(client: Awaited<ReturnType<typeof requireAdmin>>['client']) {
  const { data, error } = await client.from('managed_providers').select(PROVIDER_SELECT).order('created_at', { ascending: false });
  if (error) throw new Error('admin_query_failed');
  const { data: goldAccounts, error: goldError } = await client.from('gold_panel_accounts').select('managed_provider_id,gold_user_id,gold_package_name,gold_country,gold_expiration,gold_enabled,last_synced_at,route_mode,route_domain');
  if (goldError && !isMissingGoldMetadataError(goldError)) throw new Error('admin_query_failed');
  const goldByProvider = new Map((goldAccounts ?? []).map((account) => [account.managed_provider_id, account]));
  const { data: sourceRows, error: sourceError } = await client
    .from('managed_provider_epg_sources')
    .select(EPG_SOURCE_SELECT)
    .order('enabled', { ascending: false })
    .order('priority', { ascending: true })
    .order('created_at', { ascending: true });
  if (sourceError && !isMissingGoldMetadataError(sourceError)) throwEpgSourceDatabaseError(sourceError, 'admin_query_failed');
  const sourcesByProvider = new Map<string, ReturnType<typeof toPublicEpgSource>[]>();
  for (const source of sourceRows ?? []) {
    const typedSource = source as ManagedProviderEpgSourceRow;
    sourcesByProvider.set(typedSource.managed_provider_id, [...(sourcesByProvider.get(typedSource.managed_provider_id) ?? []), toPublicEpgSource(typedSource)]);
  }
  const providers = [];
  for (const provider of data ?? []) {
    const { count } = await client
      .from('device_provider_assignments')
      .select('id', { count: 'exact', head: true })
      .eq('managed_provider_id', provider.id)
      .eq('status', 'active');
    providers.push({ ...toPublicProvider(provider as Record<string, unknown>), assignedDevices: count ?? 0, goldAccount: goldByProvider.get(provider.id) ?? null, epgSources: sourcesByProvider.get(provider.id) ?? [] });
  }
  return providers;
}

function isMissingGoldMetadataError(error: unknown) {
  const value = error as { code?: string; message?: string };
  const message = String(value?.message ?? '').toLowerCase();
  return value?.code === '42P01' || value?.code === 'PGRST205' || message.includes('does not exist') || message.includes('schema cache') || message.includes('could not find the table');
}

async function loadProvider(client: Awaited<ReturnType<typeof requireAdmin>>['client'], id: string, withSecrets = false) {
  const select = withSecrets ? `${PROVIDER_SELECT},credentials_ciphertext,credentials_iv,custom_epg_url_iv` : PROVIDER_SELECT;
  const { data, error } = await client.from('managed_providers').select(select).eq('id', id).maybeSingle();
  if (error) throw new Error('admin_query_failed');
  if (!data) throw new Error('provider_not_found');
  return data as unknown as ManagedProviderRow;
}

async function hasGoldMetadata(client: Awaited<ReturnType<typeof requireAdmin>>['client'], providerId: string) {
  const { data, error } = await client.from('gold_panel_accounts').select('managed_provider_id').eq('managed_provider_id', providerId).maybeSingle();
  if (error && isMissingGoldMetadataError(error)) return false;
  if (error) throw new Error('admin_query_failed');
  return Boolean(data);
}

function canActivateRow(row: ManagedProviderRow) {
  return canActivateFromHealth({
    healthStatus: (row.health_status ?? 'unvalidated') as ProviderHealthStatus,
    validationStale: Boolean(row.validation_stale),
    activationStatus: (row.status ?? 'draft') as ProviderActivationStatus,
  });
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return adminOptionsResponse(request);

  try {
    const { client } = await requireAdmin(request);

    if (request.method === 'GET') {
      return adminJsonResponse(request, { providers: await loadPublicProviders(client) });
    }

    if (request.method !== 'POST' && request.method !== 'PATCH') {
      return adminJsonResponse(request, { errorCategory: 'method_not_allowed' }, 405);
    }

    const body = (await readJson(request)) ?? {};
    const action = typeof body?.action === 'string' ? body.action : request.method === 'PATCH' ? 'update' : 'create';

    if (action === 'list_epg_sources') {
      const providerId = typeof body?.managedProviderId === 'string' ? body.managedProviderId : undefined;
      return adminJsonResponse(request, { sources: await listEpgSources(client, providerId) });
    }

    if (action === 'create_epg_source') {
      const managedProviderId = typeof body?.managedProviderId === 'string' ? body.managedProviderId : '';
      if (!managedProviderId) throw new Error('invalid_request');
      await loadProvider(client, managedProviderId);
      const sourceKind = parseEpgSourceKind(body?.sourceKind);
      const safeLabel = parseEpgSourceLabel(body?.safeLabel);
      const priority = parseEpgSourcePriority(body?.priority);
      const enabled = parseEpgSourceEnabled(body?.enabled);
      const url = safeEpgUrl(body?.url);
      const encrypted = await encryptSecret(url.toString());
      const { data, error } = await client.from('managed_provider_epg_sources').insert({
        managed_provider_id: managedProviderId,
        source_kind: sourceKind,
        safe_label: safeLabel,
        priority,
        enabled,
        url_ciphertext: encrypted.ciphertext,
        url_iv: encrypted.iv,
      }).select(EPG_SOURCE_SELECT).single();
      if (error || !data) throwEpgSourceDatabaseError(error, 'admin_insert_failed');
      return adminJsonResponse(request, { ok: true, source: toPublicEpgSource(data as ManagedProviderEpgSourceRow) });
    }

    if (action === 'update_epg_source') {
      const sourceId = typeof body?.sourceId === 'string' ? body.sourceId : '';
      const source = await loadEpgSource(client, sourceId, true);
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (Object.prototype.hasOwnProperty.call(body ?? {}, 'sourceKind')) patch.source_kind = parseEpgSourceKind(body.sourceKind);
      if (Object.prototype.hasOwnProperty.call(body ?? {}, 'safeLabel')) patch.safe_label = parseEpgSourceLabel(body.safeLabel);
      if (Object.prototype.hasOwnProperty.call(body ?? {}, 'priority')) patch.priority = parseEpgSourcePriority(body.priority, source.priority);
      if (Object.prototype.hasOwnProperty.call(body ?? {}, 'enabled')) patch.enabled = parseEpgSourceEnabled(body.enabled, source.enabled);
      if (Object.prototype.hasOwnProperty.call(body ?? {}, 'url')) {
        const url = safeEpgUrl(body.url);
        const encrypted = await encryptSecret(url.toString());
        patch.url_ciphertext = encrypted.ciphertext;
        patch.url_iv = encrypted.iv;
      }
      const { data, error } = await client.from('managed_provider_epg_sources').update(patch).eq('id', sourceId).select(EPG_SOURCE_SELECT).single();
      if (error || !data) throwEpgSourceDatabaseError(error, 'admin_update_failed');
      return adminJsonResponse(request, { ok: true, source: toPublicEpgSource(data as ManagedProviderEpgSourceRow) });
    }

    if (action === 'delete_epg_source') {
      const sourceId = typeof body?.sourceId === 'string' ? body.sourceId : '';
      await loadEpgSource(client, sourceId);
      const { error } = await client.from('managed_provider_epg_sources').delete().eq('id', sourceId);
      if (error) throwEpgSourceDatabaseError(error, 'admin_delete_failed');
      return adminJsonResponse(request, { ok: true, sourceId });
    }

    if (action === 'start_epg_refresh' || action === 'refresh_epg_source') {
      const sourceId = typeof body?.sourceId === 'string' ? body.sourceId : '';
      const source = await loadEpgSource(client, sourceId);
      return adminJsonResponse(request, { refresh: await enqueueEpgRefresh(client, source) });
    }

    if (action === 'get_epg_refresh_status') {
      const jobId = typeof body?.jobId === 'string' ? body.jobId : '';
      if (!jobId) throw new Error('invalid_request');
      return adminJsonResponse(request, { refresh: publicRefreshJob(await getRefreshJob(client, jobId)) });
    }

    if (action === 'continue_epg_refresh') {
      const jobId = typeof body?.jobId === 'string' ? body.jobId : '';
      if (!jobId) throw new Error('invalid_request');
      return adminJsonResponse(request, { refresh: publicRefreshJob(await getRefreshJob(client, jobId)) });
    }

    if (action === 'test_epg_source') {
      const sourceId = typeof body?.sourceId === 'string' ? body.sourceId : '';
      const source = await loadEpgSource(client, sourceId, true);
      const result = await runEpgSourceTest(client, source, 'diagnostic');
      const epg = { ...publicEpgResult(result as unknown as Record<string, unknown>), sourceId: source.id, sourceKind: source.source_kind, safeLabel: source.safe_label };
      return adminJsonResponse(request, { ok: result.status === 'success', source: toPublicEpgSource(source), epg });
    }

    if (action === 'preview_epg_resolution') {
      const providerId = typeof body.managedProviderId === 'string' ? body.managedProviderId : typeof body.id === 'string' ? body.id : '';
      if (!providerId) throw new Error('invalid_request');
      return adminJsonResponse(request, { preview: await previewEpgResolution(client, providerId) });
    }

    if (action === 'preview_epg_mapping_audit') {
      const providerId = typeof body.managedProviderId === 'string' ? body.managedProviderId : '';
      const sourceId = typeof body.sourceId === 'string' ? body.sourceId : '';
      if (!providerId || !sourceId) throw new Error('invalid_request');
      return adminJsonResponse(request, { audit: await previewEpgMappingAudit(client, providerId, sourceId) });
    }

    if (action === 'probe') {
      const credentials = await readXtreamCredentials(body?.credentials);
      const summary = await runProviderHealthCheck(credentials);
      return adminJsonResponse(request, {
        summary: sanitizeHealthSummary(summary, credentials.username, credentials.password),
        persisted: false,
      });
    }

    if (action === 'test') {
      const id = typeof body?.id === 'string' ? body.id : '';
      if (!id) throw new Error('invalid_request');
      const row = await loadProvider(client, id, true);
      const isGoldManaged = await hasGoldMetadata(client, id);
      if (row.health_status === 'testing') throw new Error('validation_in_progress');
      const credentials = await decryptXtream(row);
      const testingAt = new Date().toISOString();
      const { error: testingError } = await client
        .from('managed_providers')
        .update({ health_status: 'testing', updated_at: testingAt })
        .eq('id', id);
      if (testingError) throw new Error('admin_update_failed');

      try {
        const summary = await runProviderHealthCheck(credentials, { isGoldManaged });
        const patch = healthColumns(summary, credentials.username, credentials.password, row.last_successful_test_at ?? null);
        const { error } = await client.from('managed_providers').update(patch).eq('id', id);
        if (error) throw new Error('admin_update_failed');
        return adminJsonResponse(request, { ok: true, summary: patch.last_health_summary, providerId: id });
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

    if (action === 'test_epg' || action === 'refresh_epg') {
      const id = typeof body?.id === 'string' ? body.id : '';
      if (!id) throw new Error('invalid_request');
      const row = await loadProvider(client, id, true);
      if (!row.custom_epg_url_ciphertext || !row.custom_epg_url_iv) throw new Error('invalid_request');
      const url = await decryptSecret(row.custom_epg_url_ciphertext, row.custom_epg_url_iv);
      const credentials = await decryptXtream(row);
      let liveChannels: EpgLiveChannel[] = [];
      try {
        const liveCatalog = await fetchLiveChannelsForEpgMapping(credentials);
        liveChannels = liveCatalog.items;
      } catch {
        liveChannels = [];
      }
      const result = await testXmltvFeed({ url, liveChannels });
      const { error } = await client.from('managed_providers').update({
        epg_last_refresh_at: result.lastRefreshAt,
        epg_last_refresh_status: result.status,
        epg_last_refresh_summary: { ...result },
        updated_at: result.lastRefreshAt,
      }).eq('id', id);
      if (error) throw new Error('admin_update_failed');
      return adminJsonResponse(request, { ok: result.status === 'success', providerId: id, epg: result });
    }

    if (action === 'trace_epg') {
      const id = typeof body?.id === 'string' ? body.id : '';
      if (!id) throw new Error('invalid_request');
      const row = await loadProvider(client, id, true);
      if (!row.custom_epg_url_ciphertext || !row.custom_epg_url_iv) throw new Error('invalid_request');
      const url = await decryptSecret(row.custom_epg_url_ciphertext, row.custom_epg_url_iv);
      return adminJsonResponse(request, await traceXmltvFeed({ url }));
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
      return adminJsonResponse(request, { ok: true, status: 'active' });
    }

    if (action === 'disable') {
      const id = typeof body?.id === 'string' ? body.id : '';
      if (!id) throw new Error('invalid_request');
      const now = new Date().toISOString();
      const { error } = await client.from('managed_providers').update({ status: 'paused', updated_at: now }).eq('id', id);
      if (error) throw new Error('admin_update_failed');
      return adminJsonResponse(request, { ok: true, status: 'paused' });
    }

    if (request.method === 'PATCH' || action === 'update') {
      const id = typeof body?.id === 'string' ? body.id : '';
      if (!id) throw new Error('invalid_request');
      const row = await loadProvider(client, id, true);
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (typeof body?.displayName === 'string') patch.display_name = body.displayName.slice(0, 120);
      if (typeof body?.notes === 'string') patch.notes = body.notes.slice(0, 2000);
      if (typeof body?.contentPolicy === 'string') patch.content_policy = body.contentPolicy.slice(0, 64);

      if (Object.prototype.hasOwnProperty.call(body ?? {}, 'epgMode')) {
        const mode = normalizeEpgMode(body.epgMode);
        if (body.epgMode !== mode) throw new Error('invalid_request');
        patch.epg_mode = mode;
      }
      if (Object.prototype.hasOwnProperty.call(body ?? {}, 'customEpgUrl')) {
        if (body.customEpgUrl == null || String(body.customEpgUrl).trim() === '') {
          patch.custom_epg_url_ciphertext = null;
          patch.custom_epg_url_iv = null;
        } else {
          const url = safeEpgUrl(body.customEpgUrl);
          const encryptedEpg = await encryptSecret(url.toString());
          patch.custom_epg_url_ciphertext = encryptedEpg.ciphertext;
          patch.custom_epg_url_iv = encryptedEpg.iv;
        }
      }

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
      return adminJsonResponse(request, { ok: true, validationStale: Boolean(patch.validation_stale) });
    }

    const displayName = String(body?.displayName ?? '').trim().slice(0, 120);
    if (!displayName) throw new Error('invalid_request');
    const slug = slugify(String(body?.slug ?? displayName)) || `provider-${crypto.randomUUID().slice(0, 8)}`;
    const credentials = await readXtreamCredentials(body?.credentials);
    const encrypted = await encryptSecret(JSON.stringify(credentials));
    const epgMode = normalizeEpgMode(body?.epgMode);
    if (body?.epgMode != null && body.epgMode !== epgMode) throw new Error('invalid_request');
    const customEpg = body?.customEpgUrl == null || String(body.customEpgUrl).trim() === '' ? null : await encryptSecret(safeEpgUrl(body.customEpgUrl).toString());
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
        epg_mode: epgMode,
        custom_epg_url_ciphertext: customEpg?.ciphertext ?? null,
        custom_epg_url_iv: customEpg?.iv ?? null,
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
            return adminJsonResponse(request,
              { errorCategory: 'activation_blocked', provider: toPublicProvider({ ...(data as Record<string, unknown>), ...patch, status: 'draft' }), summary: patch.last_health_summary },
              409,
            );
          }
          return adminJsonResponse(request, { provider: toPublicProvider({ ...(data as Record<string, unknown>), ...patch, status: 'active' }), summary: patch.last_health_summary });
        }
        await client.from('managed_providers').update(patch).eq('id', data.id);
        return adminJsonResponse(request, { provider: toPublicProvider({ ...(data as Record<string, unknown>), ...patch }), summary: patch.last_health_summary });
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

      return adminJsonResponse(request, { provider: toPublicProvider(data as Record<string, unknown>) });
  } catch (error) {
    const category = isAdminRefreshRequestDiagnostic(error) ? error.errorCategory : mapError(error);
    const diagnostic = isAdminRefreshRequestDiagnostic(error) ? { diagnostic: error.diagnostic } : {};
    return adminJsonResponse(request, { errorCategory: category, ...diagnostic }, statusCodeFor(category));
  }
});
