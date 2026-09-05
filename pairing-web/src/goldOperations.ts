export const EXPIRATION_BUCKETS = ['expired', 'today', 'tomorrow', 'next7', 'next30', 'later', 'unknown'] as const;
export type ExpirationBucket = typeof EXPIRATION_BUCKETS[number];

export const EXPIRATION_BUCKET_LABELS: Record<ExpirationBucket, string> = {
  expired: 'Expired', today: 'Today', tomorrow: 'Tomorrow', next7: 'Next 7 days',
  next30: 'Next 30 days', later: 'Later', unknown: 'Unknown expiration',
};

function startOfDay(date: Date) { return new Date(date.getFullYear(), date.getMonth(), date.getDate()); }
function parseExpiration(value: unknown) {
  const raw = String(value);
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (dateOnly) return new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]), 23, 59, 59, 999);
  return new Date(raw);
}

export function classifyGoldExpiration(value: unknown, now = new Date()): ExpirationBucket {
  if (value === null || value === undefined || String(value).trim() === '') return 'unknown';
  const expiration = parseExpiration(value);
  if (Number.isNaN(expiration.getTime())) return 'unknown';
  if (expiration.getTime() < now.getTime()) return 'expired';
  const today = startOfDay(now).getTime();
  const day = startOfDay(expiration).getTime();
  const tomorrow = today + 86400000;
  if (day === today) return 'today';
  if (day === tomorrow) return 'tomorrow';
  if (day <= today + 7 * 86400000) return 'next7';
  if (day <= today + 30 * 86400000) return 'next30';
  return 'later';
}

export function sortGoldAccountsByExpiration<T extends { gold_expiration?: unknown }>(accounts: T[], now = new Date()) {
  return [...accounts].sort((a, b) => {
    const aBucket = classifyGoldExpiration(a.gold_expiration, now);
    const bBucket = classifyGoldExpiration(b.gold_expiration, now);
    const aTime = aBucket === 'unknown' ? Number.POSITIVE_INFINITY : parseExpiration(a.gold_expiration).getTime();
    const bTime = bBucket === 'unknown' ? Number.POSITIVE_INFINITY : parseExpiration(b.gold_expiration).getTime();
    return aTime - bTime;
  });
}
