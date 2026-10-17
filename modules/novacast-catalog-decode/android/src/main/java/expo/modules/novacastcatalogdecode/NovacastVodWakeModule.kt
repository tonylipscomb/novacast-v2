package expo.modules.novacastcatalogdecode

import android.util.Log
import android.view.KeyEvent
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Native owner for hidden Movie/Episode chrome wake input.
 *
 * MainActivity consults this gate before Android's normal focus routing. The
 * gate is disabled by default and is lifecycle-scoped by the VOD controller.
 */
class NovacastVodWakeModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("NovacastVodWake")
    Events("onVodWakeKey")

    Function("setVodWakeEnabled") { value: Boolean ->
      enabled = value
      Log.i(TAG, "[NovaCast VOD Wake Native] enabled=$value")
      true
    }

    OnCreate {
      module = this@NovacastVodWakeModule
    }

    OnDestroy {
      if (module === this@NovacastVodWakeModule) {
        module = null
      }
      enabled = false
    }
  }

  companion object {
    private const val TAG = "NovaCastVodWake"

    @Volatile
    private var enabled = false

    @Volatile
    private var module: NovacastVodWakeModule? = null

    fun dispatchKeyEvent(event: KeyEvent, focusedView: String): Boolean {
      if (!enabled || !isWakeKey(event.keyCode)) {
        return false
      }

      val eventType = when (event.keyCode) {
        KeyEvent.KEYCODE_DPAD_LEFT -> "left"
        KeyEvent.KEYCODE_DPAD_RIGHT -> "right"
        KeyEvent.KEYCODE_DPAD_UP -> "up"
        KeyEvent.KEYCODE_DPAD_DOWN -> "down"
        else -> "select"
      }
      module?.sendEvent(
        "onVodWakeKey",
        mapOf(
          "eventType" to eventType,
          "keyCode" to event.keyCode,
          "eventKeyAction" to event.action,
          "repeatCount" to event.repeatCount,
          "eventTime" to event.eventTime,
          "downTime" to event.downTime,
          "activeOwner" to "vod-hidden-chrome",
          "focusedView" to focusedView.take(80),
        ),
      )
      Log.i(
        TAG,
        "[NovaCast VOD Wake Native] input eventType=$eventType " +
          "keyCode=${event.keyCode} action=${event.action} " +
          "repeatCount=${event.repeatCount} focusedView=${focusedView.take(80)}",
      )

      // Consume the whole native key sequence while the hidden owner is active.
      // JS performs the ACTION_DOWN/repeat/up wake deduplication.
      return true
    }

    private fun isWakeKey(keyCode: Int): Boolean {
      return keyCode == KeyEvent.KEYCODE_DPAD_CENTER ||
        keyCode == KeyEvent.KEYCODE_ENTER ||
        keyCode == KeyEvent.KEYCODE_NUMPAD_ENTER ||
        keyCode == KeyEvent.KEYCODE_DPAD_LEFT ||
        keyCode == KeyEvent.KEYCODE_DPAD_RIGHT ||
        keyCode == KeyEvent.KEYCODE_DPAD_UP ||
        keyCode == KeyEvent.KEYCODE_DPAD_DOWN
    }
  }
}
