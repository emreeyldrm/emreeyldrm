import { useEffect, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import type { SearchResult } from '../lib/api';
import { categoryInfo } from '../lib/categories';
import { useMapTap } from '../lib/useMapTap';
import { C } from '../theme';
import { CatGlyph } from './Icon';
import { PlaceCard } from './PlaceCard';
import { PlacePreviewCard, TapPreview } from './PlacePreviewCard';
import { PlaceSearchBar } from './PlaceSearch';
import { Btn, Empty, Field, Txt, webData } from './ui';
import { fmtCoord, type PlacesMapProps } from './mapTypes';

/**
 * Web fallback: react-native-maps has no web support, so the "map" is an accessible list of
 * pins (name, category, coordinates) with the same testIDs as the native markers. The search bar
 * (AC-MOB-15) is the same as on native; a picked result is shown as a temporary "search-pin" row
 * at the top of the pin list plus the bottom card. Map taps (AC-MOB-28) are simulated with "Bu noktada ara"
 * (coordinates), which runs the same nearby lookup and shows the same card as on native.
 */
export function PlacesMap({ places, unlocated, onOpenPlace, center, searchPick, onSearchPick, onAddPick, isSaved, city }: PlacesMapProps) {
  const [selected, setSelected] = useState<string | null>(null);
  const sel = places.find((p) => p.id === selected) ?? null;
  const { tap, current: tapped, tapAt, choose, clear: clearTap, retry, addRequested } = useMapTap(isSaved);
  const [tapOpen, setTapOpen] = useState(false);
  const [tapLat, setTapLat] = useState('');
  const [tapLon, setTapLon] = useState('');
  const tapPoint = parsePoint(tapLat, tapLon);

  useEffect(() => { if (searchPick) { setSelected(null); clearTap(); } }, [searchPick, clearTap]);

  function searchHere() {
    if (!tapPoint) return;
    setSelected(null);
    onSearchPick(null);
    setTapOpen(false); // kart için yer aç; "Bu noktada ara" ile yeniden açılır
    tapAt(tapPoint);
  }
  const addFromCard = onAddPick ? (r: SearchResult) => { addRequested(r); onAddPick(r); } : undefined;
  const tapPinAt = tapped ?? tap?.point ?? null;

  const pickCat = searchPick ? categoryInfo(searchPick.category) : null;
  return (
    <View style={{ flex: 1, backgroundColor: C.mapBg }} testID="places-map">
      <View style={{ paddingHorizontal: 12, paddingTop: 12, zIndex: 10 }}>
        <PlaceSearchBar near={center} onSelect={onSearchPick} onClear={() => onSearchPick(null)} />
        <Pressable
          testID="tap-open"
          accessibilityRole="button"
          aria-expanded={tapOpen}
          accessibilityLabel="Haritada bir noktaya dokun (web: koordinat gir)"
          onPress={() => setTapOpen(!tapOpen)}
          style={{ alignSelf: 'flex-start', minHeight: 40, justifyContent: 'center', marginTop: 4 }}
        >
          <Txt weight="bold" size={13} color={C.greenDark}>Bu noktada ara {tapOpen ? '▴' : '▾'}</Txt>
        </Pressable>
        {tapOpen ? (
          <View testID="tap-panel" style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8, backgroundColor: C.white, borderRadius: 16, padding: 10 }}>
            <Field containerStyle={{ flex: 1 }} label="Enlem" value={tapLat} onChangeText={setTapLat} inputMode="decimal" testID="tap-lat" placeholder="41.8902" />
            <Field containerStyle={{ flex: 1 }} label="Boylam" value={tapLon} onChangeText={setTapLon} inputMode="decimal" testID="tap-lon" placeholder="12.4922" />
            <Btn title="Ara" icon="search" small height={48} disabled={!tapPoint} onPress={searchHere} testID="tap-search" />
          </View>
        ) : null}
      </View>
      <ScrollView style={{ flex: 1, minHeight: 120 }} contentContainerStyle={{ padding: 16, gap: 10 }}>
        <Txt weight="bold" size={14} color={C.greenDark} accessibilityRole="header">
          Harita (web): {places.length} konumlu yer
        </Txt>
        {searchPick && pickCat ? (
          <View
            testID="search-pin"
            accessibilityLabel={`Arama sonucu: ${searchPick.name}, ${fmtCoord(searchPick)}`}
            {...webData({ category: pickCat.key })}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.orangeTint, borderRadius: 16, padding: 10, borderWidth: 2, borderColor: C.orange, borderStyle: 'dashed', minHeight: 44 }}
          >
            <View style={{ width: 36, height: 36, borderRadius: 18, borderBottomRightRadius: 4, transform: [{ rotate: '45deg' }], backgroundColor: C.orange, borderWidth: 3, borderColor: C.white, alignItems: 'center', justifyContent: 'center' }}>
              <View style={{ transform: [{ rotate: '-45deg' }] }}>
                <CatGlyph category={searchPick.category} size={16} color={C.orangeOn} />
              </View>
            </View>
            <View style={{ flex: 1 }}>
              <Txt weight="bold" size={15} testID="search-pin-name">{searchPick.name}</Txt>
              <Txt size={12} color={C.orangeText} weight="semibold">
                Arama sonucu · <Txt size={12} color={C.secondary} testID="search-pin-coords">{fmtCoord(searchPick)}</Txt>
              </Txt>
            </View>
          </View>
        ) : null}
        {tapPinAt ? (
          <View
            testID="tap-pin"
            accessibilityLabel={tapped ? `Seçilen yer: ${tapped.name}, ${fmtCoord(tapped)}` : `Dokunulan nokta: ${fmtCoord(tapPinAt)}`}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.orangeTint, borderRadius: 16, padding: 10, borderWidth: 2, borderColor: C.orange, borderStyle: 'dashed', minHeight: 44 }}
          >
            <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: C.orange, borderWidth: 4, borderColor: C.white }} />
            <View style={{ flex: 1 }}>
              <Txt weight="bold" size={15} testID="tap-pin-name">{tapped ? tapped.name : 'Dokunulan nokta'}</Txt>
              <Txt size={12} color={C.secondary} testID="tap-pin-coords">{fmtCoord(tapPinAt)}</Txt>
            </View>
          </View>
        ) : null}
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
                onPress={() => { onSearchPick(null); clearTap(); setSelected(on ? null : p.id); }}
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
      {tap ? (
        <View style={{ padding: 12, flexShrink: 1 }}>
          <TapPreview
            tap={tap}
            near={null}
            city={city}
            onChoose={choose}
            onClose={clearTap}
            onRetry={retry}
            onAdd={addFromCard}
            isSaved={isSaved}
            onOpenPlace={onOpenPlace}
          />
        </View>
      ) : searchPick ? (
        <View style={{ padding: 12, flexShrink: 1 }}>
          <PlacePreviewCard
            result={searchPick}
            near={center}
            city={city}
            saved={isSaved?.(searchPick)}
            onAdd={onAddPick ? () => onAddPick(searchPick) : undefined}
            onClose={() => onSearchPick(null)}
            onOpenPlace={onOpenPlace}
            closeLabel="Arama sonucunu kapat"
          />
        </View>
      ) : sel ? (
        <View style={{ padding: 12 }}>
          <PlaceCard place={sel} onOpen={() => onOpenPlace(sel.id)} onClose={() => setSelected(null)} />
        </View>
      ) : null}
    </View>
  );
}

function parsePoint(lat: string, lon: string): { lat: number; lon: number } | null {
  const a = Number(lat.trim().replace(',', '.'));
  const b = Number(lon.trim().replace(',', '.'));
  if (!lat.trim() || !lon.trim() || !Number.isFinite(a) || !Number.isFinite(b) || Math.abs(a) > 90 || Math.abs(b) > 180) return null;
  return { lat: a, lon: b };
}
