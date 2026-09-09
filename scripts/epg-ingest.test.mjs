import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { spawn } from 'node:child_process';
import test from 'node:test';

process.env.EPG_INGEST_TEST_IMPORT = '1';
process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
process.env.PROVIDER_ENCRYPTION_KEY = '00'.repeat(32);
const { assessGuideReadiness, buildMappingAudit, normalizeXmltvChannelId, retainMappedProgrammes, snapshotWithinAge, toAuditXmltvChannel } = await import('./epg-ingest/index.mjs');

const worker = fs.readFileSync(new URL('./epg-ingest/index.mjs', import.meta.url), 'utf8');
const combinedMigration = fs.readFileSync(new URL('../supabase/migrations/20260906165500_managed_provider_epg_combined_coverage.sql', import.meta.url), 'utf8');
const workflow = fs.readFileSync(new URL('../.github/workflows/epg-refresh.yml', import.meta.url), 'utf8');
const admin = fs.readFileSync(new URL('../supabase/functions/admin-providers/index.ts', import.meta.url), 'utf8');
const migration = fs.readFileSync(new URL('../supabase/migrations/20260906043251_managed_provider_epg_refresh_requests.sql', import.meta.url), 'utf8');
const jobsMigration = fs.readFileSync(new URL('../supabase/migrations/20260906090000_managed_provider_epg_refresh_jobs.sql', import.meta.url), 'utf8');
const mappingConstraintMigration = fs.readFileSync(new URL('../supabase/migrations/20260906134032_managed_provider_epg_source_mapping_match_types_and_snapshot_promotion.sql', import.meta.url), 'utf8');

test('full mapping audit completes for a 12,000-row provider catalog and 765 XMLTV channels', () => {
  const providerRows = Array.from({ length: 12000 }, (_, index) => ({
    streamId: `stream-${index}`,
    name: index === 0 ? 'MATCH' : index < 3000 ? `UK: ESPN ${index}` : index < 4000 ? `NZ: NBA ${index}` : index < 5000 ? `IT: TNT ${index}` : index < 8000 ? `US: CHANNEL ${index}` : `NBA CHANNEL ${index}`,
    epgChannelId: null,
    categoryId: null,
    categoryName: null,
  }));
  const xmltvChannels = Array.from({ length: 765 }, (_, index) => ({
    id: index === 0 ? 'xml-match' : `xml-${index}`,
    displayNames: [index === 0 ? 'MATCH' : `CHANNEL ${index}`],
    alternateNames: [],
  }));
  const audit = buildMappingAudit(
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
    providerRows,
    xmltvChannels,
    [],
    { generation: 'snapshot-generation', expectedRows: 12000, storedRows: 12000, complete: true },
    'epg-generation',
  );

  assert.equal(audit.providerRows, 12000);
  assert.equal(audit.snapshotStoredRows, 12000);
  assert.equal(audit.snapshotComplete, true);
  assert.equal(audit.xmltvChannels, 765);
  assert.equal(audit.currentMapped, 0);
  assert.equal(audit.additionalDeterministicPotential, 1);
  assert.equal(audit.projectedMappedTotal, 1);
  assert.ok(audit.groups.explicitForeign.rows >= 4999);
  assert.ok(audit.usRelevantRows < audit.providerRows);
  assert.ok(audit.samples.unmatchedNational.length <= 10);
  assert.ok(audit.samples.unmatchedLocal.length <= 10);
  assert.ok(audit.samples.duplicateProviderVariants.length <= 10);
  assert.ok(audit.samples.namespaceFamilies.length <= 10);
  assert.doesNotMatch(JSON.stringify(audit), /password|token|authorization|https?:\/\//i);
});

test('Phase 2C audit parity preserves alternate names, ambiguity, quality resolution, and foreign prefixes', () => {
  const audit = buildMappingAudit(
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
    [
      { streamId: 'espn', name: '4K: ESPN UHD 3840P', epgChannelId: null, categoryId: null, categoryName: null },
      { streamId: 'foreign', name: 'UK: ESPN RAW', epgChannelId: null, categoryId: null, categoryName: null },
      { streamId: 'alternate', name: 'ESPN SECOND NAME', epgChannelId: null, categoryId: null, categoryName: null },
      { streamId: 'ambiguous', name: 'TNT', epgChannelId: null, categoryId: null, categoryName: null },
    ],
    [
      { id: 'espn-hd', displayNames: ['ESPN HD', 'ESPN SECOND NAME'] },
      { id: 'espn-sd', displayNames: ['ESPN'] },
      { id: 'tnt-east', displayNames: ['TNT'] },
      { id: 'tnt-west', displayNames: ['TNT'] },
    ],
    [],
    { generation: 'snapshot-generation', expectedRows: 3, storedRows: 3, complete: true },
    'epg-generation',
  );
  assert.equal(audit.xmltvDisplayNames, 5);
  assert.equal(audit.uniqueXmltvCanonicals, 3);
  assert.equal(audit.duplicateXmltvCanonicals, 2);
  assert.equal(audit.phase2cQualityVariantPotential, 1);
  assert.equal(audit.phase2cAmbiguousPotential, 1);
  assert.equal(audit.phase2cExactNamePotential, 1);
  assert.equal(audit.phase2cAdditionalDeterministicPotential, 2);
  assert.equal(audit.groupsAreNonExclusive, true);
  assert.equal(audit.usPhase2cProjectedMappingPercent, 66.66666666666666);
  assert.ok(audit.sanityChannels.length <= 13);
  assert.doesNotMatch(JSON.stringify(audit), /password|token|authorization|https?:\/\//i);
});

test('XMLTV audit adapter accepts in-memory/cache shapes and rejects misleading zero-name audits', () => {
  assert.deepEqual(toAuditXmltvChannel({ id: 'xml-1', displayNames: [' ESPN ', 'ESPN', 'ESPN 2'] }), { id: 'xml-1', displayNames: ['ESPN', 'ESPN 2'] });
  assert.deepEqual(toAuditXmltvChannel({ xmltv_channel_id: 'xml-2', display_name: 'CNN', alternate_names: ['CNN', 'CNN HD'] }), { id: 'xml-2', displayNames: ['CNN', 'CNN HD'] });
  assert.deepEqual(toAuditXmltvChannel({ id: 'xml-3', displayNames: ['', '   '] }), { id: 'xml-3', displayNames: [] });
  assert.throws(() => buildMappingAudit('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', [], [{ id: 'xml-1', displayNames: [] }], [], { generation: 'snapshot-generation', expectedRows: 0, storedRows: 0, complete: true }, 'epg-generation'), /invalid_epg_channel_metadata/);
});

test('Phase 2C eligible matches are staged for promotion without replacing the existing mapping path', () => {
  assert.match(worker, /load_current_mappings/);
  assert.match(worker, /phase2cMappingRecords/);
  assert.match(worker, /existingByStream/);
  assert.match(worker, /insertBatches\('managed_provider_epg_source_mappings', mappings/);
  assert.match(worker, /cache_generation: generation/);
  assert.match(worker, /promote_generation/);
  assert.doesNotMatch(worker, /fuzzy|edit distance/i);
});

test('mapping provenance accepts quality variants and snapshot promotion avoids the timed-out bulk deactivation update', () => {
  assert.match(mappingConstraintMigration, /drop constraint if exists managed_provider_epg_source_mappings_match_type_check/);
  for (const value of ['direct_id', 'case_insensitive_id', 'exact_name', 'normalized_name', 'canonical', 'quality_variant', 'alias', 'local_affiliate', 'ambiguous', 'unmatched']) assert.match(mappingConstraintMigration, new RegExp(`'${value}'`));
  assert.doesNotMatch(mappingConstraintMigration, /fuzzy|guessed|heuristic|confidence-score/i);
  assert.doesNotMatch(worker, /deactivate_previous_catalog_snapshot/);
  assert.match(worker, /promote_catalog_snapshot/);
  assert.match(worker, /cleanup_previous_catalog_snapshot/);
  assert.match(worker, /snapshotComplete/);
});

test('worker uses server-only secrets and streams XMLTV outside Edge', () => {
  assert.match(worker, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(worker, /PROVIDER_ENCRYPTION_KEY/);
  assert.match(worker, /createGunzip/);
  assert.match(worker, /Readable\.fromWeb/);
  assert.match(worker, /stream\.on\('data'/);
  assert.doesNotMatch(worker, /console\.log\(.*url|console\.log\(.*password|console\.log\(.*username/s);
  for (const line of worker.split('\n').filter((line) => line.includes('process.stdout.write') || line.includes('process.stderr.write'))) {
    assert.doesNotMatch(line, /url|password|username|token|secret|key/i);
  }
});

test('worker preserves source-qualified generation promotion and cleanup contract', () => {
  for (const table of ['managed_provider_epg_source_channels', 'managed_provider_epg_source_programmes', 'managed_provider_epg_source_mappings']) assert.match(worker, new RegExp(table));
  assert.match(worker, /active_cache_generation: generation/);
  assert.match(worker, /source\.active_cache_generation/);
  assert.match(worker, /resolution=ignore-duplicates/);
  assert.match(worker, /priority/);
});

test('refresh requests are private and have one pending/running request per provider/source', () => {
  assert.match(migration, /managed_provider_epg_refresh_requests/);
  assert.match(migration, /status in \('pending', 'running', 'complete', 'failed'\)/);
  assert.match(migration, /one_active_idx/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /revoke all on table/);
  assert.match(admin, /enqueueEpgRefresh\(client, source\)/);
  assert.doesNotMatch(admin.slice(admin.indexOf("if (action === 'start_epg_refresh'"), admin.indexOf("if (action === 'test_epg_source'")), /runEpgSourceTest|decryptSecret/);
});

test('workflow runs every six hours with manual filtering and a concurrency guard', () => {
  assert.match(workflow, /workflow_dispatch/);
  assert.match(workflow, /17 \*\/6 \* \* \*/);
  assert.match(workflow, /concurrency:/);
  assert.match(workflow, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(workflow, /PROVIDER_ENCRYPTION_KEY/);
});

test('combined coverage is persisted off Edge from complete paginated cached data', () => {
  assert.match(combinedMigration, /create table public\.managed_provider_epg_combined_coverage/);
  assert.match(combinedMigration, /enable row level security/);
  assert.match(combinedMigration, /revoke all on table public\.managed_provider_epg_combined_coverage from anon, authenticated/);
  for (const field of ['provider_rows', 'resolved', 'unresolved', 'mapping_percent', 'by_source', 'by_match', 'candidate_conflicts', 'resolved_conflicts', 'unresolved_conflicts', 'source_generations']) assert.match(combinedMigration, new RegExp(field));
  assert.match(worker, /async function loadAllRows/);
  assert.match(worker, /limit=' \+ pageSize \+ '&offset=' \+ offset/);
  assert.match(worker, /async function persistCombinedCoverage/);
  assert.match(worker, /load_combined_snapshot_rows/);
  assert.match(worker, /load_combined_mappings/);
  assert.match(worker, /equal_priority_conflict/);
  assert.match(worker, /priority/);
  assert.match(worker, /persist_combined_coverage/);
  const preview = admin.slice(admin.indexOf('async function previewEpgResolution'), admin.indexOf('async function readPersistedEpgMappingAudit'));
  assert.doesNotMatch(preview, /loadProvider|decryptXtream|fetchLiveChannelsForEpgMapping|managed_provider_epg_source_mappings/);
  assert.match(preview, /managed_provider_epg_combined_coverage/);
  assert.match(preview, /refreshRequired: true/);
});

test('combined readiness uses cached programme windows and preserves deterministic conflicts', () => {
  for (const expression of ['Date.parse(programme.start_at)', 'start <= NOW && stop > NOW', 'start > NOW', 'sameTargetOverlap', 'different_target_conflict', 'us_combined_mapping_percent', 'managed_guide_delivery_ready']) assert.ok(worker.includes(expression), expression);
  assert.match(worker, /programmeCoverageBySource/);
  assert.match(worker, /load_combined_programmes/);
  assert.match(worker, /mapping_ready/);
  assert.match(worker, /programme_coverage_ready/);
  assert.match(worker, /conflict_risk_acceptable/);
  assert.doesNotMatch(worker, /fetchXmltv.*combined/i);
});

test('combined readiness enforces the documented US coverage floors', () => {
  const base = { usRelevantRows: 100, usCombinedResolved: 65, usCurrentProgrammePercent: 60, usFutureProgrammePercent: 60, unresolvedConflicts: 0 };
  assert.deepEqual(assessGuideReadiness(base), {
    mappingReady: true,
    programmeCoverageReady: true,
    conflictRiskAcceptable: true,
    managedGuideDeliveryReady: true,
    readinessReasons: ['us_denominator_available', 'us_mapping_meets_65_percent_floor', 'current_programmes_meet_60_percent_floor', 'future_programmes_meet_60_percent_floor', 'no_unresolved_conflicts'],
  });
  assert.equal(assessGuideReadiness({ ...base, usCombinedResolved: 64 }).mappingReady, false);
  assert.equal(assessGuideReadiness({ ...base, usCurrentProgrammePercent: 59.99 }).programmeCoverageReady, false);
  assert.equal(assessGuideReadiness({ ...base, usFutureProgrammePercent: 59.99 }).programmeCoverageReady, false);
  assert.equal(assessGuideReadiness({ ...base, unresolvedConflicts: 1 }).conflictRiskAcceptable, false);
  assert.equal(assessGuideReadiness({ ...base, usRelevantRows: 0 }).managedGuideDeliveryReady, false);
});

test('targeted worker runs enqueue and process only the exact provider/source pair', () => {
  assert.match(worker, /const targetedRun = Boolean\(providerId && sourceId\)/);
  assert.match(worker, /if \(targetedRun\) \{\s*const targetRequest = await prepareTargetedRefresh\(providerId, sourceId\);/s);
  assert.match(worker, /if \(targetedRun\) \{\s*if \(failed\) process\.exitCode = 1;\s*return;/s);
  const main = worker.slice(worker.indexOf('async function main()'), worker.indexOf('export {'));
  assert.match(main, /sourceId && `source_id=eq\.\$\{encodeURIComponent\(sourceId\)\}`/);
  assert.match(main, /\} else if \(!providerId && !sourceId\) \{/);
});

test('targeted fresh running request is not duplicated or reclaimed', async () => {
  const seen = [];
  const jobId = '44444444-4444-4444-8444-444444444444';
  const server = await serverFor((request, response) => {
    seen.push({ method: request.method, url: request.url });
    if (request.method === 'POST' && request.url.includes('managed_provider_epg_refresh_requests')) {
      response.writeHead(409, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ code: '23505', message: 'duplicate key value violates unique constraint managed_provider_epg_refresh_requests_one_active_idx' }));
      return;
    }
    if (request.url.includes('select=id,status,refresh_job_id')) {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify([{ id: requestUuid, status: 'running', refresh_job_id: jobId }]));
      return;
    }
    if (request.url.includes(`managed_provider_epg_refresh_jobs?id=eq.${jobId}`)) {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify([{ id: jobId, source_id: sourceUuid, generation: null, status: 'processing', updated_at: new Date().toISOString() }]));
      return;
    }
    if (request.url.includes('managed_provider_epg_refresh_jobs?source_id=eq.')) {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify([{ id: jobId, source_id: sourceUuid, generation: null, status: 'processing', updated_at: new Date().toISOString() }]));
      return;
    }
    if (request.url.includes(`refresh_job_id=eq.${jobId}`)) {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify([{ id: requestUuid }]));
      return;
    }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end('[]');
  });
  const result = await runWorker(server.address().port, 'test-service-role-key', [providerUuid, sourceUuid]);
  server.close();
  assert.equal(result.code, 0);
  assert.match(result.stdout, /Target EPG refresh is already active\./);
  assert.equal(seen.filter((entry) => entry.url.includes('status=eq.pending')).length, 0);
  assert.equal(seen.filter((entry) => entry.method === 'PATCH').length, 0);
});

test('targeted running request with a missing job is failed and re-enqueued for the exact target', async () => {
  const seen = [];
  const server = await serverFor((request, response) => {
    seen.push({ method: request.method, url: request.url });
    if (request.method === 'POST' && request.url.includes('managed_provider_epg_refresh_requests')) {
      const posts = seen.filter((entry) => entry.method === 'POST' && entry.url.includes('managed_provider_epg_refresh_requests')).length;
      response.writeHead(posts === 1 ? 409 : 201, { 'content-type': 'application/json' });
      response.end(posts === 1 ? JSON.stringify({ code: '23505', message: 'duplicate key value violates unique constraint managed_provider_epg_refresh_requests_one_active_idx' }) : JSON.stringify([{ id: requestUuid }]));
      return;
    }
    if (request.url.includes('select=id,status,refresh_job_id')) {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify([{ id: requestUuid, status: 'running', refresh_job_id: null }]));
      return;
    }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end('[]');
  });
  const result = await runWorker(server.address().port, 'test-service-role-key', [providerUuid, sourceUuid]);
  server.close();
  assert.equal(result.code, 0);
  assert.equal(seen.filter((entry) => entry.method === 'PATCH' && entry.url.includes(`id=eq.${requestUuid}`)).length, 1);
  assert.equal(seen.filter((entry) => entry.method === 'POST' && entry.url.includes('managed_provider_epg_refresh_requests')).length, 2);
  assert.equal(seen.filter((entry) => entry.url.includes('status=eq.pending')).length, 1);
});

test('targeted stale running request is reclaimed and replaced without touching another source', async () => {
  const seen = [];
  const jobId = '44444444-4444-4444-8444-444444444444';
  const staleJob = { id: jobId, source_id: sourceUuid, generation: null, status: 'processing', updated_at: '2026-09-07T00:00:00.000Z' };
  const server = await serverFor((request, response) => {
    seen.push({ method: request.method, url: request.url });
    if (request.method === 'POST' && request.url.includes('managed_provider_epg_refresh_requests')) {
      const posts = seen.filter((entry) => entry.method === 'POST' && entry.url.includes('managed_provider_epg_refresh_requests')).length;
      response.writeHead(posts === 1 ? 409 : 201, { 'content-type': 'application/json' });
      response.end(posts === 1 ? JSON.stringify({ code: '23505', message: 'duplicate key value violates unique constraint managed_provider_epg_refresh_requests_one_active_idx' }) : JSON.stringify([{ id: requestUuid }]));
      return;
    }
    if (request.url.includes('select=id,status,refresh_job_id')) {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify([{ id: requestUuid, status: 'running', refresh_job_id: jobId }]));
      return;
    }
    if (request.url.includes(`managed_provider_epg_refresh_jobs?id=eq.${jobId}`) || request.url.includes('managed_provider_epg_refresh_jobs?source_id=eq.')) {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify([staleJob]));
      return;
    }
    if (request.url.includes(`refresh_job_id=eq.${jobId}`)) {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify([{ id: requestUuid }]));
      return;
    }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end('[]');
  });
  const result = await runWorker(server.address().port, 'test-service-role-key', [providerUuid, sourceUuid]);
  server.close();
  assert.equal(result.code, 0);
  assert.match(result.stdout, /Active EPG refresh request already exists; reusing it\./);
  assert.equal(seen.filter((entry) => entry.method === 'POST' && entry.url.includes('managed_provider_epg_refresh_requests')).length, 2);
  assert.ok(seen.some((entry) => entry.method === 'PATCH' && entry.url.includes(`managed_provider_epg_refresh_jobs?id=eq.${jobId}`)));
  assert.ok(seen.some((entry) => entry.method === 'PATCH' && entry.url.includes(`managed_provider_epg_refresh_requests?id=eq.${requestUuid}`)));
  assert.equal(seen.filter((entry) => entry.url.includes('managed_provider_epg_refresh_jobs?source_id=eq.')).length, 1);
  assert.equal(seen.filter((entry) => entry.url.includes('status=eq.pending')).length, 1);
});

test('refresh-request recovery patches use only columns present in the request schema', () => {
  const requestPatchLines = worker.split('\n').filter((line) => line.includes("patch('managed_provider_epg_refresh_requests'"));
  assert.ok(requestPatchLines.length > 0);
  for (const line of requestPatchLines) assert.doesNotMatch(line, /updated_at/);
  assert.match(worker, /fail_stale_refresh_request/);
  assert.match(worker, /fail_broken_target_refresh_request/);
  assert.match(worker, /managed_provider_epg_refresh_jobs.*updated_at/);
});

test('provider catalog acquisition reuses only complete, bounded-age snapshots', () => {
  const now = Date.parse('2026-09-07T12:00:00.000Z');
  const recent = { capturedAt: '2026-09-07T11:45:00.000Z', expectedRows: 57189, storedRows: 57189, complete: true };
  assert.equal(snapshotWithinAge(recent, 30 * 60 * 1000, now), true);
  assert.equal(snapshotWithinAge({ ...recent, storedRows: 57188 }, 30 * 60 * 1000, now), false);
  assert.equal(snapshotWithinAge({ ...recent, complete: false }, 30 * 60 * 1000, now), false);
  assert.equal(snapshotWithinAge({ ...recent, capturedAt: '2026-09-06T11:00:00.000Z' }, 24 * 60 * 60 * 1000, now), false);
});

test('provider catalog refresh uses fresh snapshot reuse and reachability-only fallback', () => {
  assert.match(worker, /FRESH_PROVIDER_CATALOG_SNAPSHOT_MS = 30 \* 60 \* 1000/);
  assert.match(worker, /MAX_PROVIDER_CATALOG_FALLBACK_AGE_MS = 24 \* 60 \* 60 \* 1000/);
  assert.match(worker, /async function loadCompleteProviderCatalogSnapshot/);
  assert.match(worker, /snapshot_complete=eq\.true/);
  assert.match(worker, /snapshotWithinAge/);
  assert.match(worker, /async function acquireProviderCatalog/);
  assert.match(worker, /providerCatalogSource=snapshot/);
  assert.match(worker, /providerCatalogSource=fallback/);
  assert.match(worker, /error\.safeMessage !== 'provider_unreachable'/);
  const process = worker.slice(worker.indexOf('async function processRequest'), worker.indexOf('async function enqueueScheduledRefresh'));
  assert.match(process, /acquireProviderCatalog\(providerId, provider\)/);
  assert.doesNotMatch(process, /persistProviderCatalogSnapshot\(providerId, live\.items\)/);
});

test('programme persistence is bounded to final mapped XMLTV targets without changing coverage inputs', () => {
  const programmes = [
    { channelId: 'mapped-1', startAt: '2026-09-08T12:00:00.000Z' },
    { channelId: 'mapped-1', startAt: '2026-09-08T13:00:00.000Z' },
    { channelId: 'unmapped', startAt: '2026-09-08T14:00:00.000Z' },
  ];
  const mappings = [{ xmltv_channel_id: ' mapped-1 ' }, { xmltv_channel_id: 'mapped-1' }];
  const result = retainMappedProgrammes(programmes, mappings);
  assert.equal(result.retentionIds.size, 1);
  assert.equal(result.retained.length, 2);
  assert.equal(result.dropped, 1);
  assert.equal(normalizeXmltvChannelId(' mapped-1 '), 'mapped-1');
  assert.deepEqual(result.retained.map((programme) => programme.channelId), ['mapped-1', 'mapped-1']);
});

test('EPG parsing and mapping still see the complete XMLTV channel universe before programme retention', () => {
  assert.match(worker, /const xmltvIds = new Set\(channels\.map\(\(channel\) => channel\.id\)\)/);
  assert.match(worker, /const audit = buildMappingAudit\(providerId, sourceId, live\.items, channels/);
  assert.match(worker, /retainMappedProgrammes\(programmes, mappingsResult\)/);
  assert.match(worker, /programmeRowsPersisted=/);
  assert.match(worker, /programmeRowsDroppedUnmapped=/);
  assert.match(worker, /insertBatches\('managed_provider_epg_source_programmes', programmeRetention\.retained\.map/);
  assert.doesNotMatch(worker, /programmes\.filter\(.*xmltv/);
});

test('worker reclaims stale active jobs without deleting the active cache and handles races safely', () => {
  assert.match(worker, /STALE_REFRESH_JOB_MS = 30 \* 60 \* 1000/);
  assert.match(worker, /ACTIVE_REFRESH_JOB_STATUSES = \['queued', 'fetching', 'processing', 'finalizing'\]/);
  assert.match(worker, /loadActiveRefreshJob/);
  assert.match(worker, /loadRunningRefreshJobOwner/);
  assert.match(worker, /refresh_job_id=eq\.\$\{encodeURIComponent\(safeJobId\)\}&status=eq\.running/);
  assert.match(worker, /failure_code: ownerRequestId \? 'stale_refresh_job' : 'orphaned_refresh_job'/);
  assert.match(worker, /reclaim_orphaned_refresh_job/);
  assert.match(worker, /failure_code: 'stale_refresh_job'/);
  assert.match(worker, /reclaim_stale_refresh_job/);
  assert.match(worker, /cleanupStagedGeneration/);
  assert.match(worker, /generation === activeCacheGeneration/);
  assert.match(worker, /error\.code !== '23505'/);
  assert.match(worker, /active_job_exists/);
  assert.match(worker, /defer_active_refresh_request/);
  assert.match(worker, /status: 'pending', started_at: null/);
  assert.doesNotMatch(worker, /status: 'complete', failure_code: 'active_job_exists'/);
  assert.match(jobsMigration, /status in \('queued', 'fetching', 'processing', 'finalizing'\)/);
});

test('worker reports safe non-database stages and validates credentials without exposing secrets', () => {
  for (const stage of ['load_source', 'load_provider', 'decrypt_provider_credentials', 'parse_provider_credentials', 'fetch_provider_live_channels', 'decrypt_epg_url', 'validate_epg_url', 'fetch_epg_feed', 'gunzip_epg_feed', 'parse_epg_feed', 'build_mappings', 'persist_cache', 'promote_generation']) assert.match(worker, new RegExp(`['"]${stage}['"]`));
  assert.match(worker, /class WorkerStageFailure/);
  assert.match(worker, /stage: error\.stage/);
  assert.match(worker, /invalid_encryption_key_length/);
  assert.match(worker, /typeof parsed\.baseUrl !== 'string'/);
  assert.match(worker, /typeof parsed\.username !== 'string'/);
  assert.match(worker, /typeof parsed\.password !== 'string'/);
  assert.match(worker, /decrypt_provider_credentials/);
  assert.match(worker, /decrypt_epg_url/);
  assert.match(worker, /safeStageMessage/);
  assert.doesNotMatch(worker, /EPG worker failed: \$\{error instanceof Error \? error\.message/);
});

function runWorker(port, secret = 'super-secret-provider-token', args = []) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['./scripts/epg-ingest/index.mjs', ...args], {
      cwd: process.cwd(),
      env: { ...process.env, EPG_INGEST_TEST_IMPORT: undefined, SUPABASE_URL: `http://127.0.0.1:${port}`, SUPABASE_SERVICE_ROLE_KEY: secret, PROVIDER_ENCRYPTION_KEY: '00'.repeat(32) },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (code) => resolve({ code, stdout, stderr, secret }));
  });
}

const providerUuid = '11111111-1111-4111-8111-111111111111';
const sourceUuid = '22222222-2222-4222-8222-222222222222';
const requestUuid = '33333333-3333-4333-8333-333333333333';

test('HTTP 201 representation returns a valid enqueued request UUID and omits empty filters', async () => {
  const seen = [];
  const server = await serverFor((request, response) => {
    seen.push({ method: request.method, url: request.url, headers: request.headers });
    if (request.url.includes('managed_provider_epg_sources')) {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify([{ id: sourceUuid, managed_provider_id: providerUuid }]));
      return;
    }
    if (request.method === 'POST' && request.url.includes('managed_provider_epg_refresh_requests')) {
      response.writeHead(201, { 'content-type': 'application/json' });
      response.end(JSON.stringify([{ id: requestUuid }]));
      return;
    }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end('[]');
  });
  const result = await runWorker(server.address().port);
  server.close();
  const enqueue = seen.find((entry) => entry.method === 'POST' && entry.url.includes('managed_provider_epg_refresh_requests'));
  const pending = seen.find((entry) => entry.url.includes('managed_provider_epg_refresh_requests?select='));
  assert.equal(result.code, 0);
  assert.ok(enqueue);
  assert.match(enqueue.headers.prefer, /return=representation/);
  assert.ok(pending);
  assert.doesNotMatch(pending.url, /managed_provider_id=eq\.|source_id=eq\./);
  assert.doesNotMatch(enqueue.url, /null|undefined/i);
});

test('duplicate active-request enqueue is benign and reuses the existing pending request', async () => {
  const seen = [];
  const server = await serverFor((request, response) => {
    seen.push({ method: request.method, url: request.url });
    if (request.url.includes('managed_provider_epg_sources')) {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify([{ id: sourceUuid, managed_provider_id: providerUuid }]));
      return;
    }
    if (request.method === 'POST' && request.url.includes('managed_provider_epg_refresh_requests')) {
      response.writeHead(409, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ code: '23505', message: 'duplicate key value violates unique constraint managed_provider_epg_refresh_requests_one_active_idx' }));
      return;
    }
    if (request.url.includes('select=id,status')) {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify([{ id: requestUuid, status: 'pending' }]));
      return;
    }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end('[]');
  });
  const result = await runWorker(server.address().port);
  server.close();
  assert.equal(result.code, 0);
  assert.match(result.stdout, /Active EPG refresh request already exists; reusing it\./);
  assert.equal(result.stderr, '');
  assert.ok(seen.some((entry) => entry.method === 'POST' && entry.url.includes('managed_provider_epg_refresh_requests')));
  assert.ok(seen.some((entry) => entry.url.includes('select=id,status')));
});

test('scheduled enqueue only treats the named active-request uniqueness conflict as benign', () => {
  assert.match(worker, /error\.httpStatus === 409/);
  assert.match(worker, /error\.code === '23505'/);
  assert.match(worker, /managed_provider_epg_refresh_requests_one_active_idx/);
  assert.match(worker, /load_existing_refresh_request/);
  assert.match(worker, /Active EPG refresh request already exists; reusing it/);
  assert.match(worker, /if \(!expectedActiveConflict\) throw error/);
});

test('HTTP 201 with an empty body fails when the inserted request UUID is required', async () => {
  const server = await serverFor((request, response) => {
    if (request.url.includes('managed_provider_epg_sources')) {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify([{ id: sourceUuid, managed_provider_id: providerUuid }]));
      return;
    }
    if (request.method === 'POST' && request.url.includes('managed_provider_epg_refresh_requests')) {
      response.writeHead(201);
      response.end();
      return;
    }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end('[]');
  });
  const result = await runWorker(server.address().port);
  server.close();
  assert.equal(result.code, 1);
  assert.match(result.stderr, /"operation":"enqueue_scheduled_refresh"/);
  assert.match(result.stderr, /missing_or_invalid_request_id/);
  assert.doesNotMatch(result.stderr, /undefined|"null"/);
});

test('invalid source IDs stop before enqueueing a database request', async () => {
  const seen = [];
  const server = await serverFor((request, response) => {
    seen.push({ method: request.method, url: request.url });
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(request.url.includes('managed_provider_epg_sources') ? JSON.stringify([{ id: null, managed_provider_id: providerUuid }]) : '[]');
  });
  const result = await runWorker(server.address().port);
  server.close();
  assert.equal(result.code, 1);
  assert.equal(seen.filter((entry) => entry.method === 'POST').length, 0);
  assert.match(result.stderr, /missing_or_invalid_source_id/);
  assert.doesNotMatch(result.stderr, /"null"|undefined/);
});

function serverFor(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

test('database failures log safe operation detail and exit non-zero', async () => {
  const server = await serverFor((_request, response) => {
    response.writeHead(500, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ code: '42P01', message: 'table missing https://user:password@example.test/feed.xml', details: 'password=secret-value', hint: 'check authorization' }));
  });
  const port = server.address().port;
  const result = await runWorker(port);
  server.close();
  assert.equal(result.code, 1);
  assert.match(result.stderr, /"operation":"load_sources"/);
  assert.match(result.stderr, /"httpStatus":500/);
  assert.match(result.stderr, /"code":"42P01"/);
  assert.match(result.stderr, /redacted/);
  assert.doesNotMatch(result.stderr, /super-secret-provider-token|secret-value|user:password/);
});

test('no pending requests exits zero with a safe no-work message', async () => {
  const server = await serverFor((request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(request.url.includes('managed_provider_epg_sources') ? '[]' : '[]');
  });
  const port = server.address().port;
  const result = await runWorker(port);
  server.close();
  assert.equal(result.code, 0);
  assert.match(result.stdout, /No pending EPG refresh requests\./);
  assert.equal(result.stderr, '');
});
