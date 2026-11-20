import { useSQLiteContext, type SQLiteDatabase } from 'expo-sqlite';
import { useEffect, useState } from 'react';

import { useLibraryVersion } from '@/state/library';

/**
 * Runs a SQLite query and re-runs it whenever the library changes or `deps` change.
 * Screens render from SQLite first (spec 2, offline-first rule 1).
 */
export function useLibraryQuery<T>(
  query: (db: SQLiteDatabase) => Promise<T>,
  deps: unknown[],
  initial: T,
): { data: T; loading: boolean } {
  const db = useSQLiteContext();
  const version = useLibraryVersion((s) => s.version);
  const [state, setState] = useState({ data: initial, loading: true });

  useEffect(() => {
    let alive = true;
    query(db).then(
      (data) => alive && setState({ data, loading: false }),
      (e) => {
        console.warn('library query failed', e);
        if (alive) setState((s) => ({ ...s, loading: false }));
      },
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, version, ...deps]);

  return state;
}
