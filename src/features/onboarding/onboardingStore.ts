import { useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  createDefaultOnboardingState,
  markGuideSeen,
  normalizeOnboardingState,
  resetOnboardingState,
  setSuppressAllGuides,
  type OnboardingGuideKey,
  type OnboardingState,
} from './onboardingModel';

const STORAGE_KEY = '@novacast/onboarding-state';

let cache: OnboardingState | null = null;
let loadPromise: Promise<OnboardingState> | null = null;
const listeners = new Set<() => void>();

async function readState() {
  if (cache) {
    return cache;
  }

  if (!loadPromise) {
    loadPromise = AsyncStorage.getItem(STORAGE_KEY).then((value) => {
      let parsed: Partial<OnboardingState> | null = null;

      if (value) {
        try {
          parsed = JSON.parse(value) as Partial<OnboardingState>;
        } catch {
          parsed = null;
        }
      }

      cache = normalizeOnboardingState(parsed);
      return cache;
    });
  }

  return loadPromise;
}

async function writeState(next: OnboardingState) {
  cache = next;
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  listeners.forEach((listener) => listener());
}

export async function getOnboardingState() {
  return readState();
}

export async function updateOnboardingState(
  updater: (state: OnboardingState) => OnboardingState | Promise<OnboardingState>,
) {
  const current = await readState();
  const next = await updater(current);
  await writeState(next);
  return next;
}

export async function markOnboardingGuideSeen(key: OnboardingGuideKey) {
  return updateOnboardingState((state) => markGuideSeen(state, key));
}

export async function setOnboardingSuppressAllGuides(suppressAllGuides: boolean) {
  return updateOnboardingState((state) => setSuppressAllGuides(state, suppressAllGuides));
}

export async function resetOnboarding() {
  loadPromise = null;
  return writeState(resetOnboardingState());
}

export function clearOnboardingCacheForTests() {
  cache = null;
  loadPromise = null;
}

export function subscribeOnboarding(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useOnboardingStore() {
  const [state, setState] = useState<OnboardingState>(cache ?? createDefaultOnboardingState());
  const [ready, setReady] = useState(Boolean(cache));

  useEffect(() => {
    let active = true;

    void readState().then((next) => {
      if (!active) {
        return;
      }

      setState(next);
      setReady(true);
    });

    const unsubscribe = subscribeOnboarding(() => {
      if (!active) {
        return;
      }

      setState(cache ?? createDefaultOnboardingState());
      setReady(Boolean(cache));
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  return useMemo(
    () => ({
      state,
      ready,
    }),
    [ready, state],
  );
}
