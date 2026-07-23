import { useState } from 'react';

import {
  markOnboardingGuideSeen,
  setOnboardingSuppressAllGuides,
  useOnboardingStore,
} from './onboardingStore';
import type { OnboardingGuideKey } from './onboardingModel';
import { shouldAutoShowGuide } from './onboardingModel';

export function useGuideWalkthrough(key: OnboardingGuideKey) {
  const { state, ready } = useOnboardingStore();
  const [dismissed, setDismissed] = useState(false);

  const visible = ready && !dismissed && shouldAutoShowGuide(state, key);

  const dismiss = () => {
    setDismissed(true);
  };

  const skip = () => {
    setDismissed(true);
  };

  const dontShowAgain = async () => {
    await markOnboardingGuideSeen(key);
    setDismissed(true);
  };

  const complete = async () => {
    await markOnboardingGuideSeen(key);
    setDismissed(true);
  };

  const suppressAll = async () => {
    await setOnboardingSuppressAllGuides(true);
    setDismissed(true);
  };

  const reopen = () => {
    setDismissed(false);
  };

  return {
    visible,
    ready,
    dismiss,
    skip,
    dontShowAgain,
    complete,
    suppressAll,
    reopen,
  };
}
