import {
  getMoviesSettings,
  setHideSmartCategories,
  setSeriesSortOption,
  subscribeMoviesSettings,
  useMoviesSettingsStore,
  type MoviesSettings,
} from '../movies/smart/moviesSettingsStore.ts';

export type MediaSettings = MoviesSettings;

export async function getMediaSettings() {
  return getMoviesSettings();
}

export async function setHideSmartMediaCategories(hideSmartCategories: boolean) {
  return setHideSmartCategories(hideSmartCategories);
}

export { setSeriesSortOption };

export function subscribeMediaSettings(listener: () => void) {
  return subscribeMoviesSettings(listener);
}

export function useMediaSettingsStore() {
  return useMoviesSettingsStore();
}
