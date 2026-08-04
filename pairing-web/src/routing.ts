export type AppRoute = 'home' | 'download' | 'pair' | 'activate' | 'admin';

function normalizeLegacyCode(value: string) {
  return value.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 8);
}

export function normalizePathname(pathname: string): string {
  if (!pathname || pathname === '/') return '/';
  return pathname.replace(/\/+$/, '') || '/';
}

export function resolveAppRoute(pathname: string): AppRoute {
  const path = normalizePathname(pathname);
  if (path === '/download') return 'download';
  if (path === '/pair') return 'pair';
  if (path === '/activate') return 'activate';
  if (path === '/admin' || path.startsWith('/admin/')) return 'admin';
  return 'home';
}

/**
 * Legacy TV QR codes open `/?code=ABCDEFGH`. Preserve those links by sending
 * visitors to `/pair?code=ABCDEFGH` without losing other query params.
 */
export function legacyPairingRedirectTarget(
  pathname: string,
  search: string
): string | null {
  const path = normalizePathname(pathname);
  if (path !== '/') return null;

  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const rawCode = params.get('code');
  if (!rawCode) return null;

  const code = normalizeLegacyCode(rawCode);
  if (!code) return null;

  params.set('code', code);
  const query = params.toString();
  return query ? `/pair?${query}` : '/pair';
}

export function applyLegacyPairingRedirect(
  location: Pick<Location, 'pathname' | 'search'>,
  assign: (url: string) => void = (url) => {
    window.location.replace(url);
  }
): boolean {
  const target = legacyPairingRedirectTarget(location.pathname, location.search);
  if (!target) return false;
  assign(target);
  return true;
}
