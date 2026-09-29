package expo.modules.novacastcatalogdecode

import android.view.KeyEvent
import android.util.Log
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** Raw fullscreen LEFT/RIGHT bridge; channel and playback logic remain in JS. */
class NovacastFullscreenSurfModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("NovacastFullscreenSurf")
    Events("onFullscreenSurfKey")

    Function("setFullscreenSurfEnabled") { value: Boolean ->
      enabled = value
      Log.i("NovaCastSurfNative", "[NovaCastSurfNative] enabled-changed value=$value")
      true
    }

    OnCreate {
      module = this@NovacastFullscreenSurfModule
    }

    OnDestroy {
      if (module === this@NovacastFullscreenSurfModule) {
        module = null
        enabled = false
      }
    }
  }

  companion object {
    @Volatile private var module: NovacastFullscreenSurfModule? = null
    @Volatile private var enabled = false

    @JvmStatic fun isEnabled(): Boolean = enabled

    @JvmStatic fun setEnabledFromActivity(value: Boolean) {
      enabled = value
    }

    @JvmStatic fun dispatchKeyEvent(event: KeyEvent): Boolean {
      if (!enabled || (event.keyCode != KeyEvent.KEYCODE_DPAD_LEFT && event.keyCode != KeyEvent.KEYCODE_DPAD_RIGHT)) {
        return false
      }
      module?.sendEvent(
        "onFullscreenSurfKey",
        mapOf(
          "keyCode" to event.keyCode,
          "action" to event.action,
          "eventTime" to event.eventTime,
          "downTime" to event.downTime,
          "repeatCount" to event.repeatCount,
        ),
      )
      Log.i(
        "NovaCastSurfNative",
        "[NovaCastSurfNative] event-emitted keyCode=${event.keyCode} action=${event.action} repeatCount=${event.repeatCount}",
      )
      return true
    }
  }
}
