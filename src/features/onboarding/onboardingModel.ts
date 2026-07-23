export type OnboardingGuideKey =
  | 'pairingGuideSeen'
  | 'portalWelcomeSeen'
  | 'hubGuideSeen'
  | 'liveTvGuideSeen'
  | 'moviesGuideSeen'
  | 'seriesGuideSeen'
  | 'guideScreenGuideSeen'
  | 'settingsGuideSeen';

export type OnboardingState = {
  version: 1;
  pairingGuideSeen: boolean;
  portalWelcomeSeen: boolean;
  hubGuideSeen: boolean;
  liveTvGuideSeen: boolean;
  moviesGuideSeen: boolean;
  seriesGuideSeen: boolean;
  guideScreenGuideSeen: boolean;
  settingsGuideSeen: boolean;
  suppressAllGuides: boolean;
};

export const ONBOARDING_STATE_VERSION = 1 as const;

export function createDefaultOnboardingState(): OnboardingState {
  return {
    version: ONBOARDING_STATE_VERSION,
    pairingGuideSeen: false,
    portalWelcomeSeen: false,
    hubGuideSeen: false,
    liveTvGuideSeen: false,
    moviesGuideSeen: false,
    seriesGuideSeen: false,
    guideScreenGuideSeen: false,
    settingsGuideSeen: false,
    suppressAllGuides: false,
  };
}

export function normalizeOnboardingState(next: Partial<OnboardingState> | null | undefined): OnboardingState {
  const base = createDefaultOnboardingState();

  if (!next || next.version !== ONBOARDING_STATE_VERSION) {
    return base;
  }

  return {
    ...base,
    ...next,
    version: ONBOARDING_STATE_VERSION,
  };
}

export function shouldAutoShowGuide(state: OnboardingState, key: OnboardingGuideKey) {
  return !state.suppressAllGuides && !state[key];
}

export function markGuideSeen(state: OnboardingState, key: OnboardingGuideKey): OnboardingState {
  return {
    ...state,
    [key]: true,
  };
}

export function setSuppressAllGuides(state: OnboardingState, suppressAllGuides: boolean): OnboardingState {
  return {
    ...state,
    suppressAllGuides,
  };
}

export function resetOnboardingState(): OnboardingState {
  return createDefaultOnboardingState();
}

export const guideKeyLabelMap: Record<OnboardingGuideKey, string> = {
  pairingGuideSeen: 'Pairing',
  portalWelcomeSeen: 'Portal',
  hubGuideSeen: 'Home',
  liveTvGuideSeen: 'Live TV',
  moviesGuideSeen: 'Movies',
  seriesGuideSeen: 'Series',
  guideScreenGuideSeen: 'Guide',
  settingsGuideSeen: 'Settings',
};
