/// <reference types="jest" />

import { buildUrl, escapeLucene, MbError, MbNotFoundError, MusicBrainzClient, type ClientDeps } from '../client';

/** Fake clock + network: sleep advances time instantly, fetch replays scripted statuses. */
function fakeDeps(statuses: number[]) {
  let now = 0;
  const calls: { url: string; at: number; headers: Record<string, string> }[] = [];
  const deps: ClientDeps = {
    now: () => now,
    sleep: async (ms) => {
      now += ms;
    },
    fetch: async (url, init) => {
      calls.push({ url, at: now, headers: init.headers });
      const status = statuses.shift() ?? 200;
      return { ok: status === 200, status, json: async () => ({ url }) };
    },
  };
  return { deps, calls };
}

describe('MusicBrainzClient', () => {
  it('sends the User-Agent and spaces requests at least 1.1 s apart, in order', async () => {
    const { deps, calls } = fakeDeps([]);
    const client = new MusicBrainzClient({ userAgent: 'localtunes/1.0 ( test@example.com )' }, deps);
    await Promise.all([client.get('artist/a'), client.get('artist/b'), client.get('artist/c')]);
    expect(calls.map((c) => c.url.split('?')[0].split('/').pop())).toEqual(['a', 'b', 'c']);
    expect(calls.map((c) => c.at)).toEqual([0, 1100, 2200]);
    expect(calls[0].headers['User-Agent']).toBe('localtunes/1.0 ( test@example.com )');
  });

  it('backs off and retries on 503', async () => {
    const { deps, calls } = fakeDeps([503, 503, 200]);
    const client = new MusicBrainzClient({}, deps);
    await expect(client.get('artist/x')).resolves.toBeTruthy();
    expect(calls).toHaveLength(3);
    // retry 1 after 2.2 s backoff, retry 2 after a further 4.4 s
    expect(calls[1].at - calls[0].at).toBeGreaterThanOrEqual(2200);
    expect(calls[2].at - calls[1].at).toBeGreaterThanOrEqual(4400);
  });

  it('gives up after maxRetries', async () => {
    const { deps, calls } = fakeDeps([503, 503, 503]);
    const client = new MusicBrainzClient({ maxRetries: 2 }, deps);
    await expect(client.get('artist/x')).rejects.toBeInstanceOf(MbError);
    expect(calls).toHaveLength(3);
  });

  it('maps 404 to MbNotFoundError and keeps the queue working', async () => {
    const { deps } = fakeDeps([404, 200]);
    const client = new MusicBrainzClient({}, deps);
    await expect(client.get('artist/missing')).rejects.toBeInstanceOf(MbNotFoundError);
    await expect(client.get('artist/ok')).resolves.toBeTruthy();
  });

  it('reports network failures as MbError', async () => {
    const { deps } = fakeDeps([]);
    deps.fetch = async () => {
      throw new Error('Network request failed');
    };
    await expect(new MusicBrainzClient({}, deps).get('artist/x')).rejects.toThrow('Network error');
  });
});

describe('buildUrl / escapeLucene', () => {
  it('adds fmt=json and encodes params', () => {
    expect(buildUrl('artist', { query: 'AC/DC & co', limit: 25, offset: undefined })).toBe(
      'https://musicbrainz.org/ws/2/artist?query=AC%2FDC%20%26%20co&limit=25&fmt=json',
    );
  });
  it('escapes Lucene syntax', () => {
    expect(escapeLucene('AC/DC: "Back" (in) black!')).toBe('AC\\/DC\\: \\"Back\\" \\(in\\) black\\!');
  });
});
