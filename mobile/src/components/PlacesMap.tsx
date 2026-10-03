import { useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import MapView, { Marker, type MapPressEvent, type PoiClickEvent, type Region as MapRegion } from 'react-native-maps';
import type { SearchResult } from '../lib/api';
import { useDeviceLocation } from '../lib/useDeviceLocation';
import { useMapTap } from '../lib/useMapTap';
import { categoryInfo } from '../lib/categories';
import { C } from '../theme';
import { CatGlyph } from './Icon';
import { PlaceCard } from './PlaceCard';
import { PlacePreviewCard, TapPreview } from './PlacePreviewCard';
import { PlaceSearchBar } from './PlaceSearch';
import { Txt } from './ui';
import { regionFor, type LatLon, type PlacesMapProps } from './mapTypes';

/** A map tap this soon after a marker press, a POI click or a drag is not a new "tap" (iOS sends both events). */
const TAP_GUARD_MS = 400;

/**
 * Native map (react-native-maps): category-coloured pins, selected pin gets the orange ring (CityMap.dc.html).
 * A floating search bar (AC-MOB-15) biases results to the map centre (after the user pans), else the list's
 * centre, else the device's last known location; a picked result gets a temporary orange pin and a bottom card.
 * Tapping the map (AC-MOB-28) — on iOS / Apple Maps business icons are not tappable, so any tap counts — looks up
 * named places around that point (`/search/nearby`) and shows the nearest one in the same card; Android/Google
 * `onPoiClick` searches the POI by its name and position.
 */
export function PlacesMap({ places, unlocated, onOpenPlace, center, searchPick, onSearchPick, onAddPick, isSaved, city }: PlacesMapProps) {
  const [selected, setSelected] = useState<string | null>(null);
  const [panned, setPanned] = useState<LatLon | null>(null);
  const { location: device, request: requestLocation } = useDeviceLocation();
  const mapRef = useRef<MapView>(null);
  const region = useMemo(() => regionFor(places, center), [places, center]);
  const currentRegion = useRef<MapRegion>(region);
  const sel = places.find((p) => p.id === selected) ?? null;
  // Arama, haritada görünen bölgeye göre sıralanır: kaydırdıysan orası, değilse listenin yerleri, yoksa konumun.
  const near = panned ?? center ?? device;
  const { tap, current: tapped, tapAt, choose, clear: clearTap, retry, addRequested } = useMapTap(isSaved);
  const lastMarkerPress = useRef(0);
  const lastPoi = useRef(0);
  const lastDrag = useRef(0);

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
    clearTap();
    mapRef.current?.animateToRegion(
      { latitude: searchPick.lat, longitude: searchPick.lon, latitudeDelta: 0.012, longitudeDelta: 0.012 }, 450);
  }, [searchPick, clearTap]);

  function onRegionChangeComplete(r: MapRegion, details?: { isGesture?: boolean }) {
    currentRegion.current = r;
    if (details?.isGesture) { setPanned({ lat: r.latitude, lon: r.longitude }); lastDrag.current = Date.now(); }
  }

  /** Keeps the tapped point in the upper part of the map so the bottom card does not cover it. */
  function revealAbove(point: LatLon) {
    const r = currentRegion.current;
    if (point.lat > r.latitude + r.latitudeDelta * 0.1) return; // already in the upper part
    mapRef.current?.animateToRegion({ ...r, latitude: point.lat - r.latitudeDelta * 0.2, longitude: point.lon }, 300);
  }

  function startTap(point: LatLon, poiName?: string) {
    setSelected(null);
    onSearchPick(null);
    tapAt(point, poiName);
    revealAbove(point);
  }

  function onMapPress(e: MapPressEvent) {
    const ev = e.nativeEvent as MapPressEvent['nativeEvent'] & { action?: string };
    const now = Date.now();
    if (ev.action === 'marker-press' || now - lastMarkerPress.current < TAP_GUARD_MS
      || now - lastPoi.current < TAP_GUARD_MS || now - lastDrag.current < TAP_GUARD_MS) return;
    startTap({ lat: ev.coordinate.latitude, lon: ev.coordinate.longitude });
  }

  function onPoiClick(e: PoiClickEvent) {
    lastPoi.current = Date.now();
    const { coordinate, name } = e.nativeEvent;
    startTap({ lat: coordinate.latitude, lon: coordinate.longitude }, name.replace(/\s+/g, ' ').trim() || undefined);
  }

  const pickCat = searchPick ? categoryInfo(searchPick.category) : null;
  const tapPinAt: LatLon | null = tapped ?? (tap ? tap.point : null);
  const addFromCard = onAddPick ? (r: SearchResult) => { addRequested(r); onAddPick(r); } : undefined;

  return (
    <View style={{ flex: 1, backgroundColor: C.mapBg }} testID="places-map">
      <MapView
        ref={mapRef}
        style={{ flex: 1 }}
        initialRegion={region}
        showsUserLocation
        onPress={onMapPress}
        onPoiClick={onPoiClick}
        onPanDrag={() => { lastDrag.current = Date.now(); }}
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
              onPress={(e) => { e.stopPropagation?.(); lastMarkerPress.current = Date.now(); onSearchPick(null); clearTap(); setSelected(p.id); }}
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
            onPress={() => { lastMarkerPress.current = Date.now(); }}
          >
            <TempPin category={searchPick.category} />
          </Marker>
        ) : null}
        {tapPinAt ? (
          <Marker
            key={`tap:${tap?.id}:${tapped ? `${tapped.provider}:${tapped.providerId}` : 'point'}`}
            testID="tap-pin"
            coordinate={{ latitude: tapPinAt.lat, longitude: tapPinAt.lon }}
            accessibilityLabel={tapped ? `Seçilen yer: ${tapped.name}` : 'Dokunulan nokta'}
            anchor={tapped ? { x: 0.5, y: 1 } : { x: 0.5, y: 0.5 }}
            zIndex={1001}
            onPress={() => { lastMarkerPress.current = Date.now(); }}
          >
            {tapped ? <TempPin category={tapped.category} /> : (
              <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: C.orange, borderWidth: 4, borderColor: C.white, opacity: 0.9 }} />
            )}
          </Marker>
        ) : null}
      </MapView>

      <View style={{ position: 'absolute', top: 12, left: 12, right: 12 }} pointerEvents="box-none">
        <PlaceSearchBar near={near} onSelect={onSearchPick} onClear={() => onSearchPick(null)} onFocus={() => { if (!device) void requestLocation(); }} />
      </View>

      {unlocated > 0 && !sel && !searchPick && !tap ? (
        <View style={{ position: 'absolute', left: 12, right: 12, bottom: 16, backgroundColor: C.white, borderRadius: 14, padding: 12 }}>
          <Txt size={13} color={C.secondary} testID="map-unlocated">{unlocated} yerin konumu yok; haritada gösterilmiyor.</Txt>
        </View>
      ) : null}
      {tap ? (
        <View style={{ position: 'absolute', left: 12, right: 12, bottom: 20 }}>
          <TapPreview
            tap={tap}
            near={device ?? null}
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
        <View style={{ position: 'absolute', left: 12, right: 12, bottom: 20 }}>
          <PlacePreviewCard
            result={searchPick}
            near={near}
            city={city}
            saved={isSaved?.(searchPick)}
            onAdd={onAddPick ? () => onAddPick(searchPick) : undefined}
            onClose={() => onSearchPick(null)}
            onOpenPlace={onOpenPlace}
            closeLabel="Arama sonucunu kapat"
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

/** Temporary pin: orange teardrop with the category glyph, distinct from the saved (round) pins. */
function TempPin({ category }: { category: string }) {
  return (
    <View style={{ alignItems: 'center' }}>
      <View style={{ width: 50, height: 50, borderRadius: 25, borderBottomRightRadius: 4, transform: [{ rotate: '45deg' }], backgroundColor: C.orange, borderWidth: 3, borderColor: C.white, alignItems: 'center', justifyContent: 'center' }}>
        <View style={{ transform: [{ rotate: '-45deg' }] }}>
          <CatGlyph category={category} size={22} color={C.orangeOn} />
        </View>
      </View>
      <View style={{ width: 10, height: 4, borderRadius: 2, backgroundColor: 'rgba(23,37,30,0.25)', marginTop: 6 }} />
    </View>
  );
}
