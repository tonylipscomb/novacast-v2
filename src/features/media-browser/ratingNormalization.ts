export type NormalizedProviderRating = {
  /** Normalized to a 0–10 comparison scale. */
  value: number;
  sourceScale: '0-5' | '0-10' | '0-100' | 'percent';
};

const PLACEHOLDER_RATINGS = new Set(['0', '0.0', '10.0', '10']);

function parseNumericToken(raw: string) {
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseProviderRating(value: unknown): NormalizedProviderRating | null {
  if (value == null) {
    return null;
  }

  const raw = String(value).trim();
  if (!raw || PLACEHOLDER_RATINGS.has(raw)) {
    return null;
  }

  const lower = raw.toLowerCase();
  if (/(votes?|reviews?|ratings?|popularity|rank)/.test(lower)) {
    return null;
  }

  const fractionMatch = raw.match(/^(\d+(?:\.\d+)?)\s*\/\s*(5|10)$/);
  if (fractionMatch) {
    const numerator = parseNumericToken(fractionMatch[1]);
    const denominator = Number(fractionMatch[2]);
    if (numerator == null || numerator < 0 || numerator > denominator) {
      return null;
    }
    const normalized = denominator === 5 ? numerator * 2 : numerator;
    return normalized > 0 && normalized <= 10
      ? { value: normalized, sourceScale: denominator === 5 ? '0-5' : '0-10' }
      : null;
  }

  const percentMatch = raw.match(/^(\d+(?:\.\d+)?)\s*%$/);
  if (percentMatch) {
    const percent = parseNumericToken(percentMatch[1]);
    if (percent == null || percent <= 0 || percent > 100) {
      return null;
    }
    return { value: percent / 10, sourceScale: 'percent' };
  }

  const parsed = typeof value === 'number' ? value : parseNumericToken(raw.replace(/[^\d.+-]/g, ''));
  if (parsed == null || !Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  if (parsed > 1000) {
    return null;
  }

  if (parsed > 100) {
    return null;
  }

  if (parsed > 10) {
    return { value: parsed / 10, sourceScale: '0-100' };
  }

  return parsed > 0 ? { value: parsed, sourceScale: '0-10' } : null;
}

export function isValidRating(value: unknown) {
  return parseProviderRating(value) != null;
}

export function normalizeRating(value: unknown) {
  return parseProviderRating(value)?.value ?? 0;
}
