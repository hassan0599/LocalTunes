/**
 * Local search over `tracks_fts` (spec 6.1 "Search").
 *
 * `jazz mil` → `"jazz"* AND "mil"*`: every token must prefix-match some column.
 * Songs rank by bm25 (title weighted over artist over album) with a boost for
 * tracks played in the last 30 days. Albums and artists use column filters, so
 * "miles" finds the artist Miles Davis but not a song titled "Miles Away".
 */
import type { AlbumSummary, ArtistSummary, Track } from './queries';

type Param = string | number | null;

/** The subset of expo-sqlite's SQLiteDatabase search needs (also implemented by tests). */
export interface QueryDb {
  getAllAsync<T>(sql: string, ...params: Param[]): Promise<T[]>;
}

const MAX_TOKENS = 8;
// Same separators FTS5's unicode61 tokenizer splits on for typical input (spaces and ASCII punctuation).
const SEPARATORS = /[\s"'`.,;:!?()[\]{}<>/\\|@#$%^&*+=~_\-‘’“”]+/;

/** Turn user input into an FTS5 MATCH expression, or null when there is nothing to search. */
export function buildMatchQuery(input: string): string | null {
  const tokens = input
    .normalize('NFKC')
    .toLowerCase()
    .split(SEPARATORS)
    .filter(Boolean)
    .slice(0, MAX_TOKENS);
  if (!tokens.length) return null;
  return tokens.map((t) => `"${t.replace(/"/g, '""')}"*`).join(' AND ');
}

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
/** Lower is better (bm25 is negative). Multiplying by >1 moves recently played tracks up. */
const SONG_RANK = `f.r * (1.0 + 0.5 * MAX(0.0, 1.0 - (? - COALESCE(t.last_played_at, 0)) / ${THIRTY_DAYS_MS}.0))`;

/** Above this many matches a query is "broad": skip bm25 and take the newest matches. */
const BROAD = 2000;
/** Rows taken from the FTS ranking before joining; the recency boost re-orders within these. */
const CANDIDATES = 500;

export interface SearchResults {
  songs: Track[];
  albums: AlbumSummary[];
  artists: ArtistSummary[];
}

export const EMPTY_RESULTS: SearchResults = { songs: [], albums: [], artists: [] };

/**
 * Candidate rows (id, r) for a MATCH expression, lower r = better.
 *
 * bm25 has to score every match, which costs ~120 ms on desktop when a short prefix
 * matches 50k rows. So a capped COUNT (cheap: stops at BROAD + 1) picks the strategy:
 * - narrow: rank all matches by bm25 (a few ms for <= BROAD rows);
 * - broad: newest matches first, read straight from the index in rowid order (sub-ms).
 *   The next keystroke usually narrows the query again.
 */
async function candidateCte(db: QueryDb, match: string, weights: string, limit: number): Promise<string> {
  const [{ n }] = await db.getAllAsync<{ n: number }>(
    `SELECT count(*) AS n FROM (SELECT rowid FROM tracks_fts WHERE tracks_fts MATCH ? LIMIT ${BROAD + 1})`,
    match,
  );
  return n > BROAD
    ? `SELECT rowid AS id, -rowid AS r FROM tracks_fts WHERE tracks_fts MATCH ? ORDER BY rowid DESC LIMIT ${limit}`
    : `SELECT rowid AS id, bm25(tracks_fts${weights}) AS r FROM tracks_fts WHERE tracks_fts MATCH ? ORDER BY r LIMIT ${limit}`;
}

export async function searchLibrary(
  db: QueryDb,
  input: string,
  opts: { songLimit?: number; groupLimit?: number; now?: number } = {},
): Promise<SearchResults> {
  const match = buildMatchQuery(input);
  if (!match) return EMPTY_RESULTS;
  const { songLimit = 100, groupLimit = 20, now = Date.now() } = opts;

  // expo-sqlite serialises calls on one connection, so these run back to back.
  // Each query picks candidates inside the FTS index and joins only those to `tracks`.
  const songCte = await candidateCte(db, match, ", 10.0, 5.0, 3.0", CANDIDATES);
  const songs = await db.getAllAsync<Track>(
    `WITH f AS MATERIALIZED (${songCte})
     SELECT t.* FROM f JOIN tracks t ON t.id = f.id
     ORDER BY ${SONG_RANK}
     LIMIT ?`,
    match,
    now,
    songLimit,
  );

  // bm25() can't be used inside an aggregate, hence the materialized candidate CTE.
  const albumMatch = `{album artist} : (${match})`;
  const albumCte = await candidateCte(db, albumMatch, "", BROAD);
  const albums = await db.getAllAsync<AlbumSummary>(
    `WITH f AS MATERIALIZED (${albumCte}), m AS (
       SELECT t.album AS album, COALESCE(t.album_artist, t.artist) AS artist, t.artwork_uri AS artwork_uri, f.r AS r
       FROM f JOIN tracks t ON t.id = f.id
       WHERE t.album IS NOT NULL
     )
     SELECT album, artist, COUNT(*) AS track_count, MAX(artwork_uri) AS artwork_uri
     FROM m
     GROUP BY album COLLATE NOCASE, artist COLLATE NOCASE
     ORDER BY MIN(r), album COLLATE NOCASE
     LIMIT ?`,
    albumMatch,
    groupLimit,
  );

  const artistMatch = `artist : (${match})`;
  const artistCte = await candidateCte(db, artistMatch, "", BROAD);
  const artists = await db.getAllAsync<ArtistSummary>(
    `WITH f AS MATERIALIZED (${artistCte}), m AS (
       SELECT t.artist AS artist, t.album AS album, f.r AS r
       FROM f JOIN tracks t ON t.id = f.id
       WHERE t.artist IS NOT NULL
     )
     SELECT artist, COUNT(*) AS track_count, COUNT(DISTINCT album) AS album_count
     FROM m
     GROUP BY artist COLLATE NOCASE
     ORDER BY MIN(r), artist COLLATE NOCASE
     LIMIT ?`,
    artistMatch,
    groupLimit,
  );
  return { songs, albums, artists };
}
