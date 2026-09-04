import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

const player = read('src/features/playback/NovaStreamPlayer.tsx');
const controller = read('src/features/playback/unified/UnifiedPlayerController.tsx');
const live = read('src/features/live/LiveTvScreen.tsx');
const xtream = read('src/features/providers/xtreamClient.ts');
const repository = read('src/features/providers/providerRepositories.ts');
const source = read('src/features/series/data/ProviderSeriesDataSource.ts');
const model = read('src/features/series/useSeriesScreenModel.ts');

assert.match(xtream, /stage: 'http-response' \| 'json-parsed'/);
assert.match(xtream, /parsedNull: parsed === null/);
assert.match(repository, /provider-returned-null/);
assert.match(source, /boundary: info == null \? 'provider-returned-null' : 'normalized-object'/);
assert.match(model, /reason: 'select' \| 'retry'/);
assert.match(model, /event: 'detail-request'/);
assert.match(model, /event: 'datasource-result'/);
assert.match(xtream, /buildUrl\('get_series_info'/);

console.log('playback/series boundary audit checks passed');
