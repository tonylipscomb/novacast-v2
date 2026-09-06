import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const worker = fs.readFileSync(new URL('./epg-ingest/index.mjs', import.meta.url), 'utf8');
const workflow = fs.readFileSync(new URL('../.github/workflows/epg-refresh.yml', import.meta.url), 'utf8');
const admin = fs.readFileSync(new URL('../supabase/functions/admin-providers/index.ts', import.meta.url), 'utf8');
const migration = fs.readFileSync(new URL('../supabase/migrations/20260906043251_managed_provider_epg_refresh_requests.sql', import.meta.url), 'utf8');

test('worker uses server-only secrets and streams XMLTV outside Edge', () => {
  assert.match(worker, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(worker, /PROVIDER_ENCRYPTION_KEY/);
  assert.match(worker, /createGunzip/);
  assert.match(worker, /Readable\.fromWeb/);
  assert.match(worker, /stream\.on\('data'/);
  assert.doesNotMatch(worker, /console\.log\(.*url|console\.log\(.*password|console\.log\(.*username/s);
  assert.doesNotMatch(worker, /process\.stdout\.write\(.*url|process\.stderr\.write\(.*url/s);
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
