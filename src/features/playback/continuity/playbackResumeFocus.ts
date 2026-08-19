export type ResumeDialogAction = 'resume' | 'restart';
export type ResumeDialogDirection = 'left' | 'right' | 'up' | 'down';
export type ResumeBackLayer = 'resume-dialog' | 'player' | 'movie-detail' | 'screen';

export function getResumeDialogInitialAction(): ResumeDialogAction {
  return 'resume';
}

export function getResumeDialogNextAction(
  current: ResumeDialogAction,
  direction: ResumeDialogDirection,
): ResumeDialogAction {
  if (current === 'resume' && (direction === 'right' || direction === 'down')) {
    return 'restart';
  }
  if (current === 'restart' && (direction === 'left' || direction === 'up')) {
    return 'resume';
  }
  return current;
}

export function shouldResumeDialogOwnFocus(dialogOpen: boolean): boolean {
  return dialogOpen;
}

export function areMoviesBackgroundFocusablesEnabled(resumePromptOpen: boolean): boolean {
  return !resumePromptOpen;
}

export function shouldIgnoreMoviesRemoteInput(resumePromptOpen: boolean): boolean {
  return resumePromptOpen;
}

export function isMoviesRemoteEventActionable(
  resumePromptOpen: boolean,
  eventType: string,
): boolean {
  if (shouldIgnoreMoviesRemoteInput(resumePromptOpen)) {
    return false;
  }
  return (
    eventType === 'up' ||
    eventType === 'down' ||
    eventType === 'left' ||
    eventType === 'right' ||
    eventType === 'select' ||
    eventType === 'playPause'
  );
}

export function logResumeInputAudit(fields: {
  eventType?: string;
  resumePromptOpen: boolean;
  nativeFocusedRegion?: string;
  moviesRemoteHandlerReceived?: boolean;
  categoryHandlerReceived?: boolean;
  categoryIndexBefore?: string | null;
  categoryIndexAfter?: string | null;
  dialogAction?: ResumeDialogAction;
}) {
  console.info('[NovaCast Resume Input Audit]', fields);
}

export function buildResumeDialogNativeFocusProps(
  action: ResumeDialogAction,
  handles: { resume: number | null; restart: number | null },
): {
  nextFocusLeft: number | null;
  nextFocusRight: number | null;
  nextFocusUp: number | null;
  nextFocusDown: number | null;
} {
  const self = action === 'resume' ? handles.resume : handles.restart;
  const other = action === 'resume' ? handles.restart : handles.resume;
  if (action === 'resume') {
    return {
      nextFocusLeft: self,
      nextFocusUp: self,
      nextFocusRight: other ?? self,
      nextFocusDown: other ?? self,
    };
  }
  return {
    nextFocusLeft: other ?? self,
    nextFocusUp: other ?? self,
    nextFocusRight: self,
    nextFocusDown: self,
  };
}

export function resolveResumeLayerBackAction(input: {
  resumeDialogOpen: boolean;
  playerOpen: boolean;
  movieDetailOpen: boolean;
}): ResumeBackLayer {
  if (input.resumeDialogOpen) {
    return 'resume-dialog';
  }
  if (input.playerOpen) {
    return 'player';
  }
  if (input.movieDetailOpen) {
    return 'movie-detail';
  }
  return 'screen';
}

export function logResumeFocus(
  event:
    | 'dialog-mounted'
    | 'initial-focus-requested'
    | 'resume-focused'
    | 'restart-focused'
    | 'focus-escape-detected'
    | 'focus-contained'
    | 'background-focus-disabled'
    | 'background-focus-restored'
    | 'escape-blocked'
    | 'back-consumed'
    | 'focus-restored',
  fields: {
    action?: ResumeDialogAction;
    contentId?: string;
    returnTarget?: string;
    dialogOpen?: boolean;
  },
) {
  console.info('[NovaCast Resume Focus]', event, fields);
}
