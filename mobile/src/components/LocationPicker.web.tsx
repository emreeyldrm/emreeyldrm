import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { C } from '../theme';
import { Field, Txt } from './ui';
import type { LatLon } from './mapTypes';

const parse = (s: string): number | null => {
  const n = Number(s.trim().replace(',', '.'));
  return s.trim() !== '' && Number.isFinite(n) ? n : null;
};

/**
 * Web fallback for the tap-to-pick map (react-native-maps has no web support):
 * the pin is set by entering its coordinates.
 */
export function LocationPicker({ value, onChange }: { value: LatLon | null; onChange: (v: LatLon | null) => void; center: LatLon | null }) {
  const [lat, setLat] = useState(value ? String(value.lat) : '');
  const [lon, setLon] = useState(value ? String(value.lon) : '');

  useEffect(() => {
    if (value) {
      setLat(String(value.lat));
      setLon(String(value.lon));
    }
  }, [value]);

  function update(nextLat: string, nextLon: string) {
    setLat(nextLat);
    setLon(nextLon);
    const a = parse(nextLat);
    const b = parse(nextLon);
    if (a !== null && b !== null && Math.abs(a) <= 90 && Math.abs(b) <= 180) onChange({ lat: a, lon: b });
    else onChange(null);
  }

  return (
    <View style={{ gap: 6 }} testID="location-map">
      <Txt size={12} color={C.secondary}>Web'de harita yok: pinin koordinatlarını gir.</Txt>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Field containerStyle={{ flex: 1 }} label="Enlem" value={lat} onChangeText={(t) => update(t, lon)} inputMode="decimal" testID="pick-lat" placeholder="41.0082" />
        <Field containerStyle={{ flex: 1 }} label="Boylam" value={lon} onChangeText={(t) => update(lat, t)} inputMode="decimal" testID="pick-lon" placeholder="28.9784" />
      </View>
    </View>
  );
}
