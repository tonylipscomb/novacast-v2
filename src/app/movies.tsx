import { useProviderStore } from '@/features/providers/providerStore';
import { MoviesScreen } from '@/features/movies/MoviesScreen';

export default function MoviesRoute() {
  const { selectedProvider } = useProviderStore();
  const providerKey = selectedProvider?.id ?? 'demo-provider';

  return <MoviesScreen key={providerKey} />;
}
