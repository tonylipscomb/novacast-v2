import { createContext, useContext, useEffect, useMemo, useState, type PropsWithChildren } from 'react';

import { getAppSettings, getAppSettingsSync, subscribeAppSettings } from '@/features/settings/appSettingsStore';

import { resolveNovaTheme, type AppearanceThemeId } from './variants';
import { novaTheme as defaultTheme, type NovaTheme } from './tokens';

type AppThemeContextValue = {
  theme: NovaTheme;
  themeId: AppearanceThemeId;
};

const AppThemeContext = createContext<AppThemeContextValue>({
  theme: defaultTheme,
  themeId: 'nova',
});

export function AppThemeProvider({ children }: PropsWithChildren) {
  const [themeId, setThemeId] = useState<AppearanceThemeId>(() => getAppSettingsSync().appearanceTheme);

  useEffect(() => {
    let mounted = true;
    void getAppSettings().then((settings) => {
      if (mounted) {
        setThemeId(settings.appearanceTheme);
      }
    });

    const unsubscribe = subscribeAppSettings(() => {
      setThemeId(getAppSettingsSync().appearanceTheme);
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  const value = useMemo(
    () => ({
      themeId,
      theme: resolveNovaTheme(themeId),
    }),
    [themeId],
  );

  return <AppThemeContext.Provider value={value}>{children}</AppThemeContext.Provider>;
}

export function useAppTheme() {
  return useContext(AppThemeContext);
}
