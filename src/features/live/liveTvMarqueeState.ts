export function shouldAnimateLiveTvMarquee(input: {
  focused: boolean;
  text: string;
  measuredText: string | null;
  distance: number;
}) {
  return input.focused && input.measuredText === input.text && input.distance > 0;
}
