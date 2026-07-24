import { memo, useState, type ReactNode } from 'react';
import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native';

import { tvPerfRecordGuideCellRender } from '@/features/perf/tvPerfStore';

type GuideLocalFocusPressableProps = {
  focusable?: boolean;
  hasTVPreferredFocus?: boolean;
  accessibilityRole?: 'button';
  accessibilityLabel?: string;
  nextFocusLeft?: number;
  nextFocusRight?: number;
  nextFocusUp?: number;
  nextFocusDown?: number;
  onFocus?: () => void;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  focusedStyle?: StyleProp<ViewStyle>;
  children: ReactNode | ((focused: boolean) => ReactNode);
  pressableRef?: (instance: View | null) => void;
};

/**
 * Local focus chrome for Guide cells — highlight moves without GuideScreen setState.
 */
export const GuideLocalFocusPressable = memo(function GuideLocalFocusPressable({
  focusable = true,
  hasTVPreferredFocus,
  accessibilityRole,
  accessibilityLabel,
  nextFocusLeft,
  nextFocusRight,
  nextFocusUp,
  nextFocusDown,
  onFocus,
  onPress,
  style,
  focusedStyle,
  children,
  pressableRef,
}: GuideLocalFocusPressableProps) {
  const [focused, setFocused] = useState(false);
  tvPerfRecordGuideCellRender();

  return (
    <Pressable
      ref={pressableRef as never}
      focusable={focusable}
      hasTVPreferredFocus={hasTVPreferredFocus}
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel}
      {...(nextFocusLeft != null ? { nextFocusLeft } : null)}
      {...(nextFocusRight != null ? { nextFocusRight } : null)}
      {...(nextFocusUp != null ? { nextFocusUp } : null)}
      {...(nextFocusDown != null ? { nextFocusDown } : null)}
      onFocus={() => {
        setFocused(true);
        onFocus?.();
      }}
      onBlur={() => setFocused(false)}
      onPress={onPress}
      style={[style, focused ? focusedStyle : null]}>
      {typeof children === 'function' ? children(focused) : children}
    </Pressable>
  );
});
