import { NovaSpaceLoader } from '@/components/nova/NovaSpaceLoader';

export function SearchLoadingState({ label = 'Searching…' }: { label?: string; compact?: boolean }) {
  return <NovaSpaceLoader label={label} variant="inline" />;
}
