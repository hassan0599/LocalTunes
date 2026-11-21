/// <reference types="jest" />

import { buildIaQuery, parseLength, tracksFromMetadata, type IaMetadata } from '../internetArchive';
import { mapJamendoTrack } from '../jamendo';
import { isOpenLicense, licenseLabel, licenseSummary } from '../license';
import iaMetadata from './fixtures/ia-metadata.json';

describe('license', () => {
  it.each([
    ['http://creativecommons.org/licenses/by-nc-sa/3.0/us/', 'CC BY-NC-SA 3.0'],
    ['https://creativecommons.org/licenses/by/4.0/', 'CC BY 4.0'],
    ['https://creativecommons.org/publicdomain/zero/1.0/', 'CC0 1.0'],
    ['http://creativecommons.org/publicdomain/mark/1.0/', 'Public domain'],
    [null, 'Unknown license'],
  ])('%s → %s', (url, label) => expect(licenseLabel(url)).toBe(label));

  it('only accepts Creative Commons and public-domain URLs', () => {
    expect(isOpenLicense('https://creativecommons.org/licenses/by-nd/4.0/')).toBe(true);
    expect(isOpenLicense('https://example.com/all-rights-reserved')).toBe(false);
    expect(isOpenLicense(undefined)).toBe(false);
  });

  it('summarises terms in plain language', () => {
    expect(licenseSummary('https://creativecommons.org/licenses/by-nc-sa/4.0/')).toBe(
      'Free to listen and share: credit the artist, no commercial use, share alike.',
    );
    expect(licenseSummary('https://creativecommons.org/publicdomain/zero/1.0/')).toBe('Free to use for any purpose.');
  });
});

describe('Internet Archive (real metadata: NIN "Ghosts I-IV", CC BY-NC-SA)', () => {
  const tracks = tracksFromMetadata(iaMetadata as IaMetadata);

  it('produces one track per song despite FLAC/OGG/several MP3 copies', () => {
    expect(tracks.map((t) => t.trackNo)).toEqual([1, 2]);
  });

  it('prefers the VBR MP3 and keeps metadata, license and MusicBrainz id', () => {
    const [first] = tracks;
    expect(first.sourceId).toMatch(/^nineinchnails_ghosts_I_IV\/01_Ghosts_I(_vbr)?\.mp3$/);
    expect(first.title).toBe('Ghosts I');
    expect(first.artist).toBe('Nine Inch Nails');
    expect(first.license).toBe('http://creativecommons.org/licenses/by-nc-sa/3.0/us/');
    // Files of one song report "02:48" or "168.83": either is fine.
    expect(first.durationMs).toBeGreaterThanOrEqual(168_000);
    expect(first.durationMs).toBeLessThan(169_000);
    expect(first.mbid).toBe('b2fdf3ce-78a6-4e01-9a7b-441700e8ea66');
    expect(first.artworkUrl).toContain('cover.jpg');
  });

  it('groups untitled derivatives (e.g. OGG) with the song they were made from', () => {
    const meta: IaMetadata = {
      metadata: { identifier: 'x', licenseurl: 'https://creativecommons.org/licenses/by/4.0/' },
      files: [
        { name: '01.flac', format: 'Flac', title: '1 Song', track: '01' },
        { name: '01.mp3', format: 'VBR MP3', title: '1 Song', track: '01', original: '01.flac' },
        { name: '01.ogg', format: 'Ogg Vorbis', original: '01.flac' },
        { name: '02.ogg', format: 'Ogg Vorbis' },
      ],
    };
    const out = tracksFromMetadata(meta);
    expect(out.map((t) => t.sourceId)).toEqual(['x/01.mp3', 'x/02.ogg']);
    expect(out[0].title).toBe('Song');
  });

  it('offers nothing from items without an open license', () => {
    const closed = { ...iaMetadata, metadata: { ...iaMetadata.metadata, licenseurl: undefined } } as IaMetadata;
    expect(tracksFromMetadata(closed)).toEqual([]);
  });

  it('builds a search restricted to openly licensed music', () => {
    const q = buildIaQuery({ artist: 'Nine Inch Nails', title: 'Ghosts' });
    expect(q).toContain('mediatype:audio');
    expect(q).toContain('licenseurl:(*creativecommons.org*)');
    expect(q).toContain('creator:(Nine Inch Nails)');
    expect(buildIaQuery({ text: 'AC/DC: live' })).toContain('(AC\\/DC\\: live)');
  });

  it('parses both length formats', () => {
    expect(parseLength('02:48')).toBe(168_000);
    expect(parseLength('1:02:03')).toBe(3_723_000);
    expect(parseLength('168.78')).toBe(168_780);
    expect(parseLength(undefined)).toBeUndefined();
  });
});

describe('Jamendo mapping (live response shape, 2026-11-20)', () => {
  it('maps a real search result', () => {
    const live = {
      id: '889602',
      name: 'Song for me by Marco Preti',
      duration: 242,
      artist_name: 'Jazz Friends',
      album_name: 'Jazz Friends 2012',
      album_id: '104645',
      position: 2,
      license_ccurl: 'http://creativecommons.org/licenses/by-nc-sa/3.0/',
      audiodownload: 'https://prod-1.storage.jamendo.com/download/track/889602/mp32/',
      audiodownload_allowed: true,
    };
    expect(mapJamendoTrack(live)).toMatchObject({
      sourceId: '889602',
      title: 'Song for me by Marco Preti',
      artist: 'Jazz Friends',
      trackNo: 2,
      durationMs: 242_000,
      license: 'http://creativecommons.org/licenses/by-nc-sa/3.0/',
    });
  });
});

describe('Jamendo mapping', () => {
  const base = {
    id: '123',
    name: 'Song',
    duration: 200,
    artist_name: 'Artist',
    album_name: 'Album',
    album_id: '9',
    license_ccurl: 'http://creativecommons.org/licenses/by-sa/3.0/',
    audiodownload: 'https://example.com/dl.mp3',
    audiodownload_allowed: true,
  };
  it('maps downloadable CC tracks', () => {
    expect(mapJamendoTrack(base)).toMatchObject({ source: 'jamendo', sourceId: '123', durationMs: 200_000, groupId: 'jamendo-album-9' });
  });
  it('skips tracks the artist does not allow downloading, or without a CC license', () => {
    expect(mapJamendoTrack({ ...base, audiodownload_allowed: false })).toBeNull();
    expect(mapJamendoTrack({ ...base, license_ccurl: undefined })).toBeNull();
  });
});
