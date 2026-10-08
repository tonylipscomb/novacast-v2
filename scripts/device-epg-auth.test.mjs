import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('supabase/functions/device-epg/index.ts', 'utf8');

assert.match(source, /if \(category === 'invalid_device'\) return unavailable\('invalid_device', 401\)/);
assert.match(source, /if \(category === 'device_not_authorized'\) return unavailable\('device_not_authorized', 403\)/);
assert.match(source, /return unavailable\(\);/);
assert.match(source, /function unavailable\(errorCategory = 'managed_epg_unavailable', status = 200\)/);
assert.doesNotMatch(source, /credentials_ciphertext|credentials_iv|password|username/);

console.log('PASS device-epg auth failures preserve explicit 401/403 responses');
console.log('PASS device-epg availability failures preserve sanitized fallback');
console.log('PASS device-epg source contains no provider credential fields');
console.log('3 device-epg auth checks passed');
