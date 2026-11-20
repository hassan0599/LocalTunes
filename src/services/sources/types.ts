/** Provider interface from spec section 6.4. Only legal sources implement this. */
export type SourceId = 'jamendo' | 'internet_archive';

export interface SourceTrack {
  source: SourceId;
  sourceId: string;
  title: string;
  artist?: string;
  album?: string;
  durationMs?: number;
}

export interface ResolvedTrack {
  url: string;
  license: string;
  ext: string;
}

export interface MusicSource {
  id: SourceId;
  search(query: string): Promise<SourceTrack[]>;
  resolve(track: SourceTrack): Promise<ResolvedTrack>;
}
