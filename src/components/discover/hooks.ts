import { useSQLiteContext, type SQLiteDatabase } from 'expo-sqlite';
import { useEffect, useMemo, useState } from 'react';

import type { Track } from '@/db/queries';
import type { Cached } from '@/services/musicbrainz/cache';
import { getCoverArt } from '@/services/musicbrainz/coverArt';
import { LibraryMatcher } from '@/services/musicbrainz/match';
import { useLibraryVersion } from '@/state/library';
import { useNetwork } from '@/state/network';

export interface MbState<T> {
  data?: T;
  /** Served from the cache because we're offline or the refresh failed. */
  stale: boolean;
  loading: boolean;
  error?: Error;
  retry: () => void;
}

/**
 * Runs a cached MusicBrainz query. Re-runs when connectivity changes, so an offline
 * screen refreshes by itself once the network is back.
 */
export function useMb<T>(
  fn: ((ctx: { db: SQLiteDatabase; online: boolean }) => Promise<Cached<T>>) | null,
  deps: unknown[],
): MbState<T> {
  const db = useSQLiteContext();
  const online = useNetwork((s) => s.online);
  const [nonce, setNonce] = useState(0);
  const [state, setState] = useState<Omit<MbState<T>, 'retry'>>({ stale: false, loading: !!fn });
  // When the request changes, show loading straight away (state adjusted during render).
  const signature = JSON.stringify([online, nonce, ...deps]);
  const [shownSignature, setShownSignature] = useState(signature);
  if (signature !== shownSignature) {
    setShownSignature(signature);
    setState((s) => ({ ...s, loading: true, error: undefined }));
  }

  useEffect(() => {
    if (!fn) return;
    let alive = true;
    fn({ db, online }).then(
      (r) => alive && setState({ data: r.data, stale: r.stale, loading: false }),
      (e: Error) => alive && setState((s) => ({ ...s, loading: false, error: e })),
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, online, nonce, ...deps]);

  const shown = fn ? state : { stale: false, loading: false };
  return { ...shown, retry: () => setNonce((n) => n + 1) };
}

let matcherCache: { version: number; matcher: LibraryMatcher } | null = null;

/** Matcher over the whole library, rebuilt when the library changes. */
export function useLibraryMatcher(): LibraryMatcher | null {
  const db = useSQLiteContext();
  const version = useLibraryVersion((s) => s.version);
  const [built, setBuilt] = useState<{ version: number; matcher: LibraryMatcher } | null>(null);
  const cached = matcherCache?.version === version ? matcherCache.matcher : null;
  useEffect(() => {
    if (matcherCache?.version === version) return;
    let alive = true;
    db.getAllAsync<Track>('SELECT * FROM tracks').then((tracks) => {
      const m = new LibraryMatcher(tracks);
      matcherCache = { version, matcher: m };
      if (alive) setBuilt({ version, matcher: m });
    });
    return () => {
      alive = false;
    };
  }, [db, version]);
  return cached ?? (built?.version === version ? built.matcher : null);
}

/** Local URI of a release group's cover (downloaded and cached on first use). */
export function useCoverArt(releaseGroupMbid: string | undefined): string | null {
  const db = useSQLiteContext();
  const online = useNetwork((s) => s.online);
  const [uri, setUri] = useState<string | null>(null);
  useEffect(() => {
    if (!releaseGroupMbid) return;
    let alive = true;
    getCoverArt(db, releaseGroupMbid, online).then((u) => alive && setUri(u));
    return () => {
      alive = false;
    };
  }, [db, releaseGroupMbid, online]);
  return uri;
}

/** Debounced copy of a value. */
export function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return useMemo(() => v, [v]);
}
