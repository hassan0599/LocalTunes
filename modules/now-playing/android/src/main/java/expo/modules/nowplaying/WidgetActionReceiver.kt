package expo.modules.nowplaying

import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.util.Log
import androidx.core.content.ContextCompat
import androidx.media3.session.MediaController
import androidx.media3.session.SessionToken

/**
 * Widget buttons: connect to expo-audio's media session and send the command, the same way
 * a Bluetooth headset or the lock screen does. Binding (rather than starting the service)
 * means nothing happens, safely, when no music is loaded.
 */
class WidgetActionReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val action = intent.action ?: return
    val pending = goAsync()
    val app = context.applicationContext
    val token = SessionToken(app, ComponentName(app, PLAYBACK_SERVICE))
    val future = MediaController.Builder(app, token).buildAsync()
    future.addListener({
      try {
        val controller = future.get()
        when (action) {
          ACTION_TOGGLE -> if (controller.playWhenReady) controller.pause() else controller.play()
          ACTION_NEXT -> controller.seekToNext()
          ACTION_PREVIOUS -> controller.seekToPrevious()
        }
        controller.release()
      } catch (e: Exception) {
        // No session (nothing loaded, or the app was closed): show it as paused.
        Log.i(TAG, "No media session to control: ${e.message}")
        WidgetState.markPaused(app)
        NowPlayingWidgetProvider.refreshAll(app)
      } finally {
        pending.finish()
      }
    }, ContextCompat.getMainExecutor(app))
  }

  companion object {
    private const val TAG = "LocalTunesWidget"
    private const val PLAYBACK_SERVICE = "expo.modules.audio.service.AudioControlsService"
    const val ACTION_TOGGLE = "expo.modules.nowplaying.TOGGLE"
    const val ACTION_NEXT = "expo.modules.nowplaying.NEXT"
    const val ACTION_PREVIOUS = "expo.modules.nowplaying.PREVIOUS"
  }
}
