import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const admin = fs.readFileSync(new URL('../supabase/functions/admin-providers/index.ts', import.meta.url), 'utf8');
const adminAuth = fs.readFileSync(new URL('../supabase/functions/_shared/admin.ts', import.meta.url), 'utf8');
const adminSupabase = fs.readFileSync(new URL('../supabase/functions/_shared/supabase.ts', import.meta.url), 'utf8');
const xmltv = fs.readFileSync(new URL('../supabase/functions/_shared/xmltvEpg.ts', import.meta.url), 'utf8');
const migration = fs.readFileSync(new URL('../supabase/migrations/20260905230000_managed_provider_epg_source_cache.sql', import.meta.url), 'utf8');
const requestMigration = fs.readFileSync(new URL('../supabase/migrations/20260906043251_managed_provider_epg_refresh_requests.sql', import.meta.url), 'utf8');
const snapshotMigration = fs.readFileSync(new URL('../supabase/migrations/20260906064952_managed_provider_epg_catalog_snapshot.sql', import.meta.url), 'utf8');
const worker = fs.readFileSync(new URL('./epg-ingest/index.mjs', import.meta.url), 'utf8');
const ui = fs.readFileSync(new URL('../pairing-web/src/AdminProviders.tsx', import.meta.url), 'utf8');

test('cache is source-qualified and stores normalized bounded records only', () => {
  for (const table of ['managed_provider_epg_source_channels', 'managed_provider_epg_source_programmes', 'managed_provider_epg_source_mappings']) assert.match(migration, new RegExp(`create table public\\.${table}`));
  assert.match(migration, /cache_generation uuid not null/);
  assert.match(migration, /start_at timestamptz not null/);
  assert.match(migration, /stop_at timestamptz not null/);
  assert.match(migration, /title text not null/);
  assert.doesNotMatch(migration, /xmltv_blob|raw_xml|document text/);
  assert.match(xmltv, /MAX_XMLTV_TAG_CARRY_BYTES/);
  assert.match(xmltv, /programmes\.push/);
});

test('refresh stages a generation and promotes it only during finalization', () => {
  assert.match(admin, /const generation = crypto\.randomUUID\(\)/);
  assert.match(admin, /await uploadRefreshArtifact\(client, channelsPath, channels\)/);
  assert.match(admin, /await uploadRefreshArtifact\(client, mappingsPath/);
  assert.match(admin, /await insertBatches\(client, 'managed_provider_epg_source_channels'/);
  assert.match(admin, /await upsertProgrammeBatches\(client/);
  assert.match(admin, /active_cache_generation: job\.generation/);
  assert.match(admin, /if \(!checkpoint\.mappingsProcessed\)/);
  assert.match(admin, /status: 'complete'/);
  assert.match(admin, /result\.status !== 'success'/);
});

test('source testing is diagnostic-only while source refresh explicitly enables cache mode', () => {
  assert.match(admin, /action === 'start_epg_refresh' \|\| action === 'refresh_epg_source'/);
  assert.match(admin, /await enqueueEpgRefresh\(client, source\)/);
  assert.match(admin, /action === 'continue_epg_refresh'/);
  assert.match(admin, /runEpgSourceTest\(client, source, 'diagnostic'\)/);
  assert.match(admin, /testXmltvFeed\(\{ url, liveChannels, mode, sink \}\)/);
  assert.match(xmltv, /mode\?: 'diagnostic' \| 'cache'/);
  assert.match(xmltv, /const retainCache = input\.mode === 'cache'/);
  assert.match(xmltv, /retainProvenance: retainCache/);
  assert.match(xmltv, /\.\.\.\(retainCache \? \{ mappingRecords/);
  assert.match(xmltv, /if \(state\.retainProgrammes\) state\.programmes\.push/);
  assert.match(admin, /publicEpgResult\(result as unknown as Record<string, unknown>\)/);
});

test('admin refresh queue uses the privileged client and safely diagnoses active-request lookup failures', () => {
  assert.match(admin, /const \{ client \} = await requireAdmin\(request\)/);
  assert.match(adminAuth, /getAdminClient\(\)/);
  assert.match(adminSupabase, /createClient\(url, serviceRoleKey/);
  assert.match(admin, /managed_provider_epg_refresh_requests'\)\.select\('id,status'\)/);
  assert.match(admin, /\.limit\(1\)\.maybeSingle\(\)/);
  assert.match(admin, /class AdminRefreshRequestLookupFailure/);
  assert.match(admin, /class AdminRefreshRequestInsertFailure/);
  assert.match(admin, /errorCategory = 'admin_refresh_job_failed'/);
  assert.match(admin, /isAdminRefreshRequestDiagnostic/);
  assert.match(admin, /super\('lookup_active_refresh_request'/);
  for (const field of ['code', 'message', 'details', 'hint']) assert.match(admin, new RegExp(`${field}: error\\.${field}`));
  assert.match(admin, /const category = isAdminRefreshRequestDiagnostic\(error\) \? error\.errorCategory : mapError\(error\)/);
  assert.match(admin, /const diagnostic = isAdminRefreshRequestDiagnostic\(error\) \? \{ diagnostic: error\.diagnostic \} : \{\}/);
  assert.match(admin, /filter\(\(\[, value\]\) => value !== null\)/);
  assert.match(admin, /if \(active\) throw new Error\('refresh_in_progress'\)/);
  assert.match(admin, /super\('insert_refresh_request'/);
  assert.match(admin, /requestError\?\.code === '23505'/);
  assert.match(admin, /invalid_refresh_request_identity/);
  assert.match(admin, /if \(!UUID_PATTERN\.test\(source\.id\) \|\| !UUID_PATTERN\.test\(source\.managed_provider_id\)\)/);
  assert.match(admin, /return \{ requestId: request\.id, sourceId: source\.id, status: 'pending', requestedAt: now \}/);
  assert.doesNotMatch(admin.slice(admin.indexOf('async function enqueueEpgRefresh'), admin.indexOf('async function startEpgRefresh')), /managed_provider_epg_refresh_jobs.*insert|refresh_job_id/);
  assert.match(worker, /async function ensureRefreshJob/);
  assert.match(worker, /managed_provider_epg_refresh_jobs', \{ method: 'POST'/);
  assert.match(worker, /patch\('managed_provider_epg_refresh_requests', requestId, \{ refresh_job_id: jobId \}/);
  const refreshBranch = admin.slice(admin.indexOf("if (action === 'start_epg_refresh'"), admin.indexOf("if (action === 'get_epg_refresh_status'"));
  assert.doesNotMatch(refreshBranch, /runEpgSourceTest|testXmltvFeed|continueEpgRefresh/);
  assert.match(requestMigration, /revoke all on table public\.managed_provider_epg_refresh_requests from anon, authenticated/);
});

test('mapping provenance and preview use deterministic winning-source rules', () => {
  assert.match(xmltv, /matchConfidenceClass: 'proven' \| 'ambiguous' \| 'unmatched'/);
  for (const kind of ['direct_id', 'case_insensitive_id', 'exact_name', 'normalized_name', 'canonical', 'alias', 'local_affiliate']) assert.match(migration, new RegExp(kind));
  assert.match(admin, /action === 'preview_epg_resolution'/);
  assert.match(admin, /order\('priority', \{ ascending: true \}\)/);
  assert.match(admin, /const winner = candidates\[0\]/);
  assert.match(admin, /duplicateCandidateConflicts/);
});

test('provider catalog snapshot is bounded, provider-scoped, generation-safe, and audit-only', () => {
  assert.match(snapshotMigration, /create table public\.managed_provider_epg_catalog_snapshot/);
  for (const field of ['managed_provider_id', 'provider_stream_id', 'channel_name', 'epg_channel_id', 'category_id', 'category_name', 'canonical_name', 'captured_at', 'snapshot_generation', 'is_active']) assert.match(snapshotMigration, new RegExp(field));
  assert.match(snapshotMigration, /managed_provider_epg_catalog_snapshot_identity_idx/);
  assert.match(snapshotMigration, /enable row level security/);
  assert.match(snapshotMigration, /revoke all on table public\.managed_provider_epg_catalog_snapshot from anon, authenticated/);
  assert.doesNotMatch(worker, /snapshot.*url|snapshot.*password|snapshot.*username|snapshot.*token/i);
  assert.match(worker, /async function persistProviderCatalogSnapshot/);
  assert.match(worker, /insert_catalog_snapshot/);
  assert.match(worker, /promote_catalog_snapshot/);
  assert.match(worker, /cleanup_previous_catalog_snapshot/);
  assert.match(worker, /EPG provider catalog snapshot unavailable/);
  assert.match(admin, /action === 'preview_epg_mapping_audit'/);
  const audit = admin.slice(admin.indexOf('async function previewEpgMappingAudit'), admin.indexOf('async function loadPublicProviders'));
  assert.match(audit, /managed_provider_epg_catalog_snapshot/);
  assert.match(audit, /managed_provider_epg_source_channels/);
  assert.match(audit, /managed_provider_epg_source_mappings/);
  assert.doesNotMatch(audit, /fetch\(|decrypt|credentials|url_ciphertext|url_iv/);
  assert.match(ui, /Mapping Audit/);
});

test('admin preview is compact and does not expose cached programme payloads or secrets', () => {
  assert.match(ui, /Preview Combined Coverage/);
  assert.match(ui, /resolvedBySource/);
  assert.match(ui, /resolvedByMatchType/);
  assert.doesNotMatch(ui, /sourceForm\.url\s*=\s*source\./);
  const preview = admin.slice(admin.indexOf('async function previewEpgResolution'), admin.indexOf('async function loadPublicProviders'));
  assert.doesNotMatch(preview, /programme|title|url_ciphertext|url_iv|password|username/);
});

test('source deletion is cascade-safe and public access is revoked', () => {
  assert.match(migration, /on delete cascade/);
  assert.match(migration, /alter table public\.managed_provider_epg_source_(channels|programmes|mappings) enable row level security/g);
  assert.match(migration, /revoke all on table public\.managed_provider_epg_source_channels from anon, authenticated/);
  assert.match(admin, /action === 'delete_epg_source'/);
});
