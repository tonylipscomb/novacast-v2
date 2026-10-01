import { useProviderStore } from '@/features/providers/providerStore';
import { SeriesScreen } from '@/features/series/SeriesScreen';
import { ProviderAccessGate } from '@/features/providers/ProviderAccessGate';

export default function SeriesRoute() {
  const { providerGeneration, selectedProvider } = useProviderStore();
  const providerKey = `${selectedProvider?.id ?? 'demo-provider'}:${providerGeneration}`;

  return <ProviderAccessGate><SeriesScreen key={providerKey} /></ProviderAccessGate>;
}
