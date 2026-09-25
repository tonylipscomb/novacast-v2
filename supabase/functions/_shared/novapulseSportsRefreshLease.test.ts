import { assert, assertEquals, assertRejects } from 'jsr:@std/assert@1';
import { acquireSportsRefreshLease, releaseSportsRefreshLease } from './novapulseSportsRefreshLease.ts';

function rpcClient(results: Array<{ data: unknown; error: unknown }>) {
  const calls: Array<{ name: string; args?: Record<string, unknown> }> = [];
  return {
    calls,
    rpc: async (name: string, args?: Record<string, unknown>) => {
      calls.push({ name, args });
      return results.shift() ?? { data: null, error: new Error('missing_fake_result') };
    },
  };
}

const ownerToken = '00000000-0000-4000-8000-000000000001';

Deno.test('first caller acquires and current owner releases with its owner token', async () => {
  const client = rpcClient([
    { data: { status: 'acquired', owner_token: ownerToken, expires_at: '2026-09-25T12:10:00.000Z' }, error: null },
    { data: true, error: null },
  ]);
  const lease = await acquireSportsRefreshLease(client);
  assertEquals(lease.status, 'acquired');
  assertEquals(lease.ownerToken, ownerToken);
  await releaseSportsRefreshLease(client, lease);
  assertEquals(client.calls[1].args, { p_owner_token: ownerToken });
});

Deno.test('concurrent second caller receives refresh_in_progress without an owner token', async () => {
  const client = rpcClient([{ data: { status: 'refresh_in_progress', retry_after_seconds: 517 }, error: null }]);
  const lease = await acquireSportsRefreshLease(client);
  assertEquals(lease.status, 'refresh_in_progress');
  assertEquals(lease.ownerToken, null);
  assertEquals(lease.retryAfterSeconds, 517);
  await releaseSportsRefreshLease(client, lease);
  assertEquals(client.calls.length, 1);
});

Deno.test('expired lease acquisition is represented as a new acquired owner', async () => {
  const client = rpcClient([{ data: { status: 'acquired', owner_token: '00000000-0000-4000-8000-000000000002' }, error: null }]);
  const lease = await acquireSportsRefreshLease(client);
  assertEquals(lease.status, 'acquired');
  assert(lease.ownerToken !== ownerToken);
});

Deno.test('cooldown is distinct, bounded, and does not release another owner', async () => {
  const client = rpcClient([{ data: { status: 'refresh_cooldown', retry_after_seconds: 9999 }, error: null }]);
  const lease = await acquireSportsRefreshLease(client);
  assertEquals(lease.status, 'refresh_cooldown');
  assertEquals(lease.retryAfterSeconds, 120);
  await releaseSportsRefreshLease(client, lease);
  assertEquals(client.calls.length, 1);
});

Deno.test('an old owner cannot release a later owner lease', async () => {
  const client = rpcClient([{ data: false, error: null }]);
  await assertRejects(
    () => releaseSportsRefreshLease(client, { status: 'acquired', ownerToken, retryAfterSeconds: null, expiresAt: null }),
    Error,
    'sports_lease_release_failed',
  );
  assertEquals(client.calls[0].args, { p_owner_token: ownerToken });
});

Deno.test('acquisition and release RPC failures are fail-closed', async () => {
  const acquireClient = rpcClient([{ data: null, error: new Error('database') }]);
  await assertRejects(() => acquireSportsRefreshLease(acquireClient), Error, 'sports_lease_unavailable');
  const releaseClient = rpcClient([{ data: { status: 'acquired', owner_token: ownerToken }, error: null }, { data: false, error: null }]);
  const lease = await acquireSportsRefreshLease(releaseClient);
  await assertRejects(() => releaseSportsRefreshLease(releaseClient, lease), Error, 'sports_lease_release_failed');
});
