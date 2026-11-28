package expo.modules.nowplaying

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.widget.RemoteViews
import java.io.File

/** Home-screen widget: cover, title and artist, previous / play-pause / next. */
class NowPlayingWidgetProvider : AppWidgetProvider() {
  override fun onUpdate(context: Context, manager: AppWidgetManager, appWidgetIds: IntArray) {
    val views = buildViews(context)
    appWidgetIds.forEach { manager.updateAppWidget(it, views) }
  }

  companion object {
    private const val ART_SIZE_PX = 192

    fun refreshAll(context: Context) {
      val manager = AppWidgetManager.getInstance(context)
      val ids = manager.getAppWidgetIds(ComponentName(context, NowPlayingWidgetProvider::class.java))
      if (ids.isNotEmpty()) manager.updateAppWidget(ids, buildViews(context))
    }

    fun buildViews(context: Context): RemoteViews {
      val state = WidgetState.load(context)
      val views = RemoteViews(context.packageName, R.layout.now_playing_widget)

      views.setTextViewText(R.id.np_title, state.title ?: context.getString(R.string.np_nothing_playing))
      views.setTextViewText(R.id.np_artist, state.artist ?: if (state.title == null) context.getString(R.string.np_tap_to_open) else "")
      views.setImageViewResource(R.id.np_play, if (state.isPlaying) R.drawable.np_pause else R.drawable.np_play)
      views.setContentDescription(R.id.np_play, context.getString(if (state.isPlaying) R.string.np_pause else R.string.np_play))

      val art = state.artworkPath?.let { loadArtwork(it) }
      if (art != null) views.setImageViewBitmap(R.id.np_art, art) else views.setImageViewResource(R.id.np_art, R.drawable.np_note)

      views.setOnClickPendingIntent(R.id.np_root, openPlayer(context))
      views.setOnClickPendingIntent(R.id.np_play, action(context, WidgetActionReceiver.ACTION_TOGGLE, 1))
      views.setOnClickPendingIntent(R.id.np_next, action(context, WidgetActionReceiver.ACTION_NEXT, 2))
      views.setOnClickPendingIntent(R.id.np_previous, action(context, WidgetActionReceiver.ACTION_PREVIOUS, 3))
      return views
    }

    /** Opens the app on the player screen (expo-router deep link), or just the app. */
    private fun openPlayer(context: Context): PendingIntent {
      val intent = Intent(Intent.ACTION_VIEW, Uri.parse("localtunes://player")).setPackage(context.packageName)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
      val target = if (intent.resolveActivity(context.packageManager) != null) intent
      else context.packageManager.getLaunchIntentForPackage(context.packageName) ?: intent
      return PendingIntent.getActivity(context, 0, target, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }

    private fun action(context: Context, action: String, requestCode: Int): PendingIntent {
      val intent = Intent(context, WidgetActionReceiver::class.java).setAction(action)
      return PendingIntent.getBroadcast(context, requestCode, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }

    /** Decode the cover small enough for a widget (RemoteViews bitmaps are size-limited). */
    private fun loadArtwork(path: String): Bitmap? = try {
      val file = File(path)
      if (!file.exists()) null
      else {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(path, bounds)
        var sample = 1
        while (bounds.outWidth / (sample * 2) >= ART_SIZE_PX && bounds.outHeight / (sample * 2) >= ART_SIZE_PX) sample *= 2
        BitmapFactory.decodeFile(path, BitmapFactory.Options().apply { inSampleSize = sample })
          ?.let { Bitmap.createScaledBitmap(it, ART_SIZE_PX, ART_SIZE_PX, true) }
      }
    } catch (e: Exception) {
      null
    }
  }
}
