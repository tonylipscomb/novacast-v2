/**
 * Former full-screen remote capture layer.
 *
 * Intentionally renders nothing. A full-screen elevated Pressable above
 * VideoView covers SurfaceView/TextureView compositing on Android TV and is
 * forbidden by the recovery constraints (no focus sentinels / hidden focusables).
 * Hidden-chrome remote input is owned by UnifiedPlayerRemoteHandlers.
 */
export function UnifiedPlayerInteractionLayer(_props: {
  active: boolean;
  onTogglePlay: () => void;
  onRevealControls: () => void;
}) {
  return null;
}
