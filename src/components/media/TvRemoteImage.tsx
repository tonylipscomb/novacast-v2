import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Image, type ImageResizeMode, type ImageStyle, StyleSheet } from 'react-native';

import {
  getTvImageObservability,
  tvImageRecordFailure,
  tvImageRecordMount,
  tvImageRecordSourceChange,
  tvImageSetPending,
} from '@/features/perf/tvImageObservability';

import { normalizeTvRemoteImageUri } from './tvRemoteImageUri';

export { normalizeTvRemoteImageUri } from './tvRemoteImageUri';

type TvRemoteImageProps = {
  uri?: string;
  style?: ImageStyle;
  resizeMode?: ImageResizeMode;
  onError?: () => void;
};

let pendingImageCount = 0;

function bumpPending(delta: number) {
  pendingImageCount = Math.max(0, pendingImageCount + delta);
  tvImageSetPending(pendingImageCount);
}

function TvRemoteImageComponent({ uri, style, resizeMode = 'cover', onError }: TvRemoteImageProps) {
  const normalizedUri = normalizeTvRemoteImageUri(uri);
  // Sticky failure is keyed to the URI — a recycled card with a new URI auto-recovers.
  const [failedUri, setFailedUri] = useState<string | null>(null);
  const pendingRef = useRef(false);
  const lastUriRef = useRef<string | null>(null);
  const failed = Boolean(normalizedUri) && failedUri === normalizedUri;
  const source = useMemo(() => (normalizedUri ? { uri: normalizedUri } : null), [normalizedUri]);

  useEffect(() => {
    if (!normalizedUri) {
      return;
    }
    if (lastUriRef.current && lastUriRef.current !== normalizedUri) {
      tvImageRecordSourceChange();
    }
    lastUriRef.current = normalizedUri;
    tvImageRecordMount(normalizedUri);
  }, [normalizedUri]);

  useEffect(() => {
    if (!source || failed) {
      return;
    }
    pendingRef.current = true;
    bumpPending(1);
    return () => {
      if (pendingRef.current) {
        pendingRef.current = false;
        bumpPending(-1);
      }
    };
  }, [failed, source]);

  if (!source || failed) {
    return null;
  }

  return (
    <Image
      source={source}
      style={[styles.image, style]}
      resizeMode={resizeMode}
      onLoadEnd={() => {
        if (pendingRef.current) {
          pendingRef.current = false;
          bumpPending(-1);
        }
      }}
      onError={() => {
        if (pendingRef.current) {
          pendingRef.current = false;
          bumpPending(-1);
        }
        tvImageRecordFailure();
        setFailedUri(normalizedUri);
        onError?.();
      }}
    />
  );
}

export const TvRemoteImage = memo(TvRemoteImageComponent);

/** Dev helper — HUD reads image counters without importing component internals. */
export function getTvRemoteImageObservability() {
  return getTvImageObservability();
}

const styles = StyleSheet.create({
  image: {
    width: '100%',
    height: '100%',
  },
});
