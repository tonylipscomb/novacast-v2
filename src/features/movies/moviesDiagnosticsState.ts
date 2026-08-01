/**
 * Diagnostics-only mirror of Movies detail visibility.
 *
 * Read by grid diagnostics so a single log line can report detail state without
 * threading a new prop through the render tree. Never read by focus, render, or
 * data logic.
 */

let detailOpenForDiagnostics = false;

export function setMoviesDetailOpenForDiagnostics(open: boolean) {
  detailOpenForDiagnostics = open;
}

export function getMoviesDetailOpenForDiagnostics() {
  return detailOpenForDiagnostics;
}
