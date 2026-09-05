import { NovaPortalScreen } from '@/features/portal/NovaPortalScreen';

export default function ProviderManagementRoute() {
  return <NovaPortalScreen initialPanel="manage" returnRoute="/settings" />;
}
