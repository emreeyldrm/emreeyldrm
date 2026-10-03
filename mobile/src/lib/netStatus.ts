import NetInfo from '@react-native-community/netinfo';

/**
 * Cihazın ağ durumu (native: @react-native-community/netinfo, Expo Go'da da çalışır). `isInternetReachable`
 * bilinmiyorsa (null) çevrimiçi sayılır; sunucuya gerçekten ulaşılamadığını istek hataları ayrıca bildirir.
 */
export function watchDeviceOnline(cb: (online: boolean) => void): () => void {
  return NetInfo.addEventListener((s) => cb(s.isConnected !== false && s.isInternetReachable !== false));
}

export function initialDeviceOnline(): boolean {
  return true;
}
