export type LiveFocusNavigationIntent = 'none' | 'left' | 'explicit-category';

export type LiveFocusRetentionInput = {
  previousOwner: 'categories' | 'channels' | null;
  navigationIntent: LiveFocusNavigationIntent;
  intentAgeMs: number;
  intentWindowMs?: number;
  focusedChannelId?: string | null;
  preferredChannelId?: string | null;
  selectedChannelId?: string | null;
};

export function shouldRetainChannelFocus(input: LiveFocusRetentionInput): boolean {
  if (input.previousOwner !== 'channels') return false;
  if (input.navigationIntent === 'explicit-category') return false;
  if (input.navigationIntent === 'left' && input.intentAgeMs <= (input.intentWindowMs ?? 500)) return false;
  return Boolean(input.focusedChannelId || input.preferredChannelId || input.selectedChannelId);
}

export function resolveChannelFocusRetentionTarget(input: Pick<LiveFocusRetentionInput, 'focusedChannelId' | 'preferredChannelId' | 'selectedChannelId'>) {
  return input.focusedChannelId ?? input.preferredChannelId ?? input.selectedChannelId ?? null;
}
