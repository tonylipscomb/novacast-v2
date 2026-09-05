import assert from 'node:assert/strict';
import fs from 'node:fs';

const service = fs.readFileSync('src/features/guide/xmltv/xmltvEpgService.ts', 'utf8');
const repositories = fs.readFileSync('src/features/providers/providerRepositories.ts', 'utf8');
const source = fs.readFileSync('src/features/guide/xmltv/xmltvSource.ts', 'utf8');
const store = fs.readFileSync('src/features/providers/providerStore.ts', 'utf8');
const portal = fs.readFileSync('src/features/portal/NovaPortalScreen.tsx', 'utf8');

assert.match(service, /source\?: XmltvSourceDescriptor/);
assert.match(service, /options\.source\.getResponse\(\)/);
assert.match(service, /replaceProviderXmltvCache\(/);
assert.match(service, /temporaryFile\.move\(file, \{ overwrite: true \}\)/);
assert.match(service, /contained no usable channels or programmes/);
assert.match(service, /temporaryFile\?\.delete/);
assert.match(repositories, /sourceKind: 'provider' \| 'custom'/);
assert.match(repositories, /sourceKind,/);
assert.match(repositories, /scanAll: true/);
assert.match(repositories, /custom-epg-observation/);
assert.match(repositories, /mapGuideRowsFromChannels\(resolvedMappedChannels, epgByChannel\)/);
assert.match(source, /sourceKey: buildXmltvSourceKey\(providerId, 'custom'/);
assert.doesNotMatch(repositories, /console\.(info|log)\([^\n]*customUrl/);
assert.match(store, /setProviderCustomEpgUrl\(providerId, value\)/);
assert.match(store, /clearProviderCustomEpgUrl\(providerId\)/);
assert.match(store, /mode: 'provider', customUrlConfigured: Boolean\(value\)/);
assert.match(portal, /Custom EPG: \{provider\.epg\?\.customUrlConfigured/);
assert.match(portal, /configureProviderCustomEpg\(provider\.id, null\)/);
assert.match(portal, /Test Custom EPG/);
assert.match(portal, /testCustomXmltvSource\(provider\.id, channels\)/);
assert.match(portal, /customEpgTestResult\.summary\.exactMatches/);
assert.match(repositories, /export async function testCustomXmltvSource/);
assert.match(repositories, /force: true/);

console.log('provider Phase 2A XMLTV assertions passed (10)');
