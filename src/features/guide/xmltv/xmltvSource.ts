export type XmltvSourceDescriptor = {
  kind: 'provider' | 'custom';
  sourceKey: string;
  getResponse: () => Promise<Response>;
};

function sourceIdentityHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

export function buildXmltvSourceKey(providerId: string, kind: 'provider' | 'custom', sourceIdentity: string) {
  return `epg:${sourceIdentityHash(providerId)}:${kind}:${sourceIdentityHash(sourceIdentity)}`;
}

export function createCustomXmltvSource(providerId: string, customUrl: string): XmltvSourceDescriptor {
  const url = customUrl.trim();
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw new Error('Custom EPG URL is invalid.'); }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('Custom EPG URL must use HTTP or HTTPS.');
  return { kind: 'custom', sourceKey: buildXmltvSourceKey(providerId, 'custom', `${parsed.origin}${parsed.pathname}`), getResponse: () => fetch(url) };
}
