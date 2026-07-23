import { Redirect } from 'expo-router';

import { TV_HOME_ROUTE } from '@/features/navigation/tvRoutes';

/** Content Hub merged into Portal — keep the route as a safe redirect. */
export default function ContentHubRoute() {
  return <Redirect href={TV_HOME_ROUTE} />;
}
