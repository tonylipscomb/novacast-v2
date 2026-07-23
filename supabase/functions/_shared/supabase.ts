import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8';

export function getAdminClient() {
  const url = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceRoleKey) {
    throw new Error('server_configuration_error');
  }

  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export async function consumeRateLimit(client: ReturnType<typeof getAdminClient>, key: string, limit: number, windowSeconds: number) {
  const { data, error } = await client.rpc('consume_pairing_rate_limit', {
    p_request_key_hash: key,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });
  if (error) {
    throw new Error('server_configuration_error');
  }
  return data === true;
}
