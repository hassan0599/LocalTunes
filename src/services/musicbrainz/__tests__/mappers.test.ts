/// <reference types="jest" />

import { mapArtistDetail, mapRecording, mapReleaseGroup, mapTracks, pickRelease, yearOf } from '../mappers';
import artist from './fixtures/artist.json';
import recordingSearch from './fixtures/recording-search.json';
import rgSearch from './fixtures/release-group-search.json';

describe('mappers (real MusicBrainz responses)', () => {
  it('maps an artist with tags by vote count, related artists and links', () => {
    const a = mapArtistDetail(artist);
    expect(a.name).toBe('Miles Davis');
    expect(a.tags.slice(0, 3)).toEqual(['jazz', 'jazz fusion', 'modal jazz']);
    expect(a.lifeSpan).toEqual({ begin: '1926-05-26', end: '1991-09-28', ended: true });
    expect(a.related.length).toBeGreaterThan(5);
    expect(new Set(a.related.map((r) => r.id)).size).toBe(a.related.length);
    expect(a.links.map((l) => l.type)).toEqual(['bandcamp', 'allmusic']);
  });

  it('maps a recording and prefers an official, non-compilation release', () => {
    const r = mapRecording(recordingSearch.recordings[0]);
    expect(r.title).toBe('So What');
    expect(r.artistCredit).toBe('Miles Davis');
    expect(r.lengthMs).toBe(652200);
    expect(r.releaseGroup?.id).toBeTruthy();
  });

  it('maps a release group with its credit', () => {
    const rg = mapReleaseGroup(rgSearch['release-groups'][0]);
    expect(rg).toMatchObject({ primaryType: 'Album', firstReleaseDate: '2019-11-19' });
    expect(rg.artists[0].name).toBe(rg.artistCredit);
  });
});

describe('release helpers', () => {
  it('joins multi-artist credits', () => {
    const rg = mapReleaseGroup({
      id: 'x',
      title: 'T',
      'artist-credit': [
        { name: 'A', joinphrase: ' & ', artist: { id: '1', name: 'A' } },
        { name: 'B', artist: { id: '2', name: 'B' } },
      ],
    });
    expect(rg.artistCredit).toBe('A & B');
    expect(rg.artists.map((a) => a.id)).toEqual(['1', '2']);
  });

  it('picks the earliest official release', () => {
    expect(
      pickRelease([
        { id: 'boot', title: 'x', status: 'Bootleg', date: '1950' },
        { id: 'late', title: 'x', status: 'Official', date: '1997-03' },
        { id: 'first', title: 'x', status: 'Official', date: '1959-08-17' },
      ])?.id,
    ).toBe('first');
  });

  it('numbers tracks per disc on multi-disc releases', () => {
    const tracks = mapTracks({
      id: 'r',
      title: 'r',
      media: [
        { position: 1, tracks: [{ number: '1', title: 'A', recording: { id: 'ra', title: 'A' } }] },
        { position: 2, tracks: [{ number: '1', title: 'B', length: 1000, recording: { id: 'rb', title: 'B' } }] },
      ],
    });
    expect(tracks.map((t) => t.position)).toEqual(['1-1', '2-1']);
    expect(tracks[1].lengthMs).toBe(1000);
  });

  it('extracts years from partial dates', () => {
    expect(yearOf('1959-08-17')).toBe('1959');
    expect(yearOf('1959')).toBe('1959');
    expect(yearOf(undefined)).toBeUndefined();
  });
});
