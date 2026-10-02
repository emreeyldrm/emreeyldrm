import { useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import MapView, { Marker, type Region as MapRegion } from 'react-native-maps';
import { useDeviceLocation } from '../lib/useDeviceLocation';
import { categoryInfo } from '../lib/categories';
import { C } from '../theme';
import { CatGlyph } from './Icon';
import { PlaceCard } from './PlaceCard';
import { PlaceSearchBar, SearchResultCard } from './PlaceSearch';
import { Txt } from './ui';
import { regionFor, type LatLon, type PlacesMapProps } from './mapTypes';

/**
 * Native map (react-native-maps): category-coloured pins, selected pin gets the orange ring (CityMap.dc.html).
 * A floating search bar (AC-MOB-15) biases results to the map centre (after the user pans), else the list's
 * centre, else the device's last known location; a picked result gets a temporary orange pin and a bottom card.
 */
export function PlacesMap({ places, unlocated, onOpenPlace, center, searchPick, onSearchPick, onAddPick, pickSaved }: PlacesMapProps) {
  const [selected, setSelected] = useState<string | null>(null);
  const [panned, setPanned] = useState<LatLon | null>(null);
  const { location: device, request: requestLocation } = useDeviceLocation();
  const mapRef = useRef<MapView>(null);
  const region = useMemo(() => regionFor(places, center), [places, center]);
  const sel = places.find((p) => p.id === selected) ?? null;
  // Arama, haritada görünen bölgeye göre sıralanır: kaydırdıysan orası, değilse listenin yerleri, yoksa konumun.
  const near = panned ?? center ?? device;

  // Liste boşsa haritayı kullanıcının konumunda aç (izin ilk kez burada sorulur).
  const centredOnDevice = useRef(false);
  useEffect(() => {
    if (places.length || center) return;
    if (!device) { void requestLocation(); return; }
    if (centredOnDevice.current || panned) return;
    centredOnDevice.current = true;
    mapRef.current?.animateToRegion({ latitude: device.lat, longitude: device.lon, latitudeDelta: 0.05, longitudeDelta: 0.05 }, 400);
  }, [places.length, center, device, panned, requestLocation]);

  useEffect(() => {
    if (!searchPick) return;
    setSelected(null);
    mapRef.current?.animateToRegion(
      { latitude: searchPick.lat, longitude: searchPick.lon, latitudeDelta: 0.012, longitudeDelta: 0.012 }, 450);
  }, [searchPick]);

  function onRegionChangeComplete(r: MapRegion, details?: { isGesture?: boolean }) {
    if (details?.isGesture) setPanned({ lat: r.latitude, lon: r.longitude });
  }

  const pickCat = searchPick ? categoryInfo(searchPick.category) : null;

  return (
    <View style={{ flex: 1, backgroundColor: C.mapBg }} testID="places-map">
      <MapView
        ref={mapRef}
        style={{ flex: 1 }}
        initialRegion={region}
        showsUserLocation
        onPress={() => setSelected(null)}
        onRegionChangeComplete={onRegionChangeComplete}
      >
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
              onPress={(e) => { e.stopPropagation?.(); onSearchPick(null); setSelected(p.id); }}
            >
              <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: cat.color, borderWidth: on ? 4 : 3, borderColor: on ? C.orange : C.white, alignItems: 'center', justifyContent: 'center' }}>
                <CatGlyph category={p.category} size={on ? 22 : 18} color={C.white} />
              </View>
            </Marker>
          );
        })}
        {searchPick && pickCat ? (
          <Marker
            key={`search:${searchPick.provider}:${searchPick.providerId}`}
            testID="search-pin"
            coordinate={{ latitude: searchPick.lat, longitude: searchPick.lon }}
            title={searchPick.name}
            description={searchPick.address}
            accessibilityLabel={`Arama sonucu: ${searchPick.name}`}
            anchor={{ x: 0.5, y: 1 }}
            zIndex={1000}
          >
            {/* Temporary pin: orange teardrop with the category glyph, distinct from the saved (round) pins. */}
            <View style={{ alignItems: 'center' }}>
              <View style={{ width: 50, height: 50, borderRadius: 25, borderBottomRightRadius: 4, transform: [{ rotate: '45deg' }], backgroundColor: C.orange, borderWidth: 3, borderColor: C.white, alignItems: 'center', justifyContent: 'center' }}>
                <View style={{ transform: [{ rotate: '-45deg' }] }}>
                  <CatGlyph category={searchPick.category} size={22} color={C.orangeOn} />
                </View>
              </View>
              <View style={{ width: 10, height: 4, borderRadius: 2, backgroundColor: 'rgba(23,37,30,0.25)', marginTop: 6 }} />
            </View>
          </Marker>
        ) : null}
      </MapView>

      <View style={{ position: 'absolute', top: 12, left: 12, right: 12 }} pointerEvents="box-none">
        <PlaceSearchBar near={near} onSelect={onSearchPick} onClear={() => onSearchPick(null)} onFocus={() => { if (!device) void requestLocation(); }} />
      </View>

      {unlocated > 0 && !sel && !searchPick ? (
        <View style={{ position: 'absolute', left: 12, right: 12, bottom: 16, backgroundColor: C.white, borderRadius: 14, padding: 12 }}>
          <Txt size={13} color={C.secondary} testID="map-unlocated">{unlocated} yerin konumu yok; haritada gösterilmiyor.</Txt>
        </View>
      ) : null}
      {searchPick ? (
        <View style={{ position: 'absolute', left: 12, right: 12, bottom: 20 }}>
          <SearchResultCard
            result={searchPick}
            near={near}
            saved={pickSaved}
            onAdd={onAddPick ? () => onAddPick(searchPick) : undefined}
            onClose={() => onSearchPick(null)}
          />
        </View>
      ) : sel ? (
        <View style={{ position: 'absolute', left: 12, right: 12, bottom: 20 }}>
          <PlaceCard place={sel} onOpen={() => onOpenPlace(sel.id)} onClose={() => setSelected(null)} />
        </View>
      ) : null}
    </View>
  );
}
