import { useProviderStore } from '@/features/providers/providerStore';
import { GuideScreen } from '@/features/guide/GuideScreen';

export default function GuideRoute() {
  const { providerGeneration, selectedProvider } = useProviderStore();
  const providerKey = `${selectedProvider?.id ?? 'demo-provider'}:${providerGeneration}`;

  return <GuideScreen key={providerKey} />;
}
