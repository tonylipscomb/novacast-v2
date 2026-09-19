const fs = require('fs');
const path = require('path');
const { withAndroidManifest, withDangerousMod, AndroidConfig } = require('@expo/config-plugins');

const LEANBACK_CATEGORY = 'android.intent.category.LEANBACK_LAUNCHER';
const BANNER_DRAWABLE = '@drawable/banner';
const FULLSCREEN_SURF_MARKER = '// NovaCast fullscreen surf native bridge';
const FULLSCREEN_SURF_STARTUP_MARKER = '[NovaCastSurfNative] MainActivity-created';
const LEFT_INTENT_MARKER = '// NovaCast raw DPAD LEFT intent bridge';
const VERTICAL_INTENT_MARKER = '// NovaCast raw DPAD UP DOWN telemetry bridge';

function findMainActivity(rootDir) {
  const pending = [rootDir];
  while (pending.length) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'build' && entry.name !== '.gradle') pending.push(entryPath);
      } else if (entry.name === 'MainActivity.kt') {
        return entryPath;
      }
    }
  }
  return null;
}

function patchFullscreenSurfActivity(activityPath) {
  let source = fs.readFileSync(activityPath, 'utf8');
  if (source.includes(LEFT_INTENT_MARKER) && source.includes(VERTICAL_INTENT_MARKER)) return false;

  if (!source.includes('import android.util.Log')) {
    source = source.replace(/import android\.os\.Bundle\r?\n/, (match) => `${match}import android.util.Log\n`);
  }
  if (!source.includes('import android.view.KeyEvent')) {
    source = source.replace(/import android\.os\.Bundle\r?\n/, (match) => `${match}import android.view.KeyEvent\n`);
  }
  if (!source.includes('import com.facebook.react.modules.core.DeviceEventManagerModule')) {
    source = source.replace(
      /import android\.view\.KeyEvent\r?\n/,
      (match) => `${match}import com.facebook.react.modules.core.DeviceEventManagerModule\nimport com.facebook.react.bridge.Arguments\n`,
    );
  }
  if (!source.includes('import expo.modules.novacastcatalogdecode.NovacastFullscreenSurfModule')) {
    source = source.replace(
      /import expo\.modules\.ReactActivityDelegateWrapper\r?\n/,
      (match) => `${match}import expo.modules.novacastcatalogdecode.NovacastFullscreenSurfModule\n`,
    );
  }

  if (source.includes(FULLSCREEN_SURF_MARKER)) {
    if (!source.includes(VERTICAL_INTENT_MARKER)) {
      const verticalIntentBridge = `    ${VERTICAL_INTENT_MARKER}
    if (event.keyCode == KeyEvent.KEYCODE_DPAD_UP || event.keyCode == KeyEvent.KEYCODE_DPAD_DOWN) {
      val reactContext = try {
        getReactHost()?.currentReactContext
      } catch (error: Throwable) {
        null
      }
      reactContext?.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)?.emit(
        "onTVRemoteEvent",
        Arguments.createMap().apply {
          putString("eventType", if (event.keyCode == KeyEvent.KEYCODE_DPAD_UP) "up" else "down")
          putString("action", when (event.action) {
            KeyEvent.ACTION_DOWN -> "down"
            KeyEvent.ACTION_UP -> "up"
            else -> event.action.toString()
          })
          putInt("repeatCount", event.repeatCount)
          putLong("eventTime", event.eventTime)
          putLong("downTime", event.downTime)
        },
      )
    }
`;
      const dispatch = /(override fun dispatchKeyEvent\(event: KeyEvent\): Boolean \{\r?\n)/;
      source = source.replace(dispatch, `$1${verticalIntentBridge}`);
    }
    const leftIntentBridge = `      ${LEFT_INTENT_MARKER}
      if (event.keyCode == KeyEvent.KEYCODE_DPAD_LEFT && event.action == KeyEvent.ACTION_DOWN) {
        val reactContext = try {
          getReactHost()?.currentReactContext
        } catch (error: Throwable) {
          null
        }
        reactContext?.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)?.emit(
          "onTVRemoteEvent",
          Arguments.createMap().apply {
            putString("eventType", "left")
            putInt("keyCode", event.keyCode)
            putInt("action", event.action)
            putInt("repeatCount", event.repeatCount)
            putLong("eventTime", event.eventTime)
            putLong("downTime", event.downTime)
          },
        )
      }
`;
    const passthroughLog = '      Log.i("NovaCastSurfNative", "[NovaCastSurfNative] passthrough enabled=false")';
    source = source.replace(passthroughLog, `${leftIntentBridge}${passthroughLog}`);
    fs.writeFileSync(activityPath, source);
    return true;
  }

  const bridge = `
    ${VERTICAL_INTENT_MARKER}
    if (event.keyCode == KeyEvent.KEYCODE_DPAD_UP || event.keyCode == KeyEvent.KEYCODE_DPAD_DOWN) {
      val reactContext = try {
        getReactHost()?.currentReactContext
      } catch (error: Throwable) {
        null
      }
      reactContext?.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)?.emit(
        "onTVRemoteEvent",
        Arguments.createMap().apply {
          putString("eventType", if (event.keyCode == KeyEvent.KEYCODE_DPAD_UP) "up" else "down")
          putString("action", when (event.action) {
            KeyEvent.ACTION_DOWN -> "down"
            KeyEvent.ACTION_UP -> "up"
            else -> event.action.toString()
          })
          putInt("repeatCount", event.repeatCount)
          putLong("eventTime", event.eventTime)
          putLong("downTime", event.downTime)
        },
      )
    }
    ${FULLSCREEN_SURF_MARKER}
    if (event.keyCode == KeyEvent.KEYCODE_DPAD_LEFT || event.keyCode == KeyEvent.KEYCODE_DPAD_RIGHT) {
      val action = when (event.action) {
        KeyEvent.ACTION_DOWN -> "DOWN"
        KeyEvent.ACTION_UP -> "UP"
        else -> event.action.toString()
      }
      Log.i("NovaCastSurfNative", "[NovaCastSurfNative] dispatch keyCode=\${event.keyCode} action=\$action")
      val consumed = NovacastFullscreenSurfModule.dispatchKeyEvent(event)
      if (consumed) {
        Log.i("NovaCastSurfNative", "[NovaCastSurfNative] consumed keyCode=\${event.keyCode} action=\$action")
        return true
      }
      ${LEFT_INTENT_MARKER}
      if (event.keyCode == KeyEvent.KEYCODE_DPAD_LEFT && event.action == KeyEvent.ACTION_DOWN) {
        val reactContext = try {
          getReactHost()?.currentReactContext
        } catch (error: Throwable) {
          null
        }
        reactContext?.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)?.emit(
          "onTVRemoteEvent",
          Arguments.createMap().apply {
            putString("eventType", "left")
            putInt("keyCode", event.keyCode)
            putInt("action", event.action)
            putInt("repeatCount", event.repeatCount)
            putLong("eventTime", event.eventTime)
            putLong("downTime", event.downTime)
          },
        )
      }
      Log.i("NovaCastSurfNative", "[NovaCastSurfNative] passthrough enabled=false")
    }
`;
  const dispatch = /(override fun dispatchKeyEvent\(event: KeyEvent\): Boolean \{\r?\n)/;
  if (dispatch.test(source)) {
    source = source.replace(dispatch, `$1${bridge}`);
  } else {
    source = source.replace(
      'class MainActivity : ReactActivity() {',
      `class MainActivity : ReactActivity() {
  override fun dispatchKeyEvent(event: KeyEvent): Boolean {
${bridge}    return super.dispatchKeyEvent(event)
  }
`,
    );
  }
  if (!source.includes(FULLSCREEN_SURF_STARTUP_MARKER)) {
    source = source.replace(
      /override fun onCreate\(savedInstanceState: Bundle\?\)(?:: Unit)? \{\r?\n/,
      (match) => `${match}    Log.i("NovaCastSurfNative", "${FULLSCREEN_SURF_STARTUP_MARKER}")\n`,
    );
  }
  fs.writeFileSync(activityPath, source);
  return true;
}

function withNovacastFullscreenSurf(config) {
  return withDangerousMod(config, ['android', async (config) => {
    const root = path.join(config.modRequest.platformProjectRoot, 'app', 'src', 'main', 'java');
    const activityPath = findMainActivity(root);
    if (!activityPath) throw new Error('Expected generated MainActivity.kt not found');
    const injected = patchFullscreenSurfActivity(activityPath);
    console.log('[NovaCast Config Plugin] MainActivity located:', activityPath);
    console.log('[NovaCast Config Plugin] fullscreen surf bridge injected:', injected);
    return config;
  }]);
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

      return config;
    },
  ]);
}

function withNovacastTvManifest(config) {
  config = withNovacastAndroidManifest(config);
  config = withNovacastFullscreenSurf(config);
  config = withNovacastTvBannerAssets(config);
  return config;
}

module.exports = withNovacastTvManifest;
