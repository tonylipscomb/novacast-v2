import { getAdminClient } from './supabase.ts';

export async function requireAdmin(request: Request) {
  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim();
  if (!token) throw new Error('admin_unauthorized');
  const client = getAdminClient();
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user || (data.user.app_metadata as Record<string, unknown> | null)?.role !== 'admin') throw new Error('admin_unauthorized');
  return { client, user: data.user };
}
