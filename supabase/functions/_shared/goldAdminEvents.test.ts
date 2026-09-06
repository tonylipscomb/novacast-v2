import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { isMissingGoldActivityTableError, listGoldAdminActivity, recordGoldAdminEvent, sanitizeGoldActivityEvent, sanitizeGoldEventIdentifier, sanitizeGoldEventMetadata } from './goldAdminEvents.ts';

Deno.test('Gold event metadata is allowlisted and secret-like values are discarded', () => {
  assertEquals(sanitizeGoldEventMetadata({ subscriptionMonths: 1, source: 'm3u_import', password: 'secret', url: 'https://example.test' }), { subscriptionMonths: 1, source: 'm3u_import' });
});

Deno.test('Gold event identifiers reject credential-bearing values', () => {
  assertEquals(sanitizeGoldEventIdentifier('321e023c81b5'), '321e023c81b5');
  assertEquals(sanitizeGoldEventIdentifier('https://gold.test/get.php?username=x'), null);
});

Deno.test('recordGoldAdminEvent sanitizes goldUserId before insert', async () => {
  let inserted: Record<string, unknown> | null = null;
  const client = { from: () => ({ insert: async (value: Record<string, unknown>) => { inserted = value; } }) };
  await recordGoldAdminEvent(client, { action: 'account_synced', goldUserId: 'https://gold.test/get.php?username=x' });
  assertEquals(inserted?.gold_user_id, null);
  await recordGoldAdminEvent(client, { action: 'account_synced', goldUserId: '321e023c81b5' });
  assertEquals(inserted?.gold_user_id, '321e023c81b5');
});

Deno.test('activity response projection cannot return a credential-bearing Gold ID', () => {
  assertEquals(sanitizeGoldActivityEvent({ id: 'event-1', goldUserId: 'https://gold.test/get.php?username=x' }).goldUserId, null);
  assertEquals(sanitizeGoldActivityEvent({ id: 'event-2', goldUserId: '321e023c81b5' }).goldUserId, '321e023c81b5');
});

Deno.test('activity query uses only approved columns and returns an explicit sanitized projection', async () => {
  let selected = '';
  const client = { from: (table: string) => table === 'gold_admin_events' ? { select: (columns: string) => { selected = columns; return { order: () => ({ limit: async () => ({ data: [{ id: 'e', created_at: '2026-01-01T00:00:00Z', action: 'account_synced', status: 'success', gold_account_id: 'a', managed_provider_id: null, gold_user_id: 'https://gold.test/get.php?username=x', metadata: { subscriptionMonths: 1, password: 'x' }, actor_user_id: 'actor' }], error: null }) }) }; } } : undefined };
  const result = await listGoldAdminActivity(client);
  assertEquals(selected, 'id,created_at,action,status,gold_account_id,managed_provider_id,gold_user_id,metadata');
  assertEquals(result[0], { id: 'e', action: 'account_synced', status: 'success', accountId: 'a', providerId: null, goldUserId: null, providerName: null, createdAt: '2026-01-01T00:00:00Z', metadata: { subscriptionMonths: 1 } });
});

Deno.test('only known missing-table codes are unavailable', () => {
  assertEquals(isMissingGoldActivityTableError({ code: '42P01' }), true);
  assertEquals(isMissingGoldActivityTableError({ code: 'PGRST205' }), true);
  assertEquals(isMissingGoldActivityTableError({ code: 'PGRST116' }), false);
  assertEquals(isMissingGoldActivityTableError({ code: '42501' }), false);
});
