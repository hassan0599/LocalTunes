import NetInfo from '@react-native-community/netinfo';
import { create } from 'zustand';

/** Connectivity (spec 3: drives offline banners and network-only actions). */
export const useNetwork = create<{ online: boolean }>(() => ({ online: true }));

/** Subscribe once at app start; returns the unsubscribe function. */
export function startNetworkMonitoring(): () => void {
  return NetInfo.addEventListener((s) => {
    // isInternetReachable is null while unknown; only treat an explicit false as offline.
    useNetwork.setState({ online: s.isConnected !== false && s.isInternetReachable !== false });
  });
}
