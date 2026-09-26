import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const shared = fs.readFileSync('supabase/functions/_shared/novapulseAnnouncements.ts', 'utf8');
const feed = fs.readFileSync('supabase/functions/novapulse-announcements-feed/index.ts', 'utf8');
const admin = fs.readFileSync('supabase/functions/admin-novapulse-announcements/index.ts', 'utf8');
const mobile = fs.readFileSync('src/features/novapulse/novaPulseAnnouncements.ts', 'utf8');
const logic = fs.readFileSync('src/features/novapulse/novaPulseLogic.ts', 'utf8');
const card = fs.readFileSync('src/features/novapulse/NovaPulseCard.tsx', 'utf8');
const adminUi = fs.readFileSync('pairing-web/src/AdminAnnouncements.tsx', 'utf8');
const mock = fs.readFileSync('src/features/novapulse/novaPulseMockFeed.ts', 'utf8');
const mobileSource = fs.readFileSync('src/features/novapulse/novaPulseAnnouncements.ts', 'utf8');

function loadMobile({ fetchedAt, item, fetchStatus = 503 } = {}) {
  const storage = new Map();
  if (fetchedAt != null) storage.set('@novacast/novapulse-announcements-v1', JSON.stringify({ schemaVersion: 1, fetchedAt, kind: 'items', items: [item] }));
  const source = mobileSource
    .replace("import AsyncStorage from '@react-native-async-storage/async-storage';", 'const AsyncStorage = globalThis.__asyncStorage;')
    .replace("import { recordSanitizedDiagnostic } from '@/features/resilience/sanitizedDiagnostics';", 'const recordSanitizedDiagnostic = () => undefined;')
    .replace("import { deviceAuthHeaders } from '@/features/device/deviceRegistration';", 'const deviceAuthHeaders = async () => ({});')
    .replace(/import type \{ NovaPulseItem, NovaPulseAnnouncementImportance \} from '\.\/novaPulseTypes';/, '');
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const context = {
    module: { exports: {} }, exports: {}, URL, AbortController, Date, Promise, Set, Map, JSON, Number, String, Math,
    setTimeout, clearTimeout, fetch: async () => ({ ok: false, status: fetchStatus, json: async () => ({}) }),
    process: { env: { EXPO_PUBLIC_NOVAPULSE_REMOTE_ANNOUNCEMENTS_ENABLED: 'true', EXPO_PUBLIC_NOVACAST_PAIRING_API_URL: 'https://project.supabase.co/functions/v1', EXPO_PUBLIC_SUPABASE_ANON_KEY: 'public-key' } },
    __asyncStorage: { getItem: async (key) => storage.get(key) ?? null, setItem: async (key, value) => { storage.set(key, value); } },
  };
  context.exports = context.module.exports;
  vm.runInNewContext(output, context);
  return context.module.exports;
}

function record(id, overrides = {}) {
  return { id, revision: 1, title: 'Alert', description: 'Body', importance: 'normal', priority: 10, publishedAt: new Date(Date.now() - 60_000).toISOString(), ...overrides };
}

test('B5.1 is global-only and provider targeting remains dormant', () => {
  assert.match(shared, /provider_targeting_unavailable/);
  assert.match(shared, /row\.kind === 'provider_alert'/);
  assert.match(feed, /\.neq\('kind', 'provider_alert'\)/);
  assert.match(mobile, /SUPPORTED_KINDS/);
  assert.match(mobile, /selectNovaPulseAnnouncements/);
  assert.match(mobile, /item\.kind !== 'provider_alert'/);
  assert.match(adminUi, /Content type/);
  assert.match(adminUi, /service_alert/);
  assert.doesNotMatch(adminUi, /value="provider_alert"(?! disabled)/);
  assert.doesNotMatch(mock, /provider_alert/);
  assert.match(adminUi, /item\.kind !== 'provider_alert'/);
  assert.match(adminUi, /disabled=\{busy \|\| Boolean\(validateAnnouncementDraft\(draft, true\)\)\}/);
});

test('B5.1 critical announcements require a future end at every publish boundary', () => {
  assert.match(shared, /critical_requires_future_end/);
  assert.match(admin, /startsAt: current\.starts_at/);
  assert.match(admin, /endsAt: current\.ends_at/);
  assert.match(mobile, /importance === 'critical'/);
  assert.match(adminUi, /revision: item\.revision/);
  assert.match(admin, /startsAt: current\.starts_at/);
  assert.match(admin, /endsAt: current\.ends_at/);
});

test('B5.1 selection is bounded after deterministic precedence, not before it', () => {
  assert.match(shared, /selectAnnouncementRows/);
  assert.match(shared, /\.sort\(compareAnnouncements\)\.slice\(0, NOVAPULSE_ANNOUNCEMENT_MAX_ITEMS\)/);
  assert.match(shared, /service_alert: 3, update: 2, general: 1/);
  assert.match(feed, /selectAnnouncementRows\(rows, now\)/);
  assert.doesNotMatch(feed, /\.limit\(2\)/);
});

test('B5.1 keeps bounded cache, non-actionable TV identity, and production caps intact', () => {
  assert.match(mobile, /NOVA_PULSE_ANNOUNCEMENTS_MEMORY_MAX_AGE_MS/);
  assert.match(mobile, /NOVA_PULSE_ANNOUNCEMENTS_LKG_MAX_AGE_MS/);
  assert.match(card, /announcementType/);
  assert.match(card, /bullhorn-outline/);
  const composition = fs.readFileSync('src/features/novapulse/novaPulseV2.ts', 'utf8');
  assert.match(composition, /type === 'announcement'/);
  assert.match(composition, /NOVA_PULSE_V2_MAX_ITEMS = 12/);
});

test('B5.1 uses kind fallbacks for blank announcement badges', () => {
  assert.match(logic, /const ANNOUNCEMENT_BADGES = \{/);
  assert.match(logic, /service_alert: 'SERVICE ALERT'/);
  assert.match(logic, /update: 'UPDATE'/);
  assert.match(logic, /general: 'ANNOUNCEMENT'/);
  assert.match(logic, /const customBadge = typeof item\.badgeOverride === 'string'/);
  assert.match(logic, /announcementType === 'service_alert' && customBadge\?\.toLocaleLowerCase\(\) === 'alert'/);
  assert.match(logic, /return customBadge \?\? ANNOUNCEMENT_BADGES\[item\.announcementType \?\? 'general'\]/);
  assert.match(mobile, /item\.kind !== 'provider_alert'/);
  assert.match(mobile, /action: \{ type: 'none' \}/);
  assert.match(fs.readFileSync('src/features/novapulse/novaPulseV2.ts', 'utf8'), /NOVA_PULSE_V2_MAX_ITEMS = 12/);
});

test('B5.1 applies five-minute critical LKG and sixty-minute noncritical LKG limits', async () => {
  const critical = record('00000000-0000-4000-8000-000000000101', { importance: 'critical', endsAt: new Date(Date.now() + 60 * 60_000).toISOString() });
  assert.equal((await loadMobile({ fetchedAt: Date.now() - 4 * 60_000, item: critical }).loadNovaPulseAnnouncements()).source, 'lkg');
  assert.equal((await loadMobile({ fetchedAt: Date.now() - 6 * 60_000, item: critical }).loadNovaPulseAnnouncements()).source, 'static');
  const normal = record('00000000-0000-4000-8000-000000000102');
  assert.equal((await loadMobile({ fetchedAt: Date.now() - 59 * 60_000, item: normal }).loadNovaPulseAnnouncements()).source, 'lkg');
  assert.equal((await loadMobile({ fetchedAt: Date.now() - 61 * 60_000, item: normal }).loadNovaPulseAnnouncements()).source, 'static');
  const expired = record('00000000-0000-4000-8000-000000000103', { importance: 'critical', endsAt: new Date(Date.now() - 1).toISOString() });
  assert.equal((await loadMobile({ fetchedAt: Date.now() - 1_000, item: expired }).loadNovaPulseAnnouncements()).source, 'static');
});

test('B5.1 successful empty responses remain authoritative and unsupported kinds do not hydrate', async () => {
  let calls = 0;
  const source = mobileSource
    .replace("import AsyncStorage from '@react-native-async-storage/async-storage';", 'const AsyncStorage = globalThis.__asyncStorage;')
    .replace("import { recordSanitizedDiagnostic } from '@/features/resilience/sanitizedDiagnostics';", 'const recordSanitizedDiagnostic = () => undefined;')
    .replace("import { deviceAuthHeaders } from '@/features/device/deviceRegistration';", 'const deviceAuthHeaders = async () => ({});')
    .replace(/import type \{ NovaPulseItem, NovaPulseAnnouncementImportance \} from '\.\/novaPulseTypes';/, '');
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const storage = new Map();
  const context = { module: { exports: {} }, exports: {}, URL, AbortController, Date, Promise, Set, Map, JSON, Number, String, Math, setTimeout, clearTimeout,
    fetch: async () => { calls += 1; return { ok: true, status: 200, json: async () => ({ ok: true, items: [] }) }; },
    process: { env: { EXPO_PUBLIC_NOVAPULSE_REMOTE_ANNOUNCEMENTS_ENABLED: 'true', EXPO_PUBLIC_NOVACAST_PAIRING_API_URL: 'https://project.supabase.co/functions/v1', EXPO_PUBLIC_SUPABASE_ANON_KEY: 'public-key' } },
    __asyncStorage: { getItem: async (key) => storage.get(key) ?? null, setItem: async (key, value) => { storage.set(key, value); } } };
  context.exports = context.module.exports;
  vm.runInNewContext(output, context);
  const empty = await context.module.exports.loadNovaPulseAnnouncements();
  assert.equal(empty.source, 'empty');
  assert.equal(empty.items.length, 0);
  assert.equal(context.module.exports.validateNovaPulseAnnouncement(record('00000000-0000-4000-8000-000000000104', { kind: 'provider_alert' })), null);
  assert.equal(calls, 1);
});
