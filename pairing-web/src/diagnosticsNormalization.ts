export type DiagnosticLog = {
  id?: string;
  logged_at: string | null;
  level: 'info' | 'warning' | 'error';
  category: string;
  message: string;
  context: Record<string, unknown>;
};

export function formatDiagnosticValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? '[Invalid date]' : value.toISOString();
  try { return JSON.stringify(value, null, 2) ?? '—'; } catch { return '[Unserializable value]'; }
}

const LEVELS = new Set<DiagnosticLog['level']>(['info', 'warning', 'error']);

export function normalizeDiagnosticLogs(value: unknown): DiagnosticLog[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
    const row = raw as Record<string, unknown>;
    const rawTimestamp = row.logged_at == null ? null : String(row.logged_at);
    const timestamp = rawTimestamp && Number.isFinite(Date.parse(rawTimestamp)) ? rawTimestamp : null;
    return [{
      id: typeof row.id === 'string' ? row.id : undefined,
      logged_at: timestamp,
      level: LEVELS.has(row.level as DiagnosticLog['level']) ? row.level as DiagnosticLog['level'] : 'info',
      category: typeof row.category === 'string' && row.category ? row.category : 'app',
      message: typeof row.message === 'string' && row.message ? row.message : 'Diagnostic event',
      context: row.context && typeof row.context === 'object' && !Array.isArray(row.context)
        ? row.context as Record<string, unknown>
        : {},
    }];
  });
}
