export type GoldAssignmentMetadata = {
  status: string;
  assigned_at: string | null;
};

export function projectGoldAssignment(value: unknown): GoldAssignmentMetadata | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as { status?: unknown; assigned_at?: unknown };
  if (row.status !== 'active') return null;
  return {
    status: String(row.status),
    assigned_at: typeof row.assigned_at === 'string' ? row.assigned_at : null,
  };
}
