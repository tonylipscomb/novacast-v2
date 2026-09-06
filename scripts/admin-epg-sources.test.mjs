import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const admin = fs.readFileSync(new URL('../supabase/functions/admin-providers/index.ts', import.meta.url), 'utf8');
const ui = fs.readFileSync(new URL('../pairing-web/src/AdminProviders.tsx', import.meta.url), 'utf8');
const migration = fs.readFileSync(new URL('../supabase/migrations/20260905224113_managed_provider_epg_sources.sql', import.meta.url), 'utf8');

test('EPG source table is provider-scoped, encrypted, ordered, and private', () => {
  assert.match(migration, /managed_provider_id uuid not null references public\.managed_providers\(id\) on delete cascade/);
  assert.match(migration, /source_kind text not null check \(source_kind in \('national', 'local', 'sports', 'fallback'\)\)/);
  assert.match(migration, /url_ciphertext text not null/);
  assert.match(migration, /url_iv text not null/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /revoke all on table public\.managed_provider_epg_sources from anon, authenticated/);
  assert.match(admin, /order\('enabled', \{ ascending: false \}\).*order\('priority', \{ ascending: true \}\).*order\('created_at', \{ ascending: true \}\)/s);
});

test('EPG source actions are admin-only and use safe public projections', () => {
  for (const action of ['list_epg_sources', 'create_epg_source', 'update_epg_source', 'delete_epg_source', 'test_epg_source', 'refresh_epg_source']) {
    assert.match(admin, new RegExp(`action === '${action}'`));
  }
  assert.match(admin, /await requireAdmin\(request\)/);
  assert.match(admin, /function toPublicEpgSource\(source/);
  assert.match(admin, /urlConfigured: true/);
  assert.doesNotMatch(admin.slice(admin.indexOf('function toPublicEpgSource'), admin.indexOf('function parseEpgSourceKind')), /url_ciphertext|url_iv/);
  assert.match(admin, /safeEpgUrl\(body\?\.url\)/);
  assert.match(admin, /encryptSecret\(url\.toString\(\)\)/);
});

test('source tests and refreshes reuse the existing XMLTV feed path and preserve failed counts', () => {
  assert.match(admin, /return await testXmltvFeed\(\{ url, liveChannels, mode, sink \}\)/);
  assert.match(admin, /action === 'start_epg_refresh'/);
  assert.match(admin, /checkpoint/);
  assert.match(admin, /active_cache_generation: job\.generation/);
  assert.match(admin, /status: 'complete'/);
});

test('admin UI exposes source controls without displaying saved URLs', () => {
  for (const label of ['EPG Sources', 'Add source', 'Custom XMLTV URL', 'Test', 'Refresh', 'Delete']) assert.match(ui, new RegExp(label));
  assert.match(ui, /setSourceForm\(source \? \{ sourceKind: source\.sourceKind.*url: ''/s);
  assert.match(ui, /The URL is encrypted server-side and is never shown after saving/);
  assert.doesNotMatch(ui, /source\.url|source\.urlConfigured\s*\?\s*source\.url/);
});
