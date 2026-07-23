import { deviceAuthHeaders, deviceMetadata } from './deviceRegistration';

export async function sendDeviceHeartbeat() {
  const apiUrl = process.env.EXPO_PUBLIC_NOVACAST_PAIRING_API_URL?.trim().replace(/\/+$/, '');
  const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!apiUrl || !anonKey) return;
  await fetch(`${apiUrl}/device-heartbeat`, {
    method: 'POST',
    headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}`, 'Content-Type': 'application/json', ...(await deviceAuthHeaders()) },
    body: JSON.stringify({ metadata: deviceMetadata() }),
  }).catch(() => undefined);
}
