/** Provider interface from spec section 6.4. Only legal sources implement this. */
export type SourceId = 'jamendo' | 'internet_archive';

export interface SourceTrack {
  source: SourceId;
  /** Stable id within the source (used to de-duplicate downloads). */
  sourceId: string;
  title: string;
  artist?: string;
  album?: string;
  trackNo?: number;
  durationMs?: number;
  sizeBytes?: number;
  /** License URL (Creative Commons / public domain). Required: unlicensed audio is never offered. */
  license: string;
  artworkUrl?: string;
  /** MusicBrainz recording id when the source provides one. */
  mbid?: string;
  /** Groups tracks of one album/item in result lists. */
  groupId?: string;
  groupTitle?: string;
}

export interface ResolvedTrack {
  url: string;
  license: string;
  ext: string;
}

export interface SourceQuery {
  /** Free text, or built from artist + title when coming from Discover. */
  text?: string;
  artist?: string;
  title?: string;
  /** Searching for an album rather than a single song. */
  album?: boolean;
}

export interface MusicSource {
  id: SourceId;
  name: string;
  /** False when the source needs configuration (e.g. an API key) that's missing. */
  enabled: boolean;
  search(query: SourceQuery): Promise<SourceTrack[]>;
  resolve(track: SourceTrack): Promise<ResolvedTrack>;
}
