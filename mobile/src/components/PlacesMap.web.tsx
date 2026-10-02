import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { categoryInfo } from '../lib/categories';
import { C } from '../theme';
import { CatGlyph } from './Icon';
import { PlaceCard } from './PlaceCard';
import { Empty, Txt, webData } from './ui';
import { fmtCoord, type MapPlace } from './mapTypes';

/**
 * Web fallback: react-native-maps has no web support, so the "map" is an accessible list of
 * pins (name, category, coordinates) with the same testIDs as the native markers.
 */
export function PlacesMap({ places, unlocated, onOpenPlace }: { places: MapPlace[]; unlocated: number; onOpenPlace: (id: string) => void }) {
  const [selected, setSelected] = useState<string | null>(null);
  const sel = places.find((p) => p.id === selected) ?? null;
  return (
    <View style={{ flex: 1, backgroundColor: C.mapBg }} testID="places-map">
      <ScrollView contentContainerStyle={{ padding: 16, gap: 10 }}>
        <Txt weight="bold" size={14} color={C.greenDark} accessibilityRole="header">
          Harita (web): {places.length} konumlu yer
        </Txt>
        {places.length === 0 ? <Empty text="Haritada gösterilecek konumlu yer yok." testID="map-empty" /> : null}
        <View accessibilityRole="list" style={{ gap: 8 }}>
          {places.map((p) => {
            const cat = categoryInfo(p.category);
            const on = p.id === selected;
            return (
              <Pressable
                key={p.id}
                testID="map-pin"
                accessibilityRole="button"
                accessibilityLabel={`${p.name}, ${cat.title}, ${fmtCoord(p)}`}
                aria-selected={on}
                {...webData({ category: cat.key })}
                onPress={() => setSelected(on ? null : p.id)}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.white, borderRadius: 16, padding: 10, borderWidth: on ? 2 : 0, borderColor: C.orange, minHeight: 44 }}
              >
                <View
                  testID="map-pin-marker"
                  {...webData({ category: cat.key })}
                  style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: cat.color, borderWidth: 3, borderColor: C.white, alignItems: 'center', justifyContent: 'center' }}
                >
                  <CatGlyph category={p.category} size={18} color={C.white} />
                </View>
                <View style={{ flex: 1 }}>
                  <Txt weight="bold" size={15} testID="map-pin-name">{p.name}</Txt>
                  <Txt size={12} color={C.secondary}>
                    <Txt size={12} color={cat.color} weight="semibold" testID="map-pin-category">{cat.title}</Txt>
                    {' · '}
                    <Txt size={12} color={C.secondary} testID="map-pin-coords">{fmtCoord(p)}</Txt>
                  </Txt>
                </View>
              </Pressable>
            );
          })}
        </View>
        {unlocated > 0 ? <Txt size={13} color={C.secondary} testID="map-unlocated">{unlocated} yerin konumu yok; haritada gösterilmiyor.</Txt> : null}
      </ScrollView>
      {sel ? (
        <View style={{ padding: 12 }}>
          <PlaceCard place={sel} onOpen={() => onOpenPlace(sel.id)} onClose={() => setSelected(null)} />
        </View>
      ) : null}
    </View>
  );
}
