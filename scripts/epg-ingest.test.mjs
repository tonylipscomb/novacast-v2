import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { spawn } from 'node:child_process';
import test from 'node:test';

const worker = fs.readFileSync(new URL('./epg-ingest/index.mjs', import.meta.url), 'utf8');
const workflow = fs.readFileSync(new URL('../.github/workflows/epg-refresh.yml', import.meta.url), 'utf8');
const admin = fs.readFileSync(new URL('../supabase/functions/admin-providers/index.ts', import.meta.url), 'utf8');
const migration = fs.readFileSync(new URL('../supabase/migrations/20260906043251_managed_provider_epg_refresh_requests.sql', import.meta.url), 'utf8');
const jobsMigration = fs.readFileSync(new URL('../supabase/migrations/20260906090000_managed_provider_epg_refresh_jobs.sql', import.meta.url), 'utf8');

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

test('worker reclaims stale active jobs without deleting the active cache and handles races safely', () => {
  assert.match(worker, /STALE_REFRESH_JOB_MS = 30 \* 60 \* 1000/);
  assert.match(worker, /ACTIVE_REFRESH_JOB_STATUSES = \['queued', 'fetching', 'processing', 'finalizing'\]/);
  assert.match(worker, /loadActiveRefreshJob/);
  assert.match(worker, /failure_code: 'stale_refresh_job'/);
  assert.match(worker, /reclaim_stale_refresh_job/);
  assert.match(worker, /cleanupStagedGeneration/);
  assert.match(worker, /generation === activeCacheGeneration/);
  assert.match(worker, /error\.code !== '23505'/);
  assert.match(worker, /active_job_exists/);
  assert.match(worker, /skip_active_refresh_request/);
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
      env: { ...process.env, SUPABASE_URL: `http://127.0.0.1:${port}`, SUPABASE_SERVICE_ROLE_KEY: secret, PROVIDER_ENCRYPTION_KEY: '00'.repeat(32) },
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
