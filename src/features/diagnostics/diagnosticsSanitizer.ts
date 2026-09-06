const SECRET_KEY = /(pass(word|wd)?|user(name)?|token|secret|authorization|bearer|api[ _-]?key|credential|cookie|jwt|dsn)/i;

export function sanitizeStreamReference(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return {};
  try {
    const url = new URL(value);
    return { streamHost: url.hostname.slice(0, 160) };
  } catch {
    return { streamId: value.replace(/[^a-zA-Z0-9._:-]/g, '').slice(0, 96) };
  }
}

export function sanitizeDiagnosticMetadata(value: unknown, depth = 0): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || depth > 2) return {};
  const output: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_KEY.test(key)) continue;
    if (typeof raw === 'string') {
      const reference = /^(https?:\/\/|rtmp:\/\/)/i.test(raw) ? sanitizeStreamReference(raw) : null;
      if (reference && Object.keys(reference).length) {
        Object.assign(output, reference);
      } else {
        output[key.slice(0, 40)] = raw.replace(/[?&](token|password|passwd|username|user|auth|bearer|key)=[^&]*/gi, '').slice(0, 240);
      }
    } else if (typeof raw === 'number' || typeof raw === 'boolean' || raw === null) {
      output[key.slice(0, 40)] = raw;
    } else if (typeof raw === 'object') {
      output[key.slice(0, 40)] = sanitizeDiagnosticMetadata(raw, depth + 1);
    }
  }
  return output;
}

export function sanitizeDiagnosticEvent<T extends Record<string, unknown>>(event: T) {
  const sanitized = sanitizeDiagnosticMetadata(event);
  const stream = sanitizeStreamReference(event.streamUrl);
  return { ...sanitized, ...stream, metadata: sanitizeDiagnosticMetadata(event.metadata) };
}
