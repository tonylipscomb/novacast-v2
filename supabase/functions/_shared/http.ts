export const corsHeaders = {
  'Access-Control-Allow-Headers':
    'authorization, apikey, content-type, x-novacast-device-id, x-novacast-device-secret, x-novacast-local-test-bypass',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
  'Access-Control-Allow-Origin': Deno.env.get('PAIRING_WEB_ORIGIN') ?? '*',
  'Content-Type': 'application/json',
};

const APPROVED_ADMIN_ORIGINS = new Set([
  'https://novacast-connect.netlify.app',
  'https://beta-rolling-download--novacast-connect.netlify.app',
]);

function isLocalAdminOrigin(origin: string) {
  try {
    const url = new URL(origin);
    return (
      url.protocol === 'http:' &&
      (url.hostname === 'localhost' || url.hostname === '127.0.0.1')
    );
  } catch {
    return false;
  }
}

export function adminCorsHeaders(request: Request) {
  const headers: Record<string, string> = { ...corsHeaders, Vary: 'Origin' };
  delete headers['Access-Control-Allow-Origin'];

  const origin = request.headers.get('origin');

  if (
    origin &&
    (APPROVED_ADMIN_ORIGINS.has(origin) || isLocalAdminOrigin(origin))
  ) {
    headers['Access-Control-Allow-Origin'] = origin;
  }

  return headers;
}

export function adminJsonResponse(request: Request, body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: adminCorsHeaders(request) });
}

export function adminOptionsResponse(request: Request) {
  return new Response('ok', { headers: adminCorsHeaders(request) });
}

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
