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
const MIN_US_MAPPING_PERCENT = 65;
const MIN_US_CURRENT_PROGRAMME_PERCENT = 60;
const MIN_US_FUTURE_PROGRAMME_PERCENT = 60;
const MAX_UNRESOLVED_CONFLICTS = 0;
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

function assessGuideReadiness({ usRelevantRows, usCombinedResolved, usCurrentProgrammePercent, usFutureProgrammePercent, unresolvedConflicts }) {
  const denominator = Number(usRelevantRows);
  const resolved = Number(usCombinedResolved);
  const current = Number(usCurrentProgrammePercent);
  const future = Number(usFutureProgrammePercent);
  const conflicts = Number(unresolvedConflicts);
  const hasDenominator = Number.isFinite(denominator) && denominator > 0;
  const mappingPercent = hasDenominator && Number.isFinite(resolved) ? (resolved / denominator) * 100 : 0;
  const mappingReady = hasDenominator && mappingPercent >= MIN_US_MAPPING_PERCENT;
  const programmeCoverageReady = hasDenominator && current >= MIN_US_CURRENT_PROGRAMME_PERCENT && future >= MIN_US_FUTURE_PROGRAMME_PERCENT;
  const conflictRiskAcceptable = Number.isFinite(conflicts) && conflicts <= MAX_UNRESOLVED_CONFLICTS;
  const readinessReasons = [
    hasDenominator ? 'us_denominator_available' : 'no_us_denominator',
    mappingReady ? 'us_mapping_meets_65_percent_floor' : `us_mapping_below_${MIN_US_MAPPING_PERCENT}_percent_floor`,
    current >= MIN_US_CURRENT_PROGRAMME_PERCENT ? 'current_programmes_meet_60_percent_floor' : 'current_programmes_below_60_percent_floor',
    future >= MIN_US_FUTURE_PROGRAMME_PERCENT ? 'future_programmes_meet_60_percent_floor' : 'future_programmes_below_60_percent_floor',
    conflictRiskAcceptable ? 'no_unresolved_conflicts' : 'unresolved_conflicts_exceed_zero',
  ];
  return {
    mappingReady,
    programmeCoverageReady,
    conflictRiskAcceptable,
    managedGuideDeliveryReady: mappingReady && programmeCoverageReady && conflictRiskAcceptable,
    readinessReasons,
  };
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

async function loadAllRows(path, operation, pageSize = BATCH_SIZE) {
  const rows = [];
  for (let offset = 0; ; offset += pageSize) {
    const separator = path.includes('?') ? '&' : '?';
    const page = await db(path + separator + 'limit=' + pageSize + '&offset=' + offset, {}, operation);
    if (!Array.isArray(page) || page.length === 0) return rows;
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

async function persistCombinedCoverage(providerId) {
  const snapshotQuery = 'managed_provider_epg_catalog_snapshot?managed_provider_id=eq.' + encodeURIComponent(providerId) + '&is_active=eq.true&snapshot_complete=eq.true&select=snapshot_generation&order=captured_at.desc&limit=1';
  const snapshotHead = (await db(snapshotQuery, {}, 'load_combined_snapshot'))?.[0];
  if (!snapshotHead?.snapshot_generation) return null;
  const snapshotGeneration = requireUuid(snapshotHead.snapshot_generation, 'load_combined_snapshot', 'snapshot_generation');
  const snapshotPath = 'managed_provider_epg_catalog_snapshot?managed_provider_id=eq.' + encodeURIComponent(providerId) + '&snapshot_generation=eq.' + encodeURIComponent(snapshotGeneration) + '&is_active=eq.true&snapshot_complete=eq.true&select=provider_stream_id,channel_name,category_name';
  const snapshotRows = await loadAllRows(snapshotPath, 'load_combined_snapshot_rows');
  const sources = await db('managed_provider_epg_sources?managed_provider_id=eq.' + encodeURIComponent(providerId) + '&enabled=eq.true&select=id,safe_label,priority,active_cache_generation', {}, 'load_combined_sources');
  const candidatesByStream = new Map();
  const programmeCoverageBySource = new Map();
  for (const source of sources ?? []) {
    if (!source.active_cache_generation) continue;
    const mappingPath = 'managed_provider_epg_source_mappings?managed_provider_id=eq.' + encodeURIComponent(providerId) + '&source_id=eq.' + encodeURIComponent(source.id) + '&cache_generation=eq.' + encodeURIComponent(source.active_cache_generation) + '&match_confidence_class=eq.proven&select=provider_stream_id,xmltv_channel_id,match_type';
    const mappings = await loadAllRows(mappingPath, 'load_combined_mappings');
    const programmePath = 'managed_provider_epg_source_programmes?managed_provider_id=eq.' + encodeURIComponent(providerId) + '&source_id=eq.' + encodeURIComponent(source.id) + '&cache_generation=eq.' + encodeURIComponent(source.active_cache_generation) + '&select=xmltv_channel_id,start_at,stop_at';
    const programmeCoverage = new Map();
    for (const programme of await loadAllRows(programmePath, 'load_combined_programmes')) {
      const start = Date.parse(programme.start_at);
      const stop = Date.parse(programme.stop_at);
      if (!Number.isFinite(start) || !Number.isFinite(stop)) continue;
      const coverage = programmeCoverage.get(programme.xmltv_channel_id) ?? { current: false, future: false };
      if (start <= NOW && stop > NOW) coverage.current = true;
      if (start > NOW) coverage.future = true;
      programmeCoverage.set(programme.xmltv_channel_id, coverage);
    }
    programmeCoverageBySource.set(source.id, programmeCoverage);
    for (const mapping of mappings) {
      const list = candidatesByStream.get(mapping.provider_stream_id) ?? [];
      list.push({ sourceId: source.id, sourceLabel: source.safe_label, priority: Number(source.priority), xmltvChannelId: mapping.xmltv_channel_id, matchType: mapping.match_type });
      candidatesByStream.set(mapping.provider_stream_id, list);
    }
  }
  const bySource = {};
  const byMatch = {};
  const samples = { sameTargetOverlap: [], differentTargetConflict: [] };
  const snapshotByStream = new Map(snapshotRows.map((row) => [row.provider_stream_id, row]));
  const chosen = [];
  let resolved = 0;
  let candidateConflicts = 0;
  let resolvedConflicts = 0;
  let unresolvedConflicts = 0;
  let sameTargetOverlap = 0;
  let epgeniusOnly = 0;
  let us2Only = 0;
  const programmeStats = { current: 0, future: 0, both: 0, without: 0 };
  const usProgrammeStats = { current: 0, future: 0, both: 0, without: 0 };
  const usBySource = {};
  const usByMatch = {};
  let usRelevantRows = 0;
  let usResolved = 0;
  const sourceSamples = {};
  for (const [streamId, candidates] of candidatesByStream) {
    const provider = snapshotByStream.get(streamId);
    if (!provider) continue;
    const ordered = [...candidates].sort((a, b) => a.priority - b.priority || a.sourceId.localeCompare(b.sourceId) || String(a.xmltvChannelId).localeCompare(String(b.xmltvChannelId)));
    const distinctTargets = new Set(ordered.map((candidate) => candidate.xmltvChannelId));
    if (ordered.length > 1) candidateConflicts += 1;
    if (distinctTargets.size === 1 && ordered.length > 1) {
      sameTargetOverlap += 1;
      if (samples.sameTargetOverlap.length < 10) samples.sameTargetOverlap.push({ providerStreamId: streamId, providerName: String(provider.channel_name ?? '').slice(0, 200), candidates: ordered.map((candidate) => candidate.sourceLabel), xmltvChannelIds: [...distinctTargets] });
    } else if (distinctTargets.size > 1) {
      const samePriority = ordered[0].priority === ordered[ordered.length - 1].priority;
      if (samePriority) {
        unresolvedConflicts += 1;
        if (samples.differentTargetConflict.length < 10) samples.differentTargetConflict.push({ providerStreamId: streamId, providerName: String(provider.channel_name ?? '').slice(0, 200), candidates: ordered.map((candidate) => candidate.sourceLabel), xmltvChannelIds: ordered.map((candidate) => candidate.xmltvChannelId), winningSource: null, reason: 'equal_priority_conflict' });
        continue;
      }
      resolvedConflicts += 1;
      if (samples.differentTargetConflict.length < 10) samples.differentTargetConflict.push({ providerStreamId: streamId, providerName: String(provider.channel_name ?? '').slice(0, 200), candidates: ordered.map((candidate) => candidate.sourceLabel), xmltvChannelIds: ordered.map((candidate) => candidate.xmltvChannelId), winningSource: ordered[0].sourceLabel, reason: 'priority' });
    }
    const winner = ordered[0];
    resolved += 1;
    bySource[winner.sourceLabel] = (bySource[winner.sourceLabel] ?? 0) + 1;
    byMatch[winner.matchType] = (byMatch[winner.matchType] ?? 0) + 1;
    const programme = programmeCoverageBySource.get(winner.sourceId)?.get(winner.xmltvChannelId) ?? { current: false, future: false };
    if (programme.current) programmeStats.current += 1;
    if (programme.future) programmeStats.future += 1;
    if (programme.current && programme.future) programmeStats.both += 1;
    if (!programme.current && !programme.future) programmeStats.without += 1;
    const classification = classifyAuditItem({ name: provider.channel_name, categoryName: provider.category_name });
    if (classification.isUs) {
      usResolved += 1;
      usBySource[winner.sourceLabel] = (usBySource[winner.sourceLabel] ?? 0) + 1;
      usByMatch[winner.matchType] = (usByMatch[winner.matchType] ?? 0) + 1;
      if (programme.current) usProgrammeStats.current += 1;
      if (programme.future) usProgrammeStats.future += 1;
      if (programme.current && programme.future) usProgrammeStats.both += 1;
      if (!programme.current && !programme.future) usProgrammeStats.without += 1;
    }
    const label = String(winner.sourceLabel);
    if (!sourceSamples[label]) sourceSamples[label] = [];
    if (sourceSamples[label].length < 10) sourceSamples[label].push({ providerStreamId: streamId, providerName: String(provider.channel_name ?? '').slice(0, 200), xmltvChannelId: winner.xmltvChannelId, matchType: winner.matchType });
    chosen.push({ providerStreamId: streamId, sourceId: winner.sourceId, xmltvChannelId: winner.xmltvChannelId });
  }
  for (const row of candidatesByStream.values()) {
    const labels = new Set(row.map((candidate) => candidate.sourceLabel));
    if (labels.size === 1) continue;
    if (labels.has('EPGenius Strong') && !labels.has('US2 National')) epgeniusOnly += 1;
    if (labels.has('US2 National') && !labels.has('EPGenius Strong')) us2Only += 1;
  }
  for (const row of snapshotRows) if (classifyAuditItem({ name: row.channel_name, categoryName: row.category_name }).isUs) usRelevantRows += 1;
  const distinctChosenTargets = new Set(chosen.map((row) => row.xmltvChannelId));
  const usCurrentProgrammePercent = usResolved ? (usProgrammeStats.current / usResolved) * 100 : 0;
  const usFutureProgrammePercent = usResolved ? (usProgrammeStats.future / usResolved) * 100 : 0;
  const readiness = assessGuideReadiness({ usRelevantRows, usCombinedResolved: usResolved, usCurrentProgrammePercent, usFutureProgrammePercent, unresolvedConflicts });
  const summary = {
    id: crypto.randomUUID(),
    managed_provider_id: providerId,
    snapshot_generation: snapshotGeneration,
    provider_rows: snapshotRows.length,
    resolved,
    unresolved: snapshotRows.length - resolved,
    mapping_percent: snapshotRows.length ? resolved / snapshotRows.length : 0,
    enabled_source_count: (sources ?? []).filter((source) => source.active_cache_generation).length,
    by_source: bySource,
    by_match: byMatch,
    candidate_conflicts: candidateConflicts,
    resolved_conflicts: resolvedConflicts,
    unresolved_conflicts: unresolvedConflicts,
    duplicate_provider_variants: chosen.length - distinctChosenTargets.size,
    current_programme_coverage: programmeStats.current,
    future_programme_coverage: programmeStats.future,
    source_generations: Object.fromEntries((sources ?? []).filter((source) => source.active_cache_generation).map((source) => [source.safe_label, source.active_cache_generation])),
    samples: { ...samples, sourceContributions: sourceSamples },
    us_relevant_rows: usRelevantRows,
    us_combined_resolved: usResolved,
    us_combined_unresolved: usRelevantRows - usResolved,
    us_combined_mapping_ratio: usRelevantRows ? usResolved / usRelevantRows : 0,
    us_combined_mapping_percent: usRelevantRows ? (usResolved / usRelevantRows) * 100 : 0,
    us_by_source: usBySource,
    us_by_match: usByMatch,
    resolved_with_current_programme: programmeStats.current,
    resolved_with_future_programme: programmeStats.future,
    resolved_with_current_and_future: programmeStats.both,
    resolved_without_programme_data: programmeStats.without,
    current_programme_percent: resolved ? (programmeStats.current / resolved) * 100 : 0,
    future_programme_percent: resolved ? (programmeStats.future / resolved) * 100 : 0,
    us_resolved_with_current_programme: usProgrammeStats.current,
    us_resolved_with_future_programme: usProgrammeStats.future,
    us_resolved_with_current_and_future: usProgrammeStats.both,
    us_resolved_without_programme_data: usProgrammeStats.without,
    us_current_programme_percent: usCurrentProgrammePercent,
    us_future_programme_percent: usFutureProgrammePercent,
    epgenius_only: epgeniusOnly,
    us2_only: us2Only,
    same_target_overlap: sameTargetOverlap,
    different_target_conflict: resolvedConflicts + unresolvedConflicts,
    mapping_ready: readiness.mappingReady,
    programme_coverage_ready: readiness.programmeCoverageReady,
    conflict_risk_acceptable: readiness.conflictRiskAcceptable,
    managed_guide_delivery_ready: readiness.managedGuideDeliveryReady,
    readiness_reasons: readiness.readinessReasons,
  };
  await db('managed_provider_epg_combined_coverage', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(summary) }, 'persist_combined_coverage');
  await db('managed_provider_epg_combined_coverage?managed_provider_id=eq.' + encodeURIComponent(providerId) + '&id=neq.' + encodeURIComponent(summary.id), { method: 'DELETE', headers: { Prefer: 'return=minimal' } }, 'cleanup_previous_combined_coverage');
  return summary;
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

function canonicalizePhase2c(value) {
  const normalized = String(value ?? '').normalize('NFKC').replace(/[\u1d00-\u1d7f]/gu, (character) => character === '\u1d18' ? 'P' : character);
  return normalizeAuditName(normalized)
    .replace(/^(?:4k|hd|fhd|uhd|us|usa|prime)\s*[:\-]?\s*/i, '')
    .replace(/\b(?:hd|fhd|uhd|4k|3840p|2160p|1080p|720p|event|live event|live-event|backup|raw)\b/gi, ' ')
    .replace(/[#=\-]{2,}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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
    if (this.activeChannel) { this.channels.set(this.activeChannel.id, { id: this.activeChannel.id, displayNames: this.activeChannel.names.slice() }); this.onChannel(this.channels.get(this.activeChannel.id)); }
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
  return { credentials, items: Array.isArray(rows) ? rows.map((row) => ({
    streamId: String(row.stream_id ?? ''),
    name: String(row.name ?? ''),
    epgChannelId: row.epg_channel_id ? String(row.epg_channel_id) : null,
    categoryId: row.category_id == null ? null : String(row.category_id),
    categoryName: row.category_name == null ? null : String(row.category_name),
  })) : [] };
}

async function persistProviderCatalogSnapshot(providerId, items) {
  const generation = crypto.randomUUID();
  const capturedAt = new Date().toISOString();
  const rows = items
    .filter((item) => item.streamId)
    .map((item) => ({
      managed_provider_id: providerId,
      provider_stream_id: item.streamId.slice(0, 200),
      channel_name: item.name.slice(0, 500),
      epg_channel_id: item.epgChannelId?.slice(0, 500) ?? null,
      category_id: item.categoryId?.slice(0, 200) ?? null,
      category_name: item.categoryName?.slice(0, 500) ?? null,
      canonical_name: canonicalize(item.name).slice(0, 500) || null,
      captured_at: capturedAt,
      snapshot_generation: generation,
      is_active: false,
      snapshot_expected_rows: items.length,
      snapshot_complete: false,
    }));
  if (!rows.length) return { generation, expectedRows: items.length, storedRows: 0, complete: false };
  const [previous] = await db(`managed_provider_epg_catalog_snapshot?managed_provider_id=eq.${encodeURIComponent(providerId)}&is_active=eq.true&select=snapshot_generation&order=captured_at.desc&limit=1`, {}, 'load_previous_catalog_snapshot');
  try {
    await insertBatches('managed_provider_epg_catalog_snapshot', rows, 'managed_provider_id,snapshot_generation,provider_stream_id', 'insert_catalog_snapshot');
    const complete = rows.length === items.length;
    await db(`managed_provider_epg_catalog_snapshot?managed_provider_id=eq.${encodeURIComponent(providerId)}&snapshot_generation=eq.${encodeURIComponent(generation)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ snapshot_expected_rows: items.length, snapshot_complete: complete }) }, 'complete_catalog_snapshot');
    await db(`managed_provider_epg_catalog_snapshot?managed_provider_id=eq.${encodeURIComponent(providerId)}&snapshot_generation=eq.${encodeURIComponent(generation)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ is_active: true }) }, 'promote_catalog_snapshot');
    if (previous?.snapshot_generation && previous.snapshot_generation !== generation) {
      await db(`managed_provider_epg_catalog_snapshot?managed_provider_id=eq.${encodeURIComponent(providerId)}&snapshot_generation=eq.${encodeURIComponent(previous.snapshot_generation)}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } }, 'cleanup_previous_catalog_snapshot').catch((error) => { logDatabaseFailure(error); process.stderr.write('Previous provider catalog snapshot cleanup deferred.\n'); });
    }
  } catch (error) {
      await db(`managed_provider_epg_catalog_snapshot?managed_provider_id=eq.${encodeURIComponent(providerId)}&snapshot_generation=eq.${encodeURIComponent(generation)}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } }, 'cleanup_failed_catalog_snapshot').catch(() => {});
    logDatabaseFailure(error);
    process.stderr.write('EPG provider catalog snapshot unavailable.\n');
    return { generation, expectedRows: items.length, storedRows: rows.length, complete: false };
  }
  return { generation, expectedRows: items.length, storedRows: rows.length, complete: rows.length === items.length };
}

const AUDIT_REGION_CODES = new Set(['AF', 'AR', 'AT', 'AU', 'BE', 'BR', 'CA', 'CH', 'CL', 'CN', 'CO', 'CR', 'CZ', 'DE', 'DK', 'DO', 'EC', 'ES', 'FI', 'FR', 'GB', 'GR', 'HK', 'HU', 'IE', 'IL', 'IN', 'IS', 'IT', 'JP', 'KR', 'LV', 'MX', 'MY', 'NL', 'NO', 'NZ', 'PE', 'PH', 'PL', 'PT', 'RO', 'RU', 'SE', 'SG', 'SK', 'TR', 'TW', 'UA', 'UK', 'ZA']);
const AUDIT_NON_GEOGRAPHIC_PREFIXES = new Set(['NBA', 'NFL', 'NHL', 'MLB', 'F1', 'HD', 'FHD', 'UHD', 'PRIME', 'RAW', 'LIVE']);
const AUDIT_NETWORK_TERMS = ['ABC', 'CBS', 'NBC', 'FOX', 'ESPN', 'TNT', 'TBS', 'USA NETWORK', 'NFL', 'NBA', 'HBO', 'CNN', 'MSNBC', 'CNBC'];

function normalizeAuditName(value) {
  return String(value ?? '').trim().toLocaleLowerCase().replace(/[._-]+/g, ' ').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
}

function classifyAuditItem(item) {
  const name = String(item.name ?? '').toLocaleUpperCase();
  const category = String(item.categoryName ?? item.categoryId ?? '').toLocaleUpperCase();
  const prefix = (value) => {
    const token = value.match(/^([A-Z]{2,3}):/)?.[1] ?? null;
    if (!token || AUDIT_NON_GEOGRAPHIC_PREFIXES.has(token)) return null;
    if (token === 'US' || token === 'USA') return 'us';
    return AUDIT_REGION_CODES.has(token) ? 'foreign' : null;
  };
  const categoryPrefix = prefix(category);
  const namePrefix = prefix(name);
  if (categoryPrefix === 'foreign' || namePrefix === 'foreign') return { isUs: false, reason: 'explicit_foreign' };
  if (categoryPrefix === 'us' || namePrefix === 'us' || /(^|[^A-Z])(US|USA|UNITED STATES)([^A-Z]|$)/.test(category)) return { isUs: true, reason: categoryPrefix === 'us' ? 'us_prefix' : 'us_category' };
  if (AUDIT_NETWORK_TERMS.some((term) => new RegExp(`(^|[^A-Z])${term.replace(/[+&]/g, '\\$&')}(?=[^A-Z]|$)`).test(name))) return { isUs: true, reason: 'network_heuristic' };
  return { isUs: false, reason: 'other' };
}

function toAuditXmltvChannel(row) {
  const id = String(row?.id ?? row?.xmltv_channel_id ?? '').trim();
  const rawNames = [
    ...(Array.isArray(row?.displayNames) ? row.displayNames : []),
    ...(Array.isArray(row?.display_names) ? row.display_names : []),
    ...(Array.isArray(row?.alternate_names) ? row.alternate_names : []),
    row?.displayName,
    row?.display_name,
    row?.name,
  ];
  const displayNames = [...new Set(rawNames.filter((value) => typeof value === 'string').map((value) => value.trim()).filter(Boolean))];
  return { id, displayNames };
}

function buildMappingAudit(providerId, sourceId, items, xmltvChannels, mappings, snapshot, epgGeneration) {
  const adaptedXmltvChannels = xmltvChannels.map(toAuditXmltvChannel);
  const channelsWithDisplayNames = adaptedXmltvChannels.filter((channel) => channel.displayNames.length > 0).length;
  if (adaptedXmltvChannels.length > 0 && channelsWithDisplayNames === 0) throw new Error('invalid_epg_channel_metadata');
  const xmltv = adaptedXmltvChannels.filter((channel) => channel.id && channel.displayNames.length > 0).map((channel) => ({ id: channel.id, name: channel.displayNames[0], alternates: channel.displayNames.slice(1) }));
  const indexes = { ids: new Map(), lowerIds: new Map(), raw: new Map(), normalized: new Map(), canonical: new Map() };
  const add = (index, key, row) => { if (key) index.set(key, [...(index.get(key) ?? []), row]); };
  for (const row of xmltv) {
    add(indexes.ids, row.id, row);
    add(indexes.lowerIds, row.id.toLocaleLowerCase(), row);
    for (const value of [row.name, ...row.alternates]) {
      add(indexes.raw, value.trim(), row);
      add(indexes.normalized, normalizeAuditName(value), row);
      add(indexes.canonical, canonicalizePhase2c(value), row);
    }
  }
  const unique = (rows) => [...new Map(rows.map((row) => [row.id, row])).values()];
  const mapped = new Set(mappings.map((row) => row.provider_stream_id));
  const projections = { directIdPotential: 0, caseInsensitiveIdPotential: 0, exactNamePotential: 0, normalizedNamePotential: 0, canonicalPotential: 0, qualityVariantPotential: 0, ambiguousPotential: 0, unmatched: 0 };
  const ruleBreakdown = { qualityCleanup: 0, resolutionCleanup: 0, eventCleanup: 0, rawCleanup: 0, primeWrapperCleanup: 0, usWrapperCleanup: 0, alternateDisplayName: 0, qualityVariantResolution: 0, otherPhase2cDeterministic: 0 };
  const additional = new Map();
  const resolution = (candidates, providerName) => {
    if (candidates.length < 2) return { candidates, resolved: false };
    const providerHasHd = /(^|[^A-Z])HD([^A-Z]|$)/i.test(providerName);
    const candidateHasHd = (candidate) => /(^|[\s._-])HD($|[\s._-])/i.test(`${candidate.id} ${candidate.name} ${candidate.alternates.join(' ')}`);
    const preferred = candidates.filter((candidate) => candidateHasHd(candidate) === providerHasHd);
    return preferred.length === 1 ? { candidates: preferred, resolved: true } : { candidates, resolved: false };
  };
  const matchRule = (providerName, target, kind, qualityResolved) => {
    const name = String(providerName ?? '');
    if (qualityResolved) return 'qualityVariantResolution';
    const canonicalTarget = canonicalizePhase2c(target.name);
    if (canonicalTarget !== canonicalize(target.name)) {
      if (/\b(?:3840p|2160p|1080p|720p)\b/i.test(name)) return 'resolutionCleanup';
      if (/\b(?:event|live[ -]event)\b/i.test(name)) return 'eventCleanup';
      if (/^\s*prime\s*:/i.test(name)) return 'primeWrapperCleanup';
      if (/^\s*(?:us|usa)\s*:/i.test(name)) return 'usWrapperCleanup';
      if (/\b(?:4k|uhd|fhd|hd)\b/i.test(name)) return 'qualityCleanup';
      if (/\b(?:backup|raw)\b/i.test(name)) return 'rawCleanup';
      if (/[&#=\-(),._]/.test(name)) return 'rawCleanup';
    }
    if (kind === 'canonical' && target.name !== target.alternates[0] && target.alternates.length) return 'alternateDisplayName';
    return 'otherPhase2cDeterministic';
  };
  for (const item of items) {
    if (mapped.has(item.streamId)) continue;
    const direct = item.epgChannelId ? unique(indexes.ids.get(item.epgChannelId) ?? []) : [];
    const lower = item.epgChannelId ? unique(indexes.lowerIds.get(item.epgChannelId.toLocaleLowerCase()) ?? []) : [];
    const exact = unique(indexes.raw.get(item.name.trim()) ?? []);
    const normalized = unique(indexes.normalized.get(normalizeAuditName(item.name)) ?? []);
    const canonical = unique(indexes.canonical.get(canonicalizePhase2c(item.name)) ?? []);
    const candidates = [{ key: 'directIdPotential', rows: direct, kind: 'id' }, { key: 'caseInsensitiveIdPotential', rows: lower, kind: 'id' }, { key: 'exactNamePotential', rows: exact, kind: 'exact' }, { key: 'normalizedNamePotential', rows: normalized, kind: 'normalized' }, { key: 'canonicalPotential', rows: canonical, kind: 'canonical' }];
    let selected = candidates.find((candidate) => candidate.rows.length === 1);
    let qualityResolved = false;
    if (!selected && canonical.length > 1) {
      const resolved = resolution(canonical, item.name);
      if (resolved.candidates.length === 1) { selected = { key: 'qualityVariantPotential', rows: resolved.candidates, kind: 'canonical' }; qualityResolved = resolved.resolved; }
    }
    if (selected) {
      projections[selected.key] += 1;
      additional.set(item.streamId, { item, target: selected.rows[0], kind: selected.kind, key: selected.key, qualityResolved });
      ruleBreakdown[matchRule(item.name, selected.rows[0], selected.kind, qualityResolved)] += 1;
    } else {
      if (normalized.length > 1 || canonical.length > 1) projections.ambiguousPotential += 1;
      else projections.unmatched += 1;
    }
  }
  const group = (predicate) => { const rows = items.filter(predicate); return { rows: rows.length, uniqueCanonicalNames: new Set(rows.map((row) => canonicalizePhase2c(row.name)).filter(Boolean)).size }; };
  const classify = (item) => classifyAuditItem(item);
  const isUs = (item) => classify(item).isUs;
  const isLocal = (item) => /\b(?:LOCAL|LOCALS|AFFILIATE)\b/i.test(`${item.name} ${item.categoryName ?? ''}`);
  const groups = {
    PRIME: group((item) => /\bPRIME\b/i.test(`${item.name} ${item.categoryName ?? ''}`)),
    US: group((item) => classify(item).reason === 'us_prefix' || classify(item).reason === 'us_category'),
    USA: group((item) => /(^|[^A-Z])USA([^A-Z]|$)/i.test(`${item.name} ${item.categoryName ?? ''}`)),
    NBA: group((item) => /\bNBA\b/i.test(`${item.name} ${item.categoryName ?? ''}`)),
    NFL: group((item) => /\bNFL\b/i.test(`${item.name} ${item.categoryName ?? ''}`)),
    majorNationalNetworks: group((item) => isUs(item) && AUDIT_NETWORK_TERMS.some((term) => new RegExp(`(^|[^A-Z])${term.replace(/[+&]/g, '\\$&')}(?=[^A-Z]|$)`).test(item.name))),
    likelyLocals: group((item) => isUs(item) && isLocal(item)),
    explicitForeign: group((item) => classify(item).reason === 'explicit_foreign'),
    other: group((item) => classify(item).reason === 'other'),
  };
  const targetVariants = new Map();
  for (const { item, target } of additional.values()) targetVariants.set(target.id, [...(targetVariants.get(target.id) ?? []), item]);
  const duplicateProviderVariants = [...targetVariants.entries()].filter(([, rows]) => rows.length > 1).slice(0, 10).map(([xmltvChannelId, rows]) => ({ xmltvChannelId, providerRowCount: rows.length, providerStreamIds: rows.slice(0, 10).map((row) => row.streamId), names: rows.slice(0, 10).map((row) => row.name) }));
  const namespace = new Map();
  for (const item of items) { const suffix = item.epgChannelId?.match(/\.([A-Za-z0-9]{2,})$/)?.[1]; const key = suffix ? `.${suffix.toLowerCase()}` : '(no suffix)'; namespace.set(key, (namespace.get(key) ?? 0) + 1); }
  const sample = (predicate) => items.filter(predicate).slice(0, 10).map((item) => ({ providerStreamId: item.streamId, channelName: item.name, epgChannelId: item.epgChannelId ?? null }));
  const currentMapped = mapped.size;
  const additionalDeterministicPotential = additional.size;
  const usRows = items.filter(isUs);
  const usCurrentMapped = usRows.filter((item) => mapped.has(item.streamId)).length;
  const usAdditionalPotential = [...additional.values()].filter(({ item }) => isUs(item)).length;
  const phase2cMappingRecords = [...additional.values()].map(({ item, target, key, qualityResolved }) => ({ providerStreamId: item.streamId, xmltvChannelId: target.id, matchType: qualityResolved ? 'quality_variant' : key === 'directIdPotential' ? 'direct_id' : key === 'caseInsensitiveIdPotential' ? 'case_insensitive_id' : key === 'exactNamePotential' ? 'exact_name' : key === 'normalizedNamePotential' ? 'normalized_name' : 'canonical', providerCanonical: canonicalizePhase2c(item.name), xmltvCanonical: canonicalizePhase2c(target.name) }));
  const sanityNames = ['ESPN', 'ESPN2', 'TNT', 'TBS', 'USA NETWORK', 'CNN', 'FOX NEWS', 'MSNBC', 'AMC', 'HBO', 'CBS SPORTS NETWORK', 'NFL NETWORK', 'NBA TV'];
  const sanity = sanityNames.map((requestedName) => {
    const provider = items.find((item) => canonicalizePhase2c(item.name) === canonicalizePhase2c(requestedName));
    const candidates = provider ? unique(indexes.canonical.get(canonicalizePhase2c(provider.name)) ?? []) : [];
    return { providerStreamId: provider?.streamId ?? null, providerName: provider?.name ?? requestedName, providerCanonical: provider ? canonicalizePhase2c(provider.name) : null, xmltvId: candidates.length === 1 ? candidates[0].id : null, xmltvDisplayName: candidates.length === 1 ? candidates[0].name : null, matchRule: candidates.length === 1 ? 'canonical' : null, status: candidates.length === 1 ? 'matched' : candidates.length > 1 ? 'ambiguous' : 'unmatched', reason: provider ? candidates.length ? 'canonical_candidate_count' : 'absent_from_xmltv' : 'provider_row_not_found' };
  });
  const affiliateNames = ['6ABC PHILADELPHIA', 'WMAR', 'KIVI', 'WKBW', 'WCIV', 'WCPO', 'WEWS'];
  const localAffiliateAudit = affiliateNames.map((requestedName) => {
    const provider = items.find((item) => canonicalizePhase2c(item.name).includes(canonicalizePhase2c(requestedName)));
    const candidates = provider ? unique(indexes.canonical.get(canonicalizePhase2c(provider.name)) ?? []) : [];
    return { requestedName, providerStreamId: provider?.streamId ?? null, providerName: provider?.name ?? null, status: candidates.length === 1 ? 'deterministic_match' : candidates.length > 1 ? 'ambiguous' : 'absent_from_us2' };
  });
  return {
    providerId, sourceId, snapshotGeneration: snapshot.generation, epgGeneration, providerRows: items.length, uniqueProviderCanonicalNames: new Set(items.map((item) => canonicalizePhase2c(item.name)).filter(Boolean)).size,
    providerRowsWithEpgId: items.filter((item) => item.epgChannelId).length, providerRowsWithoutEpgId: items.filter((item) => !item.epgChannelId).length, xmltvChannels: xmltv.length, currentMapped,
    snapshotExpectedRows: snapshot.expectedRows, snapshotStoredRows: snapshot.storedRows, snapshotComplete: snapshot.complete, snapshotPageCount: 1,
    directIdPotential: projections.directIdPotential, caseInsensitiveIdPotential: projections.caseInsensitiveIdPotential, exactNamePotential: projections.exactNamePotential, normalizedNamePotential: projections.normalizedNamePotential, canonicalPotential: projections.canonicalPotential, ambiguousPotential: projections.ambiguousPotential,
    additionalDeterministicPotential, projectedMappedTotal: currentMapped + additionalDeterministicPotential,
    usRelevantRows: usRows.length, usCurrentMapped, usAdditionalPotential, usProjectedMapped: usCurrentMapped + usAdditionalPotential, usProjectedMappingPercent: usRows.length ? (usCurrentMapped + usAdditionalPotential) / usRows.length : 0,
    usPhase2cAdditionalPotential: usAdditionalPotential, usPhase2cProjectedMapped: usCurrentMapped + usAdditionalPotential, usPhase2cProjectedMappingRatio: usRows.length ? (usCurrentMapped + usAdditionalPotential) / usRows.length : 0, usPhase2cProjectedMappingPercent: usRows.length ? ((usCurrentMapped + usAdditionalPotential) / usRows.length) * 100 : 0,
    groups, groupsAreNonExclusive: true, manyToOne: { providerRowCount: duplicateProviderVariants.reduce((sum, row) => sum + row.providerRowCount, 0), uniqueXmltvTargetCount: duplicateProviderVariants.length, duplicateQualityVariantCount: duplicateProviderVariants.filter((row) => row.names.some((name) => /\b(?:HD|FHD|UHD|4K)\b/i.test(name))).length, ambiguityCount: projections.ambiguousPotential },
    phase2cDirectIdPotential: projections.directIdPotential, phase2cCaseInsensitiveIdPotential: projections.caseInsensitiveIdPotential, phase2cExactNamePotential: projections.exactNamePotential, phase2cNormalizedNamePotential: projections.normalizedNamePotential, phase2cCanonicalPotential: projections.canonicalPotential, phase2cQualityVariantPotential: projections.qualityVariantPotential, phase2cAdditionalDeterministicPotential: additionalDeterministicPotential, phase2cProjectedMappedTotal: currentMapped + additionalDeterministicPotential, phase2cAmbiguousPotential: projections.ambiguousPotential, phase2cUnmatched: projections.unmatched, phase2cRuleBreakdown: ruleBreakdown, phase2cMappingRecords, sanityChannels: sanity, localAffiliateAudit,
    xmltvChannelObjects: adaptedXmltvChannels.length, xmltvChannelsWithDisplayNames: channelsWithDisplayNames, xmltvDisplayNames: xmltv.reduce((count, row) => count + 1 + row.alternates.length, 0), uniqueXmltvCanonicals: indexes.canonical.size, duplicateXmltvCanonicals: [...indexes.canonical.values()].filter((rows) => unique(rows).length > 1).length, ambiguousXmltvCanonicals: [...indexes.canonical.values()].filter((rows) => unique(rows).length > 1).length,
    samples: { unmatchedNational: sample((item) => isUs(item) && !mapped.has(item.streamId) && !isLocal(item)), unmatchedLocal: sample((item) => isUs(item) && !mapped.has(item.streamId) && isLocal(item)), duplicateProviderVariants, namespaceFamilies: [...namespace.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([suffix, count]) => ({ suffix, count, scope: 'global' })) },
  };
}

async function persistMappingAudit(audit) {
  const auditId = crypto.randomUUID();
  try {
    await db('managed_provider_epg_mapping_audits', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ id: auditId, managed_provider_id: audit.providerId, source_id: audit.sourceId, snapshot_generation: audit.snapshotGeneration ?? crypto.randomUUID(), epg_generation: audit.epgGeneration ?? null, provider_rows: audit.providerRows, unique_provider_canonical_names: audit.uniqueProviderCanonicalNames, provider_rows_with_epg_id: audit.providerRowsWithEpgId, provider_rows_without_epg_id: audit.providerRowsWithoutEpgId, xmltv_channels: audit.xmltvChannels, current_mapped: audit.currentMapped, snapshot_expected_rows: audit.snapshotExpectedRows, snapshot_stored_rows: audit.snapshotStoredRows, snapshot_complete: audit.snapshotComplete, snapshot_page_count: audit.snapshotPageCount, direct_id_potential: audit.directIdPotential, case_insensitive_id_potential: audit.caseInsensitiveIdPotential, exact_name_potential: audit.exactNamePotential, normalized_name_potential: audit.normalizedNamePotential, canonical_potential: audit.canonicalPotential, ambiguous_potential: audit.ambiguousPotential, additional_deterministic_potential: audit.additionalDeterministicPotential, projected_mapped_total: audit.projectedMappedTotal, us_relevant_rows: audit.usRelevantRows, us_current_mapped: audit.usCurrentMapped, us_additional_potential: audit.usAdditionalPotential, us_projected_mapped: audit.usProjectedMapped, us_projected_mapping_percent: audit.usProjectedMappingPercent, xmltv_display_names: audit.xmltvDisplayNames, unique_xmltv_canonicals: audit.uniqueXmltvCanonicals, duplicate_xmltv_canonicals: audit.duplicateXmltvCanonicals, ambiguous_xmltv_canonicals: audit.ambiguousXmltvCanonicals, groups_are_non_exclusive: true, phase2c_direct_id_potential: audit.phase2cDirectIdPotential, phase2c_case_insensitive_id_potential: audit.phase2cCaseInsensitiveIdPotential, phase2c_exact_name_potential: audit.phase2cExactNamePotential, phase2c_normalized_name_potential: audit.phase2cNormalizedNamePotential, phase2c_canonical_potential: audit.phase2cCanonicalPotential, phase2c_quality_variant_potential: audit.phase2cQualityVariantPotential, phase2c_additional_deterministic_potential: audit.phase2cAdditionalDeterministicPotential, phase2c_projected_mapped_total: audit.phase2cProjectedMappedTotal, phase2c_ambiguous_potential: audit.phase2cAmbiguousPotential, phase2c_unmatched: audit.phase2cUnmatched, us_phase2c_additional_potential: audit.usPhase2cAdditionalPotential, us_phase2c_projected_mapped: audit.usPhase2cProjectedMapped, us_phase2c_projected_mapping_ratio: audit.usPhase2cProjectedMappingRatio, us_phase2c_projected_mapping_percent: audit.usPhase2cProjectedMappingPercent, phase2c_rule_breakdown: audit.phase2cRuleBreakdown, groups: audit.groups, many_to_one: audit.manyToOne, samples: { ...audit.samples, sanityChannels: audit.sanityChannels, localAffiliateAudit: audit.localAffiliateAudit } }) }, 'persist_mapping_audit');
    await db(`managed_provider_epg_mapping_audits?managed_provider_id=eq.${encodeURIComponent(audit.providerId)}&source_id=eq.${encodeURIComponent(audit.sourceId)}&id=neq.${encodeURIComponent(auditId)}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } }, 'cleanup_previous_mapping_audits');
  } catch (error) {
    logDatabaseFailure(error);
    process.stderr.write('EPG mapping audit unavailable.\n');
  }
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
  const snapshot = await persistProviderCatalogSnapshot(providerId, live.items);
  process.stdout.write(`providerCatalogFetched=${live.items.length} snapshotStored=${snapshot?.storedRows ?? 0} snapshotComplete=${snapshot?.complete === true}\n`);
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
  const existingMappings = await runWorkerStage('load_current_mappings', async () => source.active_cache_generation ? db(`managed_provider_epg_source_mappings?source_id=eq.${encodeURIComponent(source.id)}&cache_generation=eq.${encodeURIComponent(source.active_cache_generation)}&select=provider_stream_id,xmltv_channel_id,match_type,provider_canonical,xmltv_canonical`, {}, 'load_current_mappings') : []);
  const mappingsResult = await runWorkerStage('build_mappings', async () => {
  const liveStreamIds = new Set(live.items.map((item) => item.streamId));
  const xmltvIds = new Set(channels.map((channel) => channel.id));
  const validExistingMappings = existingMappings.filter((mapping) => liveStreamIds.has(mapping.provider_stream_id) && xmltvIds.has(mapping.xmltv_channel_id));
  const audit = buildMappingAudit(providerId, sourceId, live.items, channels, validExistingMappings, { generation: crypto.randomUUID(), expectedRows: live.items.length, storedRows: live.items.length, complete: true }, generation);
  const existingByStream = new Map(validExistingMappings.map((mapping) => [mapping.provider_stream_id, mapping]));
  for (const mapping of validExistingMappings) mappings.push({ source_id: source.id, managed_provider_id: source.managed_provider_id, cache_generation: generation, provider_stream_id: mapping.provider_stream_id, xmltv_channel_id: mapping.xmltv_channel_id, match_type: mapping.match_type, match_confidence_class: 'proven', provider_canonical: mapping.provider_canonical, xmltv_canonical: mapping.xmltv_canonical, mapped_at: refreshedAt });
  for (const mapping of audit.phase2cMappingRecords) if (!existingByStream.has(mapping.providerStreamId)) mappings.push({ source_id: source.id, managed_provider_id: source.managed_provider_id, cache_generation: generation, provider_stream_id: mapping.providerStreamId, xmltv_channel_id: mapping.xmltvChannelId, match_type: mapping.matchType, match_confidence_class: 'proven', provider_canonical: mapping.providerCanonical, xmltv_canonical: mapping.xmltvCanonical, mapped_at: refreshedAt });
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
  if (snapshot?.complete === true) {
    try {
      const audit = buildMappingAudit(providerId, sourceId, live.items, channels, mappings, snapshot, generation);
      if (audit.projectedMappedTotal < audit.currentMapped || audit.usPhase2cProjectedMapped < audit.usCurrentMapped) throw new Error('invalid_mapping_audit_totals');
      await persistMappingAudit(audit);
    } catch (error) {
      if (error instanceof Error && error.message === 'invalid_epg_channel_metadata') process.stderr.write('EPG mapping audit skipped: invalid channel metadata.\n');
      else if (error instanceof Error && error.message === 'invalid_mapping_audit_totals') process.stderr.write('EPG mapping audit skipped: invalid totals.\n');
      else { logDatabaseFailure(error); process.stderr.write('EPG mapping audit unavailable.\n'); }
    }
  }
  try {
    const combined = await persistCombinedCoverage(providerId);
    if (combined) process.stdout.write('combinedEpgCoveragePersisted=' + combined.provider_rows + ' resolved=' + combined.resolved + '\n');
  } catch (error) {
    logDatabaseFailure(error);
    process.stderr.write('Combined EPG coverage unavailable.\n');
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
  let result;
  try {
    result = await db('managed_provider_epg_refresh_requests', { method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=representation' }, body: JSON.stringify({ managed_provider_id: providerId, source_id: sourceId, status: 'pending', requested_at: new Date().toISOString() }) }, 'enqueue_scheduled_refresh');
  } catch (error) {
    const conflictText = [error?.safeMessage, error?.details, error?.hint].filter(Boolean).join(' ');
    const expectedActiveConflict = error instanceof DatabaseFailure && error.httpStatus === 409 && error.code === '23505' && conflictText.includes('managed_provider_epg_refresh_requests_one_active_idx');
    if (!expectedActiveConflict) throw error;
    const [existing] = await db(`managed_provider_epg_refresh_requests?managed_provider_id=eq.${encodeURIComponent(providerId)}&source_id=eq.${encodeURIComponent(sourceId)}&status=in.(pending,running)&select=id,status&limit=1`, {}, 'load_existing_refresh_request');
    if (!existing) throw error;
    process.stdout.write('Active EPG refresh request already exists; reusing it.\n');
    return requireUuid(existing.id, 'enqueue_scheduled_refresh', 'request_id');
  }
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

async function loadRunningRefreshJobOwner(jobId) {
  const safeJobId = requireUuid(jobId, 'load_refresh_job_owner', 'job_id');
  const [request] = await db(`managed_provider_epg_refresh_requests?refresh_job_id=eq.${encodeURIComponent(safeJobId)}&status=eq.running&select=id&limit=1`, {}, 'load_refresh_job_owner');
  return request ?? null;
}

async function cleanupStagedGeneration(sourceId, generation, activeCacheGeneration, operation) {
  if (!generation || generation === activeCacheGeneration) return;
  const safeSourceId = requireUuid(sourceId, operation, 'source_id');
  const safeGeneration = requireUuid(generation, operation, 'generation');
  for (const table of ['managed_provider_epg_source_channels', 'managed_provider_epg_source_programmes', 'managed_provider_epg_source_mappings']) {
    await db(`${table}?source_id=eq.${encodeURIComponent(safeSourceId)}&cache_generation=eq.${encodeURIComponent(safeGeneration)}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } }, operation).catch(() => {});
  }
}

async function reclaimActiveRefreshJob(source, activeJob, ownerRequestId = null) {
  const [providerSource] = await db(`managed_provider_epg_sources?id=eq.${encodeURIComponent(requireUuid(source.id, 'load_source_for_job_reclaim', 'source_id'))}&select=active_cache_generation`, {}, 'load_source_for_job_reclaim');
  const now = new Date().toISOString();
  await patch('managed_provider_epg_refresh_jobs', activeJob.id, { status: 'failed', stage: null, failure_code: ownerRequestId ? 'stale_refresh_job' : 'orphaned_refresh_job', failure_message: ownerRequestId ? 'stale_refresh_job' : 'orphaned_refresh_job', completed_at: now, updated_at: now }, '', ownerRequestId ? 'reclaim_stale_refresh_job' : 'reclaim_orphaned_refresh_job');
  if (ownerRequestId) await patch('managed_provider_epg_refresh_requests', ownerRequestId, { status: 'failed', failure_code: 'stale_refresh_job', failure_message: 'stale_refresh_job', completed_at: now }, '', 'fail_stale_refresh_request');
  await cleanupStagedGeneration(source.id, activeJob.generation, providerSource?.active_cache_generation, ownerRequestId ? 'cleanup_stale_refresh_job' : 'cleanup_orphaned_refresh_job');
  if (!ownerRequestId) process.stdout.write('Reclaimed orphaned EPG refresh job.\n');
}

async function ensureRefreshJob(source, requestId) {
  const [request] = await db(`managed_provider_epg_refresh_requests?id=eq.${encodeURIComponent(requestId)}&select=id,refresh_job_id`, {}, 'load_refresh_request');
  if (!request) throw new WorkerValidationFailure('load_refresh_request', 'missing_request');
  if (request.refresh_job_id != null) return { jobId: requireUuid(request.refresh_job_id, 'load_refresh_request', 'job_id'), skipped: false };
  const activeJob = await loadActiveRefreshJob(source.id);
  if (activeJob) {
    const owner = await loadRunningRefreshJobOwner(activeJob.id);
    const timestamp = Date.parse(activeJob.updated_at ?? activeJob.started_at ?? activeJob.created_at ?? '');
    const isStale = !Number.isFinite(timestamp) || Date.now() - timestamp > STALE_REFRESH_JOB_MS;
    if (owner && !isStale) return { jobId: requireUuid(activeJob.id, 'active_job_exists', 'job_id'), skipped: true, reason: 'active_job_exists' };
    await reclaimActiveRefreshJob(source, activeJob, owner?.id ?? null);
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
    const racedOwner = await loadRunningRefreshJobOwner(racedJob.id);
    const racedTimestamp = Date.parse(racedJob.updated_at ?? racedJob.started_at ?? racedJob.created_at ?? '');
    const racedIsStale = !Number.isFinite(racedTimestamp) || Date.now() - racedTimestamp > STALE_REFRESH_JOB_MS;
    if (racedOwner && !racedIsStale) return { jobId: requireUuid(racedJob.id, 'active_job_exists', 'job_id'), skipped: true, reason: 'active_job_exists' };
    await reclaimActiveRefreshJob(source, racedJob, racedOwner?.id ?? null);
    return ensureRefreshJob(source, requestId);
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
  const targetedRun = Boolean(providerId && sourceId);
  let failed = false;
  if (targetedRun) {
    await enqueueScheduledRefresh({ id: sourceId, managed_provider_id: providerId });
  } else if (!providerId && !sourceId) {
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
        await patch('managed_provider_epg_refresh_requests', requestId, { status: 'pending', started_at: null }, '', 'defer_active_refresh_request');
        process.stdout.write('EPG refresh already active; request remains pending.\n');
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
  if (targetedRun) {
    if (failed) process.exitCode = 1;
    return;
  }
  if (failed) process.exitCode = 1;
}

export { assessGuideReadiness, buildMappingAudit, toAuditXmltvChannel };

if (process.env.EPG_INGEST_TEST_IMPORT !== '1') {
  main().catch((error) => {
    logDatabaseFailure(error);
    logWorkerFailure(error);
    const code = error instanceof WorkerValidationFailure ? error.safeMessage : error instanceof DatabaseFailure ? error.message : 'worker_failure';
    process.stderr.write(`EPG worker failed: ${code}\n`);
    process.exitCode = 1;
  });
}
