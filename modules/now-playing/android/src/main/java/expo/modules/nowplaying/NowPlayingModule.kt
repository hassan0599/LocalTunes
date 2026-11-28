package expo.modules.nowplaying

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** JS → widget: remembers what's playing and redraws every LocalTunes widget. */
class NowPlayingModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("NowPlaying")

    Function("updateWidget") { title: String?, artist: String?, isPlaying: Boolean, artworkPath: String? ->
      val context = appContext.reactContext ?: return@Function
      WidgetState(title, artist, isPlaying, artworkPath).save(context)
      NowPlayingWidgetProvider.refreshAll(context)
    }
  }
}
