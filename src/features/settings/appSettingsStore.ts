import { useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = '@novacast/app-settings';
const PIN_STORAGE_KEY = '@novacast/parental-pin';

export type AppearanceThemeId = 'nova' | 'blackout' | 'ice';
export type PlaybackQuality = 'auto' | '1080p' | '720p';
export type PlaybackAudio = 'stereo' | 'surround';
export type ParentalRating = 'off' | 'pg' | 'pg13' | 'r';

export type AppSettings = {
  appearanceTheme: AppearanceThemeId;
  playbackQuality: PlaybackQuality;
  playbackAudio: PlaybackAudio;
  autoplayNextEpisode: boolean;
  resumePlayback: boolean;
  parentalEnabled: boolean;
  parentalMaxRating: ParentalRating;
};

const DEFAULT_SETTINGS: AppSettings = {
  appearanceTheme: 'nova',
  playbackQuality: 'auto',
  playbackAudio: 'stereo',
  autoplayNextEpisode: true,
  resumePlayback: true,
  parentalEnabled: false,
  parentalMaxRating: 'pg13',
};

let cache: AppSettings | null = null;
let loadPromise: Promise<AppSettings> | null = null;
let pinCache: string | null | undefined;
const listeners = new Set<() => void>();

function normalizeSettings(value: Partial<AppSettings> | null | undefined): AppSettings {
  return {
    appearanceTheme:
      value?.appearanceTheme === 'blackout' || value?.appearanceTheme === 'ice' || value?.appearanceTheme === 'nova'
        ? value.appearanceTheme
        : DEFAULT_SETTINGS.appearanceTheme,
    playbackQuality:
      value?.playbackQuality === '1080p' || value?.playbackQuality === '720p' || value?.playbackQuality === 'auto'
        ? value.playbackQuality
        : DEFAULT_SETTINGS.playbackQuality,
    playbackAudio:
      value?.playbackAudio === 'surround' || value?.playbackAudio === 'stereo'
        ? value.playbackAudio
        : DEFAULT_SETTINGS.playbackAudio,
    autoplayNextEpisode: value?.autoplayNextEpisode !== false,
    resumePlayback: value?.resumePlayback !== false,
    parentalEnabled: value?.parentalEnabled === true,
    parentalMaxRating:
      value?.parentalMaxRating === 'off' ||
      value?.parentalMaxRating === 'pg' ||
      value?.parentalMaxRating === 'pg13' ||
      value?.parentalMaxRating === 'r'
        ? value.parentalMaxRating
        : DEFAULT_SETTINGS.parentalMaxRating,
  };
}

async function readSettings(): Promise<AppSettings> {
  if (cache) {
    return cache;
  }

  if (typeof AsyncStorage.getItem !== 'function') {
    cache = { ...DEFAULT_SETTINGS };
    return cache;
  }

  if (!loadPromise) {
    loadPromise = AsyncStorage.getItem(STORAGE_KEY).then((raw) => {
      if (!raw) {
        cache = { ...DEFAULT_SETTINGS };
        return cache;
      }

      try {
        cache = normalizeSettings(JSON.parse(raw) as Partial<AppSettings>);
      } catch {
        cache = { ...DEFAULT_SETTINGS };
      }
      return cache!;
    });
  }

  return loadPromise;
}

async function writeSettings(next: AppSettings) {
  cache = next;
  if (typeof AsyncStorage.setItem === 'function') {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }
  listeners.forEach((listener) => listener());
}

async function readPin(): Promise<string | null> {
  if (pinCache !== undefined) {
    return pinCache;
  }

  try {
    const SecureStore = await import('expo-secure-store');
    pinCache = (await SecureStore.getItemAsync(PIN_STORAGE_KEY)) ?? null;
  } catch {
    pinCache = null;
  }

  return pinCache;
}

export async function getParentalPinConfigured() {
  const pin = await readPin();
  return Boolean(pin && pin.length >= 4);
}

export async function setParentalPin(pin: string) {
  const SecureStore = await import('expo-secure-store');
  await SecureStore.setItemAsync(PIN_STORAGE_KEY, pin);
  pinCache = pin;
  const current = await readSettings();
  if (!current.parentalEnabled) {
    await writeSettings({ ...current, parentalEnabled: true });
  } else {
    listeners.forEach((listener) => listener());
  }
}

export async function clearParentalPin() {
  try {
    const SecureStore = await import('expo-secure-store');
    await SecureStore.deleteItemAsync(PIN_STORAGE_KEY);
  } catch {
    // ignore
  }
  pinCache = null;
  listeners.forEach((listener) => listener());
}

export async function verifyParentalPin(pin: string) {
  const stored = await readPin();
  return stored === pin;
}

export function getAppSettingsSync() {
  return cache ?? { ...DEFAULT_SETTINGS };
}

export async function getAppSettings() {
  return readSettings();
}

export async function patchAppSettings(patch: Partial<AppSettings>) {
  const current = await readSettings();
  await writeSettings(normalizeSettings({ ...current, ...patch }));
}

export function subscribeAppSettings(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useAppSettingsStore() {
  const [settings, setSettings] = useState<AppSettings>(() => getAppSettingsSync());
  const [pinConfigured, setPinConfigured] = useState(false);

  useEffect(() => {
    let mounted = true;
    void readSettings().then((next) => {
      if (mounted) {
        setSettings(next);
      }
    });
    void getParentalPinConfigured().then((configured) => {
      if (mounted) {
        setPinConfigured(configured);
      }
    });

    const unsubscribe = subscribeAppSettings(() => {
      setSettings(getAppSettingsSync());
      void getParentalPinConfigured().then((configured) => {
        if (mounted) {
          setPinConfigured(configured);
        }
      });
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  return useMemo(
    () => ({
      settings,
      pinConfigured,
      setAppearanceTheme: (appearanceTheme: AppearanceThemeId) => patchAppSettings({ appearanceTheme }),
      setPlaybackQuality: (playbackQuality: PlaybackQuality) => patchAppSettings({ playbackQuality }),
      setPlaybackAudio: (playbackAudio: PlaybackAudio) => patchAppSettings({ playbackAudio }),
      setAutoplayNextEpisode: (autoplayNextEpisode: boolean) => patchAppSettings({ autoplayNextEpisode }),
      setResumePlayback: (resumePlayback: boolean) => patchAppSettings({ resumePlayback }),
      setParentalEnabled: (parentalEnabled: boolean) => patchAppSettings({ parentalEnabled }),
      setParentalMaxRating: (parentalMaxRating: ParentalRating) => patchAppSettings({ parentalMaxRating }),
      setParentalPin,
      clearParentalPin,
    }),
    [pinConfigured, settings],
  );
}

export function appearanceThemeLabel(theme: AppearanceThemeId) {
  if (theme === 'blackout') {
    return 'Midnight';
  }
  if (theme === 'ice') {
    return 'Ice';
  }
  return 'Nova Dark';
}

export function playbackQualityLabel(value: PlaybackQuality) {
  if (value === '1080p') {
    return '1080p';
  }
  if (value === '720p') {
    return '720p';
  }
  return 'Auto';
}

export function parentalRatingLabel(value: ParentalRating) {
  if (value === 'pg') {
    return 'PG';
  }
  if (value === 'pg13') {
    return 'PG-13';
  }
  if (value === 'r') {
    return 'R';
  }
  return 'Off';
}
