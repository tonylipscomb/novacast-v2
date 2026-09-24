export type GlobalAdminHeaderAction = 'refresh' | 'new_invitation';

export function shouldShowGlobalAdminHeaderAction(tab: string, action: GlobalAdminHeaderAction) {
  if (tab === 'announcements') return false;
  return action === 'refresh' || action === 'new_invitation';
}
