import { useMemo } from 'react';
import { View } from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import { C } from '../theme';
import { Txt } from './ui';
import { regionFor, type LatLon } from './mapTypes';

/** Native: tap the map to drop the pin (AC-MOB-14). */
export function LocationPicker({ value, onChange, center }: { value: LatLon | null; onChange: (v: LatLon | null) => void; center: LatLon | null }) {
  const region = useMemo(() => regionFor(value ? [value] : [], center), [center]);
  return (
    <View style={{ gap: 6 }}>
      <Txt size={12} color={C.secondary}>Haritaya dokunarak konumu seç.</Txt>
      <View style={{ height: 220, borderRadius: 16, overflow: 'hidden', backgroundColor: C.mapBg }}>
        <MapView
          testID="location-map"
          style={{ flex: 1 }}
          initialRegion={region}
          showsUserLocation
          accessibilityLabel="Konum seçme haritası"
          onPress={(e) => onChange({ lat: e.nativeEvent.coordinate.latitude, lon: e.nativeEvent.coordinate.longitude })}
        >
          {value ? <Marker coordinate={{ latitude: value.lat, longitude: value.lon }} pinColor={C.orange} /> : null}
        </MapView>
      </View>
    </View>
  );
}
