import { assert, assertEquals } from 'jsr:@std/assert@1';
import {
  CATALOG_READ_LIMIT_BYTES,
  catalogDiagnosticMessage,
  createXtreamCatalogScanner,
  parseXtreamCatalogText,
} from './providerHealthCatalog.ts';

function channel(id: number) {
  return { stream_id: id, name: `Channel ${id}`, category_id: String((id % 12) + 1), container_extension: 'ts' };
}

Deno.test('parses a normal small Xtream array', () => {
  const parsed = parseXtreamCatalogText(JSON.stringify([channel(1), channel(2), channel(3)]));
  assertEquals(parsed.ok, true);
  assertEquals(parsed.reason, 'ok');
  assertEquals(parsed.count, 3);
  assertEquals(parsed.complete, true);
  assertEquals(parsed.stopReason, 'complete');
  assertEquals(parsed.items[0]?.stream_id, 1);
});

Deno.test('parses a valid wrapped Xtream object array', () => {
  const parsed = parseXtreamCatalogText(JSON.stringify({ js: [channel(9), channel(10)] }));
  assertEquals(parsed.ok, true);
  assertEquals(parsed.count, 2);
});

Deno.test('valid catalog just under the configured byte limit parses completely', () => {
  const rows = Array.from({ length: 40 }, (_, index) => channel(index + 1));
  const text = JSON.stringify(rows);
  const parsed = parseXtreamCatalogText(text, { maxBytes: text.length + 32 });
  assertEquals(parsed.ok, true);
  assertEquals(parsed.count, 40);
  assertEquals(parsed.truncated, false);
  assertEquals(parsed.stopReason, 'complete');
});

Deno.test('response exceeding the read limit is not passed through JSON.parse as one blob', () => {
  const rows = Array.from({ length: 80 }, (_, index) => channel(index + 1));
  const text = JSON.stringify(rows);
  const limit = Math.floor(text.length / 2);
  const truncatedText = text.slice(0, limit);
  let jsonParseThrew = false;
  try {
    JSON.parse(truncatedText);
  } catch {
    jsonParseThrew = true;
  }
  assert(jsonParseThrew);
  const parsed = parseXtreamCatalogText(truncatedText, { truncatedInput: true, maxBytes: limit });
  assertEquals(parsed.ok, true);
  assert(parsed.count >= 10);
  assertEquals(parsed.reason, 'ok');
  assertEquals(parsed.stopReason, 'byte_limit');
});

Deno.test('truncated JSON with no complete record is payload too large, not invalid JSON', () => {
  const parsed = parseXtreamCatalogText('[{"stream_id":1,"name":"Partial', {
    truncatedInput: true,
    maxBytes: 24,
  });
  assertEquals(parsed.ok, false);
  assertEquals(parsed.reason, 'catalog_payload_too_large');
  assert(parsed.detail.includes('validation read limit'));
  assert(!parsed.detail.includes('catalog_payload_invalid'));
});

Deno.test('complete malformed JSON is catalog_invalid_json', () => {
  const parsed = parseXtreamCatalogText('{"not": "an array and not closed"');
  assertEquals(parsed.ok, false);
  assertEquals(parsed.reason, 'catalog_invalid_json');
  assertEquals(parsed.detail, 'Catalog returned malformed JSON.');
});

Deno.test('valid JSON with unexpected shape is distinct from malformed JSON', () => {
  const parsed = parseXtreamCatalogText(JSON.stringify({ user_info: { auth: 1 }, server_info: {} }));
  assertEquals(parsed.ok, false);
  assertEquals(parsed.reason, 'catalog_unexpected_shape');
  assertEquals(parsed.detail, 'Catalog returned an unexpected response shape.');
});

Deno.test('HTML or login pages are classified as catalog_html', () => {
  const parsed = parseXtreamCatalogText('<html><body>login</body></html>');
  assertEquals(parsed.ok, false);
  assertEquals(parsed.reason, 'catalog_html');
  assertEquals(parsed.detail, 'Catalog endpoint returned an HTML/login page instead of JSON.');
});

Deno.test('huge catalogs keep a bounded sample instead of retaining every row', () => {
  const rows = Array.from({ length: 5000 }, (_, index) => channel(index + 1));
  const parsed = parseXtreamCatalogText(JSON.stringify(rows), { maxItems: 5000, sampleSize: 40 });
  assertEquals(parsed.ok, true);
  assertEquals(parsed.count, 5000);
  assert(parsed.items.length <= 40);
  assert(parsed.items.some((item) => item.stream_id === 1));
  assert(parsed.items.some((item) => item.stream_id === 5000));
});

Deno.test('counts a complete 20000-item catalog while bounding diagnostic inspection', () => {
  const rows = Array.from({ length: 20_000 }, (_, index) => channel(index + 1));
  const parsed = parseXtreamCatalogText(JSON.stringify(rows), { keepAll: true });
  assertEquals(parsed.ok, true);
  assertEquals(parsed.totalCount, 20_000);
  assertEquals(parsed.inspectedCount, 12_000);
  assertEquals(parsed.count, 12_000);
  assertEquals(parsed.exactCountAvailable, true);
  assertEquals(parsed.diagnosticTruncated, true);
  assertEquals(parsed.items.length, 12_000);
});

Deno.test('diagnostic cap stops a large catalog without consuming the remaining response', () => {
  const rows = Array.from({ length: 20_000 }, (_, index) => channel(index + 1));
  const encoded = new TextEncoder().encode(JSON.stringify(rows));
  const scanner = createXtreamCatalogScanner({ exactCount: false });
  for (let offset = 0; offset < encoded.length && !scanner.finished; offset += 4096) {
    scanner.push(encoded.slice(offset, offset + 4096));
  }
  const parsed = scanner.finish();
  assertEquals(parsed.ok, true);
  assertEquals(parsed.totalCount, null);
  assertEquals(parsed.inspectedCount, 12_000);
  assertEquals(parsed.exactCountAvailable, false);
  assertEquals(parsed.stopReason, 'diagnostic_cap');
  assertEquals(parsed.diagnosticTruncated, true);
  assert(parsed.bytesRead < encoded.length);
});

Deno.test('an interrupted full count is not reported as exact', () => {
  const text = JSON.stringify(Array.from({ length: 20_000 }, (_, index) => channel(index + 1)));
  const parsed = parseXtreamCatalogText(text.slice(0, Math.floor(text.length * 0.8)), {
    truncatedInput: true,
    maxBytes: text.length,
  });
  assertEquals(parsed.ok, true);
  assertEquals(parsed.totalCount, null);
  assertEquals(parsed.exactCountAvailable, false);
  assertEquals(parsed.diagnosticTruncated, true);
  assertEquals(parsed.stopReason, 'upstream_incomplete');
});

Deno.test('a timeout after partial records preserves the bounded count', () => {
  const scanner = createXtreamCatalogScanner({ maxItems: 12_000 });
  scanner.push(new TextEncoder().encode(JSON.stringify([channel(1), channel(2), channel(3)]).slice(0, -1)));
  const parsed = scanner.finish(true, 'timeout');
  assertEquals(parsed.inspectedCount, 3);
  assertEquals(parsed.totalCount, null);
  assertEquals(parsed.exactCountAvailable, false);
  assertEquals(parsed.stopReason, 'timeout');
});

Deno.test('empty valid array is catalog_empty', () => {
  const parsed = parseXtreamCatalogText('[]');
  assertEquals(parsed.ok, false);
  assertEquals(parsed.reason, 'catalog_empty');
});

Deno.test('diagnostic messages stay distinct and sanitized', () => {
  assertEquals(catalogDiagnosticMessage('catalog_http', { httpStatus: 403 }), 'Catalog request returned HTTP 403.');
  assertEquals(catalogDiagnosticMessage('catalog_timeout'), 'Catalog request timed out.');
  assertEquals(
    catalogDiagnosticMessage('catalog_payload_too_large', { limitBytes: CATALOG_READ_LIMIT_BYTES }),
    'Catalog response exceeded the 128 MB validation read limit before a complete record could be parsed.',
  );
  for (const reason of ['catalog_http', 'catalog_timeout', 'catalog_html', 'catalog_invalid_json', 'catalog_unexpected_shape', 'catalog_payload_too_large'] as const) {
    const detail = catalogDiagnosticMessage(reason, { httpStatus: 500 });
    assert(!detail.includes('password'));
    assert(!detail.includes('player_api'));
    assert(!detail.includes('catalog_payload_invalid'));
  }
});
