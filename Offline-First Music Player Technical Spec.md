# Offline-First Music Player: Technical Spec

Draft v1 · React Native (Expo) · Android and iOS

## 1. Overview

A music player that works fully without a network. The user's library lives on the device, search is local, and anything fetched from the internet (discovery data, cover art, legal downloads) is cached so it stays usable offline.

**Goals**

- Play local audio files reliably, in the background and from the lock screen.
- Find songs on the phone quickly, including songs already stored in the device's media.
- Browse and discover music through MusicBrainz.
- Acquire new music through legal sources and keep it available offline.

**Non-goals (v1)**

- Streaming from a catalog service.
- Accounts, social features, cloud sync.
- Ripping or converting audio from video platforms (see section 6.4).

## 2. Architecture

Three layers, with the local database as the single source of truth. The UI never reads from the network directly.

| Layer | Responsibility | Key pieces |
| --- | --- | --- |
| UI | Screens, navigation, mini player | Expo Router, React Native |
| Domain | Playback queue, search, download queue, discovery logic | Zustand stores, service modules |
| Data | Persistence, file storage, network clients | SQLite, file system, MusicBrainz and source clients |

**Offline-first rules**

1. Every screen renders from SQLite or the cache first, then refreshes in the background if online.
2. Network failures never block playback or library browsing.
3. Downloads and metadata refreshes go through a persistent queue that resumes after the app restarts or the connection returns.

## 3. Tech stack

| Concern | Choice | Why |
| --- | --- | --- |
| Framework | Expo (development build) | Native modules without ejecting |
| Language | TypeScript | Safer data models |
| Playback | react-native-track-player | Background playback, lock-screen controls, queue management. Replaces the expo-audio prototype |
| Database | expo-sqlite with FTS5 | Local full-text search, relational library data |
| Files | expo-file-system | App-owned storage for downloads and imports |
| Local media | expo-media-library (Android), expo-document-picker (both) | See section 6.1 |
| State | Zustand | Small, simple, easy to persist |
| Networking | fetch with a small retry and cache wrapper | MusicBrainz needs strict rate limiting |
| Connectivity | @react-native-community/netinfo | Drives queue pause and resume |

## 4. Data model (SQLite)

```
tracks(id, title, artist, album, duration_ms, file_uri, source, mbid, added_at, play_count)
tracks_fts(title, artist, album)          -- FTS5 virtual table, content=tracks
playlists(id, name, created_at)
playlist_tracks(playlist_id, track_id, position)
downloads(id, source, source_id, url, status, bytes_done, bytes_total, track_id, error)
mb_cache(key, json, fetched_at, ttl_s)    -- MusicBrainz and Cover Art responses
settings(key, value)
```

`source` is one of `imported`, `device`, `internet_archive`, `jamendo`. `mbid` links a track to a MusicBrainz recording when a match is found.

## 5. Screens

| Tab | Contents |
| --- | --- |
| Library | All songs, albums, artists, playlists. Sort and filter. Long-press for actions |
| Search | One search box across the local library and the device media index. Results grouped by songs, albums, artists |
| Discover | MusicBrainz browsing: genres, artist pages, release lists |
| Downloads | Active and finished downloads, storage used, retry controls |
| Now Playing | Full-screen player, queue, seek, repeat, shuffle. A mini player sits above the tab bar on every screen |

## 6. Feature design

### 6.1 Local library and device media search

**Android.** Use expo-media-library to read audio from MediaStore (needs the `READ_MEDIA_AUDIO` permission on Android 13 and above, `READ_EXTERNAL_STORAGE` on older versions). A scan job reads title, artist, album, duration and URI, then upserts into `tracks` with `source = device`. Run it on first launch, on pull-to-refresh, and when the app returns to the foreground (check the media store's modification time to skip no-op scans).

**iOS.** Apps cannot list arbitrary audio files on the device, and the Apple Music library is not readable through these libraries (and DRM-protected tracks cannot be played). On iOS, users import files through the document picker, and the app copies them into its own storage. This is a platform limit, so the spec treats the Android scan as an enhancement and the picker as the baseline for both platforms.

**Search.** Every insert into `tracks` also updates `tracks_fts`. A query like `jazz mil` runs a prefix match (`jazz* mil*`) and ranks by bm25, with a small boost for recently played tracks. Results should appear within about 50 ms for libraries up to 50,000 tracks. Debounce typing by 150 ms.

**Metadata.** Read ID3 and similar tags for imported files so titles and artists are correct. Fall back to the file name when tags are missing.

### 6.2 Playback

- A `PlaybackService` registered with react-native-track-player handles remote events (play, pause, next, previous, seek) so controls work with the screen off.
- Queue is built from the current list (album, playlist, search result) and persisted, so the app resumes where it stopped.
- Resume position every 5 seconds to `settings`.
- Audio focus handling: pause on interruption (calls, other apps), duck for navigation prompts.
- Cover art: embedded art if present, otherwise cached Cover Art Archive image, otherwise a generated placeholder.

### 6.3 Discover (MusicBrainz)

MusicBrainz is a metadata database, not a streaming service and not a popularity chart. Discover therefore focuses on exploration: genres, artists, and relationships between them.

**API**

- Base URL: `https://musicbrainz.org/ws/2/`, with `fmt=json`. No API key is required.
- A descriptive `User-Agent` header is mandatory, in the form `AppName/1.0 ( contact@example.com )`.
- Rate limit: about one request per second. Use a single serial request queue with a 1.1 s spacing and back off on HTTP 503.
- Cover art: the Cover Art Archive, `https://coverartarchive.org/release/{mbid}/front-250`. Treat a 404 as normal and show the placeholder.

**Discover screen sections**

1. **Browse by genre.** Fixed list of popular tags. Tapping one runs `release-group?query=tag:{genre}` and shows results.
2. **Artist page.** `artist/{mbid}?inc=release-groups+tags+url-rels` gives discography, tags and links.
3. **Similar artists.** Derived from shared tags and artist relationships returned by the API.
4. **Search.** `artist?query=`, `release-group?query=`, `recording?query=` with a type toggle.
5. **Optional trending row.** ListenBrainz (a sibling project from the MetaBrainz Foundation) publishes listening statistics and could power a "popular now" row. Verify the endpoint and its terms before depending on it.

**Caching and offline behavior**

- Every response is stored in `mb_cache` with a TTL (7 days for artists and releases, 24 hours for search).
- Offline, Discover shows cached pages with an "Offline, showing saved results" banner, and disables only the actions that need the network.
- Cache only what the user opened, plus one level of related items, to keep storage small.

**Matching to the library.** When a discovered release or recording matches a track you own (MBID match first, then normalized artist and title), show an "In your library" badge and play it directly.

**The gap to plan for.** MusicBrainz does not provide audio. A discovered song can be played only if it is already in the library or available from one of the acquisition sources in 6.4.

### 6.4 Getting songs onto the device

**Scope decision.** This spec does not include ytmp3 or any other service that extracts audio from YouTube. Those services work by circumventing the platform's terms and by copying copyrighted recordings without a license, and accepting personal responsibility does not change what the integration does. The download feature is designed instead around a provider interface, so legal sources plug in cleanly.

**Provider interface**

```ts
interface MusicSource {
  id: string;
  search(query: string): Promise<SourceTrack[]>;
  resolve(track: SourceTrack): Promise<{ url: string; license: string; ext: string }>;
}
```

**Sources for v1**

| Source | What it offers | Notes |
| --- | --- | --- |
| Local import | Files the user already owns: ripped CDs, purchases from Bandcamp or similar stores, own recordings | Document picker, copy into app storage |
| Jamendo | Independent music under Creative Commons licenses | Free API key required. Check each track's license and keep it in the database |
| Internet Archive | Public domain and openly licensed audio, including live-music collections | Search and metadata APIs, direct file URLs. Store the license text |

For Discover results, the "Get" button searches these sources by artist and title and offers a match if one exists. If none does, show links out to where the user can buy or stream it.

**Download manager**

- Persistent queue stored in `downloads`, processed by a worker with 2 concurrent transfers.
- Resumable transfers (expo-file-system `createDownloadResumable`), with progress written to the database every 500 ms.
- Status flow: `queued → downloading → paused → done | failed`. Failed items retry with exponential backoff, up to 3 times.
- Pause everything on a metered connection if the user sets "Wi-Fi only".
- On completion, read tags, insert the track, fetch cover art if online, and mark `source` and `license`.
- Check free space before starting and show a clear error if there is not enough.

## 7. Project structure

```
src/
  app/            routes (Expo Router): library, search, discover, downloads, player
  components/     TrackRow, MiniPlayer, CoverImage, OfflineBanner
  db/             schema.ts, migrations, queries, fts.ts
  services/
    playback/     PlaybackService.ts, queue.ts
    media/        deviceScan.ts, importer.ts, tags.ts
    musicbrainz/  client.ts (rate-limited), cache.ts, mappers.ts
    sources/      types.ts, jamendo.ts, internetArchive.ts
    downloads/    manager.ts, worker.ts
  state/          player.ts, library.ts, network.ts
```

## 8. Non-functional requirements

| Area | Target |
| --- | --- |
| Cold start to library visible | Under 1.5 s with 10,000 tracks |
| Local search latency | Under 50 ms |
| Playback start | Under 300 ms for local files |
| Works with no network | All of Library, Search, Now Playing, and cached Discover |
| Storage | Show per-source usage and let users delete downloads in bulk |
| Accessibility | Screen reader labels on all controls, 44 pt touch targets, dynamic type |
| Privacy | No analytics or accounts. The only outbound traffic is MusicBrainz, Cover Art Archive and the enabled sources |

## 9. Milestones

1. **Foundation.** TypeScript project, SQLite schema, track-player service, library screen with import. (1 to 2 weeks)
2. **Local search.** Android device scan, FTS5 index, search screen. (1 week)
3. **Discover.** MusicBrainz client with rate limiting and cache, genre browse, artist page, cover art. (1 to 2 weeks)
4. **Acquisition.** Source interface, Jamendo and Internet Archive providers, download manager and Downloads tab. (1 to 2 weeks)
5. **Polish.** Playlists, queue persistence, offline banners, accessibility pass, device testing. (1 week)

## 10. Risks and open questions

- **iOS file access.** Without a device scan, iOS relies on manual import. Is that acceptable, or should the first release be Android-only?
- **Discover without audio.** The catalog is metadata only, so many discovered songs will have no playable source. Consider adding a "save to wishlist" list so interest is not lost.
- **MusicBrainz limits.** Heavy use needs the rate limiter to hold. A self-hosted mirror is possible if the app grows.
- **Licensing.** Jamendo and Internet Archive licenses vary per track (some prohibit commercial use or require attribution). Store and display the license for every download.
- **Tag quality.** Local files often have missing or wrong tags, which weakens MBID matching. A manual "fix match" action is worth including.
