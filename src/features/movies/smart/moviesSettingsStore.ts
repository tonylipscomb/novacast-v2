import { useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { isContentSortOption, type ContentSortOption } from '../../media-browser/contentSorting.ts';
import {
  getMovieSortOption,
  getSeriesSortOption,
  setMovieSortOptionSession,
  setSeriesSortOptionSession,
  subscribeContentSortSession,
} from '../../media-browser/contentSortSessionStore.ts';

const STORAGE_KEY = '@novacast/movies-settings';

export type MoviesSettings = {
  hideSmartCategories: boolean;
  movieSortOption: ContentSortOption;
  seriesSortOption: ContentSortOption;
};


let cache: Pick<MoviesSettings, 'hideSmartCategories'> | null = null;
let loadPromise: Promise<Pick<MoviesSettings, 'hideSmartCategories'>> | null = null;
const listeners = new Set<() => void>();

function readPersistedSettings(value: Partial<MoviesSettings> | null): Pick<MoviesSettings, 'hideSmartCategories'> {
  return {
    hideSmartCategories: value?.hideSmartCategories === true,
  };
}

function currentSettings(): MoviesSettings {
  return {
    hideSmartCategories: cache?.hideSmartCategories ?? false,
    movieSortOption: getMovieSortOption(),
    seriesSortOption: getSeriesSortOption(),
  };
}

async function readSettings() {
  if (cache) {
    return currentSettings();
  }

  if (typeof AsyncStorage.getItem !== 'function') {
    cache = readPersistedSettings(null);
    return currentSettings();
  }

  if (!loadPromise) {
    loadPromise = AsyncStorage.getItem(STORAGE_KEY).then((value) => {
      let parsed: Partial<MoviesSettings> | null = null;
      if (value) {
        try {
          parsed = JSON.parse(value) as Partial<MoviesSettings>;
        } catch {
          parsed = null;
        }
      }
      cache = readPersistedSettings(parsed);
      return cache;
    });
  }

  await loadPromise;
  return currentSettings();
}

async function writePersistedSettings(next: Pick<MoviesSettings, 'hideSmartCategories'>) {
  cache = next;
  if (typeof AsyncStorage.setItem === 'function') {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }
  listeners.forEach((listener) => listener());
}

export async function getMoviesSettings() {
  return readSettings();
}

export function getMoviesSettingsSync() {
  return currentSettings();
}

export async function setHideSmartCategories(hideSmartCategories: boolean) {
  const current = await readSettings();
  await writePersistedSettings({ hideSmartCategories });
  return { ...current, hideSmartCategories };
}

export async function setMovieSortOption(movieSortOption: ContentSortOption) {
  if (!isContentSortOption(movieSortOption)) {
    return currentSettings();
  }
  setMovieSortOptionSession(movieSortOption);
  listeners.forEach((listener) => listener());
  return currentSettings();
}

export async function setSeriesSortOption(seriesSortOption: ContentSortOption) {
  if (!isContentSortOption(seriesSortOption)) {
    return currentSettings();
  }
  setSeriesSortOptionSession(seriesSortOption);
  listeners.forEach((listener) => listener());
  return currentSettings();
}

export function clearMoviesSettingsCacheForTests() {
  cache = null;
  loadPromise = null;
}

export function subscribeMoviesSettings(listener: () => void) {
  listeners.add(listener);
  const unsubscribeSession = subscribeContentSortSession(listener);
  return () => {
    listeners.delete(listener);
    unsubscribeSession();
  };
}

export function useMoviesSettingsStore() {
  const [settings, setSettings] = useState<MoviesSettings>(currentSettings());
  const [ready, setReady] = useState(Boolean(cache));

  useEffect(() => {
    let active = true;

    void readSettings().then((next) => {
      if (!active) {
        return;
      }
      setSettings(next);
      setReady(true);
    });

    const unsubscribe = subscribeMoviesSettings(() => {
      if (!active) {
        return;
      }
      setSettings(currentSettings());
      setReady(Boolean(cache));
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  return useMemo(
    () => ({
      settings,
      ready,
      hideSmartCategories: settings.hideSmartCategories,
      movieSortOption: settings.movieSortOption,
      seriesSortOption: settings.seriesSortOption,
      setHideSmartCategories: (value: boolean) => void setHideSmartCategories(value),
      setMovieSortOption: (value: ContentSortOption) => void setMovieSortOption(value),
      setSeriesSortOption: (value: ContentSortOption) => void setSeriesSortOption(value),
    }),
    [ready, settings],
  );
}
