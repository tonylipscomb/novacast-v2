const SECRET = /(pass(word|wd)?|user(name)?|token|secret|authorization|bearer|api[ _-]?key|credential|cookie|jwt|dsn)/i;
const URL_FIELD = /(?:url|uri|stream|source|manifest|endpoint)/i;
const URL_SCHEME = /^(?:https?|rtsp):\/\//i;

function sanitizeString(raw: string, key: string) {
  const isUrlField = URL_FIELD.test(key);
  if (isUrlField || URL_SCHEME.test(raw)) {
    try {
      const url = new URL(raw);
      return {
        streamHost: url.hostname.slice(0, 160),
        protocol: url.protocol,
      };
    } catch {
      // A URL-shaped field that is not parseable remains harmless text.
    }
  }
  return raw.slice(0, 240);
}

export function redact(value: unknown, depth = 0): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || depth > 2) return {};
  const out: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET.test(key)) continue;
    const safeKey = key.slice(0, 40);
    if (typeof raw === 'string') out[safeKey] = sanitizeString(raw, key);
    else if (typeof raw === 'number' || typeof raw === 'boolean' || raw === null) out[safeKey] = raw;
    else out[safeKey] = redact(raw, depth + 1);
  }
  return out;
}
