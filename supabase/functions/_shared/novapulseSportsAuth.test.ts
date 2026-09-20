import { assert, assertFalse } from 'jsr:@std/assert@1';
import { isNovaPulseSportsRefreshAuthorized } from './novapulseSportsAuth.ts';

Deno.test('sports refresh authorization rejects empty, malformed, and anon credentials', () => {
  assertFalse(isNovaPulseSportsRefreshAuthorized({ configuredSecret: '', suppliedSecret: '' }));
  assertFalse(isNovaPulseSportsRefreshAuthorized({ configuredSecret: 'refresh-secret', suppliedSecret: '' }));
  assertFalse(isNovaPulseSportsRefreshAuthorized({ configuredSecret: 'refresh-secret', suppliedSecret: 'wrong' }));
  assertFalse(isNovaPulseSportsRefreshAuthorized({ serviceRoleKey: 'service-role', bearerToken: 'anon-key' }));
  assertFalse(isNovaPulseSportsRefreshAuthorized({ serviceRoleKey: 'service-role', bearerToken: 'Bearer service-role' }));
});

Deno.test('sports refresh authorization accepts only exact configured credentials', () => {
  assert(isNovaPulseSportsRefreshAuthorized({ configuredSecret: ' refresh-secret ', suppliedSecret: 'refresh-secret' }));
  assert(isNovaPulseSportsRefreshAuthorized({ serviceRoleKey: ' service-role ', bearerToken: 'service-role' }));
});
