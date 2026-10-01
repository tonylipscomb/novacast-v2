import { MainMenuScreen } from '@/features/hub/MainMenuScreen';
import { ProviderAccessGate } from '@/features/providers/ProviderAccessGate';

export default function MainMenuRoute() {
  return <ProviderAccessGate><MainMenuScreen /></ProviderAccessGate>;
}
