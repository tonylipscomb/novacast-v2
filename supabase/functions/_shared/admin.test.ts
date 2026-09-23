import { assert, assertEquals } from 'jsr:@std/assert@1.0.19';
import { adminOptionsResponse } from './http.ts';
import { extractBearerToken, isAdminUser } from './admin.ts';

Deno.test('admin auth rejects missing and malformed bearer tokens', () => {
  assertEquals(extractBearerToken(new Headers()), null);
  assertEquals(extractBearerToken(new Headers({ authorization: 'Basic abc' })), null);
  assertEquals(extractBearerToken(new Headers({ authorization: 'Bearer' })), null);
  assertEquals(extractBearerToken(new Headers({ authorization: 'Bearer   ' })), null);
  assertEquals(extractBearerToken(new Headers({ authorization: 'Bearer token-value' })), 'token-value');
});

Deno.test('admin role comes only from app_metadata', () => {
  assert(!isAdminUser(null));
  assert(!isAdminUser({ app_metadata: {} }));
  assert(!isAdminUser({ app_metadata: {}, user_metadata: { role: 'admin' } } as { app_metadata?: unknown }));
  assert(!isAdminUser({ app_metadata: { role: 'viewer' } }));
  assert(isAdminUser({ app_metadata: { role: 'admin' } }));
});

Deno.test('admin auth failures use sanitized categories and CORS remains available', () => {
  const source = Deno.readTextFileSync(new URL('./admin.ts', import.meta.url));
  assert(source.includes("throw new Error('admin_unauthorized')"));
  assert(!source.includes('console.log'));
  assert(!source.includes('console.error'));
  const response = adminOptionsResponse(new Request('https://example.test', { headers: { origin: 'https://novacast-connect.netlify.app' } }));
  assertEquals(response.status, 200);
  assertEquals(response.headers.get('access-control-allow-origin'), 'https://novacast-connect.netlify.app');
});
