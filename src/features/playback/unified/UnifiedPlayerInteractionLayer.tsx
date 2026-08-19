/**
 * Former full-screen remote capture layer.
 *
 * Intentionally renders nothing. A full-screen elevated Pressable above
 * VideoView covers SurfaceView/TextureView compositing on Android TV.
 * Hidden VOD LEFT/RIGHT is owned by native focus sentinels
 * (UnifiedPlayerVodFocusRouter).
 */
export function UnifiedPlayerInteractionLayer(_props: {
  active: boolean;
  onTogglePlay: () => void;
  onRevealControls: () => void;
}) {
  return null;
}
