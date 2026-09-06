import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const admin = fs.readFileSync(new URL('../supabase/functions/admin-providers/index.ts', import.meta.url), 'utf8');
const xmltv = fs.readFileSync(new URL('../supabase/functions/_shared/xmltvEpg.ts', import.meta.url), 'utf8');
const migration = fs.readFileSync(new URL('../supabase/migrations/20260905230000_managed_provider_epg_source_cache.sql', import.meta.url), 'utf8');
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

test('mapping provenance and preview use deterministic winning-source rules', () => {
  assert.match(xmltv, /matchConfidenceClass: 'proven' \| 'ambiguous' \| 'unmatched'/);
  for (const kind of ['direct_id', 'case_insensitive_id', 'exact_name', 'normalized_name', 'canonical', 'alias', 'local_affiliate']) assert.match(migration, new RegExp(kind));
  assert.match(admin, /action === 'preview_epg_resolution'/);
  assert.match(admin, /order\('priority', \{ ascending: true \}\)/);
  assert.match(admin, /const winner = candidates\[0\]/);
  assert.match(admin, /duplicateCandidateConflicts/);
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
