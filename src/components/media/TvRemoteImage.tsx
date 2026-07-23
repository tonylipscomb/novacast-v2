import { useState } from 'react';
import { Image, type ImageResizeMode, type ImageStyle, StyleSheet } from 'react-native';

type TvRemoteImageProps = {
  uri?: string;
  style?: ImageStyle;
  resizeMode?: ImageResizeMode;
  onError?: () => void;
};

export function TvRemoteImage({ uri, style, resizeMode = 'cover', onError }: TvRemoteImageProps) {
  const [failed, setFailed] = useState(false);

  if (!uri?.trim() || failed) {
    return null;
  }

  return (
    <Image
      source={{ uri: uri.trim() }}
      style={[styles.image, style]}
      resizeMode={resizeMode}
      onError={() => {
        setFailed(true);
        onError?.();
      }}
    />
  );
}

const styles = StyleSheet.create({
  image: {
    width: '100%',
    height: '100%',
  },
});
