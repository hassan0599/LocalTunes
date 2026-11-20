# localtunes: Build Plan

Implements [the technical spec](./Offline-First%20Music%20Player%20Technical%20Spec.md). Stack as scaffolded: Expo SDK 58, React Native 0.88 (New Architecture only), Expo Router, TypeScript, expo-sqlite (FTS5 on), Zustand.

## Where the plan departs from the spec

| # | Spec says | Change | Why |
|---|---|---|---|
| 1 | react-native-track-player | **expo-audio `AudioPlaylist`** (decided in M1, see below) | RNTP 4.1.2 (latest stable) does not support the New Architecture, and RN 0.88 requires it. SDK 58's expo-audio has a native playlist with lock-screen next and previous, background playback and audio focus. |
| 2 | `createDownloadResumable` | Import it from `expo-file-system/legacy`, or use the new `File`/`Directory` API if it supports resuming | SDK 58 moved the resumable API under `legacy` |
| 3 | `tracks` columns | Added `license`, `last_played_at`, `album_artist`, `track_no`, `artwork_uri`. `downloads` gets `attempts` and `UNIQUE(source, source_id)` | 6.4 stores the license per track. 6.1 boosts recently played tracks. 6.4 retries up to 3 times. Album grouping and embedded cover art need the tag fields |
| 4 | Tag reading (6.1) unspecified | **In-house reader** `services/media/tags.ts`: ID3v1/v2, FLAC, MP4, plus duration. Reads only the bytes it needs through expo-file-system `FileHandle` | No maintained RN-compatible library. A small pure-TS reader is unit-tested in Node. OGG/Opus falls back to the file name (TODO) |
| 6 | Media library scan (6.1) | expo-media-library returns file name and duration only, not artist or album | M2 scan runs the same tag reader over device files |
| 5 | Wishlist is an open question | Add a `wishlist` table in M3 | Cheap, and it keeps Discover useful when no playable source exists |

### Playback decision

**expo-audio** is the engine. `services/playback/PlaybackService.ts` wraps one native `AudioPlaylist`: interruption mode `doNotMix`, background playback on, lock-screen controls with next and previous. The queue (playback order and pre-shuffle order) lives in `state/player.ts` and is persisted to `settings`.

If on-device testing shows gaps (remote next/previous, focus loss during calls), the fallback is **react-native-audio-pro** behind the same `PlaybackService` functions. The UI never imports expo-audio directly.

## Toolchain
- **Node 22.13 or later** (SDK 58 requirement). Node 24 is installed via nvm.
- **JDK 17** for Gradle (`JAVA_HOME` must not point at the system JRE 8).
- Android SDK at `%LOCALAPPDATA%\Android\Sdk`. Test device: Galaxy A32 5G, Android 13.
- **Windows long paths:** the SDK's CMake 3.22.1 ships ninja 1.10.2, which fails on react-native-reanimated's long object paths. It was replaced with ninja 1.12.1 (old copy kept as `ninja-1.10.2.exe.bak` in `cmake\3.22.1\bin`). Reapply if the SDK's CMake is reinstalled. `subst` does not help, because autolinking resolves real paths.
- **Device connection:** run `adb reverse tcp:8081 tcp:8081` and load `http://localhost:8081` in the dev client. The LAN URL hangs (Windows firewall).
- Build from PowerShell with `$env:JAVA_HOME` set. A `JAVA_HOME` exported from Git Bash did not reach Gradle.

## Milestones

### M1 · Foundation (1 to 2 weeks)
- [x] `PlaybackService` + `state/player.ts` (queue, repeat, shuffle, play next, add to queue, resume position every 5 s, play counts).
- [x] Tag reader + `services/media/importer.ts` (document picker → move into `Paths.document/music/` → read tags, falling back to the file name → insert into `tracks`, embedded cover → `Paths.document/covers/`).
- [x] `db/queries.ts`: typed query helpers.
- [x] Library tab: songs (sortable), albums grid, artists; album and artist pages; long-press actions (play next, add to queue, delete).
- [x] MiniPlayer above the tab bar; Now Playing modal with seek, shuffle, repeat, up next.
- [x] `jest-expo` with tests for the tag reader and queue logic.
- [x] On-device verification on a Galaxy A32 (Android 13), 2026-11-20: import, playback, lock-screen controls, Now Playing, resume after app kill.
- **Exit:** on an Android device, import a file, play it with the screen locked, and resume after an app kill.

### M2 · Local search (1 week)
- [x] `services/media/deviceScan.ts`: MediaStore scan (expo-media-library `next` API). Runs on first launch (asks for permission once), on foreground and on pull-to-refresh. A signature check (count, newest mtime, ids, filter version) skips no-op scans. Diffs by MediaStore id (`tracks.device_id`, migration v2). Reads tags with the same reader as imports.
- [x] `services/media/scanFilter.ts`: what counts as music. Requires a known duration of at least 30 s. Excludes ringtone, recording and backup folders, plus voice-note and WhatsApp file names. Deleted device tracks are remembered (`scan.ignored`).
- [x] `db/fts.ts`: `jazz mil` → `"jazz"* AND "mil"*`. Songs rank by bm25 (title > artist > album) with a 30-day recency boost. Albums and artists use FTS column filters. FTS table has `prefix='1 2 3'`. Broad queries (more than 2,000 matches) skip bm25 and return the newest matches.
- [x] Search tab: 150 ms debounce, stale-response guard, songs / albums / artists groups.
- [x] Tests: tag reader, filter rules, and search SQL against real SQLite + FTS5 (`node:sqlite`, needs Node 22.5+).
- Benchmarks are out of scope for now (owner's call, 2026-11-20). For reference: at 50k tracks, search takes about 12 ms worst case on desktop and 43–286 ms on the Galaxy A32 in a **debug** build, where SQLite is compiled unoptimized. The < 50 ms target (spec 8) is unverified on a release build.

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
