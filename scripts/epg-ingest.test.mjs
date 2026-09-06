import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { spawn } from 'node:child_process';
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

function runWorker(port, secret = 'super-secret-provider-token') {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['./scripts/epg-ingest/index.mjs'], {
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
