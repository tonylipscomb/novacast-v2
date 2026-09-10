import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, StyleSheet, Text, View, type StyleProp, type TextStyle } from 'react-native';

import { recordLiveTvMarqueeLayout, recordLiveTvMarqueeMount, recordLiveTvMarqueeTextLayout } from './liveTvScrollPerf';

type LiveTvMarqueeTextProps = {
  children: ReactNode;
  focused: boolean;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
};

/** Keeps long Live labels quiet until focus, then gives the viewer a bounded read-through. */
export function LiveTvMarqueeText({ children, focused, style, numberOfLines = 1 }: LiveTvMarqueeTextProps) {
  useEffect(() => {
    recordLiveTvMarqueeMount();
  }, []);
  const offset = useRef(new Animated.Value(0)).current;
  const animation = useRef<Animated.CompositeAnimation | null>(null);
  const [viewportWidth, setViewportWidth] = useState(0);
  const [contentWidth, setContentWidth] = useState(0);
  const text = String(children ?? '');
  const distance = Math.max(0, contentWidth - viewportWidth + 8);

  useEffect(() => {
    animation.current?.stop();
    animation.current = null;
    offset.stopAnimation();
    offset.setValue(0);
    if (!focused || distance <= 0) return;

    const duration = Math.min(8000, Math.max(2200, distance * 24));
    const loop = Animated.loop(Animated.sequence([
      Animated.delay(500),
      Animated.timing(offset, { toValue: -distance, duration, useNativeDriver: true }),
      Animated.delay(900),
      Animated.timing(offset, { toValue: 0, duration: 350, useNativeDriver: true }),
    ]));
    animation.current = loop;
    loop.start();
    return () => {
      loop.stop();
      animation.current = null;
      offset.stopAnimation();
      offset.setValue(0);
    };
  }, [distance, focused, offset, text]);

  return (
    <View style={styles.viewport} onLayout={(event) => {
      recordLiveTvMarqueeLayout();
      setViewportWidth(event.nativeEvent.layout.width);
    }}>
      <Animated.Text
        numberOfLines={numberOfLines}
        ellipsizeMode="tail"
        onTextLayout={(event) => {
          recordLiveTvMarqueeTextLayout();
          setContentWidth(event.nativeEvent.lines[0]?.width ?? 0);
        }}
        style={[style, styles.content, { transform: [{ translateX: offset }] }]}
      >{children}</Animated.Text>
    </View>
  );
}

const styles = StyleSheet.create({
  viewport: { flex: 1, minWidth: 0, overflow: 'hidden' },
  content: { flexShrink: 0 },
});
