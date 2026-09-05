import { getSecureValue, removeSecureValue, setSecureValue } from './providerCredentialStore.ts';

const PREFIX = 'novacast.provider.custom-epg.';
const key = (providerId: string) => `${PREFIX}${providerId.replace(/[^a-zA-Z0-9._-]/g, '_')}`;

export function getProviderCustomEpgUrl(providerId: string) {
  return getSecureValue(key(providerId));
}

export async function setProviderCustomEpgUrl(providerId: string, url: string) {
  const value = url.trim();
  if (!value) throw new Error('Custom EPG URL is required.');
  await setSecureValue(key(providerId), value);
}

export function clearProviderCustomEpgUrl(providerId: string) {
  return removeSecureValue(key(providerId));
}
