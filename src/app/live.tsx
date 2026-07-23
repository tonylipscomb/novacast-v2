import { useProviderStore } from '@/features/providers/providerStore';
import { LiveTvScreen } from '@/features/live/LiveTvScreen';

export default function LiveRoute() {
  const { providerGeneration, selectedProvider } = useProviderStore();
  const providerKey = `${selectedProvider?.id ?? 'demo-provider'}:${providerGeneration}`;

  return <LiveTvScreen key={providerKey} />;
}
