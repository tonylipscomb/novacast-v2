import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const client = fs.readFileSync('src/features/novapulse/novaPulseAnnouncements.ts', 'utf8');
const hook = fs.readFileSync('src/features/novapulse/useNovaPulseFeed.ts', 'utf8');
const env = fs.readFileSync('.env.example', 'utf8');
const feed = fs.readFileSync('supabase/functions/novapulse-announcements-feed/index.ts', 'utf8');
const clientTs = fs.readFileSync('src/features/novapulse/novaPulseAnnouncements.ts', 'utf8');

function loadClient({ enabled = true, fetchImpl = async () => ({ ok: false, status: 503, json: async () => ({}) }), storage = new Map(), storageSetFails = false } = {}) {
  const source = clientTs
    .replace("import AsyncStorage from '@react-native-async-storage/async-storage';", 'const AsyncStorage = globalThis.__asyncStorage;')
    .replace("import { recordSanitizedDiagnostic } from '@/features/resilience/sanitizedDiagnostics';", 'const recordSanitizedDiagnostic = globalThis.__recordDiagnostic;')
    .replace("import { deviceAuthHeaders } from '@/features/device/deviceRegistration';", 'const deviceAuthHeaders = globalThis.__deviceAuthHeaders;')
    .replace(/import type \{ NovaPulseItem, NovaPulseAnnouncementImportance \} from '\.\/novaPulseTypes';/, '');
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const context = {
    module: { exports: {} }, exports: {}, URL, AbortController, Date, Promise, Set, Map, JSON, Number, String, Math,
    setTimeout, clearTimeout, fetch: fetchImpl,
    process: { env: { EXPO_PUBLIC_NOVAPULSE_REMOTE_ANNOUNCEMENTS_ENABLED: enabled ? 'true' : 'false', EXPO_PUBLIC_NOVACAST_PAIRING_API_URL: 'https://project.supabase.co/functions/v1', EXPO_PUBLIC_SUPABASE_ANON_KEY: 'public-key' } },
    __asyncStorage: { getItem: async (key) => storage.get(key) ?? null, setItem: async (key, value) => { if (storageSetFails) throw new Error('storage unavailable'); storage.set(key, value); } },
    __recordDiagnostic: () => undefined,
    __deviceAuthHeaders: async () => ({ 'x-novacast-device-id': 'NC-TEST', 'x-novacast-device-secret': 'test-secret' }),
  };
  context.exports = context.module.exports;
  vm.runInNewContext(output, context);
  return { api: context.module.exports, storage };
}

function record(id, overrides = {}) {
  return { id, revision: 1, title: 'Announcement', description: 'Body', importance: 'normal', priority: 10, ...overrides };
}

const NOW = Date.parse('2026-09-24T12:00:00.000Z');

function response(status, payload) {
  return { ok: status >= 200 && status < 300, status, json: async () => payload };
}

test('runtime validator accepts only safe bounded announcement records', () => {
  const { api } = loadClient();
  const artwork = 'https://project.supabase.co/storage/v1/object/public/novapulse-announcement-artwork/a.png';
  const valid = api.validateNovaPulseAnnouncement(record('00000000-0000-4000-8000-000000000001', { artworkUrl: artwork }), NOW, 'https://project.supabase.co');
  assert.equal(valid.id, '00000000-0000-4000-8000-000000000001');
  assert.equal(api.validateNovaPulseAnnouncement(record('00000000-0000-4000-8000-000000000002', { startsAt: new Date(NOW + 1).toISOString() }), NOW, 'https://project.supabase.co'), null);
  assert.equal(api.validateNovaPulseAnnouncement(record('00000000-0000-4000-8000-000000000003', { endsAt: new Date(NOW).toISOString() }), NOW, 'https://project.supabase.co'), null);
  assert.equal(api.validateNovaPulseAnnouncement(record('00000000-0000-4000-8000-000000000004', { artworkUrl: 'http://project.supabase.co/x' }), NOW, 'https://project.supabase.co').artworkUrl, undefined);
  assert.equal(api.validateNovaPulseAnnouncement(record('00000000-0000-4000-8000-000000000005', { artworkUrl: `${artwork}/%2e%2e%2fsecret` }), NOW, 'https://project.supabase.co').artworkUrl, undefined);
  assert.equal(api.validateNovaPulseAnnouncement({ ...record('not-a-uuid') }, NOW), null);
  const normalized = api.normalizeNovaPulseAnnouncements({ ok: true, items: [
    record('00000000-0000-4000-8000-000000000010'),
    record('00000000-0000-4000-8000-000000000011', { revision: 2 }),
    record('00000000-0000-4000-8000-000000000012'),
  ] }, NOW, 'https://project.supabase.co');
  assert.equal(normalized.validPayload, true);
  assert.equal(normalized.items.length, 2);
  assert.equal(api.normalizeNovaPulseAnnouncements({ ok: true, items: [record('00000000-0000-4000-8000-000000000013', { title: '' })] }, NOW).validPayload, false);
  assert.equal(api.normalizeNovaPulseAnnouncements({ ok: true, items: [] }, NOW).validPayload, true);
});

test('remote/cache behavior distinguishes disabled, empty, cached, and terminal failures', async () => {
  let fetchCount = 0;
  const enabled = loadClient({ fetchImpl: async () => { fetchCount += 1; return response(200, { ok: true, items: [record('00000000-0000-4000-8000-000000000020')] }); } });
  const remote = await enabled.api.loadNovaPulseAnnouncements();
  assert.equal(remote.source, 'remote');
  assert.equal(remote.items.length, 1);
  assert.equal(fetchCount, 1);
  const memory = await enabled.api.loadNovaPulseAnnouncements();
  assert.equal(memory.source, 'lkg');
  assert.equal(fetchCount, 1);

  const emptyClient = loadClient({ fetchImpl: async () => response(200, { ok: true, items: [] }) });
  const empty = await emptyClient.api.loadNovaPulseAnnouncements();
  assert.equal(empty.source, 'empty');
  assert.equal(empty.items.length, 0);

  const lkgStorage = new Map([["@novacast/novapulse-announcements-v1", JSON.stringify({ schemaVersion: 1, fetchedAt: Date.now() - 1_000, kind: 'items', items: [record('00000000-0000-4000-8000-000000000021')] })]]);
  const lkgClient = loadClient({ fetchImpl: async () => response(503, {}), storage: lkgStorage });
  const lkg = await lkgClient.api.loadNovaPulseAnnouncements();
  assert.equal(lkg.source, 'lkg');
  assert.equal(lkg.items.length, 1);

  const authFailure = loadClient({ fetchImpl: async () => response(401, {}) });
  assert.equal((await authFailure.api.loadNovaPulseAnnouncements()).source, 'none');
  const invalid = loadClient({ fetchImpl: async () => response(200, { ok: true, items: [record('bad')] }) });
  assert.equal((await invalid.api.loadNovaPulseAnnouncements()).source, 'none');
  const disabled = loadClient({ enabled: false, fetchImpl: async () => { throw new Error('must not fetch'); } });
  assert.equal((await disabled.api.loadNovaPulseAnnouncements()).source, 'static');
});

test('concurrent callers share one remote request and storage failures stay non-fatal', async () => {
  let fetchCount = 0;
  let resolveFetch;
  const pending = new Promise((resolve) => { resolveFetch = resolve; });
  const client = loadClient({ fetchImpl: async () => { fetchCount += 1; return pending; }, storage: new Map() });
  const first = client.api.loadNovaPulseAnnouncements();
  const second = client.api.loadNovaPulseAnnouncements();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(fetchCount, 1);
  resolveFetch(response(200, { ok: true, items: [record('00000000-0000-4000-8000-000000000030')] }));
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a.source, 'remote');
  assert.deepEqual(b.items, a.items);

  const storageFailure = new Map();
  const failingStorageClient = loadClient({
    fetchImpl: async () => response(200, { ok: true, items: [record('00000000-0000-4000-8000-000000000031')] }),
    storage: storageFailure,
    storageSetFails: true,
  });
  failingStorageClient.api.clearNovaPulseAnnouncementsCacheForTests();
  const result = await failingStorageClient.api.loadNovaPulseAnnouncements();
  assert.equal(result.source, 'remote');
});

test('remote announcements are disabled by default and use the committed endpoint contract', () => {
  assert.match(env, /EXPO_PUBLIC_NOVAPULSE_REMOTE_ANNOUNCEMENTS_ENABLED=false/);
  assert.match(client, /NOVA_PULSE_REMOTE_ANNOUNCEMENTS_ENABLED = process\.env\.EXPO_PUBLIC_NOVAPULSE_REMOTE_ANNOUNCEMENTS_ENABLED === 'true'/);
  assert.match(client, /novapulse-announcements-feed/);
  assert.match(client, /method: 'GET'/);
  assert.match(client, /deviceAuthHeaders\(\)/); // shared device-auth header convention
  assert.doesNotMatch(client, /service_role|sports.*secret|provider.*password/i);
  assert.match(feed, /authenticateDevice\(request, client\)/);
});

test('runtime validation is bounded, scheduled, deduplicated, and artwork-scoped', () => {
  assert.match(client, /NOVA_PULSE_ANNOUNCEMENTS_TIMEOUT_MS = 5_000/);
  assert.match(client, /NOVA_PULSE_ANNOUNCEMENTS_MAX_ITEMS = 2/);
  assert.match(client, /starts \? parsed > nowMs : parsed <= nowMs/);
  assert.match(client, /seen\.has\(item\.id\)/);
  assert.match(client, /items\.slice\(0, NOVA_PULSE_ANNOUNCEMENTS_MAX_ITEMS\)/);
  assert.match(client, /url\.protocol !== 'https:'/);
  assert.match(client, /url\.origin !== expected\.origin/);
  assert.match(client, /NOVA_PULSE_ANNOUNCEMENT_BUCKET/);
  assert.match(client, /url\.username \|\| url\.password/);
  assert.match(client, /decodeURIComponent\(url\.pathname\)/);
  assert.match(client, /rawItems\.length === 0 \|\| items\.length > 0/);
  assert.match(client, /replace\(\/<\[\^>\]\*>\/g, ' '\)/);
});

test('cache and fallback semantics preserve authoritative empty results', () => {
  assert.match(client, /@novacast\/novapulse-announcements-v1/);
  assert.match(client, /schemaVersion: 1/);
  assert.match(client, /kind: 'items' \| 'empty'/);
  assert.match(client, /parsed\.kind === 'empty'/);
  assert.match(client, /NOVA_PULSE_ANNOUNCEMENTS_LKG_MAX_AGE_MS = 60 \* 60_000/);
  assert.match(client, /response\.status === 408 \|\| response\.status === 429 \|\| response\.status >= 500/);
  assert.match(client, /result\('empty', \[\],/);
  assert.match(client, /result\('none', \[\]\)/);
  assert.match(client, /result\('static', \[\]\)/);
  assert.match(hook, /announcementResult\.source === 'static'/);
  assert.match(hook, /announcementResult\.items/);
  assert.match(hook, /announcementFrozenRef\.current/);
  assert.match(hook, /controller\.abort\(\)/);
});

test('remote announcements remain non-actionable and use stable UUID identity', () => {
  assert.match(client, /id: `announcement:\$\{item\.id\}`/);
  assert.match(client, /action: \{ type: 'none' \}/);
  assert.match(client, /NOVA_PULSE_ANNOUNCEMENTS_MAX_ITEMS/);
  assert.doesNotMatch(client, /console\.(log|info).*title/);
});
