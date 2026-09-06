import { createGunzip } from 'node:zlib';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

const SUPABASE_URL = required('SUPABASE_URL').replace(/\/$/, '');
const SERVICE_ROLE_KEY = required('SUPABASE_SERVICE_ROLE_KEY');
const NOW = Date.now();
const BATCH_SIZE = 1_000;
const PAST_RETENTION_MS = 6 * 60 * 60 * 1000;
const FUTURE_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 60_000;
const STALE_REFRESH_JOB_MS = 30 * 60 * 1000;
const headers = { apikey: SERVICE_ROLE_KEY, authorization: `Bearer ${SERVICE_ROLE_KEY}`, 'content-type': 'application/json' };

class DatabaseFailure extends Error {
  constructor(operation, httpStatus, payload) {
    super('database_failure');
    this.name = 'DatabaseFailure';
    this.operation = operation;
    this.httpStatus = httpStatus ?? null;
    this.code = safeErrorText(payload?.code);
    this.safeMessage = safeErrorText(payload?.message) || 'database_failure';
    this.details = safeErrorText(payload?.details);
    this.hint = safeErrorText(payload?.hint);
  }
}

class WorkerValidationFailure extends Error {
  constructor(operation, message) {
    super('worker_validation_failed');
    this.name = 'WorkerValidationFailure';
    this.operation = operation;
    this.safeMessage = message;
  }
}

class WorkerStageFailure extends Error {
  constructor(stage, safeMessage, name = 'Error') {
    super(safeMessage);
    this.name = name;
    this.stage = stage;
    this.safeMessage = safeMessage;
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function requireUuid(value, operation, field) {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) throw new WorkerValidationFailure(operation, `missing_or_invalid_${field}`);
  return value;
}

function safeErrorText(value) {
  if (typeof value !== 'string') return null;
  let safe = value
    .replace(/https?:\/\/[^\s"']+/gi, '[redacted-url]')
    .replace(/Bearer\s+[^\s,;]+/gi, 'Bearer [redacted]')
    .replace(/[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, '[redacted-token]')
    .replace(/(password|passwd|username|user|token|secret|authorization|api[_-]?key|ciphertext|encryption[_-]?key)\s*[=:]\s*[^\s,;]+/gi, '$1=[redacted]')
    .slice(0, 300);
  for (const secret of [process.env.SUPABASE_SERVICE_ROLE_KEY, process.env.PROVIDER_ENCRYPTION_KEY].filter(Boolean)) safe = safe.split(secret).join('[redacted]');
  return safe || null;
}

function logDatabaseFailure(error) {
  if (!(error instanceof DatabaseFailure)) return;
  process.stderr.write(`${JSON.stringify({ databaseFailure: { operation: error.operation, httpStatus: error.httpStatus, code: error.code, message: error.safeMessage, details: error.details, hint: error.hint } })}\n`);
}

function logWorkerFailure(error) {
  if (error instanceof WorkerValidationFailure) {
    process.stderr.write(`${JSON.stringify({ workerFailure: { operation: error.operation, message: error.safeMessage } })}\n`);
  } else if (error instanceof WorkerStageFailure) {
    process.stderr.write(`${JSON.stringify({ workerFailure: { stage: error.stage, name: error.name, message: error.safeMessage } })}\n`);
  }
}

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`missing_${name.toLowerCase()}`);
  return value;
}

function decodeKey(value) {
  if (/^[0-9a-f]{64}$/i.test(value)) return Buffer.from(value, 'hex');
  return Buffer.from(value, 'base64');
}

async function decryptSecret(ciphertext, iv) {
  const decodedKey = decodeKey(required('PROVIDER_ENCRYPTION_KEY'));
  if (![16, 24, 32].includes(decodedKey.length)) throw new Error('invalid_encryption_key_length');
  const key = await crypto.subtle.importKey('raw', decodedKey, 'AES-GCM', false, ['decrypt']);
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: Buffer.from(iv, 'base64') }, key, Buffer.from(ciphertext, 'base64'));
  return Buffer.from(plaintext).toString('utf8');
}

function safeStageMessage(error, stage) {
  const message = error instanceof Error ? error.message : '';
  if (/^(invalid_encryption_key_length|unsafe_url|provider_unreachable|feed_unavailable|http_404|http_5xx|gzip_failed|xmltv_parse_failed|empty_feed)$/.test(message)) return message;
  if (stage === 'decrypt_provider_credentials' || stage === 'decrypt_epg_url') return 'decrypt_failed';
  if (stage === 'parse_provider_credentials') return 'invalid_provider_credentials';
  if (stage === 'fetch_provider_live_channels') return 'provider_unreachable';
  if (stage === 'validate_epg_url') return 'unsafe_url';
  if (stage === 'fetch_epg_feed') return 'feed_unavailable';
  if (stage === 'gunzip_epg_feed') return 'gzip_failed';
  if (stage === 'parse_epg_feed') return 'xmltv_parse_failed';
  if (stage === 'persist_cache') return 'persist_failed';
  if (stage === 'promote_generation') return 'promote_failed';
  return 'worker_failure';
}

async function runWorkerStage(stage, action) {
  try {
    return await action();
  } catch (error) {
    if (error instanceof DatabaseFailure || error instanceof WorkerValidationFailure || error instanceof WorkerStageFailure) throw error;
    throw new WorkerStageFailure(stage, safeStageMessage(error, stage), error instanceof Error ? error.name : 'Error');
  }
}

async function db(path, init = {}, operation = 'supabase_request') {
  let response;
  try {
    response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...init, headers: { ...headers, ...(init.headers ?? {}) } });
  } catch {
    throw new DatabaseFailure(operation, null, { message: 'database_network_failure' });
  }
  if (!response.ok) {
    let payload = {};
    try { payload = await response.json(); } catch { payload = {}; }
    throw new DatabaseFailure(operation, response.status, payload);
  }
  if (response.status === 204) return null;
  try {
    const body = await response.text();
    return body.trim() ? JSON.parse(body) : null;
  } catch { throw new DatabaseFailure(operation, response.status, { message: 'invalid_database_response' }); }
}

function returnedRow(result, operation) {
  const row = Array.isArray(result) ? result[0] : result;
  if (!row || typeof row !== 'object') throw new WorkerValidationFailure(operation, 'missing_returned_row');
  return row;
}

async function patch(table, id, values, extra = '', operation = `update_${table}`) {
  const safeId = requireUuid(id, operation, 'id');
  await db(`${table}?id=eq.${encodeURIComponent(safeId)}${extra}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(values) }, operation);
}

async function insertBatches(table, rows, onConflict = '', operation = `insert_${table}`) {
  for (let offset = 0; offset < rows.length; offset += BATCH_SIZE) {
    const suffix = onConflict ? `?on_conflict=${encodeURIComponent(onConflict)}` : '';
    await db(`${table}${suffix}`, { method: 'POST', headers: { Prefer: onConflict ? 'resolution=ignore-duplicates,return=minimal' : 'return=minimal' }, body: JSON.stringify(rows.slice(offset, offset + BATCH_SIZE)) }, operation);
  }
}

function canonicalize(value) {
  return String(value ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/&/g, ' AND ').replace(/[^A-Z0-9]+/g, ' ').replace(/\b(?:4K|UHD|FHD|HD)\b/g, ' ').replace(/\s+/g, ' ').trim();
}

function parseTimestamp(value) {
  const match = String(value ?? '').trim().match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(?:\s*([+-])(\d{2})(\d{2}))?/);
  if (!match) return null;
  const [, year, month, day, hour, minute, second, sign, offsetHour, offsetMinute] = match;
  const base = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second));
  if (!sign) return base;
  const offset = (Number(offsetHour) * 60 + Number(offsetMinute)) * 60_000 * (sign === '+' ? 1 : -1);
  return base - offset;
}

function attr(tag, name) {
  return tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, 'i'))?.[1] ?? null;
}

class XmltvParser {
  constructor(onChannel, onProgramme) {
    this.carry = '';
    this.channels = new Map();
    this.programmes = [];
    this.activeChannel = null;
    this.activeProgramme = null;
    this.field = null;
    this.onChannel = onChannel;
    this.onProgramme = onProgramme;
    this.invalidTimestamps = 0;
  }
  text(chunk) {
    this.carry += chunk;
    let cursor = 0;
    while (true) {
      const open = this.carry.indexOf('<', cursor);
      if (open < 0) break;
      const close = this.carry.indexOf('>', open + 1);
      if (close < 0) { this.carry = this.carry.slice(open); return; }
      this.handleText(this.carry.slice(cursor, open));
      this.handleTag(this.carry.slice(open, close + 1));
      cursor = close + 1;
    }
    this.carry = this.carry.slice(cursor);
    if (this.carry.length > 65_536) this.carry = this.carry.slice(-65_536);
  }
  handleText(value) {
    if (this.field && this.activeProgramme) this.activeProgramme[this.field] += value;
    if (this.activeChannel?.field) this.activeChannel.text += value;
  }
  handleTag(tag) {
    const opening = tag.match(/^<(channel|programme)\b/i);
    if (opening?.[1].toLowerCase() === 'channel') {
      const id = String(attr(tag, 'id') ?? '').trim();
      if (id) this.activeChannel = { id, text: '', names: [] };
      if (/\/\s*>$/.test(tag)) this.finishChannel();
      return;
    }
    if (/^<display-name(?:\s|>)/i.test(tag)) { if (this.activeChannel) this.activeChannel.field = 'display'; return; }
    if (/^<\/display-name\s*>/i.test(tag)) { if (this.activeChannel?.text.trim()) this.activeChannel.names.push(this.activeChannel.text.trim()); if (this.activeChannel) { this.activeChannel.text = ''; this.activeChannel.field = null; } return; }
    if (/^<\/channel\s*>/i.test(tag)) { this.finishChannel(); return; }
    if (opening?.[1].toLowerCase() === 'programme') {
      const start = parseTimestamp(attr(tag, 'start'));
      const stop = parseTimestamp(attr(tag, 'stop') ?? attr(tag, 'end'));
      if (start == null || stop == null || stop <= start) this.invalidTimestamps += 1;
      this.activeProgramme = { channelId: String(attr(tag, 'channel') ?? '').trim(), start, stop, title: '', subtitle: '', description: '', category: '' };
      if (/\/\s*>$/.test(tag)) this.finishProgramme();
      return;
    }
    for (const field of ['title', 'sub-title', 'desc', 'category']) {
      if (new RegExp(`^<${field}(?:\\s|>)`, 'i').test(tag)) { this.field = field === 'sub-title' ? 'subtitle' : field === 'desc' ? 'description' : field; return; }
      if (new RegExp(`^</${field}\\s*>`, 'i').test(tag)) { this.field = null; return; }
    }
    if (/^<\/programme\s*>/i.test(tag)) this.finishProgramme();
  }
  finishChannel() {
    if (this.activeChannel) { this.channels.set(this.activeChannel.id, { id: this.activeChannel.id, displayNames: this.activeChannel.names.slice(0, 6) }); this.onChannel(this.channels.get(this.activeChannel.id)); }
    this.activeChannel = null;
  }
  finishProgramme() {
    const programme = this.activeProgramme;
    if (programme?.start != null && programme.stop != null && programme.stop > programme.start) this.onProgramme({ ...programme, title: programme.title.trim() || 'Untitled', subtitle: programme.subtitle.trim() || null, description: programme.description.trim() || null, category: programme.category.trim() || null, startAt: new Date(programme.start).toISOString(), stopAt: new Date(programme.stop).toISOString() });
    this.activeProgramme = null;
    this.field = null;
  }
  finish() { this.finishChannel(); if (this.activeProgramme) this.finishProgramme(); }
}

function isPrivateAddress(address) {
  if (isIP(address) === 4) { const [a, b] = address.split('.').map(Number); return a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168); }
  return address === '::1' || address.startsWith('fc') || address.startsWith('fd') || address.startsWith('fe80:');
}

async function assertSafeUrl(raw) {
  const url = new URL(raw);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('unsafe_url');
  const addresses = await lookup(url.hostname, { all: true });
  if (addresses.some(({ address }) => isPrivateAddress(address))) throw new Error('unsafe_url');
  return url;
}

async function fetchLiveChannels(provider) {
  const credentialsText = await runWorkerStage('decrypt_provider_credentials', () => decryptSecret(provider.credentials_ciphertext, provider.credentials_iv));
  const credentials = await runWorkerStage('parse_provider_credentials', () => {
    const parsed = JSON.parse(credentialsText);
    if (!parsed || typeof parsed !== 'object' || typeof parsed.baseUrl !== 'string' || typeof parsed.username !== 'string' || typeof parsed.password !== 'string') throw new Error('invalid_provider_credentials');
    return parsed;
  });
  const rows = await runWorkerStage('fetch_provider_live_channels', async () => {
    const base = new URL(credentials.baseUrl);
    base.pathname = `${base.pathname.replace(/\/$/, '')}/player_api.php`;
    base.searchParams.set('username', credentials.username);
    base.searchParams.set('password', credentials.password);
    base.searchParams.set('action', 'get_live_streams');
    const response = await fetch(base, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!response.ok) throw new Error('provider_unreachable');
    return response.json();
  });
  return { credentials, items: Array.isArray(rows) ? rows.map((row) => ({ streamId: String(row.stream_id ?? ''), name: String(row.name ?? ''), epgChannelId: row.epg_channel_id ? String(row.epg_channel_id) : null })) : [] };
}

async function processRequest(request) {
  const sourceId = requireUuid(request.source_id, 'load_source', 'source_id');
  const providerId = requireUuid(request.managed_provider_id, 'load_provider', 'provider_id');
  const [source] = await runWorkerStage('load_source', () => db(`managed_provider_epg_sources?id=eq.${encodeURIComponent(sourceId)}&select=id,managed_provider_id,url_ciphertext,url_iv,priority,active_cache_generation`, {}, 'load_source'));
  const [provider] = await runWorkerStage('load_provider', () => db(`managed_providers?id=eq.${encodeURIComponent(providerId)}&select=id,credentials_ciphertext,credentials_iv`, {}, 'load_provider'));
  if (!source) throw new WorkerStageFailure('load_source', 'source_not_found');
  if (!provider) throw new WorkerStageFailure('load_provider', 'provider_not_found');
  const generation = crypto.randomUUID();
  const refreshedAt = new Date().toISOString();
  let promoted = false;
  try {
  const channels = [];
  const programmes = [];
  const mappings = [];
  const live = await runWorkerStage('fetch_provider_live_channels', () => fetchLiveChannels(provider));
  const xmltvUrl = await runWorkerStage('decrypt_epg_url', () => decryptSecret(source.url_ciphertext, source.url_iv));
  const url = await runWorkerStage('validate_epg_url', () => assertSafeUrl(xmltvUrl));
  const response = await runWorkerStage('fetch_epg_feed', async () => {
    const fetched = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!fetched.ok || !fetched.body) throw new Error(fetched.status === 404 ? 'http_404' : fetched.status >= 500 ? 'http_5xx' : 'feed_unavailable');
    return fetched;
  });
  const parser = new XmltvParser((channel) => channels.push(channel), (programme) => {
    if (programme.stopAt >= new Date(NOW - PAST_RETENTION_MS).toISOString() && programme.startAt <= new Date(NOW + FUTURE_RETENTION_MS).toISOString()) programmes.push(programme);
  });
  await runWorkerStage('gunzip_epg_feed', async () => {
    const input = Readable.fromWeb(response.body);
    const stream = url.pathname.toLowerCase().endsWith('.gz') ? input.pipe(createGunzip()) : input;
    stream.setEncoding('utf8');
    await new Promise((resolve, reject) => {
      stream.on('data', (chunk) => {
        try { parser.text(chunk); } catch (error) { reject(error); }
      });
      stream.once('end', resolve);
      stream.once('error', reject);
    });
  });
  await runWorkerStage('parse_epg_feed', async () => {
    parser.finish();
    if (!channels.length || !programmes.length) throw new Error('empty_feed');
  });
  const mappingsResult = await runWorkerStage('build_mappings', async () => {
  const byId = new Map(channels.map((channel) => [channel.id, channel]));
  const byName = new Map(channels.flatMap((channel) => { const key = canonicalize(channel.displayNames[0] || channel.id); return key ? [[key, channel]] : []; }));
  for (const channel of live.items) {
    const direct = channel.epgChannelId && byId.get(channel.epgChannelId);
    const named = direct ?? byName.get(canonicalize(channel.name));
    if (named) mappings.push({ source_id: source.id, managed_provider_id: source.managed_provider_id, cache_generation: generation, provider_stream_id: channel.streamId, xmltv_channel_id: named.id, match_type: direct ? 'direct_id' : 'normalized_name', match_confidence_class: 'proven', provider_canonical: canonicalize(channel.name), xmltv_canonical: canonicalize(named.displayNames[0] || named.id), mapped_at: refreshedAt });
  }
  return mappings;
  });
  await runWorkerStage('persist_cache', async () => {
  await insertBatches('managed_provider_epg_source_channels', channels.map((channel) => ({ source_id: source.id, managed_provider_id: source.managed_provider_id, cache_generation: generation, xmltv_channel_id: channel.id, display_name: channel.displayNames[0] || channel.id, canonical_name: canonicalize(channel.displayNames[0] || channel.id), alternate_names: channel.displayNames.slice(1), refreshed_at: refreshedAt })), '', 'insert_channels');
  await insertBatches('managed_provider_epg_source_programmes', programmes.map((programme) => ({ source_id: source.id, managed_provider_id: source.managed_provider_id, cache_generation: generation, xmltv_channel_id: programme.channelId, start_at: programme.startAt, stop_at: programme.stopAt, title: programme.title, subtitle: programme.subtitle, description: programme.description, category: programme.category, refreshed_at: refreshedAt })), 'source_id,cache_generation,xmltv_channel_id,start_at,stop_at,title', 'insert_programmes');
  await insertBatches('managed_provider_epg_source_mappings', mappings, '', 'insert_mappings');
  });
  await runWorkerStage('promote_generation', () => patch('managed_provider_epg_sources', source.id, { active_cache_generation: generation, last_refresh_at: refreshedAt, last_refresh_status: 'success', channel_count: channels.length, programme_count: programmes.length, diagnostic_summary: { sourceId: source.id, mappedChannels: mappings.length, invalidTimestamps: parser.invalidTimestamps }, updated_at: refreshedAt }, '', 'promote_generation'));
  promoted = true;
  if (source.active_cache_generation) {
    for (const table of ['managed_provider_epg_source_channels', 'managed_provider_epg_source_programmes', 'managed_provider_epg_source_mappings']) await db(`${table}?source_id=eq.${encodeURIComponent(source.id)}&cache_generation=eq.${encodeURIComponent(source.active_cache_generation)}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } }, 'cleanup_previous_generation').catch(() => {});
  }
  return { channels: channels.length, programmes: programmes.length, mapped: mappings.length };
  } catch (error) {
    if (!promoted) for (const table of ['managed_provider_epg_source_channels', 'managed_provider_epg_source_programmes', 'managed_provider_epg_source_mappings']) await db(`${table}?source_id=eq.${encodeURIComponent(source.id)}&cache_generation=eq.${encodeURIComponent(generation)}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } }, 'cleanup_failed_generation').catch(() => {});
    throw error;
  }
}

async function enqueueScheduledRefresh(source) {
  const providerId = requireUuid(source.managed_provider_id, 'enqueue_scheduled_refresh', 'provider_id');
  const sourceId = requireUuid(source.id, 'enqueue_scheduled_refresh', 'source_id');
  const result = await db('managed_provider_epg_refresh_requests', { method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=representation' }, body: JSON.stringify({ managed_provider_id: providerId, source_id: sourceId, status: 'pending', requested_at: new Date().toISOString() }) }, 'enqueue_scheduled_refresh');
  const inserted = Array.isArray(result) ? result[0] : result;
  if (inserted?.id != null) return requireUuid(inserted.id, 'enqueue_scheduled_refresh', 'request_id');
  const [existing] = await db(`managed_provider_epg_refresh_requests?managed_provider_id=eq.${encodeURIComponent(providerId)}&source_id=eq.${encodeURIComponent(sourceId)}&status=in.(pending,running)&select=id,refresh_job_id&limit=1`, {}, 'load_existing_refresh_request');
  return requireUuid(existing?.id, 'enqueue_scheduled_refresh', 'request_id');
}

const ACTIVE_REFRESH_JOB_STATUSES = ['queued', 'fetching', 'processing', 'finalizing'];

async function loadActiveRefreshJob(sourceId) {
  const safeSourceId = requireUuid(sourceId, 'load_active_refresh_job', 'source_id');
  const statusFilter = `(${ACTIVE_REFRESH_JOB_STATUSES.join(',')})`;
  const [job] = await db(`managed_provider_epg_refresh_jobs?source_id=eq.${encodeURIComponent(safeSourceId)}&status=in.${statusFilter}&select=id,source_id,generation,status,created_at,started_at,updated_at&order=created_at.desc&limit=1`, {}, 'load_active_refresh_job');
  return job ?? null;
}

async function cleanupStagedGeneration(sourceId, generation, activeCacheGeneration, operation) {
  if (!generation || generation === activeCacheGeneration) return;
  const safeSourceId = requireUuid(sourceId, operation, 'source_id');
  const safeGeneration = requireUuid(generation, operation, 'generation');
  for (const table of ['managed_provider_epg_source_channels', 'managed_provider_epg_source_programmes', 'managed_provider_epg_source_mappings']) {
    await db(`${table}?source_id=eq.${encodeURIComponent(safeSourceId)}&cache_generation=eq.${encodeURIComponent(safeGeneration)}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } }, operation).catch(() => {});
  }
}

async function ensureRefreshJob(source, requestId) {
  const [request] = await db(`managed_provider_epg_refresh_requests?id=eq.${encodeURIComponent(requestId)}&select=id,refresh_job_id`, {}, 'load_refresh_request');
  if (!request) throw new WorkerValidationFailure('load_refresh_request', 'missing_request');
  if (request.refresh_job_id != null) return { jobId: requireUuid(request.refresh_job_id, 'load_refresh_request', 'job_id'), skipped: false };
  const activeJob = await loadActiveRefreshJob(source.id);
  if (activeJob) {
    const timestamp = Date.parse(activeJob.updated_at ?? activeJob.started_at ?? activeJob.created_at ?? '');
    const isStale = !Number.isFinite(timestamp) || Date.now() - timestamp > STALE_REFRESH_JOB_MS;
    if (!isStale) return { jobId: requireUuid(activeJob.id, 'active_job_exists', 'job_id'), skipped: true };
    const [providerSource] = await db(`managed_provider_epg_sources?id=eq.${encodeURIComponent(source.id)}&select=active_cache_generation`, {}, 'load_source_for_stale_job');
    await patch('managed_provider_epg_refresh_jobs', activeJob.id, { status: 'failed', stage: null, failure_code: 'stale_refresh_job', failure_message: 'stale_refresh_job', completed_at: new Date().toISOString(), updated_at: new Date().toISOString() }, '', 'reclaim_stale_refresh_job');
    await cleanupStagedGeneration(source.id, activeJob.generation, providerSource?.active_cache_generation, 'cleanup_stale_refresh_job');
  }
  const jobId = requireUuid(crypto.randomUUID(), 'create_refresh_job', 'job_id');
  const generation = requireUuid(crypto.randomUUID(), 'create_refresh_job', 'generation');
  let created;
  try {
    created = await db('managed_provider_epg_refresh_jobs', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ id: jobId, managed_provider_id: source.managed_provider_id, source_id: source.id, generation, status: 'queued', stage: 'queued', updated_at: new Date().toISOString() }) }, 'create_refresh_job');
  } catch (error) {
    if (!(error instanceof DatabaseFailure) || error.code !== '23505') throw error;
    const racedJob = await loadActiveRefreshJob(source.id);
    if (!racedJob) throw error;
    return { jobId: requireUuid(racedJob.id, 'active_job_exists', 'job_id'), skipped: true };
  }
  requireUuid(returnedRow(created, 'create_refresh_job').id, 'create_refresh_job', 'job_id');
  await patch('managed_provider_epg_refresh_requests', requestId, { refresh_job_id: jobId }, '', 'link_refresh_job');
  return { jobId, skipped: false };
}

async function main() {
  const providerInput = process.argv[2] ?? '';
  const sourceInput = process.argv[3] ?? '';
  const providerId = providerInput ? requireUuid(providerInput, 'provider_filter', 'provider_id') : '';
  const sourceId = sourceInput ? requireUuid(sourceInput, 'source_filter', 'source_id') : '';
  let failed = false;
  if (!providerId && !sourceId) {
    const sources = await db('managed_provider_epg_sources?enabled=eq.true&select=id,managed_provider_id', {}, 'load_sources');
    for (const source of sources ?? []) await enqueueScheduledRefresh(source).catch((error) => { logDatabaseFailure(error); logWorkerFailure(error); failed = true; });
  }
  const query = ['status=eq.pending', 'order=requested_at.asc', 'limit=20', providerId && `managed_provider_id=eq.${encodeURIComponent(providerId)}`, sourceId && `source_id=eq.${encodeURIComponent(sourceId)}`].filter(Boolean).join('&');
  const requests = await db(`managed_provider_epg_refresh_requests?select=id,managed_provider_id,source_id,refresh_job_id,status&${query}`, {}, 'load_pending_requests');
  if (!requests?.length) {
    if (!providerId && !sourceId) process.stdout.write('No pending EPG refresh requests.\n');
    if (failed) process.exitCode = 1;
    return;
  }
  for (const request of requests ?? []) {
    const requestId = requireUuid(request.id, 'claim_refresh_request', 'request_id');
    requireUuid(request.source_id, 'claim_refresh_request', 'source_id');
    requireUuid(request.managed_provider_id, 'claim_refresh_request', 'provider_id');
    const claimed = await db(`managed_provider_epg_refresh_requests?id=eq.${encodeURIComponent(requestId)}&status=eq.pending`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ status: 'running', started_at: new Date().toISOString() }) }, 'claim_refresh_request');
    if (!claimed?.length) continue;
    try {
      const source = { id: requireUuid(request.source_id, 'claim_refresh_request', 'source_id'), managed_provider_id: requireUuid(request.managed_provider_id, 'claim_refresh_request', 'provider_id') };
      const ensuredJob = await ensureRefreshJob(source, requestId);
      if (ensuredJob.skipped) {
        await patch('managed_provider_epg_refresh_requests', requestId, { status: 'complete', failure_code: 'active_job_exists', failure_message: 'active_job_exists', completed_at: new Date().toISOString() }, '', 'skip_active_refresh_request');
        continue;
      }
      const jobId = ensuredJob.jobId;
      await patch('managed_provider_epg_refresh_jobs', jobId, { status: 'processing', stage: 'worker_ingest', updated_at: new Date().toISOString() }, '', 'start_refresh_job');
      const result = await processRequest(request);
      await patch('managed_provider_epg_refresh_jobs', jobId, { status: 'complete', stage: null, progress_percent: 100, completed_at: new Date().toISOString(), updated_at: new Date().toISOString() }, '', 'complete_refresh_job');
      await patch('managed_provider_epg_refresh_requests', requestId, { status: 'complete', completed_at: new Date().toISOString() }, '', 'complete_request');
      process.stdout.write(`EPG refresh completed: channels=${result.channels} programmes=${result.programmes} mapped=${result.mapped}\n`);
    } catch (error) {
      failed = true;
      logDatabaseFailure(error);
      logWorkerFailure(error);
      const code = error instanceof Error && /^[a-z0-9_]+$/.test(error.message) ? error.message : 'worker_failure';
      if (request.refresh_job_id && UUID_PATTERN.test(request.refresh_job_id)) await patch('managed_provider_epg_refresh_jobs', request.refresh_job_id, { status: 'failed', stage: null, failure_code: code, failure_message: code, updated_at: new Date().toISOString() }, '', 'fail_refresh_job').catch((patchError) => { logDatabaseFailure(patchError); });
      if (UUID_PATTERN.test(requestId)) await patch('managed_provider_epg_refresh_requests', requestId, { status: 'failed', failure_code: code, failure_message: code, completed_at: new Date().toISOString() }, '', 'fail_request').catch((patchError) => { logDatabaseFailure(patchError); });
      process.stderr.write(`EPG refresh failed: ${code}\n`);
    }
  }
  if (failed) process.exitCode = 1;
}

main().catch((error) => {
  logDatabaseFailure(error);
  logWorkerFailure(error);
  const code = error instanceof WorkerValidationFailure ? error.safeMessage : error instanceof DatabaseFailure ? error.message : 'worker_failure';
  process.stderr.write(`EPG worker failed: ${code}\n`);
  process.exitCode = 1;
});
