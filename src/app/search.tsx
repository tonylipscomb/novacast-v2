import { useProviderStore } from '@/features/providers/providerStore';
import { SearchScreen } from '@/features/search/SearchScreen';

export default function SearchRoute() {
  const { providerGeneration, selectedProvider } = useProviderStore();
  const providerKey = `${selectedProvider?.id ?? 'demo-provider'}:${providerGeneration}`;

  return <SearchScreen key={providerKey} />;
}
