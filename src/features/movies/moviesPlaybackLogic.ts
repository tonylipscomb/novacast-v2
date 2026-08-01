/**
 * Back ownership and focus-restoration helpers for Movies root-level playback.
 */
export type MoviesPlaybackLaunchSource = 'play' | 'poster' | null;

export type MoviesBackAction = 'close-playback' | 'leave-screen' | 'swallow';

export function decideMoviesBackAction(
  playbackActive: boolean,
  isRestoringPlaybackFocus: boolean,
): MoviesBackAction {
  if (playbackActive) {
    return 'close-playback';
  }

  if (isRestoringPlaybackFocus) {
    return 'swallow';
  }

  return 'leave-screen';
}

/**
 * While the unified player Modal owns the screen, hardware Back must close
 * playback — not the still-mounted detail overlay under it.
 * During Stage 3D closing phases, Back is consumed but must not start a second close.
 */
export function shouldHandleMoviesDetailBack(input: {
  playbackUiActive: boolean;
  detailOpen: boolean;
  detailClosing?: boolean;
}): boolean {
  if (input.playbackUiActive) {
    return false;
  }
  return input.detailOpen || Boolean(input.detailClosing);
}

export function didMoviesPlaybackJustClose(previousActive: boolean, currentActive: boolean): boolean {
  return previousActive && !currentActive;
}
