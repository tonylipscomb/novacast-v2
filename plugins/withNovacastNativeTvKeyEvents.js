const fs = require('fs');
const path = require('path');
const { withDangerousMod } = require('@expo/config-plugins');

const METHOD = `
  override fun dispatchKeyEvent(event: KeyEvent): Boolean {
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
    return super.dispatchKeyEvent(event)
  }
`;

function withNovacastNativeTvKeyEvents(config) {
  return withDangerousMod(config, ['android', async (config) => {
    const activityPath = path.join(config.modRequest.platformProjectRoot, 'app', 'src', 'main', 'java', 'com', 'novacast', 'novacastv2', 'MainActivity.kt');
    if (!fs.existsSync(activityPath)) throw new Error(`Expected MainActivity.kt not found: ${activityPath}`);
    let source = fs.readFileSync(activityPath, 'utf8');
    if (source.includes('onNovaCastNativeTvKey')) return config;
    const imports = 'import android.view.KeyEvent\nimport com.facebook.react.bridge.Arguments\nimport com.facebook.react.modules.core.DeviceEventManagerModule\n';
    const classMarker = 'class MainActivity : ReactActivity() {';
    if (!source.includes(classMarker)) throw new Error('Expected NovaCast MainActivity class not found');
    source = source.replace('import android.os.Bundle\n', `import android.os.Bundle\n${imports}`);
    const insertionPoint = '\n  override fun onCreate';
    if (!source.includes(insertionPoint)) throw new Error('Expected MainActivity onCreate anchor not found');
    source = source.replace(insertionPoint, `\n${METHOD}${insertionPoint}`);
    fs.writeFileSync(activityPath, source);
    return config;
  }]);
}

module.exports = withNovacastNativeTvKeyEvents;
