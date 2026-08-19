import { deviceAuthHeaders, deviceMetadata, getDeviceIdentity } from '@/features/device/deviceRegistration';
import { isLocalActivationBypassEnabled } from '@/features/device/deviceFeatureFlags';
import { setContentPolicyOverride, type ContentPolicyId } from '@/features/content-policy/ContentPolicyService';
import { connectXtreamProvider } from '@/features/providers/providerStore';
import { markPairingCompleted } from '@/features/pairing/pairingState';
import { waitForHomeChannelsReady } from '@/features/pairing/waitForHomeChannelsReady';

export type ManagedProviderDownloadResult = {
  providerName: string;
  contentPolicy: ContentPolicyId;
};

function apiConfig() {
  const apiUrl = process.env.EXPO_PUBLIC_NOVACAST_PAIRING_API_URL?.trim().replace(/\/+$/, '');
  const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim();
  return apiUrl && anonKey ? { apiUrl, anonKey } : null;
}

/**
 * Securely download the backend-assigned provider for a closed-beta device.
 * Credentials never appear in UI — they are stored via the existing provider store.
 */
export async function downloadManagedProviderAssignment(): Promise<ManagedProviderDownloadResult> {
  const api = apiConfig();
  if (!api) {
    throw new Error('managed_provider_unavailable');
  }

  const localBypass = isLocalActivationBypassEnabled({ log: false });
  const identity = await getDeviceIdentity().catch(() => null);
  const authHeaders = await deviceAuthHeaders();
  const localTestBypassHeaderSent = localBypass;
  console.info('[NovaCast Managed Provider Download]', JSON.stringify({
    event: 'request-auth-mode',
    localBypassEligible: localBypass,
    localTestBypassHeaderSent,
    publicDeviceIdPresent: Boolean(identity?.publicDeviceCode || authHeaders['x-novacast-device-id']),
    privateCredentialPresent: Boolean(identity?.deviceSecret || authHeaders['x-novacast-device-secret']),
  }));
  const response = await fetch(`${api.apiUrl}/device-provider-assignment`, {
    method: 'POST',
    headers: {
      apikey: api.anonKey,
      Authorization: `Bearer ${api.anonKey}`,
      'Content-Type': 'application/json',
      ...authHeaders,
      ...(localTestBypassHeaderSent ? { 'x-novacast-local-test-bypass': '1' } : {}),
    },
    body: JSON.stringify({ metadata: deviceMetadata() }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      typeof payload.errorCategory === 'string' ? payload.errorCategory : 'managed_provider_unavailable',
    );
  }

  const providerName = typeof payload.providerName === 'string' ? payload.providerName : 'NovaCast';
  const contentPolicy: ContentPolicyId =
    payload.contentPolicy === 'unrestricted' ? 'unrestricted' : 'us_only';

  setContentPolicyOverride(contentPolicy);

  await connectXtreamProvider({
    name: providerName,
    baseUrl: String(payload.baseUrl ?? ''),
    username: String(payload.username ?? ''),
    password: String(payload.password ?? ''),
  });

  markPairingCompleted();
  await waitForHomeChannelsReady({ timeoutMs: 20_000 });

  return { providerName, contentPolicy };
}
