import { useMemo, useState } from 'react';
import { View } from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import { categoryInfo } from '../lib/categories';
import { C } from '../theme';
import { CatGlyph } from './Icon';
import { PlaceCard } from './PlaceCard';
import { Txt } from './ui';
import { regionFor, type MapPlace } from './mapTypes';

/** Native map (react-native-maps): category-coloured pins, selected pin gets the orange ring (CityMap.dc.html). */
export function PlacesMap({ places, unlocated, onOpenPlace }: { places: MapPlace[]; unlocated: number; onOpenPlace: (id: string) => void }) {
  const [selected, setSelected] = useState<string | null>(null);
  const region = useMemo(() => regionFor(places), [places]);
  const sel = places.find((p) => p.id === selected) ?? null;

  return (
    <View style={{ flex: 1, backgroundColor: C.mapBg }} testID="places-map">
      <MapView style={{ flex: 1 }} initialRegion={region} showsUserLocation onPress={() => setSelected(null)}>
        {places.map((p) => {
          const cat = categoryInfo(p.category);
          const on = p.id === selected;
          const size = on ? 48 : 40;
          return (
            <Marker
              key={p.id}
              testID="map-pin"
              coordinate={{ latitude: p.lat, longitude: p.lon }}
              title={p.name}
              description={cat.title}
              accessibilityLabel={`${p.name}, ${cat.title}`}
              onPress={(e) => { e.stopPropagation?.(); setSelected(p.id); }}
            >
              <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: cat.color, borderWidth: on ? 4 : 3, borderColor: on ? C.orange : C.white, alignItems: 'center', justifyContent: 'center' }}>
                <CatGlyph category={p.category} size={on ? 22 : 18} color={C.white} />
              </View>
            </Marker>
          );
        })}
      </MapView>
      {unlocated > 0 && !sel ? (
        <View style={{ position: 'absolute', left: 12, right: 12, bottom: 16, backgroundColor: C.white, borderRadius: 14, padding: 12 }}>
          <Txt size={13} color={C.secondary} testID="map-unlocated">{unlocated} yerin konumu yok; haritada gösterilmiyor.</Txt>
        </View>
      ) : null}
      {sel ? (
        <View style={{ position: 'absolute', left: 12, right: 12, bottom: 20 }}>
          <PlaceCard place={sel} onOpen={() => onOpenPlace(sel.id)} onClose={() => setSelected(null)} />
        </View>
      ) : null}
    </View>
  );
}
