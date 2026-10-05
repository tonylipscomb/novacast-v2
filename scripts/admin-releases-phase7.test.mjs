import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('..', import.meta.url);
const read = (path) => fs.readFileSync(new URL(path, root), 'utf8');

test('release catalog seeds only the explicit approved production release', () => {
  const migration = read('supabase/migrations/20261006120000_novacast_release_catalog.sql');
  assert.match(migration, /create table if not exists public\.novacast_releases/);
  assert.match(migration, /'1\.0\.5', 25, 'production', 'active'/);
  assert.match(migration, /68921d90f725ec9555ac508255b0f092115ccaae/);
  assert.doesNotMatch(migration, /dev14|beta81/);
});

test('admin release projection is authenticated, bounded, and explicit about production', () => {
  const source = read('supabase/functions/admin-releases/index.ts');
  assert.match(source, /requireAdmin/);
  assert.match(source, /eq\('channel', 'production'\)/);
  assert.match(source, /limit\(5000\)/);
  assert.match(source, /bounded: true/);
  assert.doesNotMatch(source, /SUPABASE_SERVICE_ROLE_KEY|KEYSTORE_PASSWORD|privateKey|keystore/);
});

test('release admin route and dashboard integration exist', () => {
  const nav = read('pairing-web/src/adminNavigation.ts');
  const cloud = read('pairing-web/src/AdminCloud.tsx');
  const dashboard = read('pairing-web/src/AdminDashboard.tsx');
  assert.match(nav, /releases: '\/admin\/releases'/);
  assert.match(cloud, /AdminReleases/);
  assert.match(dashboard, /CURRENT PRODUCTION/);
});
