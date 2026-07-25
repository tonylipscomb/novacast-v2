import * as Application from 'expo-application';
import Constants from 'expo-constants';

export type AnalyticsAppMetadata = {
  appVersion: string;
  appBuild?: string;
  buildSource: string;
};

type ManifestWithExpoClient = {
  extra?: { expoClient?: { android?: { versionCode?: number | string }; version?: string } };
  android?: { versionCode?: number | string };
};

function asString(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'string' && value.trim()) return value.trim();
  return undefined;
}

export function resolveAnalyticsAppMetadata(): AnalyticsAppMetadata {
  const expoConfig = Constants.expoConfig as ManifestWithExpoClient | null;
  const manifest2 = Constants.manifest2 as ManifestWithExpoClient | null;
  const manifest = Constants.manifest as ManifestWithExpoClient | null;

  const appVersion = asString(Application.nativeApplicationVersion)
    ?? asString(expoConfig?.extra?.expoClient?.version)
    ?? asString(Constants.expoConfig?.version)
    ?? 'unknown';

  const buildCandidates: [unknown, string][] = [
    [Application.nativeBuildVersion, 'expo-application.nativeBuildVersion'],
    [Constants.nativeBuildVersion, 'expo-constants.nativeBuildVersion'],
    [manifest2?.extra?.expoClient?.android?.versionCode, 'expo-constants.manifest2.extra.expoClient.android.versionCode'],
    [manifest?.android?.versionCode, 'expo-constants.manifest.android.versionCode'],
    [expoConfig?.extra?.expoClient?.android?.versionCode, 'expoConfig.extra.expoClient.android.versionCode'],
    [Constants.expoConfig?.android?.versionCode, 'expoConfig.android.versionCode'],
    [Constants.expoConfig?.ios?.buildNumber, 'expoConfig.ios.buildNumber'],
  ];
  const resolved = buildCandidates.find(([value]) => asString(value));
  const metadata = { appVersion, appBuild: resolved ? asString(resolved[0]) : undefined, buildSource: resolved?.[1] ?? 'unresolved' };

  console.log('[analytics] app metadata', {
    appVersion: metadata.appVersion,
    appBuild: metadata.appBuild ?? null,
    buildSource: metadata.buildSource,
  });
  return metadata;
}
