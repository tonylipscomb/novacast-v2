export type TvDensity = 'compact' | 'normal' | 'comfortable';

export function getTvDensity(width: number): TvDensity {
  if (width < 1400) {
    return 'compact';
  }

  if (width < 2200) {
    return 'normal';
  }

  return 'comfortable';
}

export function getPosterColumns(width: number) {
  if (width >= 1700) {
    return 6;
  }

  if (width >= 1050) {
    return 5;
  }

  return 4;
}

/** Series posters get one extra column so more rows fit above the fold. */
export function getSeriesPosterColumns(width: number) {
  if (width >= 1700) {
    return 7;
  }

  if (width >= 1050) {
    return 6;
  }

  return 5;
}
