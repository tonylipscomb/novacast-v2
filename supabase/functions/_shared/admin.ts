import { getAdminClient } from './supabase.ts';

export function extractBearerToken(headers: Headers) {
  const value = headers.get('authorization')?.trim() ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(value);
  return match?.[1].trim() || null;
}

export function isAdminUser(user: { app_metadata?: unknown } | null | undefined) {
  return Boolean(
    user &&
      user.app_metadata &&
      typeof user.app_metadata === 'object' &&
      (user.app_metadata as Record<string, unknown>).role === 'admin',
  );
}

export async function requireAdmin(request: Request, options: { distinguishForbidden?: boolean } = {}) {
  const token = extractBearerToken(request.headers);
  if (!token) throw new Error('admin_unauthorized');
  const client = getAdminClient();
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) throw new Error('admin_unauthorized');
  if (!isAdminUser(data.user)) {
    throw new Error(options.distinguishForbidden ? 'admin_forbidden' : 'admin_unauthorized');
  }
  return { client, user: data.user };
}
