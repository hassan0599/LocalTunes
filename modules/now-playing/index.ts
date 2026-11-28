/**
 * Now playing outside the app (Android): the home-screen widget and Android Auto support.
 * The widget's buttons talk to expo-audio's media session directly, so they work while the
 * app is in the background; this module only pushes what the widget should show.
 *
 * On other platforms, in Expo Go or on web the native module is absent and this is a no-op.
 */
import { requireOptionalNativeModule } from 'expo';

interface NowPlayingNative {
  updateWidget(title: string | null, artist: string | null, isPlaying: boolean, artworkPath: string | null): void;
}

const native = requireOptionalNativeModule<NowPlayingNative>('NowPlaying');

export interface WidgetState {
  title: string | null;
  artist: string | null;
  isPlaying: boolean;
  /** file:// URI of the cover image, if any. */
  artworkUri: string | null;
}

let last = '';

/** Update the home-screen widget (only sends a change). Never throws. */
export function updateWidget(state: WidgetState): void {
  if (!native) return;
  const key = JSON.stringify(state);
  if (key === last) return;
  last = key;
  try {
    const path = state.artworkUri?.startsWith('file://') ? decodeURIComponent(state.artworkUri.slice('file://'.length)) : null;
    native.updateWidget(state.title, state.artist, state.isPlaying, path);
  } catch (e) {
    console.warn('now-playing: widget update failed', e);
  }
}
