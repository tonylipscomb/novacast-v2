import { useProviderStore } from '@/features/providers/providerStore';
import { GuideScreen } from '@/features/guide/GuideScreen';
import { ProviderAccessGate } from '@/features/providers/ProviderAccessGate';

export default function GuideRoute() {
  const { providerGeneration, selectedProvider } = useProviderStore();
  const providerKey = `${selectedProvider?.id ?? 'demo-provider'}:${providerGeneration}`;

  return <ProviderAccessGate><GuideScreen key={providerKey} /></ProviderAccessGate>;
}
