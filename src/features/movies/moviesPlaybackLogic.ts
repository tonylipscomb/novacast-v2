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

export function didMoviesPlaybackJustClose(previousActive: boolean, currentActive: boolean): boolean {
  return previousActive && !currentActive;
}
