import { useProviderStore } from '@/features/providers/providerStore';
import { LiveTvScreen } from '@/features/live/LiveTvScreen';
import { ProviderAccessGate } from '@/features/providers/ProviderAccessGate';

export default function LiveRoute() {
  const { providerGeneration, selectedProvider } = useProviderStore();
  const providerKey = `${selectedProvider?.id ?? 'demo-provider'}:${providerGeneration}`;

  return <ProviderAccessGate><LiveTvScreen key={providerKey} /></ProviderAccessGate>;
}
