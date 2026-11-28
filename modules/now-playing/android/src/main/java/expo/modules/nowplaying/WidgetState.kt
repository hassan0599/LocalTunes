package expo.modules.nowplaying

import android.content.Context

/** What the widget shows, kept in SharedPreferences so it survives the app being closed. */
data class WidgetState(
  val title: String?,
  val artist: String?,
  val isPlaying: Boolean,
  val artworkPath: String?,
) {
  fun save(context: Context) {
    prefs(context).edit()
      .putString(KEY_TITLE, title)
      .putString(KEY_ARTIST, artist)
      .putBoolean(KEY_PLAYING, isPlaying)
      .putString(KEY_ARTWORK, artworkPath)
      .apply()
  }

  companion object {
    private const val PREFS = "localtunes_now_playing_widget"
    private const val KEY_TITLE = "title"
    private const val KEY_ARTIST = "artist"
    private const val KEY_PLAYING = "playing"
    private const val KEY_ARTWORK = "artwork"

    private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun load(context: Context): WidgetState {
      val p = prefs(context)
      return WidgetState(
        p.getString(KEY_TITLE, null),
        p.getString(KEY_ARTIST, null),
        p.getBoolean(KEY_PLAYING, false),
        p.getString(KEY_ARTWORK, null),
      )
    }

    /** The playback service went away (e.g. the app was closed): show "paused". */
    fun markPaused(context: Context) {
      prefs(context).edit().putBoolean(KEY_PLAYING, false).apply()
    }
  }
}
