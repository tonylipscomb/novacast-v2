import { useProviderStore } from '@/features/providers/providerStore';
import { SeriesScreen } from '@/features/series/SeriesScreen';

export default function SeriesRoute() {
  const { providerGeneration, selectedProvider } = useProviderStore();
  const providerKey = `${selectedProvider?.id ?? 'demo-provider'}:${providerGeneration}`;

  return <SeriesScreen key={providerKey} />;
}
