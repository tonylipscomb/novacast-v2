import { assertEquals } from 'jsr:@std/assert@1.0.19';
import { projectGoldAssignment } from './goldAssignmentProjection.ts';

Deno.test('projects active assignment status and assigned_at without other fields', () => {
  assertEquals(projectGoldAssignment({
    status: 'active',
    assigned_at: '2026-10-08T15:00:00.000Z',
    managed_provider_id: 'provider-id',
    password: 'must-not-project',
  }), {
    status: 'active',
    assigned_at: '2026-10-08T15:00:00.000Z',
  });
});

Deno.test('returns null for missing or non-active assignments', () => {
  assertEquals(projectGoldAssignment(null), null);
  assertEquals(projectGoldAssignment({ status: 'superseded', assigned_at: '2026-10-08T15:00:00.000Z' }), null);
  assertEquals(projectGoldAssignment({ status: 'active' }), { status: 'active', assigned_at: null });
});
