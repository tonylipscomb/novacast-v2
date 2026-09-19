import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const helper = fs.readFileSync(new URL('../supabase/functions/_shared/autoProvisionProviderEpg.ts', import.meta.url), 'utf8');
const adminProviders = fs.readFileSync(new URL('../supabase/functions/admin-providers/index.ts', import.meta.url), 'utf8');
const goldPanel = fs.readFileSync(new URL('../supabase/functions/admin-gold-panel/index.ts', import.meta.url), 'utf8');
const worker = fs.readFileSync(new URL('./epg-ingest/index.mjs', import.meta.url), 'utf8');

test('Xtream XMLTV derivation preserves scheme, host, port, and credentials only in query', () => {
  assert.match(helper, /new URL\(baseUrl\)/);
  assert.match(helper, /url\.pathname = `\$\{basePath\}\/xmltv\.php`/);
  assert.match(helper, /url\.searchParams\.set\('username', username\)/);
  assert.match(helper, /url\.searchParams\.set\('password', password\)/);
  assert.match(helper, /url\.username = ''/);
  assert.match(helper, /url\.password = ''/);
});

test('auto provisioning tests XMLTV before creating an encrypted source', () => {
  assert.match(helper, /testXmltvFeed\(\{ url: xmltvUrl\.toString\(\), liveChannels \}\)/);
  assert.ok(helper.indexOf('const result = await testXmltvFeed') < helper.indexOf(".from('managed_provider_epg_sources').insert"));
  assert.match(helper, /if \(result\.status !== 'success'\)/);
  assert.match(helper, /encryptSecret\(xmltvUrl\.toString\(\)\)/);
});

test('auto provisioning is idempotent and never overwrites manual sources', () => {
  assert.match(helper, /source\.enabled/);
  assert.match(helper, /provisioning === AUTO_SOURCE_MARKER/);
  assert.match(helper, /manual-source-conflict/);
  assert.match(helper, /if \(enabledSource && !autoSource\(enabledSource\)\)/);
  assert.match(helper, /existingAutoSource/);
});

test('provider creation and Gold diagnostics use the worker-owned enqueue path', () => {
  assert.match(adminProviders, /autoProvisionXtreamEpg/);
  assert.match(adminProviders, /enqueueRefresh: \(source\) => enqueueEpgRefresh\(client, source\)/);
  assert.match(goldPanel, /autoProvisionXtreamEpg/);
  assert.match(goldPanel, /enqueueProviderEpgRefresh\(client, source\)/);
  assert.match(helper, /managed_provider_epg_refresh_requests/);
  assert.doesNotMatch(helper, /managed_provider_epg_refresh_jobs/);
  assert.match(worker, /managed_provider_epg_refresh_requests/);
});

test('auto provisioning runs only after successful provider validation paths', () => {
  assert.match(adminProviders, /summary\.overall === 'healthy' \|\| summary\.overall === 'degraded'/);
  assert.match(goldPanel, /health\.overall === 'healthy' \|\| health\.overall === 'degraded'/);
});

test('credential-bearing URL is never returned by the helper or public source selection', () => {
  assert.doesNotMatch(helper, /console\.(log|info|warn|error).*xmltvUrl/);
  assert.doesNotMatch(helper, /return .*xmltvUrl/);
  assert.doesNotMatch(adminProviders, /url_ciphertext.*EPG_SOURCE_SELECT/);
});
