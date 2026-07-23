/**
 * Development-only visual modes for Live TV channel-row A/B profiling.
 * Flip `LIVE_TV_ROW_AB_MODE` locally and reload Metro to compare scroll feel.
 */
export type LiveTvRowAbMode =
  | 'normal'
  | 'lightweight'
  | 'ab-restore-logos'
  | 'ab-restore-focus'
  | 'ab-restore-highlights'
  | 'ab-restore-detail';

/** Default production/TV UI — full logos, EPG rows, highlights, and live detail panel. */
export const LIVE_TV_ROW_AB_MODE: LiveTvRowAbMode = 'normal';

const DEV_AB_MODE = process.env.EXPO_PUBLIC_LIVE_TV_AB_MODE as LiveTvRowAbMode | undefined;

const VALID_AB_MODES = new Set<LiveTvRowAbMode>([
  'normal',
  'lightweight',
  'ab-restore-logos',
  'ab-restore-focus',
  'ab-restore-highlights',
  'ab-restore-detail',
]);

/** Full UI on device builds; dev-only A/B modes require EXPO_PUBLIC_LIVE_TV_AB_MODE. */
export function resolveLiveTvRowAbMode(): LiveTvRowAbMode {
  if (typeof __DEV__ !== 'undefined' && __DEV__ && DEV_AB_MODE && VALID_AB_MODES.has(DEV_AB_MODE)) {
    return DEV_AB_MODE;
  }

  return 'normal';
}

export type LiveTvRowVisualFlags = {
  showLogos: boolean;
  showProgress: boolean;
  showResolution: boolean;
  showPreviewingHighlight: boolean;
  showSelectedHighlight: boolean;
  lightweightFocus: boolean;
  freezeDetailPanel: boolean;
};

export function getLiveTvRowVisualFlags(mode: LiveTvRowAbMode = resolveLiveTvRowAbMode()): LiveTvRowVisualFlags {
  switch (mode) {
    case 'lightweight':
      return {
        showLogos: false,
        showProgress: false,
        showResolution: false,
        showPreviewingHighlight: false,
        showSelectedHighlight: false,
        lightweightFocus: true,
        freezeDetailPanel: true,
      };
    case 'ab-restore-logos':
      return {
        showLogos: true,
        showProgress: false,
        showResolution: false,
        showPreviewingHighlight: false,
        showSelectedHighlight: false,
        lightweightFocus: true,
        freezeDetailPanel: true,
      };
    case 'ab-restore-focus':
      return {
        showLogos: true,
        showProgress: false,
        showResolution: false,
        showPreviewingHighlight: false,
        showSelectedHighlight: false,
        lightweightFocus: false,
        freezeDetailPanel: true,
      };
    case 'ab-restore-highlights':
      return {
        showLogos: true,
        showProgress: true,
        showResolution: true,
        showPreviewingHighlight: true,
        showSelectedHighlight: true,
        lightweightFocus: false,
        freezeDetailPanel: true,
      };
    case 'ab-restore-detail':
      return {
        showLogos: true,
        showProgress: true,
        showResolution: true,
        showPreviewingHighlight: true,
        showSelectedHighlight: true,
        lightweightFocus: false,
        freezeDetailPanel: false,
      };
    case 'normal':
    default:
      return {
        showLogos: true,
        showProgress: true,
        showResolution: true,
        showPreviewingHighlight: true,
        showSelectedHighlight: true,
        lightweightFocus: false,
        freezeDetailPanel: false,
      };
  }
}

export function isLiveTvRowAbModeActive(): boolean {
  return typeof __DEV__ !== 'undefined' && __DEV__ && resolveLiveTvRowAbMode() !== 'normal';
}
