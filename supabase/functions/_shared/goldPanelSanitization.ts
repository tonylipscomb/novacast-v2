export function sanitizeGoldText(value: unknown, max = 500): string | null {
  if (typeof value !== 'string') return null;
  return value.replace(/[\r\n\t]+/g, ' ').trim().slice(0, max) || null;
}

export function sanitizeGoldError(value: unknown, secrets: string[] = [], max = 500): string {
  let output = typeof value === 'string' ? value : 'Gold Panel request failed';
  for (const secret of secrets.filter(Boolean)) output = output.split(secret).join('***');
  output = output.replace(/https?:\/\/[^\s"']+(?:get\.php|player_api\.php)\?[^\s"']*/gi, '[redacted credential URL]');
  output = output.replace(/([?&](?:username|password|user|pass|token|api_key|authorization)=)[^&\s]*/gi, '$1***');
  output = output.replace(/((?:password|passwd|api[_ -]?key|token|authorization)\s*[:=]\s*)[^\s,;]+/gi, '$1***');
  return output.replace(/[\r\n\t]+/g, ' ').trim().slice(0, max) || 'Gold Panel request failed';
}

export function redactGoldSecrets(value: unknown, secrets: string[] = []): unknown {
  if (typeof value === 'string') {
    let output = value;
    for (const secret of secrets.filter(Boolean)) output = output.split(secret).join('***');
    return sanitizeGoldError(output);
  }
  if (Array.isArray(value)) return value.map((item) => redactGoldSecrets(item, secrets));
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (/password|secret|api[_ -]?key|token|credential/i.test(key)) result[key] = '[redacted]';
      else result[key] = redactGoldSecrets(item, secrets);
    }
    return result;
  }
  return value;
}
