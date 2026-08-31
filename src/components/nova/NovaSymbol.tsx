import { Image } from 'react-native';

import { useAppTheme } from '@/theme/AppThemeProvider';
import { getThemeMarkSource } from '@/theme/brandingAssets';

type NovaSymbolProps = {
  width: number;
  height?: number;
};

export function NovaSymbol({ width, height = width * (1519 / 2400) }: NovaSymbolProps) {
  const { themeId } = useAppTheme();
  return <Image source={getThemeMarkSource(themeId)} style={{ width, height }} resizeMode="contain" />;
}
