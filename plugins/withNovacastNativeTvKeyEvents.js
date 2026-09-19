const fs = require('fs');
const path = require('path');
const { withDangerousMod } = require('@expo/config-plugins');

const FAVORITE_MARKER = '// NovaCast native favorite key bridge';
const METHOD = `
    ${FAVORITE_MARKER}
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

function withNovacastNativeTvKeyEvents(config) {
  return withDangerousMod(config, ['android', async (config) => {
    const activityPath = findMainActivity(path.join(config.modRequest.platformProjectRoot, 'app', 'src', 'main', 'java'));
    if (!activityPath) throw new Error('Expected generated MainActivity.kt not found');
    let source = fs.readFileSync(activityPath, 'utf8');
    const alreadyPresent = source.includes('onNovaCastNativeTvKey');
    if (!source.includes('import android.view.KeyEvent')) {
      source = source.replace(/import android\.os\.Bundle\r?\n/, (match) => `${match}import android.view.KeyEvent\n`);
    }
    if (!alreadyPresent && !source.includes('import com.facebook.react.bridge.Arguments')) {
      source = source.replace(/import android\.os\.Bundle\r?\n|import com\.facebook\.react\.ReactActivity\r?\n/, (match) => `${match}import com.facebook.react.bridge.Arguments\n`);
    }
    if (!alreadyPresent && !source.includes('import com.facebook.react.modules.core.DeviceEventManagerModule')) {
      source = source.replace(/import android\.os\.Bundle\r?\n|import com\.facebook\.react\.ReactActivity\r?\n/, (match) => `${match}import com.facebook.react.modules.core.DeviceEventManagerModule\n`);
    }
    const classMarker = 'class MainActivity : ReactActivity() {';
    if (!source.includes(classMarker)) throw new Error('Expected NovaCast MainActivity class not found');
    if (!alreadyPresent) {
      const dispatch = /(override fun dispatchKeyEvent\(event: KeyEvent\): Boolean \{\r?\n)/;
      if (dispatch.test(source)) {
        source = source.replace(dispatch, `$1${METHOD}`);
      } else {
        const insertionPoint = '\n  override fun onCreate';
        if (!source.includes(insertionPoint)) throw new Error('Expected MainActivity onCreate anchor not found');
        source = source.replace(insertionPoint, `\n  override fun dispatchKeyEvent(event: KeyEvent): Boolean {\n${METHOD}    return super.dispatchKeyEvent(event)\n  }${insertionPoint}`);
      }
    }
    console.log('[NovaCast Config Plugin] MainActivity located:', activityPath);
    console.log('[NovaCast Config Plugin] favorite bridge injected:', !alreadyPresent);
    fs.writeFileSync(activityPath, source);
    return config;
  }]);
}

module.exports = withNovacastNativeTvKeyEvents;
