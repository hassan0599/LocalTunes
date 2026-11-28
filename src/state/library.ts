import { create } from 'zustand';

/** Bumped whenever tracks are added or removed, so screens re-query SQLite. */
export const useLibraryVersion = create<{ version: number; bump: () => void }>((set) => ({
  version: 0,
  bump: () => set((s) => ({ version: s.version + 1 })),
}));

/**
 * Bumped after a play is recorded. Only views built from play counts (smart playlists)
 * listen to it, so starting a song doesn't make every library list re-query.
 */
export const usePlaysVersion = create<{ version: number; bump: () => void }>((set) => ({
  version: 0,
  bump: () => set((s) => ({ version: s.version + 1 })),
}));
