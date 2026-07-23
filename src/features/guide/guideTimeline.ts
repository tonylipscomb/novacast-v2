import type { ProviderGuideProgram, ProviderGuideRow } from '@/features/providers/providerRepositories';

export const GUIDE_CHANNEL_COLUMN_WIDTH = 235;
export const GUIDE_PIXELS_PER_MINUTE = 1.5;
export const GUIDE_MIN_PROGRAM_WIDTH = 132;
export const GUIDE_TIME_SLOT_MINUTES = 60;

export type NormalizedGuideProgram = ProviderGuideProgram & {
  startAt?: number;
  endAt?: number;
  hasValidWindow: boolean;
};

export type NormalizedGuideRow = Omit<ProviderGuideRow, 'programs'> & {
  programs: NormalizedGuideProgram[];
};

function parseClockTime(value: string, reference: number) {
  const match = value.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?$/i);
  if (!match) {
    return null;
  }

  const date = new Date(reference);
  let hour = Number(match[1]);
  const minute = Number(match[2] ?? 0);
  const meridiem = match[3]?.toUpperCase();
  if (meridiem === 'PM' && hour < 12) hour += 12;
  if (meridiem === 'AM' && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) return null;
  date.setHours(hour, minute, 0, 0);
  return date.getTime();
}

export function parseGuideTimestamp(value: unknown, reference = Date.now()): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value < 1_000_000_000_000 ? value * 1000 : value;
  }

  if (typeof value !== 'string' || !value.trim()) {
    return undefined;
  }

  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    return numeric < 1_000_000_000_000 ? numeric * 1000 : numeric;
  }

  const parsed = Date.parse(value);
  if (Number.isFinite(parsed)) {
    return parsed;
  }

  return parseClockTime(value, reference) ?? undefined;
}

function cleanText(value?: string) {
  const text = value?.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim();
  return text || undefined;
}

export function normalizeGuideProgram(program: ProviderGuideProgram, index: number, reference = Date.now()): NormalizedGuideProgram {
  const startAt = parseGuideTimestamp(program.startAt ?? program.start, reference);
  const endAt = parseGuideTimestamp(program.endAt ?? program.end, reference);
  const hasValidWindow = startAt !== undefined && endAt !== undefined && endAt > startAt;

  return {
    ...program,
    id: program.id?.trim() || `program-${index}`,
    title: cleanText(program.title) ?? 'No program information available.',
    meta: cleanText(program.meta) ?? 'Time unavailable',
    description: cleanText(program.description),
    startAt,
    endAt: hasValidWindow ? endAt : undefined,
    hasValidWindow,
  };
}

export function normalizeGuideRows(rows: ProviderGuideRow[], reference = Date.now()): NormalizedGuideRow[] {
  return rows.map((row) => {
    const seen = new Set<string>();
    const normalizedPrograms = row.programs
      .map((program, index) => normalizeGuideProgram(program, index, reference))
      .filter((program) => {
        const key = `${program.id}:${program.startAt ?? ''}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((left, right) => (left.startAt ?? Number.MAX_SAFE_INTEGER) - (right.startAt ?? Number.MAX_SAFE_INTEGER));

    const programs: NormalizedGuideProgram[] = [];
    let previousEndAt: number | undefined;
    for (const program of normalizedPrograms) {
      if (!program.hasValidWindow || program.startAt === undefined || program.endAt === undefined) {
        programs.push(program);
        continue;
      }

      const adjustedStartAt = previousEndAt !== undefined ? Math.max(program.startAt, previousEndAt) : program.startAt;
      if (adjustedStartAt >= program.endAt) {
        continue;
      }

      const adjustedProgram = adjustedStartAt === program.startAt
        ? program
        : { ...program, startAt: adjustedStartAt };
      programs.push(adjustedProgram);
      previousEndAt = adjustedProgram.endAt;
    }

    return { channel: row.channel, programs };
  });
}

function floorToHour(timestamp: number) {
  const date = new Date(timestamp);
  date.setMinutes(0, 0, 0);
  return date.getTime();
}

function ceilToHour(timestamp: number) {
  return floorToHour(timestamp + 59 * 60 * 1000) + 60 * 60 * 1000;
}

export function getGuideWindow(rows: NormalizedGuideRow[], now = Date.now()) {
  const timestamps = rows.flatMap((row) => row.programs.flatMap((program) => [program.startAt, program.endAt])).filter(
    (timestamp): timestamp is number => typeof timestamp === 'number' && Number.isFinite(timestamp),
  );
  const earliest = timestamps.length ? Math.min(...timestamps) : now - 2 * 60 * 60 * 1000;
  const latest = timestamps.length ? Math.max(...timestamps) : now + 4 * 60 * 60 * 1000;

  return {
    startAt: floorToHour(Math.min(earliest, now - 2 * 60 * 60 * 1000)),
    endAt: ceilToHour(Math.max(latest, now + 4 * 60 * 60 * 1000)),
  };
}

export function getProgramWidth(program: Pick<NormalizedGuideProgram, 'startAt' | 'endAt'>) {
  if (!program.startAt || !program.endAt || program.endAt <= program.startAt) {
    return GUIDE_MIN_PROGRAM_WIDTH;
  }

  return Math.max(GUIDE_MIN_PROGRAM_WIDTH, ((program.endAt - program.startAt) / 60_000) * GUIDE_PIXELS_PER_MINUTE);
}

export function timeToTimelinePixels(timestamp: number, timelineStartAt: number) {
  return Math.max(0, ((timestamp - timelineStartAt) / 60_000) * GUIDE_PIXELS_PER_MINUTE);
}

export function getProgramOffset(program: Pick<NormalizedGuideProgram, 'startAt'>, timelineStartAt: number) {
  return program.startAt === undefined ? 0 : timeToTimelinePixels(program.startAt, timelineStartAt);
}

export function findProgramForTimestamp(row: NormalizedGuideRow | undefined, timestamp: number) {
  if (!row?.programs.length) return null;

  return (
    row.programs.find((program) => program.startAt !== undefined && program.endAt !== undefined && timestamp >= program.startAt && timestamp < program.endAt) ??
    row.programs.reduce((closest, program) => {
      const distance = Math.abs((program.startAt ?? timestamp) - timestamp);
      const closestDistance = Math.abs((closest.startAt ?? timestamp) - timestamp);
      return distance < closestDistance ? program : closest;
    }, row.programs[0])
  );
}

export function findVerticalProgram(
  rows: NormalizedGuideRow[],
  rowIndex: number,
  timestamp: number,
  direction: 'up' | 'down',
) {
  const targetRow = rows[rowIndex + (direction === 'up' ? -1 : 1)];
  return targetRow ? findProgramForTimestamp(targetRow, timestamp) : null;
}

export function getProgramStatus(program: NormalizedGuideProgram, now = Date.now()): 'past' | 'live' | 'upcoming' | 'unknown' {
  if (!program.hasValidWindow || program.startAt === undefined || program.endAt === undefined) return 'unknown';
  if (now < program.startAt) return 'upcoming';
  if (now >= program.endAt) return 'past';
  return 'live';
}

export function formatGuideTime(timestamp: number | undefined) {
  if (!timestamp) return 'Time unavailable';
  return new Date(timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function formatGuideDate(timestamp: number | undefined) {
  if (!timestamp) return 'Date unavailable';
  return new Date(timestamp).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export function formatRelativeGuideTime(program: NormalizedGuideProgram, now = Date.now()) {
  if (!program.hasValidWindow || program.startAt === undefined || program.endAt === undefined) return null;
  const minutes = Math.max(0, Math.round((program.startAt - now) / 60_000));
  if (now >= program.startAt && now < program.endAt) {
    const remaining = Math.max(0, Math.round((program.endAt - now) / 60_000));
    return `${remaining} min remaining`;
  }
  if (program.startAt > now) return minutes < 60 ? `Starts in ${minutes} min` : `Starts at ${formatGuideTime(program.startAt)}`;
  return null;
}
