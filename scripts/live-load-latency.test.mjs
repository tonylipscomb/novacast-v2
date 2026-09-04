import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('..', import.meta.url);
const model = fs.readFileSync(new URL('src/features/live/useLiveTvScreenModel.ts', root), 'utf8');
const catalog = fs.readFileSync(new URL('src/features/search/liveSearchSqliteCatalog.ts', root), 'utf8');
const screen = fs.readFileSync(new URL('src/features/live/LiveTvScreen.tsx', root), 'utf8');

assert.match(model, /categoryMetadataKeyRef/);
assert.match(model, /channelCacheRef/);
assert.match(model, /source: 'memory-cache'/);
assert.match(model, /publishedGeneration: generation/);
assert.match(model, /publishedGeneration: publishedState\.generation/);
assert.match(model, /category-metadata-read/);
assert.match(model, /action: categoryWasLoaded \? 'reused' : 'executed'/);
assert.match(model, /onLoadAudit\?\.\('[\w-]+-load-start'/);
assert.match(model, /prefetchChannelEpg[\s\S]*blocking: false/);
assert.match(catalog, /publishedLiveCategoryCache/);
assert.match(catalog, /publishedLiveCategoryInflight/);
assert.match(catalog, /const cacheKey = `\$\{providerId\.trim\(\)\}:\$\{state\.generation\}`/);
assert.match(catalog, /source: 'memory-cache'/);
assert.match(catalog, /idx_live_search_channels_provider_generation_category/);
assert.match(catalog, /publishedGeneration\?: number/);
assert.match(catalog, /\[NovaCast Live Category CPU Audit\]/);
assert.match(catalog, /profileBuildMs/);
assert.match(catalog, /actualSortMs/);
assert.match(catalog, /totalCategoryTransformMs/);
assert.match(screen, /\[NovaCast Live Load Audit\]/);
assert.match(screen, /loadSessionId/);
assert.match(screen, /onNovaCastNativeTvKey/);

console.log('live load latency architecture test passed');
