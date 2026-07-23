import { novaTheme as baseTheme, type NovaTheme } from './tokens';

export type AppearanceThemeId = 'nova' | 'blackout' | 'ice';

/** Midnight — keep OLED black / white contrast; do not share Ice light chrome. */
const blackoutColors = {
  background: '#000000',
  backgroundRaised: '#050505',
  surface: '#0A0A0A',
  surfaceMuted: '#101010',
  surfaceFocused: '#161616',
  accent: '#FFFFFF',
  accentHover: '#F5F5F5',
  focusRing: '#D4D4D4',
  onAccent: '#000000',
  textPrimary: '#FFFFFF',
  textSecondary: '#A3A3A3',
  textMuted: '#737373',
  borderSubtle: 'rgba(255,255,255,0.06)',
  borderStrong: 'rgba(255,255,255,0.12)',
  success: '#22C55E',
  warning: '#F59E0B',
  danger: '#EF4444',
} as const;

/** Ice only — cream canvas + dark text. Nova / Midnight never use these. */
const iceColors = {
  background: '#F3EEE4',
  backgroundRaised: '#FFFCF7',
  surface: '#E8E1D5',
  surfaceMuted: '#DDD4C6',
  surfaceFocused: '#C9D6E4',
  accent: '#0C4A6E',
  accentHover: '#082F49',
  focusRing: '#155E75',
  onAccent: '#FFFFFF',
  textPrimary: '#1A1510',
  textSecondary: '#3D3429',
  textMuted: '#5C5144',
  borderSubtle: 'rgba(26,21,16,0.28)',
  borderStrong: 'rgba(26,21,16,0.42)',
  success: '#047857',
  warning: '#B45309',
  danger: '#B91C1C',
} as const;

export function resolveNovaTheme(themeId: AppearanceThemeId): NovaTheme {
  if (themeId === 'blackout') {
    return {
      ...baseTheme,
      scheme: 'dark',
      colors: { ...baseTheme.colors, ...blackoutColors },
    };
  }

  if (themeId === 'ice') {
    return {
      ...baseTheme,
      scheme: 'light',
      colors: { ...baseTheme.colors, ...iceColors },
    };
  }

  return { ...baseTheme, scheme: 'dark' };
}

export const APPEARANCE_THEMES: Array<{
  id: AppearanceThemeId;
  label: string;
  copy: string;
  swatch: string[];
}> = [
  {
    id: 'nova',
    label: 'Nova Dark',
    copy: 'Default blue-accent dark theme',
    swatch: ['#07090D', '#3B82F6', '#11151C'],
  },
  {
    id: 'blackout',
    label: 'Midnight',
    copy: 'Pure black background with high-contrast white text',
    swatch: ['#000000', '#FFFFFF', '#0A0A0A'],
  },
  {
    id: 'ice',
    label: 'Ice',
    copy: 'Cream arctic canvas with cool blue accents',
    swatch: ['#F3EEE4', '#0C4A6E', '#E8E1D5'],
  },
];
