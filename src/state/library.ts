import { create } from 'zustand';

/** Bumped whenever tracks are added or removed, so screens re-query SQLite. */
export const useLibraryVersion = create<{ version: number; bump: () => void }>((set) => ({
  version: 0,
  bump: () => set((s) => ({ version: s.version + 1 })),
}));
