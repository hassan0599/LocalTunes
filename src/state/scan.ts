import { create } from 'zustand';

export type ScanPermission = 'unknown' | 'granted' | 'undetermined' | 'denied';

export interface ScanState {
  permission: ScanPermission;
  scanning: boolean;
  done: number;
  total: number;
}

export const useScan = create<ScanState>(() => ({
  permission: 'unknown',
  scanning: false,
  done: 0,
  total: 0,
}));
