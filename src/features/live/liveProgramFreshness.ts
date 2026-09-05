import type { ProviderGuideProgram } from '../providers/providerRepositories.ts';

export const CURRENT_PROGRAM_OVERLAY_TTL_MS = 5 * 60 * 1000;

export function isCurrentProgramFresh(input: {
  fetchedAt?: number | null;
  startAt?: number | null;
  endAt?: number | null;
  now?: number;
  ttlMs?: number;
}) {
  const now = input.now ?? Date.now();
  const ttlMs = input.ttlMs ?? CURRENT_PROGRAM_OVERLAY_TTL_MS;
  if (input.fetchedAt == null || !Number.isFinite(input.fetchedAt) || now - input.fetchedAt > ttlMs) return false;
  if (input.startAt != null && Number.isFinite(input.startAt) && input.startAt > now) return false;
  if (input.endAt != null && Number.isFinite(input.endAt) && input.endAt <= now) return false;
  return true;
}

export function selectCurrentEpgProgram(programs: ProviderGuideProgram[], now = Date.now()) {
  const current = programs.find((program) =>
    program.startAt != null && program.endAt != null &&
    program.startAt <= now && program.endAt > now,
  );
  if (current) return { program: current, staleProgramRejected: false };
  const timestamped = programs.some((program) => program.startAt != null || program.endAt != null);
  return {
    program: timestamped ? undefined : programs[0],
    staleProgramRejected: programs.length > 0 && timestamped,
  };
}
