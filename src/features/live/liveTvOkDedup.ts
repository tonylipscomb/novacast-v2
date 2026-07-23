export const LIVE_TV_OK_DEDUP_MS = 350;

export type LiveTvOkPressRecord = {
  channelId: string;
  at: number;
};

export function shouldAcceptLiveTvOkPress(
  channelId: string,
  previous: LiveTvOkPressRecord | null,
  now: number,
  dedupMs = LIVE_TV_OK_DEDUP_MS,
): boolean {
  if (!previous) {
    return true;
  }

  if (previous.channelId !== channelId) {
    return true;
  }

  return now - previous.at >= dedupMs;
}
