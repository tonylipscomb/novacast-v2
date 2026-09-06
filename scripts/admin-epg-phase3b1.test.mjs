import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const admin = fs.readFileSync(new URL('../supabase/functions/admin-providers/index.ts', import.meta.url), 'utf8');
const migration = fs.readFileSync(new URL('../supabase/migrations/20260906090000_managed_provider_epg_refresh_jobs.sql', import.meta.url), 'utf8');
const ui = fs.readFileSync(new URL('../pairing-web/src/AdminProviders.tsx', import.meta.url), 'utf8');

test('refreshes are resumable jobs with private, source-qualified artifacts', () => {
  assert.match(migration, /create table public\.managed_provider_epg_refresh_jobs/);
  assert.match(migration, /checkpoint jsonb/);
  assert.match(migration, /artifact_path text/);
  assert.match(migration, /public = false/);
  assert.match(migration, /one_active_idx/);
  assert.match(admin, /const EPG_REFRESH_PROGRAMME_CHUNK_SIZE = 5_000/);
  assert.match(admin, /epg-refresh-artifacts/);
  assert.match(admin, /startEpgRefresh/);
  assert.match(admin, /continueEpgRefresh/);
});

test('one continuation handles one programme chunk and checkpoints it idempotently', () => {
  assert.match(admin, /if \(nextChunk < chunkCount\)/);
  assert.match(admin, /nextProgrammeChunk = nextChunk \+ 1/);
  assert.match(admin, /upsert\(rows\.slice\(offset, offset \+ 1_000\), \{ onConflict: 'source_id,cache_generation,xmltv_channel_id,start_at,stop_at,title', ignoreDuplicates: true \}\)/);
  assert.match(admin, /await updateRefreshJob\(client, job, checkpoint/);
  assert.match(admin, /active_cache_generation: job\.generation/);
  assert.match(admin, /status: 'complete'/);
});

test('admin exposes job status while refresh work is delegated to the worker', () => {
  for (const action of ['start_epg_refresh', 'get_epg_refresh_status', 'continue_epg_refresh']) assert.match(admin, new RegExp(`action === '${action}'`));
  const publicJob = admin.slice(admin.indexOf('function publicRefreshJob'), admin.indexOf('async function getRefreshJob'));
  assert.doesNotMatch(publicJob, /checkpoint|artifact_path|generation/);
  assert.match(admin, /enqueueEpgRefresh\(client, source\)/);
  assert.match(ui, /start_epg_refresh/);
  assert.match(ui, /EPG source refresh queued for the ingestion worker/);
});

test('failed jobs clean staged generation and private artifacts without changing active generation', () => {
  assert.match(admin, /markRefreshJobFailed/);
  assert.match(admin, /deleteCacheGeneration\(client, job\.source_id, job\.generation\)/);
  assert.match(admin, /removeRefreshArtifacts\(client, job\)/);
  assert.match(admin, /active_cache_generation: job\.generation/);
});
