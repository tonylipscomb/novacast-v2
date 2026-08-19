export const corsHeaders = {
  'Access-Control-Allow-Headers':
    'authorization, apikey, content-type, x-novacast-device-id, x-novacast-device-secret, x-novacast-local-test-bypass',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
  'Access-Control-Allow-Origin': Deno.env.get('PAIRING_WEB_ORIGIN') ?? '*',
  'Content-Type': 'application/json',
};

export function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

export function optionsResponse() {
  return new Response('ok', { headers: corsHeaders });
}

export async function readJson(request: Request) {
  try {
    const body = await request.json();
    return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function getClientAddress(request: Request) {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown-client';
}
