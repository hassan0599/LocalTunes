import { create } from 'zustand';

import type { DownloadRow } from '@/services/downloads/schedule';

export interface DownloadsState {
  rows: DownloadRow[];
  /** Live progress for active downloads (updated more often than the database). */
  progress: Record<number, { done: number; total: number | null }>;
  /** Why queued downloads aren't starting. */
  blocked: 'offline' | 'wifi' | null;
  wifiOnly: boolean;
}

export const useDownloads = create<DownloadsState>(() => ({
  rows: [],
  progress: {},
  blocked: null,
  wifiOnly: false,
}));
