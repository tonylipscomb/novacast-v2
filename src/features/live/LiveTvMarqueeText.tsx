import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, StyleSheet, Text, View, type StyleProp, type TextStyle } from 'react-native';

import { recordLiveTvMarqueeLayout, recordLiveTvMarqueeMount, recordLiveTvMarqueeTextLayout } from './liveTvScrollPerf';
import { shouldAnimateLiveTvMarquee } from './liveTvMarqueeState';

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
  const [measuredText, setMeasuredText] = useState<string | null>(null);
  const text = String(children ?? '');
  const distance = measuredText === text ? Math.max(0, contentWidth - viewportWidth + 8) : 0;

  useEffect(() => {
    animation.current?.stop();
    animation.current = null;
    offset.stopAnimation();
    offset.setValue(0);
    setContentWidth(0);
    setMeasuredText(null);
  }, [offset, text]);

  useEffect(() => {
    animation.current?.stop();
    animation.current = null;
    offset.stopAnimation();
    offset.setValue(0);
    if (!shouldAnimateLiveTvMarquee({ focused, text, measuredText, distance })) return;

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
  }, [distance, focused, measuredText, offset, text]);

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
          setMeasuredText(text);
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
