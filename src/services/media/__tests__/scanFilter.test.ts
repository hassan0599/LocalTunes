/// <reference types="jest" />

import { isMusic, isNonMusicPath, librarySignature } from '../scanFilter';

describe('isMusic', () => {
  const dl = 'file:///storage/emulated/0/Download/';
  it('keeps normal songs', () => {
    expect(isMusic(`${dl}Shirobon%20-%20Regain%20Control.mp3`, 195_280)).toBe(true);
  });
  it.each([
    ['no duration (not playable audio)', `${dl}song.mp3`, null],
    ['too short', `${dl}ding.mp3`, 12_000],
    ['app backups', 'file:///storage/emulated/0/Documents/XMusic/Backups/All%20data%20backup/AutoBackup_1.wav', 200_000],
    ['shared voice recordings', `${dl}Quick%20Share/Voice%20012.m4a`, 55_078],
    ['WhatsApp audio', `${dl}Quick%20Share/AUD-20230813-WA0002.m4a`, 48_948],
  ])('drops %s', (_, uri, ms) => expect(isMusic(uri, ms)).toBe(false));
});

describe('isNonMusicPath', () => {
  it.each([
    'file:///storage/emulated/0/Notifications/ding.ogg',
    'file:///storage/emulated/0/Ringtones/ring.mp3',
    'file:///storage/emulated/0/Recordings/Voice%20Recorder/rec1.m4a',
    'file:///storage/emulated/0/Android/media/com.whatsapp/WhatsApp/Media/WhatsApp%20Voice%20Notes/a.opus',
  ])('filters %s', (uri) => expect(isNonMusicPath(uri)).toBe(true));

  it.each([
    'file:///storage/emulated/0/Music/Miles%20Davis%20-%20So%20What.mp3',
    'file:///storage/emulated/0/Download/Shirobon%20-%20Regain%20Control.mp3',
    'file:///storage/emulated/0/Samsung/Music/Over_the_Horizon.mp3',
  ])('keeps %s', (uri) => expect(isNonMusicPath(uri)).toBe(false));
});

describe('librarySignature', () => {
  const a = { id: 'content://media/external/audio/media/17', modificationTime: 100 };
  const b = { id: 'content://media/external/audio/media/256', modificationTime: 200 };

  it('ignores order', () => {
    expect(librarySignature([a, b])).toBe(librarySignature([b, a]));
  });
  it('changes when files are added, removed or modified', () => {
    const base = librarySignature([a, b]);
    expect(librarySignature([a])).not.toBe(base);
    expect(librarySignature([a, { ...b, modificationTime: 300 }])).not.toBe(base);
    expect(librarySignature([a, { ...b, id: 'content://media/external/audio/media/257' }])).not.toBe(base);
  });
});
