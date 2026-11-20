# localtunes: Build Plan

Implements [the technical spec](./Offline-First%20Music%20Player%20Technical%20Spec.md). Stack as scaffolded: Expo SDK 58, React Native 0.88 (New Architecture only), Expo Router, TypeScript, expo-sqlite (FTS5 on), Zustand.

## Where the plan departs from the spec

| # | Spec says | Change | Why |
|---|---|---|---|
| 1 | react-native-track-player | **Not installed yet. Decide in M1 spike** (see below) | RNTP 4.1.2 (latest stable) does not support the New Architecture, and RN 0.88 requires it. `expo install` warns about this. |
| 2 | `createDownloadResumable` | Import it from `expo-file-system/legacy`, or use the new `File`/`Directory` API if it supports resuming | SDK 58 moved the resumable API under `legacy` |
| 3 | `tracks` columns | Added `license`, `last_played_at`. `downloads` gets `attempts` and `UNIQUE(source, source_id)` | 6.4 stores the license per track. 6.1 boosts recently played tracks. 6.4 retries up to 3 times |
| 4 | Tag reading (6.1) unspecified | Pick a library in M1 | Nothing in the stack reads ID3/MP4/FLAC tags from imported files |
| 5 | Wishlist is an open question | Add a `wishlist` table in M3 | Cheap, and it keeps Discover useful when no playable source exists |

### Playback spike (first task of M1, about 1 day)

Build a dev client on a real Android device and test: background playback, lock-screen controls, next and previous from the notification, and audio-focus interruption.

1. **expo-audio** (first-party, already the prototype). Check SDK 58's lock-screen and background support. The queue lives in a Zustand store and is persisted to `settings`.
2. **react-native-audio-pro** (New Architecture, built for this use case) if expo-audio cannot handle remote next and previous or audio focus.
3. RNTP v5 nightly only if both fail. Not recommended for v1.

Whatever wins sits behind a `PlaybackService` interface in `src/services/playback/`, so the UI never imports the library directly.

## Milestones

### M1 · Foundation (1 to 2 weeks)
- Playback spike (above), then `PlaybackService` + `state/player.ts` (queue, repeat, shuffle, resume position every 5 s).
- Choose a tag library; `services/media/importer.ts` (document picker → copy into `Paths.document/music/` → read tags, falling back to the file name → insert into `tracks`).
- `db/queries.ts`: typed query helpers. Schema v1 is already in `db/schema.ts`.
- Library tab: songs, albums and artists lists (FlashList if 10k rows lag), long-press actions.
- MiniPlayer above the tab bar; Now Playing modal.
- Add `jest-expo` for logic tests.
- **Exit:** on an Android device, import a file, play it with the screen locked, and resume after an app kill.

### M2 · Local search (1 week)
- `services/media/deviceScan.ts`: Android MediaStore scan via expo-media-library (`granularPermissions: ["audio"]` already set). Runs on first launch, pull-to-refresh and foreground, and skips the scan when nothing has changed.
- `db/fts.ts`: query builder (`jazz mil` → `"jazz"* "mil"*`, escape quotes), ranked by bm25 plus a recency boost.
- Search tab with a 150 ms debounce, results grouped by songs, albums and artists.
- **Exit:** a seeded 50k-track DB answers queries in under 50 ms on a mid-range Android phone (benchmark script).

### M3 · Discover (1 to 2 weeks)
- `services/musicbrainz/client.ts`: serial queue with 1.1 s spacing, backoff on 503, User-Agent from `MUSICBRAINZ_USER_AGENT` in `src/config.ts`.
- `cache.ts` over `mb_cache` (7 d entities / 24 h search), stale-while-revalidate, `OfflineBanner`.
- Genre browse, artist page, search with type toggle, similar artists from tags and relationships.
- Cover Art Archive images with an on-disk cache; a 404 shows the placeholder.
- "In your library" matching (MBID first, then normalized artist and title). Wishlist.
- **Exit:** browse, kill the network, and the pages already visited still render.

### M4 · Acquisition (1 to 2 weeks)
- `sources/jamendo.ts` (client id from `EXPO_PUBLIC_JAMENDO_CLIENT_ID` in `.env.local`, which is gitignored) and `sources/internetArchive.ts`. Store the license text for every track.
- `downloads/manager.ts` + `worker.ts`: persistent queue, 2 concurrent transfers, resumable, progress every 500 ms, backoff retries ×3, a Wi-Fi-only switch driven by NetInfo, and a free-space check.
- On completion, tag the file, insert the track, then fetch cover art.
- Downloads tab: active and finished downloads, per-source storage, bulk delete. A "Get" button on Discover.
- **Exit:** a download survives app kill and airplane-mode toggling and completes.

### M5 · Polish (1 week)
- Playlists, queue persistence edge cases, offline banners everywhere, accessibility pass (labels, 44 pt, dynamic type), cold-start profiling (under 1.5 s with 10k tracks), Android device matrix testing (Android 10, 13+, a low-end phone).

## Decisions
1. **Platform scope:** v1 ships **Android first**. Keep code cross-platform (no Android-only APIs outside `services/media/deviceScan.ts`), but test, tune and release on Android only. iOS (import-only) follows after v1.
2. **MusicBrainz contact:** `developer.mha@gmail.com`, set in `src/config.ts`.
3. **License:** MIT (`LICENSE`).
4. **Open: bundle id.** Set to `com.localtunes.app` as a placeholder. Change it before the first Play Store build.

## Commands
```bash
npm install
npx expo run:android      # builds a dev client (needs Android Studio/SDK); or: npx eas-cli@latest build --profile development
npm start                 # Metro for an installed dev client
npm run typecheck
npx expo install <pkg>    # always use this to add packages
```
Expo Go will not work once native modules beyond its bundle are used. Use a development build.
