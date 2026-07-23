export const LIVE_TV_CHANNEL_ROW_HEIGHT = 52;
export const LIVE_TV_CHANNEL_ROW_GAP = 3;
export const LIVE_TV_CHANNEL_ROW_STRIDE = LIVE_TV_CHANNEL_ROW_HEIGHT + LIVE_TV_CHANNEL_ROW_GAP;

export function getLiveTvChannelItemLayout(_data: unknown, index: number) {
  return {
    length: LIVE_TV_CHANNEL_ROW_STRIDE,
    offset: LIVE_TV_CHANNEL_ROW_STRIDE * index,
    index,
  };
}
