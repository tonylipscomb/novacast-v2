import { NovaSpaceLoader } from './NovaSpaceLoader';

type NovaLoadingStateProps = {
  label?: string;
};

export function NovaLoadingState({ label = 'Loading...' }: NovaLoadingStateProps) {
  return <NovaSpaceLoader label={label} variant="panel" />;
}
