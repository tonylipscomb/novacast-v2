import { useProviderStore } from '@/features/providers/providerStore';
import { MoviesScreen } from '@/features/movies/MoviesScreen';
import { ProviderAccessGate } from '@/features/providers/ProviderAccessGate';

export default function MoviesRoute() {
  const { selectedProvider } = useProviderStore();
  const providerKey = selectedProvider?.id ?? 'demo-provider';

  return <ProviderAccessGate><MoviesScreen key={providerKey} /></ProviderAccessGate>;
}
