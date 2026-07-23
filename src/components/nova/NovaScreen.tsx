import type { PropsWithChildren } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAppTheme } from '@/theme/AppThemeProvider';

type NovaScreenProps = PropsWithChildren<{
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
  padded?: boolean;
}>;

export function NovaScreen({ children, style, contentStyle, padded = true }: NovaScreenProps) {
  const { theme } = useAppTheme();
  const styles = createStyles(theme);

  return (
    <View style={[styles.root, style]}>
      <SafeAreaView style={[styles.safeArea, padded && styles.padded, contentStyle]}>
        {children}
      </SafeAreaView>
    </View>
  );
}

function createStyles(theme: ReturnType<typeof useAppTheme>['theme']) {
  return StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: theme.colors.background,
    },
    safeArea: {
      flex: 1,
    },
    padded: {
      paddingTop: theme.safeArea.top,
      paddingRight: theme.safeArea.right,
      paddingBottom: theme.safeArea.bottom,
      paddingLeft: theme.safeArea.left,
    },
  });
}
