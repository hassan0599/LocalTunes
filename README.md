# localtunes

An offline-first music player for Android (iOS follows after v1), built with Expo. Your library lives on-device in SQLite, search is local via FTS5, and anything fetched from the internet — MusicBrainz metadata, cover art, legal downloads — is cached so it keeps working with no network.

## Features

- **Library** — Songs (sortable), albums grid, artists, playlists, and genres. Import files via the document picker; on Android, audio already on the device is indexed automatically. Long-press (bottom-sheet menu) for play next, add to queue, add to playlist, go to album/artist, delete.
- **Local search** — One search box with 150 ms debounce across songs, albums, artists, genres, and playlists. Prefix matching (`jazz mil` → `"jazz"* AND "mil"*`), BM25 ranking with title > artist > album weighting plus a 30-day recency boost. Works fully offline.
- **Playback** — Background playback with lock-screen next/previous via `expo-audio` `AudioPlaylist`. Queue with shuffle/repeat, play-next/add-to-queue, persisted queue and resume position (every 5 s), play counts. Mini-player above the tab bar plus a full Now Playing screen with seek, shuffle, repeat, and Up Next.
- **Discover (MusicBrainz)** — Browse by genre, artist pages (tags, related artists, links), discographies, similar artists, album tracklists, and search with a type toggle. Rate-limited client (1.1 s spacing, backoff on 503/429), 7-day entity / 24-hour search cache, stale-while-offline rendering with an "Offline, showing saved results" banner. "In your library" badges play owned tracks directly.
- **Get music (legal sources only)** — Provider interface with Internet Archive (public-domain / CC audio) and Jamendo (CC tracks, free API key required). License labels and plain-language terms shown before download, on finished downloads, and in Now Playing. "Get" buttons on Discover results; external buy/stream links (Bandcamp, Apple Music, Spotify) when no legal match exists.
- **Downloads** — Persistent queue (survives app kill), 2 concurrent transfers, resumable, progress to DB every 500 ms, retries with 10/20/40 s backoff (up to 3 attempts), Wi-Fi-only mode, 100 MB free-space margin. Pause/resume/retry/cancel, per-source storage stats, bulk delete.
- **Playlists & wishlist** — Create, rename, delete, reorder (move up/down), add songs or whole albums/artists, mosaic covers. Wishlist saves discovered MusicBrainz recordings/releases with no playable source yet.
- **Offline-first & accessible** — Library, Search, and Now Playing work with no network; cached Discover pages render offline. Screen-reader labels on all controls, 44 pt touch targets, dynamic-type-safe rows, offline banners on network-dependent screens.

## Tech stack

| Concern | Choice |
| --- | --- |
| Framework | Expo SDK 58 (development build), React Native 0.88 (New Architecture), Expo Router |
| Language | TypeScript (strict) |
| Playback | `expo-audio` `AudioPlaylist` (background playback, lock-screen controls) |
| Database | `expo-sqlite` with FTS5 (`prefix='1 2 3'`) |
| Files | `expo-file-system` (+ legacy `DownloadTask.savable()` for resumable downloads) |
| Local media | `expo-media-library` (Android scan), `expo-document-picker` (import) |
| State | Zustand (+ `settings` table for persisted queue/position) |
| Networking | `fetch` with serial rate-limited queue, retry + cache wrapper |
| Connectivity | `@react-native-community/netinfo` |
| Tags | In-house reader (`services/media/tags.ts`): ID3v1/v2, FLAC, MP4 + duration; OGG/Opus falls back to file name |

SQLite is the single source of truth — the UI never reads from the network directly. Key tables: `tracks` (+ `tracks_fts`), `playlists` / `playlist_tracks`, `downloads`, `wishlist`, `mb_cache`, `settings`.

## Project structure

```
src/
  app/            Expo Router screens: (tabs)/library, search, discover, downloads + album, artist,
                  genre, mb-artist, mb-album, playlist, wishlist, get, player
  components/     TrackRow, MiniPlayer, CoverImage, OfflineBanner, Sheet, theme, trackActions, …
  db/             schema.ts (migrations), queries.ts, fts.ts, playlists.ts
  services/
    playback/     PlaybackService.ts, queue.ts
    media/        deviceScan.ts, importer.ts, tags.ts, scanFilter.ts, genreBackfill.ts
    musicbrainz/  client.ts (rate-limited), cache.ts, api.ts, mappers.ts, match.ts, coverArt.ts
    sources/      types.ts, internetArchive.ts, jamendo.ts, license.ts
    downloads/    manager.ts, schedule.ts
  state/          player.ts, library.ts, network.ts, downloads.ts, wishlist.ts, scan.ts
```

See [`PLAN.md`](./PLAN.md) for the build plan and milestone notes, and [`Offline-First Music Player Technical Spec.md`](./Offline-First%20Music%20Player%20Technical%20Spec.md) for the original spec.

## Getting started

### Prerequisites

- **Node 22.13+**
- **JDK 17** for Gradle builds (`JAVA_HOME` must not point at a JRE 8)
- Android SDK + a device or emulator (primary test device: Galaxy A32 5G, Android 13)
- Expo Go will **not** work (native modules beyond its bundle are used) — use a development build

### Install & run

```bash
npm install
npx expo run:android      # builds a dev client (needs Android SDK); or: npx eas-cli@latest build --profile development
npm start                 # Metro for the installed dev client
```

If the dev server won't connect over LAN (e.g. Windows firewall), use USB reverse-proxying and load `http://localhost:8081` in the dev client:

```bash
adb reverse tcp:8081 tcp:8081
```

### Optional: Jamendo source

The Jamendo source is off without a client id. Get a free key at <https://devportal.jamendo.com> and set it in `.env.local` (gitignored, embedded at build time):

```bash
EXPO_PUBLIC_JAMENDO_CLIENT_ID=your_key_here
```

### Commands

```bash
npm start                 # Metro dev server
npm run typecheck         # tsc --noEmit
npm run lint              # expo lint
npm test                  # jest (jest-expo preset)
npx expo install <pkg>    # always use this to add packages (resolves SDK-compatible versions)
```

Run lint and typecheck before declaring a task done. Never hand-create or edit `ios/` / `android/` — they are generated; configure native behavior in `app.json` and config plugins.

## Configuration

- App identity: `app.json` (`com.localtunes.app` — placeholder, change before the first Play Store build), dark-only UI (`#14161B` surfaces, `#E5484D` accent).
- MusicBrainz contact (required `User-Agent`): `src/config.ts` → `MUSICBRAINZ_CONTACT`.
- Background audio, MediaStore audio permission, and FTS5 are wired via `app.json` plugin config (`expo-audio`, `expo-media-library`, `expo-sqlite`).

## How offline-first works

1. Every screen renders from SQLite/cache first, then refreshes in the background if online.
2. Network failures never block playback or library browsing.
3. Downloads and metadata refreshes go through a persistent queue that resumes after restart or reconnection.

## Data & privacy

No accounts, no analytics. The only outbound traffic is MusicBrainz, Cover Art Archive, and the enabled download sources. Per-track licenses (CC / public domain) are stored in the DB and displayed before download, on finished downloads, and in Now Playing.

## Tests

`jest-expo` suites cover the tag reader, queue logic, scan-filter rules, MusicBrainz client/cache/mappers/matching, download scheduling, download sources (incl. live-API verification), and search SQL against real SQLite + FTS5 (requires Node 22.5+ for `node:sqlite`).

```bash
npm test
```

## License

MIT — see [LICENSE](./LICENSE).
