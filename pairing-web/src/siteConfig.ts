/** Relative path used by the Download button (works on any custom domain). */
export const APK_DOWNLOAD_PATH = '/downloads/novacast.apk';

/** Downloader app short code — stable across releases. */
export const DOWNLOADER_CODE = '6275368';

const DEFAULT_PUBLIC_DOWNLOAD_URL =
  'https://novacast-connect.netlify.app/downloads/novacast.apk';

/**
 * Visible direct-download URL text. Override with VITE_PUBLIC_DOWNLOAD_URL
 * when the custom domain is live (e.g. https://connect.novacastapp.com/downloads/novacast.apk).
 */
export function getPublicDownloadUrl(): string {
  const fromEnv = import.meta.env.VITE_PUBLIC_DOWNLOAD_URL?.trim();
  return fromEnv || DEFAULT_PUBLIC_DOWNLOAD_URL;
}

export const LATEST_STABLE_LABEL = 'Latest stable Android TV release';
