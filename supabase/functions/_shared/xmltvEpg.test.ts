import { assert, assertEquals, assertRejects, assertThrows } from 'jsr:@std/assert@1';
import { MAX_COMPRESSED_BYTES, MAX_DECOMPRESSED_BYTES, MAX_XMLTV_TAG_CARRY_BYTES, canonicalizeEpgName, classifyEpgChannel, countXmltvStream, isUsRelevantEpgChannel, mapEpgChannels, normalizeEpgMode, parseXmltv, safeEpgUrl } from './xmltvEpg.ts';

const validXml = new TextEncoder().encode(`<?xml version="1.0"?><tv><channel id="news.us"><display-name>News</display-name></channel><programme channel="news.us" start="20260905100000 +0000" stop="20260905110000 +0000"><title>Morning</title></programme></tv>`);

Deno.test('EPG modes default safely and accept only supported values', () => {
  assertEquals(normalizeEpgMode(undefined), 'provider');
  assertEquals(normalizeEpgMode('custom'), 'custom');
  assertEquals(normalizeEpgMode('unsupported'), 'provider');
});

Deno.test('XMLTV parser returns bounded safe counts and invalid timestamp count', () => {
  assertEquals(parseXmltv(validXml), { channels: 1, programs: 1, invalidTimestamps: 0 });
  const invalid = new TextEncoder().encode(`<tv><channel id="x"/><programme channel="x" start="bad" stop="bad"/></tv>`);
  assertEquals(parseXmltv(invalid).invalidTimestamps, 1);
});

Deno.test('custom EPG URL validation blocks unsafe targets and credentials in authority', () => {
  assertEquals(safeEpgUrl('https://guide.example/lineup.xml?token=secret').hostname, 'guide.example');
  assertEquals(safeEpgUrl('https://raw.githubusercontent.com/example/project/main/guide.xml.gz').hostname, 'raw.githubusercontent.com');
  assertThrows(() => safeEpgUrl('http://127.0.0.1/guide.xml'), Error, 'unsafe_url');
  assertThrows(() => safeEpgUrl('https://user:pass@guide.example/guide.xml'), Error, 'unsafe_url');
});

Deno.test('XMLTV size budgets separate compressed and expanded payloads', () => {
  assertEquals(MAX_COMPRESSED_BYTES, 20 * 1024 * 1024);
  assertEquals(MAX_DECOMPRESSED_BYTES, 128 * 1024 * 1024);
  assert(MAX_COMPRESSED_BYTES < MAX_DECOMPRESSED_BYTES);
  assert(6_637_845 < MAX_COMPRESSED_BYTES);
  assert(75_524_680 < MAX_DECOMPRESSED_BYTES);
});

Deno.test('XMLTV size-limit categories and byte fields are part of the test result contract', async () => {
  const source = await Deno.readTextFile(new URL('./xmltvEpg.ts', import.meta.url));
  assert(source.includes("'compressed_response_too_large'"));
  assert(source.includes("'decompressed_response_too_large'"));
  assert(source.includes('compressedBytes'));
  assert(source.includes('decompressedBytes'));
  assert(source.includes('response.headers.get(\'content-length\')'));
  assert(!source.includes('const bytes = decompressed.bytes'));
  assert(!source.includes('const chunks: Uint8Array[]'));
});

function streamFrom(parts: string[]) {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const part of parts) controller.enqueue(encoder.encode(part));
      controller.close();
    },
  });
}

Deno.test('streaming XMLTV counter handles split tags and split attributes', async () => {
  const result = await countXmltvStream(streamFrom([
    '<tv><chan',
    'nel id="x"><display-name>X</display-name></channel><pro',
    'gramme channel="x" start="20260905100000 ',
    '+0000" stop="20260905110000 +0000"><title>X</title></programme></tv>',
  ]));
  assertEquals(result.channels, 1);
  assertEquals(result.programs, 1);
  assertEquals(result.invalidTimestamps, 0);
});

Deno.test('streaming XMLTV counter preserves invalid timestamp counting', async () => {
  const result = await countXmltvStream(streamFrom([
    '<tv><channel id="x"/><programme channel="x" start="bad" stop="bad"/></tv>',
  ]));
  assertEquals(result.channels, 1);
  assertEquals(result.programs, 1);
  assertEquals(result.invalidTimestamps, 1);
});

Deno.test('diagnostic mode avoids programme retention while cache mode opts in', async () => {
  const diagnostic = await countXmltvStream(streamFrom([
    '<tv><channel id="x"><display-name>X</display-name></channel><programme channel="x" start="20260905100000 +0000" stop="20260905110000 +0000"><title>Now</title></programme></tv>',
  ]));
  const cache = await countXmltvStream(streamFrom([
    '<tv><channel id="x"><display-name>X</display-name></channel><programme channel="x" start="20260905100000 +0000" stop="20260905110000 +0000"><title>Now</title></programme></tv>',
  ]), { value: 0 }, Date.parse('2026-09-05T10:30:00Z'), true);
  assertEquals(diagnostic.programmes.length, 0);
  assertEquals(cache.programmes.length, 1);
});

Deno.test('synthetic 72 MiB XMLTV is processed with bounded parser state', async () => {
  const encoder = new TextEncoder();
  const program = '<programme channel="x" start="20260905100000 +0000" stop="20260905110000 +0000"><title>x</title></programme>';
  const targetBytes = 72 * 1024 * 1024;
  let emitted = 0;
  let finished = false;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (emitted === 0) {
        const prefix = encoder.encode('<tv><channel id="x"/>');
        emitted += prefix.byteLength;
        controller.enqueue(prefix);
        return;
      }
      if (emitted < targetBytes) {
        const chunk = encoder.encode(program.repeat(Math.max(1, Math.floor(64 * 1024 / program.length))));
        emitted += chunk.byteLength;
        controller.enqueue(chunk);
        return;
      }
      if (!finished) {
        const suffix = encoder.encode('</tv>');
        emitted += suffix.byteLength;
        finished = true;
        controller.enqueue(suffix);
        return;
      }
      controller.close();
    },
  });
  const result = await countXmltvStream(stream);
  assert(result.decompressedBytes > 72 * 1024 * 1024);
  assert(result.decompressedBytes < MAX_DECOMPRESSED_BYTES);
  assert(result.programs > 600_000);
  assert(MAX_XMLTV_TAG_CARRY_BYTES <= 64 * 1024);
});

Deno.test('streaming decompressed limit remains enforced', async () => {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.enqueue(encoder.encode('<tv><channel id="x"/>' + ' '.repeat(1024 * 1024)));
    },
  });
  await assertRejects(() => countXmltvStream(stream), Error, 'decompressed_response_too_large');
});

Deno.test('EPG mapping uses ID, exact-name, normalized-name priority and bounded samples', () => {
  const channels = new Map([
    ['id-1', { id: 'id-1', displayNames: ['Exact Channel'] }],
    ['id-2', { id: 'id-2', displayNames: ['Sports_Channel HD'] }],
    ['id-3a', { id: 'id-3a', displayNames: ['Duplicate'] }],
    ['id-3b', { id: 'id-3b', displayNames: ['Duplicate'] }],
  ]);
  const coverage = new Map([
    ['id-1', { hasCurrent: true, hasFuture: false }],
    ['id-2', { hasCurrent: false, hasFuture: true }],
  ]);
  const live = [
    { name: 'Wrong name', epgChannelId: 'id-1', category: null },
    { name: 'Exact Channel', epgChannelId: null, category: null },
    { name: 'Sports-Channel HD', epgChannelId: null, category: null },
    { name: 'Duplicate', epgChannelId: null, category: null },
    ...Array.from({ length: 12 }, (_, index) => ({ name: `Missing ${index}`, epgChannelId: null, category: null })),
  ];
  const result = mapEpgChannels(live, channels, coverage);
  assertEquals(result.directIdMatches, 1);
  assertEquals(result.exactNameMatches, 1);
  assertEquals(result.normalizedNameMatches, 1);
  assertEquals(result.ambiguousMatches, 1);
  assertEquals(result.unmatchedChannels, 12);
  assertEquals(result.currentProgramCoverage, 1 / 3);
  assertEquals(result.futureProgramCoverage, 1 / 3);
  assertEquals(result.unmatchedSamples.length, 10);
  assertEquals(result.ambiguousSamples.length, 1);
});

Deno.test('US classifier and canonical name rules are deterministic and conservative', () => {
  assertEquals(isUsRelevantEpgChannel({ name: 'ESPN FHD', epgChannelId: null, category: null }), true);
  assertEquals(isUsRelevantEpgChannel({ name: 'International Sports', epgChannelId: null, category: null }), false);
  assertEquals(isUsRelevantEpgChannel({ name: 'Local News', epgChannelId: null, category: 'US LOCAL' }), true);
  assertEquals(canonicalizeEpgName('4K: TNT SPORTS ᵁᴴᴰ ³⁸⁴⁰ᴾ (EVENT)'), 'tnt sports');
  assertEquals(canonicalizeEpgName('USA: ESPN FHD'), 'espn');
  assertEquals(canonicalizeEpgName('ESPN Deportes HD'), 'espn deportes');
  assertEquals(canonicalizeEpgName('USA Network HD (Pacific)'), 'usa network (pacific)');
  assertEquals(canonicalizeEpgName('NBA League Pass 4'), 'nba league pass 4');
});

Deno.test('explicit region prefixes outrank network heuristics and only US prefixes count as US prefixes', () => {
  assertEquals(classifyEpgChannel({ name: 'US: ESPN', epgChannelId: null, category: null }), { isUs: true, reason: 'us_prefix' });
  assertEquals(classifyEpgChannel({ name: 'USA: ESPN', epgChannelId: null, category: null }), { isUs: true, reason: 'us_prefix' });
  assertEquals(classifyEpgChannel({ name: 'USA Network HD', epgChannelId: null, category: null }), { isUs: true, reason: 'us_network_heuristic' });
  assertEquals(classifyEpgChannel({ name: 'CL: ESPN 1', epgChannelId: null, category: null }).isUs, false);
  assertEquals(classifyEpgChannel({ name: 'LV: NBA', epgChannelId: null, category: null }).isUs, false);
  assertEquals(classifyEpgChannel({ name: 'AF: NBA TV', epgChannelId: null, category: null }).isUs, false);
  assertEquals(classifyEpgChannel({ name: 'UK: TNT SPORT', epgChannelId: null, category: null }).isUs, false);
  assertEquals(classifyEpgChannel({ name: 'NZ: ESPN', epgChannelId: null, category: null }).isUs, false);
  assertEquals(classifyEpgChannel({ name: 'ESPN', epgChannelId: null, category: 'CL: Sports' }).isUs, false);
  assertEquals(classifyEpgChannel({ name: '4K: ESPN', epgChannelId: null, category: 'US: Sports' }).isUs, true);
});

Deno.test('classification counters distinguish explicit prefixes, categories, and network heuristics', () => {
  const result = mapEpgChannels([
    { name: 'US: ESPN', epgChannelId: null, category: null },
    { name: 'USA: ESPN 2', epgChannelId: null, category: null },
    { name: 'CL: ESPN', epgChannelId: null, category: null },
    { name: 'AF: NBA TV', epgChannelId: null, category: null },
    { name: 'USA Network HD', epgChannelId: null, category: null },
    { name: 'Local News', epgChannelId: null, category: 'US: Local' },
    { name: 'ESPN', epgChannelId: null, category: 'CL: Sports' },
  ], new Map(), new Map());
  assertEquals(result.classifiedByUsPrefix, 2);
  assertEquals(result.excludedByNonUsPrefix, 2);
  assertEquals(result.classifiedByUsCategory, 1);
  assertEquals(result.excludedByNonUsCategory, 1);
  assertEquals(result.classifiedByUsNetworkHeuristic, 1);
  assertEquals(result.usRelevantProviderChannels, 4);
});

Deno.test('only validated geographic prefixes override US network heuristics', () => {
  assertEquals(classifyEpgChannel({ name: 'NBA: LEAGUE PASS 1 HD', epgChannelId: null, category: null }), { isUs: true, reason: 'us_network_heuristic' });
  assertEquals(classifyEpgChannel({ name: 'NFL: NETWORK', epgChannelId: null, category: null }).reason, 'us_network_heuristic');
  assertEquals(classifyEpgChannel({ name: 'TNT: SPORTS', epgChannelId: null, category: null }).reason, 'us_network_heuristic');
  assertEquals(classifyEpgChannel({ name: 'PRIME: ABC BALTIMORE', epgChannelId: null, category: null }).reason, 'us_network_heuristic');
  assertEquals(classifyEpgChannel({ name: 'Category Example', epgChannelId: null, category: 'NBA:' }).reason, 'no_us_signal');
  assertEquals(classifyEpgChannel({ name: 'Category Example', epgChannelId: null, category: 'CL:' }).isUs, false);
});

Deno.test('NBA League Pass canonical matches remain in US-scoped accounting', () => {
  const channels = new Map([
    ['nba-1', { id: 'nba-1', displayNames: ['NBA League Pass 1'] }],
    ['nba-2', { id: 'nba-2', displayNames: ['NBA League Pass 2'] }],
  ]);
  const result = mapEpgChannels([
    { name: 'NBA: LEAGUE PASS 1 HD', epgChannelId: null, category: null },
    { name: 'NBA: LEAGUE PASS 2 HD', epgChannelId: null, category: null },
  ], channels, new Map());
  assertEquals(result.canonicalNameMatches, 2);
  assertEquals(result.mappedChannels, 2);
  assertEquals(result.usMappedChannels, 2);
});

Deno.test('canonicalization removes proven provider quality and wrapper metadata only', () => {
  assertEquals(canonicalizeEpgName('4K: ESPN UHD 3840P'), 'espn');
  assertEquals(canonicalizeEpgName('ESPN 3840P'), 'espn');
  assertEquals(canonicalizeEpgName('ESPN UHD'), 'espn');
  assertEquals(canonicalizeEpgName('ESPN2 HD'), 'espn2');
  assertEquals(canonicalizeEpgName('NBA League Pass 4 HD'), 'nba league pass 4');
  assertEquals(canonicalizeEpgName('PRIME: ABC BALTIMORE NEWS (WMAR) RAW'), 'abc baltimore news wmar');
  assertEquals(canonicalizeEpgName('PRIME: 6ABC PHILADELPHIA RAW'), '6abc philadelphia');
  assertEquals(canonicalizeEpgName('PRIME: A&E CRIME 360 RAW'), 'a e crime 360');
  assertEquals(canonicalizeEpgName('4K: TNT SPORTS UHD 3840P (EVENT)'), 'tnt sports');
  assertEquals(canonicalizeEpgName('HBO 2'), 'hbo 2');
});

Deno.test('ESPN canonical matching is unique while TNT remains ambiguous or unmatched', () => {
  const channels = new Map([
    ['ESPN.HD.us2', { id: 'ESPN.HD.us2', displayNames: ['ESPN HD'] }],
    ['TNT.HD.us2', { id: 'TNT.HD.us2', displayNames: ['TNT HD'] }],
    ['TNT.HD.(Pacific).us2', { id: 'TNT.HD.(Pacific).us2', displayNames: ['TNT HD (Pacific)'] }],
  ]);
  const result = mapEpgChannels([
    { name: '4K: ESPN UHD 3840P', epgChannelId: null, category: null },
    { name: '4K: TNT SPORTS UHD 3840P (EVENT)', epgChannelId: null, category: null },
  ], channels, new Map());
  assertEquals(result.canonicalNameMatches, 1);
  assertEquals(result.mappedChannels, 1);
  assertEquals(result.usMappedChannels, 1);
  assertEquals(result.ambiguousMatches, 0);
  assertEquals(result.unmatchedChannels, 1);
  assertEquals(result.matchedSamples[0], { providerName: '4K: ESPN UHD 3840P', providerCanonical: 'espn', xmltvDisplayName: 'ESPN HD', xmltvCanonical: 'espn', matchType: 'canonical' });
});
