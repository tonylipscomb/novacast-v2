import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('..', import.meta.url);
const read = (path) => fs.readFileSync(new URL(path, root), 'utf8');

test('phase 6 admin functions require admin and keep sensitive pairing fields private', () => {
  const source = read('supabase/functions/admin-pairing-ops/index.ts');
  assert.match(source, /requireAdmin/);
  assert.doesNotMatch(source, /code_hash|redemption_hash|ciphertext|url_ciphertext|device_secret/);
  assert.match(source, /pageSize/);
});

test('phase 6 NovaPulse status distinguishes request-time feeds from persisted signals', () => {
  const source = read('supabase/functions/admin-novapulse-ops/index.ts');
  assert.match(source, /weather: \{ state: 'unknown'/);
  assert.match(source, /news: \{ state: 'unknown'/);
  assert.match(source, /requireAdmin/);
});

test('phase 6 EPG projection excludes encrypted URL fields', () => {
  const source = read('supabase/functions/admin-epg-ops/index.ts');
  assert.match(source, /safe_label/);
  assert.doesNotMatch(source, /url_ciphertext|url_iv/);
  assert.match(source, /requireAdmin/);
});
