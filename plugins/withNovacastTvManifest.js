const fs = require('fs');
const path = require('path');
const { withAndroidManifest, withDangerousMod, AndroidConfig } = require('@expo/config-plugins');

const LEANBACK_CATEGORY = 'android.intent.category.LEANBACK_LAUNCHER';
const BANNER_DRAWABLE = '@drawable/banner';
const FULLSCREEN_SURF_ACTIVITY_MARKER = '// NovaCast fullscreen surf native bridge';
const FULLSCREEN_SURF_STARTUP_MARKER = '[NovaCastSurfNative] MainActivity-created';
const NATIVE_FAVORITE_KEY_MARKER = '// NovaCast native favorite key bridge';

function findMainActivity(rootDir) {
  const pending = [rootDir];
  while (pending.length) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'build' && entry.name !== '.gradle') {
          pending.push(entryPath);
        }
      } else if (entry.name === 'MainActivity.kt') {
        return entryPath;
      }
    }
  }
  return null;
}

function patchFullscreenSurfActivity(activityPath) {
  if (!fs.existsSync(activityPath)) {
    return;
  }

  let contents = fs.readFileSync(activityPath, 'utf8');
  const hasFullscreenBridge = contents.includes(FULLSCREEN_SURF_ACTIVITY_MARKER);
  const hasFavoriteBridge = contents.includes('onNovaCastNativeTvKey');
  if (hasFullscreenBridge && hasFavoriteBridge) {
    return;
  }

  if (!contents.includes('import android.util.Log') && !hasFullscreenBridge) {
    contents = contents.replace(
      /import android\.os\.Bundle\r?\n/,
      (match) => `${match}import android.util.Log\n`,
    );
  }
  if (!contents.includes('import android.view.KeyEvent')) {
    contents = contents.replace(
      /import android\.os\.Bundle\r?\n/,
      (match) => `${match}import android.view.KeyEvent\n`,
    );
  }
  if (!contents.includes('import expo.modules.novacastcatalogdecode.NovacastFullscreenSurfModule')) {
    contents = contents.replace(
      /import expo\.modules\.ReactActivityDelegateWrapper\r?\n/,
      (match) => `${match}import expo.modules.novacastcatalogdecode.NovacastFullscreenSurfModule\n`,
    );
  }
  if (!hasFavoriteBridge && !contents.includes('import com.facebook.react.bridge.Arguments')) {
    contents = contents.replace(
      /import com\.facebook\.react\.ReactActivity\r?\n|import expo\.modules\.ReactActivityDelegateWrapper\r?\n/,
      (match) => `${match}import com.facebook.react.bridge.Arguments\n`,
    );
  }
  if (!hasFavoriteBridge && !contents.includes('import com.facebook.react.modules.core.DeviceEventManagerModule')) {
    contents = contents.replace(
      /import com\.facebook\.react\.ReactActivity\r?\n|import expo\.modules\.ReactActivityDelegateWrapper\r?\n/,
      (match) => `${match}import com.facebook.react.modules.core.DeviceEventManagerModule\n`,
    );
  }
  const fullscreenBlock = `
    ${FULLSCREEN_SURF_ACTIVITY_MARKER}
    if (event.keyCode == KeyEvent.KEYCODE_DPAD_LEFT || event.keyCode == KeyEvent.KEYCODE_DPAD_RIGHT) {
      val action = when (event.action) {
        KeyEvent.ACTION_DOWN -> "DOWN"
        KeyEvent.ACTION_UP -> "UP"
        else -> event.action.toString()
      }
      Log.i(
        "NovaCastNativeTvKey",
        "[NovaCastSurfNative] dispatch keyCode=\${event.keyCode} action=\$action " +
          "repeatCount=\${event.repeatCount} fullscreenSurfEnabled=\${NovacastFullscreenSurfModule.isEnabled()}",
      )
      val consumed = NovacastFullscreenSurfModule.dispatchKeyEvent(event)
      if (consumed) {
        Log.i("NovaCastSurfNative", "[NovaCastSurfNative] consumed keyCode=\${event.keyCode} action=\$action")
        return true
      }
      Log.i("NovaCastSurfNative", "[NovaCastSurfNative] passthrough enabled=false")
    }
`;
  const favoriteBlock = `
    ${NATIVE_FAVORITE_KEY_MARKER}
    if (event.keyCode == KeyEvent.KEYCODE_DPAD_CENTER ||
        event.keyCode == KeyEvent.KEYCODE_ENTER ||
        event.keyCode == KeyEvent.KEYCODE_NUMPAD_ENTER) {
      val reactContext = try {
        getReactHost()?.currentReactContext
      } catch (error: Throwable) {
        null
      }
      reactContext?.let {
        try {
          it.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            ?.emit("onNovaCastNativeTvKey", Arguments.createMap().apply {
              putInt("keyCode", event.keyCode)
              putInt("action", event.action)
              putInt("repeatCount", event.repeatCount)
              putLong("eventTime", event.eventTime)
              putLong("downTime", event.downTime)
            })
        } catch (error: Throwable) {
        }
      }
    }
`;
  const dispatchPattern = /(override fun dispatchKeyEvent\(event: KeyEvent\): Boolean \{\r?\n)/;
  if (dispatchPattern.test(contents)) {
    if (!hasFullscreenBridge) {
      contents = contents.replace(dispatchPattern, `$1${fullscreenBlock}`);
    }
    if (!hasFavoriteBridge) {
      contents = contents.replace(
        /\n(\s*)return super\.dispatchKeyEvent\(event\)/,
        `\n${favoriteBlock}$1return super.dispatchKeyEvent(event)`,
      );
    }
  } else {
    contents = contents.replace(
      'class MainActivity : ReactActivity() {',
      `class MainActivity : ReactActivity() {
  override fun dispatchKeyEvent(event: KeyEvent): Boolean {
${hasFullscreenBridge ? '' : fullscreenBlock}${hasFavoriteBridge ? '' : favoriteBlock}    return super.dispatchKeyEvent(event)
  }
`,
    );
  }
  if (!contents.includes(FULLSCREEN_SURF_STARTUP_MARKER)) {
    contents = contents.replace(
      /override fun onCreate\(savedInstanceState: Bundle\?\): Unit \{\r?\n|override fun onCreate\(savedInstanceState: Bundle\?\) \{\r?\n/,
      (match) => `${match}    Log.i("NovaCastSurfNative", "${FULLSCREEN_SURF_STARTUP_MARKER}")\n`,
    );
  }
  fs.writeFileSync(activityPath, contents);
}

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

function ensureActivityBanner(mainActivity) {
  mainActivity.$ = mainActivity.$ ?? {};
  if (mainActivity.$['android:banner'] !== BANNER_DRAWABLE) {
    mainActivity.$['android:banner'] = BANNER_DRAWABLE;
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
    ensureActivityBanner(mainActivity);

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
  ['tv-banner-xxxhdpi.png', 'drawable-xxxhdpi'],
  ['tv-banner-xxhdpi.png', 'drawable-xxhdpi'],
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

      // Default `drawable/banner.png` so `@drawable/banner` still resolves when a
      // density bucket is missing. Android TV / Fire TV banners are 320x180 mdpi.
      const defaultBannerSource = ['tv-banner-mdpi.png', 'tv-banner-hdpi.png', 'tv-banner-xhdpi.png']
        .map((file) => path.join(projectRoot, 'assets', 'images', file))
        .find((sourcePath) => fs.existsSync(sourcePath));
      if (defaultBannerSource) {
        const defaultDir = path.join(platformProjectRoot, 'app', 'src', 'main', 'res', 'drawable');
        fs.mkdirSync(defaultDir, { recursive: true });
        fs.copyFileSync(defaultBannerSource, path.join(defaultDir, 'banner.png'));
      }

      const mainActivityPath = findMainActivity(path.join(platformProjectRoot, 'app', 'src', 'main', 'java'));
      if (mainActivityPath) {
        patchFullscreenSurfActivity(mainActivityPath);
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
