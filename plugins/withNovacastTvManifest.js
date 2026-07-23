const fs = require('fs');
const path = require('path');
const { withAndroidManifest, withDangerousMod, AndroidConfig } = require('@expo/config-plugins');

const LEANBACK_CATEGORY = 'android.intent.category.LEANBACK_LAUNCHER';
const BANNER_DRAWABLE = '@drawable/banner';

// Fire TV / Android TV launchers only surface an app in the TV home-screen row (and
// use the TV banner instead of a generic icon) when the main activity's MAIN/LAUNCHER
// intent-filter also declares LEANBACK_LAUNCHER. This app is TV-only, so it needs it.
function ensureLeanbackCategory(mainActivity) {
  const intentFilters = mainActivity['intent-filter'] ?? [];
  for (const filter of intentFilters) {
    const actions = filter.action ?? [];
    const isMainAction = actions.some(
      (action) => action.$?.['android:name'] === 'android.intent.action.MAIN',
    );
    if (!isMainAction) {
      continue;
    }

    filter.category = filter.category ?? [];
    const hasLeanback = filter.category.some(
      (category) => category.$?.['android:name'] === LEANBACK_CATEGORY,
    );
    if (!hasLeanback) {
      filter.category.push({ $: { 'android:name': LEANBACK_CATEGORY } });
    }
  }
}

function ensureBannerAttribute(application) {
  application.$ = application.$ ?? {};
  if (application.$['android:banner'] !== BANNER_DRAWABLE) {
    application.$['android:banner'] = BANNER_DRAWABLE;
  }
}

function ensureCleartextTraffic(application) {
  application.$ = application.$ ?? {};
  if (application.$['android:usesCleartextTraffic'] !== 'true') {
    application.$['android:usesCleartextTraffic'] = 'true';
  }
}

function withNovacastAndroidManifest(config) {
  return withAndroidManifest(config, (config) => {
    const androidManifest = config.modResults;

    const mainActivity = AndroidConfig.Manifest.getMainActivityOrThrow(androidManifest);
    ensureLeanbackCategory(mainActivity);

    const mainApplication = AndroidConfig.Manifest.getMainApplicationOrThrow(androidManifest);
    ensureBannerAttribute(mainApplication);
    ensureCleartextTraffic(mainApplication);

    return config;
  });
}

// android/ is a gitignored, fully-regenerable prebuild output (see .gitignore), so raw
// drawable resources copied in by hand would be silently lost on the next
// `expo prebuild --clean`. Copying them here via withDangerousMod makes them survive
// every prebuild, sourced from the tracked assets checked into assets/images/.
const BANNER_SOURCES = [
  ['tv-banner-xhdpi.png', 'drawable-xhdpi'],
  ['tv-banner-hdpi.png', 'drawable-hdpi'],
  ['tv-banner-mdpi.png', 'drawable-mdpi'],
];

function withNovacastTvBannerAssets(config) {
  return withDangerousMod(config, [
    'android',
    async (config) => {
      const projectRoot = config.modRequest.projectRoot;
      const platformProjectRoot = config.modRequest.platformProjectRoot;

      for (const [sourceFile, densityDir] of BANNER_SOURCES) {
        const sourcePath = path.join(projectRoot, 'assets', 'images', sourceFile);
        if (!fs.existsSync(sourcePath)) {
          continue;
        }

        const destDir = path.join(platformProjectRoot, 'app', 'src', 'main', 'res', densityDir);
        fs.mkdirSync(destDir, { recursive: true });
        fs.copyFileSync(sourcePath, path.join(destDir, 'banner.png'));
      }

      return config;
    },
  ]);
}

function withNovacastTvManifest(config) {
  config = withNovacastAndroidManifest(config);
  config = withNovacastTvBannerAssets(config);
  return config;
}

module.exports = withNovacastTvManifest;
