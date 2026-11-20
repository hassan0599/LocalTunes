/** App-side shapes for MusicBrainz data (mapped from the raw JSON in mappers.ts). */

export interface MbArtistRef {
  id: string;
  name: string;
}

export interface MbArtist {
  id: string;
  name: string;
  disambiguation?: string;
  type?: string;
  country?: string;
  /** Tag names, most-voted first. */
  tags: string[];
}

export interface MbLink {
  type: string;
  url: string;
}

export interface MbArtistDetail extends MbArtist {
  lifeSpan?: { begin?: string; end?: string; ended?: boolean };
  related: (MbArtistRef & { relation: string })[];
  links: MbLink[];
}

export interface MbReleaseGroup {
  id: string;
  title: string;
  primaryType?: string;
  secondaryTypes: string[];
  firstReleaseDate?: string;
  artistCredit: string;
  artists: MbArtistRef[];
}

export interface MbRecording {
  id: string;
  title: string;
  lengthMs?: number;
  artistCredit: string;
  artists: MbArtistRef[];
  releaseGroup?: { id: string; title: string };
}

export interface MbTrack {
  position: string;
  title: string;
  lengthMs?: number;
  recordingId: string;
  artistCredit: string;
}

export interface MbReleaseDetail {
  releaseGroup: MbReleaseGroup;
  releaseId?: string;
  tracks: MbTrack[];
}

export interface MbPage<T> {
  count: number;
  items: T[];
}
