import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, StyleSheet, Text, View, type StyleProp, type TextStyle } from 'react-native';

import { recordLiveTvMarqueeLayout, recordLiveTvMarqueeMount, recordLiveTvMarqueeTextLayout } from './liveTvScrollPerf';
import { shouldAnimateLiveTvMarquee } from './liveTvMarqueeState';
import { recordLivePerformanceEvent } from '@/features/diagnostics/livePerformanceTelemetry';

let activeMarqueeStop: (() => void) | null = null;

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
    recordLivePerformanceEvent('marquee_mount');
    return () => recordLivePerformanceEvent('marquee_unmount');
  }, []);
  const offset = useRef(new Animated.Value(0)).current;
  const animation = useRef<Animated.CompositeAnimation | null>(null);
  const [viewportWidth, setViewportWidth] = useState(0);
  const [fullTextWidth, setFullTextWidth] = useState(0);
  const [measuredText, setMeasuredText] = useState<string | null>(null);
  const text = String(children ?? '');
  const distance = measuredText === text ? Math.max(0, fullTextWidth - viewportWidth + 8) : 0;

  useEffect(() => {
    animation.current?.stop();
    animation.current = null;
    offset.stopAnimation();
    offset.setValue(0);
    setFullTextWidth(0);
    setMeasuredText(null);
  }, [offset, text]);

  useEffect(() => {
    animation.current?.stop();
    animation.current = null;
    offset.stopAnimation();
    offset.setValue(0);
    if (!shouldAnimateLiveTvMarquee({ focused, text, measuredText, distance })) return;
    recordLivePerformanceEvent('marquee_start', { overflowPx: distance });

    const duration = Math.min(10000, Math.max(2200, distance * 30));
    const loop = Animated.loop(Animated.sequence([
      Animated.delay(700),
      Animated.timing(offset, { toValue: -distance, duration, useNativeDriver: true }),
      Animated.delay(900),
      Animated.timing(offset, { toValue: 0, duration: 350, useNativeDriver: true }),
    ]));
    const stop = () => {
      recordLivePerformanceEvent('marquee_stop', { overflowPx: distance });
      loop.stop();
      animation.current = null;
      offset.stopAnimation();
      offset.setValue(0);
    };
    activeMarqueeStop?.();
    activeMarqueeStop = stop;
    animation.current = loop;
    loop.start();
    return () => {
      stop();
      if (activeMarqueeStop === stop) {
        activeMarqueeStop = null;
      }
    };
  }, [distance, focused, measuredText, offset, text]);

  useEffect(() => {
    if (!focused || measuredText !== text || viewportWidth <= 0 || fullTextWidth <= 0) return;
    console.log('[NovaCast Marquee]', {
      title: text,
      viewportWidth,
      fullTextWidth,
      overflowPx: distance,
      shouldAnimate: distance > 0,
    });
  }, [distance, focused, fullTextWidth, measuredText, text, viewportWidth]);

  return (
    <View style={styles.viewport} onLayout={(event) => {
      recordLiveTvMarqueeLayout();
      recordLivePerformanceEvent('marquee_layout', { width: event.nativeEvent.layout.width });
      setViewportWidth(event.nativeEvent.layout.width);
    }}>
      {focused ? (
        <Text
          pointerEvents="none"
          numberOfLines={1}
          onTextLayout={(event) => {
            recordLiveTvMarqueeTextLayout();
            recordLivePerformanceEvent('marquee_text_measure', { width: event.nativeEvent.lines[0]?.width ?? 0 });
            setFullTextWidth(event.nativeEvent.lines[0]?.width ?? 0);
            setMeasuredText(text);
          }}
          style={[style, styles.measurement]}
        >{text}</Text>
      ) : null}
      <Animated.Text
        numberOfLines={numberOfLines}
        ellipsizeMode={focused ? 'clip' : 'tail'}
        style={[style, styles.content, measuredText === text && fullTextWidth > 0 ? { width: fullTextWidth } : null, { transform: [{ translateX: offset }] }]}
      >{children}</Animated.Text>
    </View>
  );
}

const styles = StyleSheet.create({
  viewport: { flex: 1, minWidth: 0, overflow: 'hidden' },
  content: { flexShrink: 0 },
  // Keep intrinsic measurement independent from the clipped/translated title.
  // The large, unconstrained surface prevents the viewport width from feeding
  // back into the measured line width.
  measurement: { position: 'absolute', left: 0, top: 0, width: 10000, opacity: 0, flexShrink: 0 },
});
