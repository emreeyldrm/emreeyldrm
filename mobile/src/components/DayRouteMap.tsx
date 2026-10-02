import { useMemo } from 'react';
import { View } from 'react-native';
import MapView, { Marker, Polyline } from 'react-native-maps';
import { categoryInfo } from '../lib/categories';
import { C } from '../theme';
import { Txt } from './ui';
import { regionFor, type RouteStop } from './mapTypes';

/** Native day map: numbered stops in category colours joined by an orange route line (DayMap.dc.html). */
export function DayRouteMap({ stops }: { stops: RouteStop[] }) {
  const region = useMemo(() => regionFor(stops), [stops]);
  return (
    <MapView style={{ flex: 1 }} initialRegion={region} testID="day-map">
      {stops.length > 1 ? (
        <Polyline coordinates={stops.map((s) => ({ latitude: s.lat, longitude: s.lon }))} strokeColor={C.orange} strokeWidth={4} />
      ) : null}
      {stops.map((s) => (
        <Marker key={s.id} testID="route-stop" coordinate={{ latitude: s.lat, longitude: s.lon }} title={`${s.n}. ${s.name}`} accessibilityLabel={`${s.n}. durak: ${s.name}`}>
          <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: categoryInfo(s.category).color, borderWidth: 3, borderColor: C.white, alignItems: 'center', justifyContent: 'center' }}>
            <Txt weight="extrabold" size={15} color={C.white}>{s.n}</Txt>
          </View>
        </Marker>
      ))}
    </MapView>
  );
}
