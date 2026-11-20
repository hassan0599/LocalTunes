/// <reference types="jest" />

import { artistKeys, LibraryMatcher, normalize } from '../match';

const track = (id: number, title: string, artist: string | null, album: string | null = null, mbid: string | null = null) => ({
  id,
  title,
  artist,
  album,
  album_artist: null,
  mbid,
});

describe('normalize', () => {
  it.each([
    ['Blue in Green (Remastered 2009)', 'blue in green'],
    ['Take My Breath (Official Music Video)', 'take my breath'],
    // Version qualifiers are a different recording: keep them.
    ['So What [Live]', 'so what live'],
    ['Regain Control (Mitch Murder remix)', 'regain control mitch murder remix'],
    ['Hurt (Acoustic Version)', 'hurt acoustic version'],
    ['Stay feat. Justin Bieber', 'stay'],
    ['Beyoncé', 'beyonce'],
    ['The Beatles', 'beatles'],
    ['Simon & Garfunkel', 'simon and garfunkel'],
    ['Don’t Stop Me Now', 'don t stop me now'],
    ['Майлз Дейвис', 'маилз деивис'],
  ])('%s → %s', (input, out) => expect(normalize(input)).toBe(out));
});

describe('artistKeys', () => {
  it('splits collaborations', () => {
    expect(artistKeys('The Kid LAROI, Justin Bieber')).toEqual(['kid laroi justin bieber', 'kid laroi', 'justin bieber']);
  });
});

describe('LibraryMatcher', () => {
  const m = new LibraryMatcher([
    track(1, 'So What', 'Miles Davis', 'Kind of Blue'),
    track(2, 'STAY (Official Video)', 'The Kid LAROI, Justin Bieber'),
    track(3, 'Untitled', 'Someone', null, 'rec-mbid-3'),
  ]);

  it('matches by MBID first', () => {
    expect(m.matchRecording({ id: 'rec-mbid-3', title: 'Different', artistCredit: 'Other', artists: [] })?.id).toBe(3);
  });

  it('matches by normalized artist and title', () => {
    expect(m.matchRecording({ id: 'x', title: 'So What', artistCredit: 'Miles Davis', artists: [] })?.id).toBe(1);
    expect(
      m.matchRecording({
        id: 'y',
        title: 'Stay',
        artistCredit: 'The Kid LAROI & Justin Bieber',
        artists: [{ id: 'a', name: 'The Kid LAROI' }],
      })?.id,
    ).toBe(2);
  });

  it('does not match remixes or live versions of an owned song', () => {
    expect(m.matchRecording({ id: 'r', title: 'So What (Live)', artistCredit: 'Miles Davis', artists: [] })).toBeUndefined();
    expect(m.matchRecording({ id: 'r2', title: 'So What (DJ Remix)', artistCredit: 'Miles Davis', artists: [] })).toBeUndefined();
    expect(m.matchRecording({ id: 'r3', title: 'So What (2009 Remaster)', artistCredit: 'Miles Davis', artists: [] })?.id).toBe(1);
  });

  it('does not match the same title by another artist', () => {
    expect(m.matchRecording({ id: 'z', title: 'So What', artistCredit: 'Pink', artists: [] })).toBeUndefined();
  });

  it('knows albums and artists in the library', () => {
    expect(m.hasReleaseGroup({ title: 'Kind of Blue', artistCredit: 'Miles Davis', artists: [] })).toBe(true);
    expect(m.hasReleaseGroup({ title: 'Bitches Brew', artistCredit: 'Miles Davis', artists: [] })).toBe(false);
    expect(m.hasArtist('Justin Bieber')).toBe(true);
    expect(m.hasArtist('Miles Davis')).toBe(true);
    expect(m.hasArtist('John Coltrane')).toBe(false);
  });
});
