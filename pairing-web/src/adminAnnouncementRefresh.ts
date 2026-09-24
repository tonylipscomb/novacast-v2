export type AnnouncementRefreshGate = {
  tryStart: () => boolean;
  finish: () => void;
};

export function createAnnouncementRefreshGate(): AnnouncementRefreshGate {
  let active = false;
  return {
    tryStart() {
      if (active) return false;
      active = true;
      return true;
    },
    finish() {
      active = false;
    },
  };
}

export function announcementListRequestInit(): RequestInit {
  return { cache: 'no-store' };
}

export function normalizeAnnouncementItems<T>(payload: unknown): T[] {
  if (!payload || typeof payload !== 'object' || !Array.isArray((payload as { items?: unknown }).items)) return [];
  return (payload as { items: T[] }).items;
}
