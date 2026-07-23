import type { ImageSourcePropType } from 'react-native';

import type { AppearanceThemeId } from './variants';

const NOVA_LOGO = require('@/assets/images/novacast-logo.png');
const ICE_LOGO = require('@/assets/images/NCicelogo.png');
const MIDNIGHT_LOGO = require('@/assets/images/NCmidnightlogo.png');

/** Home hero only — Ice / Midnight splash art. Nova keeps the existing card art. */
const NOVA_HERO = require('@/assets/images/novacastnewcard.png');
const ICE_HERO = require('@/assets/images/NCIceSplash.png');
const MIDNIGHT_HERO = require('@/assets/images/NCmidnightsplash.png');

const NOVA_MARK = require('@/assets/images/nav-mark.png');

/** Full brand logo (portal, launch fallback, pairing). */
export function getThemeLogoSource(themeId: AppearanceThemeId): ImageSourcePropType {
  if (themeId === 'ice') {
    return ICE_LOGO;
  }
  if (themeId === 'blackout') {
    return MIDNIGHT_LOGO;
  }
  return NOVA_LOGO;
}

/**
 * Compact nav / mark asset.
 * Ice & Midnight logos already include the wordmark, so they replace nav-mark.
 */
export function getThemeMarkSource(themeId: AppearanceThemeId): ImageSourcePropType {
  if (themeId === 'ice') {
    return ICE_LOGO;
  }
  if (themeId === 'blackout') {
    return MIDNIGHT_LOGO;
  }
  return NOVA_MARK;
}

/** Home screen hero banner only — do not use for launch / Content Hub / elsewhere. */
export function getThemeHeroSource(themeId: AppearanceThemeId): ImageSourcePropType {
  if (themeId === 'ice') {
    return ICE_HERO;
  }
  if (themeId === 'blackout') {
    return MIDNIGHT_HERO;
  }
  return NOVA_HERO;
}

/** True when the logo image already carries the NOVACAST wordmark. */
export function themeLogoIncludesWordmark(themeId: AppearanceThemeId) {
  return themeId === 'ice' || themeId === 'blackout';
}
