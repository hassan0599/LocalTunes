import NetInfo from '@react-native-community/netinfo';
import { create } from 'zustand';

/** Connectivity (drives offline banners, network-only actions and the download queue). */
export const useNetwork = create<{ online: boolean; metered: boolean }>(() => ({ online: true, metered: false }));

/** Subscribe once at app start; returns the unsubscribe function. */
export function startNetworkMonitoring(): () => void {
  return NetInfo.addEventListener((s) => {
    useNetwork.setState({
      // isInternetReachable is null while unknown; only treat an explicit false as offline.
      online: s.isConnected !== false && s.isInternetReachable !== false,
      // Cellular, or a Wi-Fi network the OS marks as metered (e.g. a phone hotspot).
      metered: s.type === 'cellular' || (s.details as { isConnectionExpensive?: boolean } | null)?.isConnectionExpensive === true,
    });
  });
}
