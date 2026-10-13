import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { mapManagedEpgPrograms } from '../src/features/guide/managedEpgMapping.ts';
import { enrichChannelWithEpg, orderTimedEpgPrograms } from '../src/features/live/liveTvChannelEpg.ts';
import { decodeDisplayTextEntities, displayLiveProgramText } from '../src/features/live/liveTvProgramText.ts';

const now = Date.parse('2026-09-10T12:00:00Z');
const program = (id, startAt, stopAt) => ({ id, title: id, startAt, stopAt, description: 'safe', category: 'News' });
const channel = { id: 'stream-1', name: 'Example', current: '', currentStart: '', currentEnd: '', streamUrl: '' };

function withNow(timestamp, callback) {
  const originalNow = Date.now;
  Date.now = () => timestamp;
  try {
    return callback();
  } finally {
    Date.now = originalNow;
  }
}

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

test('EPG display text decodes common entities without changing stream-like values', () => {
  assert.equal(decodeDisplayTextEntities('Tyler Perry&apos;s House &amp; Payne'), "Tyler Perry's House & Payne");
  assert.equal(decodeDisplayTextEntities('&#39; &#x27; &quot; &lt; &gt;'), `' ' " < >`);
  assert.equal(displayLiveProgramText('https://provider.example/live?id=1&token=secret', 'fallback'), 'fallback');
  assert.equal(displayLiveProgramText('Normal unencoded title', 'fallback'), 'Normal unencoded title');
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
  const enriched = withNow(now, () => enrichChannelWithEpg(channel, future));
  assert.equal(enriched.current, '');
  assert.equal(enriched.next, 'later');
  assert.equal(enriched.progress, 0);
});

test('enrichment selects the currently airing programme and next programme', () => {
  const programs = mapManagedEpgPrograms([
    program('next', '2026-09-10T13:00:00Z', '2026-09-10T14:00:00Z'),
    program('current', '2026-09-10T11:30:00Z', '2026-09-10T12:30:00Z'),
    program('expired', '2026-09-10T10:00:00Z', '2026-09-10T11:00:00Z'),
  ], 3, now);
  const enriched = withNow(now, () => enrichChannelWithEpg(channel, programs));
  assert.equal(enriched.current, 'current');
  assert.equal(enriched.next, 'next');
  assert.equal(enriched.currentStart, programs.find((item) => item.id === 'current').start);
});

test('expired timed programmes do not become current and do not crash enrichment', () => {
  const expired = mapManagedEpgPrograms([
    program('expired', '2026-09-10T09:00:00Z', '2026-09-10T10:00:00Z'),
  ], 3, now);
  const enriched = withNow(now, () => enrichChannelWithEpg(channel, expired));
  assert.equal(enriched.current, '');
  assert.equal(enriched.progress, 0);
});

test('missing timing fields remain safe and preserve untimed provider EPG behavior', () => {
  const untimed = [{ id: 'untimed', title: 'Untimed', meta: 'Untimed', description: 'safe' }];
  const enriched = withNow(now, () => enrichChannelWithEpg(channel, untimed));
  assert.equal(enriched.current, 'Untimed');
  assert.equal(enriched.currentStart, '');
});

test('malformed managed timing is discarded before enrichment', () => {
  const mapped = mapManagedEpgPrograms([
    program('bad-start', 'not-a-date', '2026-09-10T13:00:00Z'),
    program('bad-order', '2026-09-10T13:00:00Z', '2026-09-10T12:00:00Z'),
  ], 3, now);
  assert.deepEqual(mapped, []);
  const enriched = withNow(now, () => enrichChannelWithEpg(channel, mapped));
  assert.equal(enriched.current, '');
});

test('empty EPG results preserve a safe empty display state', () => {
  const enriched = enrichChannelWithEpg({ ...channel, current: 'Example' }, []);
  assert.equal(enriched.current, '');
  assert.equal(enriched.next, undefined);
});

test('current-to-next transition follows the wall-clock boundary', () => {
  const programs = mapManagedEpgPrograms([
    program('first', '2026-09-10T12:00:00Z', '2026-09-10T13:00:00Z'),
    program('second', '2026-09-10T13:00:00Z', '2026-09-10T14:00:00Z'),
  ], 3, now);
  const before = withNow(Date.parse('2026-09-10T12:59:59Z'), () => enrichChannelWithEpg(channel, programs));
  const after = withNow(Date.parse('2026-09-10T13:00:00Z'), () => enrichChannelWithEpg(channel, programs));
  assert.equal(before.current, 'first');
  assert.equal(before.next, 'second');
  assert.equal(after.current, 'second');
  assert.equal(after.next, undefined);
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

test('temporary Live EPG audit diagnostics are bounded to safe display fields', () => {
  const live = fs.readFileSync(new URL('../src/features/live/liveTvChannelEpg.ts', import.meta.url), 'utf8');
  assert.match(live, /NovaCast Live EPG Classification Audit/);
  assert.match(live, /programSamples/);
  assert.match(live, /slice\(0, 3\)/);
  assert.match(live, /rawName/);
  assert.doesNotMatch(live, /streamUrl/);
  assert.doesNotMatch(live, /Authorization|password|token|username/i);
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
  assert.match(edge, /candidatesByStream/);
  assert.match(edge, /candidates\.find\(\(candidate\) => candidate\.hasCurrent\) \?\? candidates\[0\]/);
  assert.match(edge, /match_confidence_class', 'proven'/);
  assert.match(edge, /cache_generation', generation/);
  assert.match(edge, /managed_provider_id', assignment\.managed_provider_id/);
  assert.match(edge, /source_id', source\.id/);
  assert.match(edge, /\.in\('xmltv_channel_id', xmltvIds\)/);
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

test('device-epg batch contract and permanent device authentication config are bounded', () => {
  const edge = fs.readFileSync(new URL('../supabase/functions/device-epg/index.ts', import.meta.url), 'utf8');
  const config = fs.readFileSync(new URL('../supabase/config.toml', import.meta.url), 'utf8');
  const client = fs.readFileSync(new URL('../src/features/guide/managedEpgClient.ts', import.meta.url), 'utf8');
  assert.match(edge, /Array\.isArray\(body\?\.streamIds\)/);
  assert.match(edge, /requestedIds\.length > 32/);
  assert.match(edge, /Object\.fromEntries\(requestedIds\.map/);
  assert.match(client, /export async function fetchManagedEpgBatch/);
  assert.match(client, /MANAGED_EPG_BATCH_SIZE = 32/);
  assert.match(client, /streamIds: chunk/);
  assert.match(config, /\[functions\.device-epg\]\s+verify_jwt = false/);
});

test('Guide and Live share managed-first resolution while keeping bounded cancellation', () => {
  const repositories = fs.readFileSync(new URL('../src/features/providers/providerRepositories.ts', import.meta.url), 'utf8');
  const client = fs.readFileSync(new URL('../src/features/guide/managedEpgClient.ts', import.meta.url), 'utf8');
  assert.match(repositories, /managedEpgResolver!\(channel\.id, epgLimit, signal\)/);
  assert.match(repositories, /managedEpgByChannel\.set\(channel\.id, managed\)/);
  assert.match(client, /signal: controller\.signal/);
  assert.match(client, /removeEventListener\('abort', abort\)/);
});
