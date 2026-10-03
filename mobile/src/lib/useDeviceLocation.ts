import { useCallback, useEffect, useState } from 'react';
import * as Location from 'expo-location';

export interface DeviceLocation { lat: number; lon: number }

// Uygulama genelinde tek konum: bir ekran izin alınca diğerleri de güncellenir.
let cached: DeviceLocation | null = null;
let prompted = false;
const listeners = new Set<(l: DeviceLocation | null) => void>();

async function readLocation(prompt: boolean): Promise<DeviceLocation | null> {
  try {
    let perm = await Location.getForegroundPermissionsAsync();
    // iOS izni bir kez sorar; reddedilirse bu oturumda tekrar sormayız.
    if (perm.status !== 'granted' && prompt && perm.canAskAgain && !prompted) {
      prompted = true;
      perm = await Location.requestForegroundPermissionsAsync();
    }
    if (perm.status !== 'granted') return null;
    let pos: Location.LocationObject | null = null;
    try { pos = await Location.getLastKnownPositionAsync({ maxAge: 10 * 60 * 1000 }); } catch { /* web: yok */ }
    pos ??= await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    cached = { lat: pos.coords.latitude, lon: pos.coords.longitude };
    listeners.forEach((f) => f(cached));
    return cached;
  } catch {
    return null;
  }
}

/**
 * İzin zaten verilmişse cihaz konumu, yoksa null. İzin penceresi AÇMAZ (ör. Keşfet'in varsayılan şehri).
 */
export function locationIfGranted(): Promise<DeviceLocation | null> {
  return cached ? Promise.resolve(cached) : readLocation(false);
}

/**
 * Cihaz konumu. Açılışta yalnızca izin zaten verilmişse okunur; `request()` gerekirse izni sorar
 * (ör. kullanıcı arama yapmaya başlayınca). Konum yoksa `location` null kalır.
 */
export function useDeviceLocation() {
  const [location, setLocation] = useState<DeviceLocation | null>(cached);
  useEffect(() => {
    listeners.add(setLocation);
    if (!cached) void readLocation(false);
    return () => { listeners.delete(setLocation); };
  }, []);
  const request = useCallback(() => readLocation(true), []);
  return { location, request };
}
