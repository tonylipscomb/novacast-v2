import { assert, assertEquals } from 'jsr:@std/assert@1';
import {
  CATALOG_READ_LIMIT_BYTES,
  catalogDiagnosticMessage,
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
    'Catalog response exceeded the 8 MB validation read limit before a complete record could be parsed.',
  );
  for (const reason of ['catalog_http', 'catalog_timeout', 'catalog_html', 'catalog_invalid_json', 'catalog_unexpected_shape', 'catalog_payload_too_large'] as const) {
    const detail = catalogDiagnosticMessage(reason, { httpStatus: 500 });
    assert(!detail.includes('password'));
    assert(!detail.includes('player_api'));
    assert(!detail.includes('catalog_payload_invalid'));
  }
});
