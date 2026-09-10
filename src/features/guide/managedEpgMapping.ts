import type { ProviderGuideProgram } from '../providers/providerRepositories.ts';

export type ManagedEpgProgram = {
  id?: unknown;
  title?: unknown;
  subtitle?: unknown;
  description?: unknown;
  category?: unknown;
  startAt?: unknown;
  stopAt?: unknown;
};

function timestamp(value: unknown) {
  const parsed = typeof value === 'number' ? value : Date.parse(String(value ?? ''));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function displayTime(value: number) {
  return new Date(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function mapManagedEpgPrograms(input: ManagedEpgProgram[], limit = 3, now = Date.now()): ProviderGuideProgram[] {
  const mapped: ProviderGuideProgram[] = [];
  input.forEach((program, index) => {
    const startAt = timestamp(program.startAt);
    const endAt = timestamp(program.stopAt);
    if (startAt == null || endAt == null || endAt <= startAt) return;
    const current = startAt <= now && endAt > now;
    const title = typeof program.title === 'string' && program.title.trim() ? program.title.trim() : 'No program information available.';
    const start = displayTime(startAt);
    const end = displayTime(endAt);
    mapped.push({
      id: typeof program.id === 'string' && program.id.trim() ? program.id : `managed-epg-${index}-${startAt}`,
      title,
      meta: current ? `${start} - ${end} · ${Math.max(0, Math.ceil((endAt - now) / 60000))} min left` : `${start} - ${end}`,
      description: typeof program.description === 'string' ? program.description : undefined,
      genre: typeof program.category === 'string' ? program.category : undefined,
      start,
      end,
      startAt,
      endAt,
    } satisfies ProviderGuideProgram);
  });
  return mapped.sort((left, right) => {
    const leftCurrent = left.startAt != null && left.endAt != null && left.startAt <= now && left.endAt > now;
    const rightCurrent = right.startAt != null && right.endAt != null && right.startAt <= now && right.endAt > now;
    return Number(rightCurrent) - Number(leftCurrent) || (left.startAt ?? 0) - (right.startAt ?? 0);
  }).slice(0, Math.min(12, Math.max(1, Math.floor(limit))));
}
