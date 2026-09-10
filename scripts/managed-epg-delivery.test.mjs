import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { mapManagedEpgPrograms } from '../src/features/guide/managedEpgMapping.ts';
import { enrichChannelWithEpg, orderTimedEpgPrograms } from '../src/features/live/liveTvChannelEpg.ts';

const now = Date.parse('2026-09-10T12:00:00Z');
const program = (id, startAt, stopAt) => ({ id, title: id, startAt, stopAt, description: 'safe', category: 'News' });

test('managed current, next, and following map in playback order', () => {
  const programs = mapManagedEpgPrograms([
    program('next', '2026-09-10T13:00:00Z', '2026-09-10T14:00:00Z'),
    program('current', '2026-09-10T11:30:00Z', '2026-09-10T12:30:00Z'),
    program('following', '2026-09-10T14:00:00Z', '2026-09-10T15:00:00Z'),
  ], 3, now);
  assert.deepEqual(programs.map((item) => item.id), ['current', 'next', 'following']);
  assert.equal(programs[0].startAt, Date.parse('2026-09-10T11:30:00Z'));
  assert.match(programs[0].meta, /left/);
});

test('invalid managed timestamps are ignored and limit is bounded', () => {
  const input = Array.from({ length: 20 }, (_, index) => program(String(index), now + index * 3_600_000, now + (index + 1) * 3_600_000));
  input.push(program('bad', 'not-a-date', now));
  assert.equal(mapManagedEpgPrograms(input, 99, now).length, 12);
});

test('future-only managed programming remains upcoming, never Now Playing', () => {
  const future = mapManagedEpgPrograms([
    program('later', '2026-09-10T13:00:00Z', '2026-09-10T14:00:00Z'),
  ], 3, now);
  assert.deepEqual(orderTimedEpgPrograms(future, now).map((item) => item.id), ['later']);
  const channel = enrichChannelWithEpg({ id: 'stream-1', name: 'Example', current: '', currentStart: '', currentEnd: '', streamUrl: '' }, future);
  assert.equal(channel.current, '');
  assert.equal(channel.next, 'later');
  assert.equal(channel.progress, 0);
});

test('managed delivery uses the shared resolver and preserves fallback paths', () => {
  const repositories = fs.readFileSync(new URL('../src/features/providers/providerRepositories.ts', import.meta.url), 'utf8');
  assert.match(repositories, /repositoryOptions\.managedEpgResolver\(channelId, limit, signal\)/);
  assert.match(repositories, /if \(managed\?\.length\) return managed/);
  assert.match(repositories, /\.catch\(\(\) => null\)/);
  assert.match(repositories, /fetchShortEpgWithFallback\(client, channelId, epgChannelId, limit, signal\)/);
  assert.match(repositories, /managedEpgByChannel/);
  assert.match(repositories, /if \(managedPrograms\?\.length\)/);
  assert.match(repositories, /fetchShortEpgWithFallback\(client, channelId, epgChannelId, limit, signal\)/);
});

test('managed failures and missing client prerequisites fall back without affecting Xtream', () => {
  const client = fs.readFileSync(new URL('../src/features/guide/managedEpgClient.ts', import.meta.url), 'utf8');
  assert.match(client, /configuration_missing/);
  assert.match(client, /device_auth_missing/);
  assert.match(client, /http_failure/);
  assert.match(client, /timeout_or_aborted/);
  assert.match(client, /callerSignal\?\.aborted/);
  assert.match(client, /setTimeout\(\(\) => controller\.abort\(\), 3_000\)/);
});

test('release-visible managed EPG audit is bounded and excludes request secrets', () => {
  const client = fs.readFileSync(new URL('../src/features/guide/managedEpgClient.ts', import.meta.url), 'utf8');
  const live = fs.readFileSync(new URL('../src/features/live/liveTvChannelEpg.ts', import.meta.url), 'utf8');
  assert.match(client, /\[NovaCast Managed EPG Release Audit\]/);
  assert.match(client, /console\.info\(MANAGED_EPG_RELEASE_AUDIT/);
  assert.match(client, /sourceLabel/);
  assert.match(client, /sourcePriority/);
  const managedAuditCalls = client.match(/console\.info\([\s\S]*?\);/g) ?? [];
  assert.ok(managedAuditCalls.length >= 2);
  managedAuditCalls.forEach((call) => assert.doesNotMatch(call, /apiUrl|anonKey|authHeaders|Authorization/));
  assert.match(live, /\[NovaCast Live EPG Classification Audit\]/);
  assert.match(live, /programs\.slice\(0, 3\)/);
  assert.match(live, /console\.info\(LIVE_EPG_CLASSIFICATION_AUDIT/);
  const liveAuditCalls = live.match(/console\.info\(LIVE_EPG_CLASSIFICATION_AUDIT[\s\S]*?\);/g) ?? [];
  assert.ok(liveAuditCalls.length >= 2);
  liveAuditCalls.forEach((call) => assert.doesNotMatch(call, /streamUrl|password|token|authorization/i));
});

test('Edge function authenticates by device assignment and never accepts client provider identity', () => {
  const edge = fs.readFileSync(new URL('../supabase/functions/device-epg/index.ts', import.meta.url), 'utf8');
  assert.match(edge, /authenticateDevice\(request, client\)/);
  assert.match(edge, /from\('device_provider_assignments'\)/);
  assert.match(edge, /managed_provider_id.*assignment/);
  assert.doesNotMatch(edge, /body\?\.managedProviderId/);
  assert.doesNotMatch(edge, /credentials|url_ciphertext|url_iv|service_role/i);
});

test('managed failure remains a nullable client result', () => {
  const client = fs.readFileSync(new URL('../src/features/guide/managedEpgClient.ts', import.meta.url), 'utf8');
  assert.match(client, /Promise<ProviderGuideProgram\[\] \| null>/);
  assert.match(client, /if \(!response\.ok\)/);
  assert.match(client, /catch \{[\s\S]*return null;/);
});

test('Edge selection prefers a current programme and then source priority', () => {
  const edge = fs.readFileSync(new URL('../supabase/functions/device-epg/index.ts', import.meta.url), 'utf8');
  assert.match(edge, /order\('priority', \{ ascending: true \}\)/);
  assert.match(edge, /candidates\.find\(\(candidate\) => candidate\.hasCurrent\) \?\? candidates\[0\]/);
  assert.match(edge, /match_confidence_class', 'proven'/);
  assert.match(edge, /cache_generation', generation/);
  assert.match(edge, /managed_provider_id', assignment\.managed_provider_id/);
  assert.match(edge, /source_id', source\.id/);
  assert.match(edge, /xmltv_channel_id', xmltvChannelId/);
  assert.match(edge, /\.gt\('stop_at', nowIso\)/);
  assert.match(edge, /\.lt\('start_at', futureIso\)/);
});

test('managed delivery preserves identity, generation, confidence, and fallback contracts', () => {
  const edge = fs.readFileSync(new URL('../supabase/functions/device-epg/index.ts', import.meta.url), 'utf8');
  const repositories = fs.readFileSync(new URL('../src/features/providers/providerRepositories.ts', import.meta.url), 'utf8');
  assert.match(edge, /match_confidence_class', 'proven'/);
  assert.match(edge, /\.not\('xmltv_channel_id', 'is', null\)/);
  assert.match(edge, /\.eq\('cache_generation', generation\)/);
  assert.match(edge, /source: \{ id: selected\.source\.id/);
  assert.match(repositories, /channel\.epgChannelId/);
  assert.match(repositories, /fetchShortEpgWithFallback/);
  assert.match(repositories, /getCachedXmltvPrograms/);
});

test('Guide and Live share managed-first resolution while keeping bounded cancellation', () => {
  const repositories = fs.readFileSync(new URL('../src/features/providers/providerRepositories.ts', import.meta.url), 'utf8');
  const client = fs.readFileSync(new URL('../src/features/guide/managedEpgClient.ts', import.meta.url), 'utf8');
  assert.match(repositories, /managedEpgResolver!\(channel\.id, epgLimit, signal\)/);
  assert.match(repositories, /managedEpgByChannel\.set\(channel\.id, managed\)/);
  assert.match(client, /signal: controller\.signal/);
  assert.match(client, /removeEventListener\('abort', abort\)/);
});
