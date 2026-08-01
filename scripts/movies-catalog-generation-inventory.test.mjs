import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const repository = fs.readFileSync('src/features/catalog/catalogRepository.ts', 'utf8');
const index = fs.readFileSync('src/features/catalog/index.ts', 'utf8');

const MARKER = '[NovaCast Catalog Generation Inventory]';

function extractInventoryPayload(source) {
  const markerIndex = source.indexOf(`'${MARKER} '`);
  assert.ok(markerIndex >= 0, 'inventory marker must exist');
  const stringifyIndex = source.indexOf('JSON.stringify(', markerIndex);
  assert.ok(stringifyIndex > markerIndex, 'inventory must use JSON.stringify');
  let depth = 1;
  let cursor = stringifyIndex + 'JSON.stringify('.length;
  while (cursor < source.length && depth > 0) {
    const character = source[cursor];
    if (character === '(') {
      depth += 1;
    } else if (character === ')') {
      depth -= 1;
    }
    cursor += 1;
  }
  return {
    payload: source.slice(stringifyIndex + 'JSON.stringify('.length, cursor - 1),
    tail: source.slice(cursor, cursor + 48),
  };
}

test('generation inventory is a one-shot single-line JSON diagnostic', () => {
  assert.match(repository, /logCatalogGenerationInventoryOnce/);
  assert.match(repository, /catalogGenerationInventoryLogged/);
  assert.match(repository, /\[NovaCast Catalog Generation Inventory\]/);
  assert.match(index, /logCatalogGenerationInventoryOnce/);

  const success = extractInventoryPayload(repository);
  assert.match(success.tail, /^\s*,?\s*\)/);

  assert.match(
    repository,
    /void logCatalogGenerationInventoryOnce\(providerId, mediaType, \{/,
  );
});

test('inventory queries physical generation counts without mutating catalog state', () => {
  assert.match(
    repository,
    /COUNT\(\*\) AS item_rows[\s\S]*COUNT\(DISTINCT content_id\) AS distinct_content_ids[\s\S]*COUNT\(DISTINCT category_id\) AS distinct_item_category_ids/,
  );
  assert.match(
    repository,
    /FROM catalog_items[\s\S]*GROUP BY sync_generation[\s\S]*ORDER BY sync_generation DESC/,
  );
  assert.match(
    repository,
    /FROM catalog_categories[\s\S]*GROUP BY sync_generation[\s\S]*ORDER BY sync_generation DESC/,
  );
  assert.match(repository, /FROM catalog_seasons/);

  const inventoryStart = repository.indexOf('export async function logCatalogGenerationInventoryOnce');
  const inventoryEnd = repository.indexOf('export async function resolveReadableCatalogGeneration', inventoryStart);
  const inventoryFn = repository.slice(inventoryStart, inventoryEnd);
  assert.ok(inventoryFn.length > 200, 'inventory function body must be extractable');
  assert.doesNotMatch(inventoryFn, /\bdb\.run\b/);
  assert.doesNotMatch(inventoryFn, /\b(?:INSERT INTO|UPDATE\s+\w+|DELETE FROM)\b/i);
  assert.doesNotMatch(inventoryFn, /\bbeginCatalogSync\b|\bcompleteCatalogSync\b|\bfailCatalogSync\b|\bdeleteStaleCatalogGeneration\b/);
});

test('inventory payload includes required generation and resolver fields', () => {
  const inventoryStart = repository.indexOf('export async function logCatalogGenerationInventoryOnce');
  const inventoryEnd = repository.indexOf('export async function resolveReadableCatalogGeneration', inventoryStart);
  const inventoryFn = repository.slice(inventoryStart, inventoryEnd);
  for (const field of [
    'providerId',
    'mediaType',
    'syncState',
    'generations',
    'resolverDecision',
    'itemRows',
    'distinctContentIds',
    'categoryRows',
    'distinctItemCategoryIds',
    'seasonRows',
    'markedReady',
    'markedFailed',
    'completedAt',
    'failureReason',
    'currentAttemptGeneration',
    'lastCompletedGeneration',
    'lastFailedGeneration',
    'previousPathEligible',
    'resolvedReadableGeneration',
    'readableRowCount',
    'reason',
  ]) {
    assert.match(inventoryFn, new RegExp(`\\b${field}\\b`), `missing field ${field}`);
  }
});

test('inventory diagnostics contain no credentials or provider secrets', () => {
  const inventoryFn = repository.slice(
    repository.indexOf('export async function logCatalogGenerationInventoryOnce'),
    repository.indexOf('export async function resolveReadableCatalogGeneration'),
  );
  const forbidden = [
    /password/i,
    /secret/i,
    /username/i,
    /credential/i,
    /api[_-]?key/i,
    /access[_-]?token/i,
    /authorization/i,
    /bearer/i,
    /https?:\/\//i,
    /\burl\b/i,
    /artworkUrl|backdropUrl|streamUrl|stream_extension/i,
  ];
  for (const pattern of forbidden) {
    assert.doesNotMatch(inventoryFn, pattern, `inventory must not log ${pattern}`);
  }
});

test('resolver behavior and sync writers remain unchanged by the inventory', () => {
  assert.match(
    repository,
    /lastCompletedGeneration > 0 &&\s*lastCompletedGeneration !== currentAttemptGeneration/,
  );
  assert.match(repository, /reason = 'recovered-completed-generation'/);
  assert.match(repository, /status = 'ready'/);
  assert.match(repository, /status = 'error'/);
  assert.match(repository, /DELETE FROM catalog_items[\s\S]*sync_generation != \?/);

  const inventoryCallSite = repository.slice(
    repository.indexOf('void logCatalogGenerationInventoryOnce'),
    repository.indexOf('return resolvedReadableGeneration;'),
  );
  assert.doesNotMatch(inventoryCallSite, /resolvedReadableGeneration\s*=/);
});
