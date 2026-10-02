import { useEffect, useRef, useState } from 'react';
import { Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, TextInput, View } from 'react-native';
import * as Location from 'expo-location';
import type { Category, ListItem, SearchResult } from '../lib/api';
import { CATEGORIES, categoryInfo } from '../lib/categories';
import { SEARCH_MIN_CHARS, usePlaceSearch } from '../lib/usePlaceSearch';
import { useDeviceLocation } from '../lib/useDeviceLocation';
import { findDestination } from '../lib/destinations';
import { api } from '../lib/api';
import { currencyForCity, hasService, MAX_PLACE_PHOTOS, type PlaceDetails } from '../lib/details';
import { usePhotoUploads } from '../lib/media';
import { DetailsSection, draftFromDetails, draftToDetails, type DetailsDraft } from './DetailsSection';
import { C, F, HIT } from '../theme';
import { CatGlyph, Icon } from './Icon';
import { LocationPicker } from './LocationPicker';
import { fmtCoord, type LatLon } from './mapTypes';
import { SearchResultsPanel } from './PlaceSearch';
import { Btn, ErrorMsg, Field, IconBtn, Txt } from './ui';

/** `provider`/`providerId` are set when the place comes from search (AC-MOB-16); manual places have none. */
export interface NewPlace {
  name: string; category: Category; note: string; lat: number | null; lon: number | null;
  provider?: string; providerId?: string;
  /** DET: always set (may be `{}`). */
  details: PlaceDetails;
}
/** 'search' = location (and identity) taken from a search result. */
type LocMode = 'none' | 'map' | 'device' | 'search';

/** Delay before hiding name suggestions on blur, so a tap on a suggestion still lands. */
const BLUR_GRACE_MS = 250;

/**
 * "Yer ekle" bottom sheet: name (with search suggestions, AC-MOB-17), category, note and an optional location
 * (search result / map tap / device / none) — AC-MOB-3, AC-MOB-14, AC-MOB-16. `initial` pre-fills it from a
 * search result ("Listeye ekle" on the map card). "Detaylar" (AC-MOB-21..23): service, wait, recommendation,
 * favourites, spend and photos. With `editItem` it edits a saved place (AC-MOB-24): name and location stay as
 * saved (they identify the place), category, note and details change; the button reads "Kaydet".
 */
export function AddPlaceSheet({ visible, onClose, onSubmit, center, initial, city, editItem }: {
  visible: boolean; onClose: () => void; onSubmit: (p: NewPlace) => Promise<void>; center: LatLon | null;
  initial?: SearchResult | null;
  /** Listenin şehri: "Roma'ya göre" arama seçeneği ve varsayılan para birimi için. */
  city?: string;
  editItem?: ListItem | null;
}) {
  const editing = !!editItem;
  const [name, setName] = useState('');
  const [category, setCategory] = useState<Category>('food');
  const [note, setNote] = useState('');
  const [mode, setMode] = useState<LocMode>('none');
  const [loc, setLoc] = useState<LatLon | null>(null);
  const [picked, setPicked] = useState<SearchResult | null>(null);
  const [nameFocused, setNameFocused] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [locating, setLocating] = useState(false);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const defaultCurrency = currencyForCity(city);
  const [draft, setDraft] = useState<DetailsDraft>(() => draftFromDetails(null, defaultCurrency));
  // Detaylar yeme-içme yerlerinde varsayılan açık; kullanıcı açıp kapatınca kategoriye göre değişmez.
  const [detailsOpen, setDetailsOpen] = useState(true);
  const [detailsToggled, setDetailsToggled] = useState(false);
  const photos = usePhotoUploads(MAX_PLACE_PHOTOS);

  useEffect(() => {
    if (visible) {
      setNote(''); setError(null); setDetailsToggled(false);
      if (editItem) {
        const d = editItem.details ?? {};
        setName(editItem.name); setCategory(editItem.category); setNote(editItem.note ?? '');
        setLoc(editItem.lat !== null && editItem.lon !== null ? { lat: editItem.lat, lon: editItem.lon } : null);
        setMode('none'); setPicked(null);
        setDraft(draftFromDetails(d, defaultCurrency));
        photos.reset(d.photos ?? []);
        setDetailsOpen(hasService(editItem.category) || Object.keys(d).length > 0);
        return;
      }
      setDraft(draftFromDetails(null, defaultCurrency));
      photos.reset();
      if (initial) {
        pick(initial);
        setDetailsOpen(hasService(initial.category));
      } else {
        setName(''); setCategory('food'); setMode('none'); setLoc(null); setPicked(null);
        setDetailsOpen(true);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, initial, editItem]);
  useEffect(() => {
    if (visible && !detailsToggled && !editing) setDetailsOpen(hasService(category));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category]);
  useEffect(() => () => { if (blurTimer.current) clearTimeout(blurTimer.current); }, []);

  // Suggestions only while the name field has focus and the text is not the picked result's name.
  const suggest = visible && !editing && nameFocused && name.trim().length >= SEARCH_MIN_CHARS && name.trim() !== picked?.name;
  // Arama neye göre sıralansın: cihaz konumu (varsayılan) ya da listenin şehri.
  const [bias, setBias] = useState<'near' | 'city'>('near');
  const [cityCenter, setCityCenter] = useState<LatLon | null>(null);
  const device = useDeviceLocation();
  useEffect(() => {
    // Liste şehrinin merkezi: listede yer varsa onların ortası, yoksa şehir adını bir kez ararız.
    if (bias !== 'city' || center || cityCenter || !city) return;
    // Önce gömülü şehir listesi (internetsiz), bulunamazsa arama servisi.
    const known = findDestination(city);
    if (known) { setCityCenter({ lat: known.lat, lon: known.lon }); return; }
    let alive = true;
    api.searchPlaces(city, null).then((r) => { if (alive && r[0]) setCityCenter({ lat: r[0].lat, lon: r[0].lon }); }).catch(() => {});
    return () => { alive = false; };
  }, [bias, center, city, cityCenter]);
  const biasPoint = bias === 'city' ? (center ?? cityCenter) : (device.location ?? center);
  const search = usePlaceSearch(name, biasPoint, suggest);

  function pick(r: SearchResult) {
    setName(r.name);
    setCategory(r.category);
    setLoc({ lat: r.lat, lon: r.lon });
    setMode('search');
    setPicked(r);
    setNameFocused(false);
    Keyboard.dismiss();
  }

  function onNameFocus() {
    if (blurTimer.current) clearTimeout(blurTimer.current);
    setNameFocused(true);
    if (bias === 'near' && !device.location) void device.request();
  }
  function onNameBlur() {
    if (blurTimer.current) clearTimeout(blurTimer.current);
    blurTimer.current = setTimeout(() => setNameFocused(false), BLUR_GRACE_MS);
  }

  async function locateDevice() {
    setMode('device');
    setLoc(null);
    setError(null);
    setLocating(true);
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== 'granted') {
        setError('Konum izni verilmedi.');
        setMode('none');
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setLoc({ lat: pos.coords.latitude, lon: pos.coords.longitude });
    } catch {
      setError('Konum alınamadı.');
      setMode('none');
    } finally {
      setLocating(false);
    }
  }

  function chooseMode(m: LocMode) {
    // Choosing another location source drops the search result's identity.
    setPicked(null);
    if (m === 'device') { void locateDevice(); return; }
    setMode(m);
    if (m === 'none') setLoc(null);
  }

  async function submit() {
    if (!name.trim()) { setError('Yer adı gerekli.'); return; }
    if (photos.busy) { setError('Fotoğraflar yükleniyor, biraz bekle.'); return; }
    const built = draftToDetails(draft, category, photos.ids);
    if ('error' in built) { setError(built.error); setDetailsOpen(true); return; }
    setBusy(true);
    setError(null);
    try {
      if (editItem) {
        await onSubmit({
          name: editItem.name, category, note: note.trim(), lat: editItem.lat, lon: editItem.lon,
          provider: editItem.provider, providerId: editItem.providerId, details: built.details,
        });
        return;
      }
      const withLoc = mode !== 'none' && loc ? loc : null;
      const fromSearch = mode === 'search' && picked ? { provider: picked.provider, providerId: picked.providerId } : {};
      await onSubmit({ name: name.trim(), category, note: note.trim(), lat: withLoc?.lat ?? null, lon: withLoc?.lon ?? null, ...fromSearch, details: built.details });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const modes: { key: LocMode; label: string; testID: string }[] = [
    { key: 'none', label: 'Konumsuz', testID: 'loc-none' },
    { key: 'map', label: 'Haritadan seç', testID: 'loc-map' },
    { key: 'device', label: 'Konumumu kullan', testID: 'place-use-location' },
  ];

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(23,37,30,0.4)' }}>
        <View testID="add-place-sheet" accessibilityViewIsModal style={{ backgroundColor: C.white, borderTopLeftRadius: 26, borderTopRightRadius: 26, maxHeight: '92%' }}>
          <View style={{ width: 40, height: 5, borderRadius: 3, backgroundColor: C.border, alignSelf: 'center', marginTop: 10 }} />
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 6 }}>
            <Txt weight="extrabold" size={22} color={C.greenDark} accessibilityRole="header">{editing ? 'Yeri düzenle' : 'Yer ekle'}</Txt>
            <IconBtn icon="close" label="Kapat" onPress={onClose} testID="place-cancel" />
          </View>
          {editing ? (
            <View style={{ paddingHorizontal: 20, paddingBottom: 6 }}>
              <Txt weight="bold" size={17} testID="edit-place-name">{name}</Txt>
              {loc ? <Txt size={12} color={C.secondary}>Konum: {fmtCoord(loc)}</Txt> : <Txt size={12} color={C.secondary}>Konumsuz</Txt>}
            </View>
          ) : null}
          {/* Sabit arama çubuğu: kaydırınca kaybolmaz. Hem arama hem yer adı alanıdır (AC-MOB-17). */}
          {editing ? null : (
          <View style={{ paddingHorizontal: 20, paddingTop: 4, paddingBottom: 8, gap: 8, zIndex: 10 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: C.input, borderRadius: 16, paddingLeft: 14, minHeight: 52, borderWidth: nameFocused ? 2 : 0, borderColor: C.green }}>
              <Icon name="search" size={20} color={C.green} strokeWidth={2.4} />
              <TextInput
                testID="place-name"
                value={name}
                onChangeText={(t) => { setName(t); if (picked && t !== picked.name) { setPicked(null); if (mode === 'search') { setMode('none'); setLoc(null); } } }}
                onFocus={onNameFocus}
                onBlur={onNameBlur}
                placeholder="Yer ara ya da adını yaz: örn. Ayasofya"
                placeholderTextColor={C.secondary}
                accessibilityLabel="Yer adı veya arama"
                returnKeyType="search"
                autoCorrect={false}
                autoFocus={!initial}
                style={{ flex: 1, minHeight: 52, paddingHorizontal: 10, fontFamily: F.medium, fontSize: 16, color: C.text, ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as object : null) }}
              />
              {name ? (
                <IconBtn icon="close" label="Temizle" color={C.secondary} iconSize={18} onPress={() => { setName(''); setPicked(null); if (mode === 'search') { setMode('none'); setLoc(null); } }} testID="place-name-clear" />
              ) : null}
            </View>
            <View style={{ flexDirection: 'row', gap: 8 }} accessibilityRole="radiogroup" accessibilityLabel="Arama konumu">
              {([
                { key: 'near' as const, label: 'Yakınımda', icon: 'pin' as const, testID: 'bias-near' },
                ...(city ? [{ key: 'city' as const, label: city, icon: 'map' as const, testID: 'bias-city' }] : []),
              ]).map((b) => {
                const on = bias === b.key;
                return (
                  <Pressable
                    key={b.key}
                    testID={b.testID}
                    accessibilityRole="radio"
                    aria-checked={on}
                    accessibilityLabel={b.key === 'near' ? 'Konumuma göre ara' : `${b.label} şehrinde ara`}
                    onPress={() => { setBias(b.key); if (b.key === 'near' && !device.location) void device.request(); }}
                    style={{ minHeight: 36, paddingHorizontal: 12, borderRadius: 18, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: on ? C.green : C.greenCard }}
                  >
                    <Icon name={b.icon} size={14} color={on ? C.white : C.greenDark} strokeWidth={2.2} />
                    <Txt weight="bold" size={13} color={on ? C.white : C.greenDark} numberOfLines={1}>{b.label}</Txt>
                  </Pressable>
                );
              })}
            </View>
            {suggest && search.status !== 'idle' ? (
              <SearchResultsPanel
                id="place-suggest"
                state={search}
                near={biasPoint}
                maxHeight={260}
                onSelect={pick}
                emptyHint="Adı yazıp elle eklemeye devam edebilirsin."
                errorHint="Yeri elle ekleyebilirsin."
              />
            ) : null}
          </View>
          )}
          <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ padding: 20, paddingTop: 8, gap: 14, paddingBottom: 20 }} keyboardShouldPersistTaps="handled" testID="add-place-scroll">
            <View style={{ gap: 6 }}>
              <Txt weight="semibold" size={13} color={C.secondary}>Kategori</Txt>
              <View accessibilityRole="radiogroup" accessibilityLabel="Kategori" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }} testID="place-category">
                {CATEGORIES.map((c) => {
                  const on = c.key === category;
                  return (
                    <Pressable
                      key={c.key}
                      testID={`place-cat-${c.key}`}
                      accessibilityRole="radio"
                      accessibilityLabel={c.title}
                      aria-checked={on}
                      onPress={() => setCategory(c.key)}
                      style={{ minHeight: HIT, paddingLeft: 10, paddingRight: 14, borderRadius: 22, backgroundColor: on ? c.color : c.tint, flexDirection: 'row', alignItems: 'center', gap: 6 }}
                    >
                      <CatGlyph category={c.key} size={16} color={on ? C.white : c.color} />
                      <Txt weight="bold" size={13} color={on ? C.white : c.color}>{c.title}</Txt>
                    </Pressable>
                  );
                })}
              </View>
            </View>
            <Field label="Not" value={note} onChangeText={setNote} placeholder="Örn. sabah erken git" testID="place-note" />
            {editing ? null : (
            <View style={{ gap: 8 }}>
              <Txt weight="semibold" size={13} color={C.secondary}>Konum</Txt>
              <View accessibilityRole="radiogroup" accessibilityLabel="Konum" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {modes.map((m) => {
                  const on = m.key === mode;
                  return (
                    <Pressable
                      key={m.key}
                      testID={m.testID}
                      accessibilityRole="radio"
                      aria-checked={on}
                      onPress={() => chooseMode(m.key)}
                      style={{ minHeight: HIT, paddingHorizontal: 14, borderRadius: 22, justifyContent: 'center', backgroundColor: on ? C.green : C.greenCard }}
                    >
                      <Txt weight="bold" size={13} color={on ? C.white : C.greenDark}>{m.label}</Txt>
                    </Pressable>
                  );
                })}
              </View>
              {mode === 'search' && picked ? (
                <View testID="place-picked" style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.orangeTint, borderRadius: 14, paddingLeft: 12, paddingVertical: 4 }}>
                  <CatGlyph category={picked.category} size={18} color={categoryInfo(picked.category).color} />
                  <View style={{ flex: 1 }}>
                    <Txt weight="bold" size={13} color={C.orangeText}>Arama sonucundan</Txt>
                    {picked.address ? <Txt size={12} color={C.secondary} numberOfLines={2} testID="place-picked-address">{picked.address}</Txt> : null}
                  </View>
                  <IconBtn icon="close" label="Arama sonucunu kaldır" color={C.secondary} iconSize={18} onPress={() => chooseMode('none')} testID="place-picked-clear" />
                </View>
              ) : null}
              {mode === 'map' ? <LocationPicker value={loc} onChange={setLoc} center={center} /> : null}
              {mode === 'device' && locating ? <Txt size={13} color={C.secondary}>Konum alınıyor…</Txt> : null}
              {mode !== 'none' && loc ? (
                <Txt size={13} weight="semibold" color={C.greenDark} testID="place-coords">Seçilen konum: {fmtCoord(loc)}</Txt>
              ) : null}
            </View>
            )}
            <DetailsSection
              category={category}
              draft={draft}
              onChange={setDraft}
              photos={photos}
              open={detailsOpen}
              onToggle={() => { setDetailsOpen(!detailsOpen); setDetailsToggled(true); }}
            />
          </ScrollView>
          {/* Ana düğme her zaman görünür: içerik kayar, düğme altta sabit kalır. */}
          <View style={{ paddingHorizontal: 20, paddingTop: 10, paddingBottom: 24, gap: 8, borderTopWidth: 1, borderTopColor: C.divider }}>
            <ErrorMsg message={error} />
            {photos.busy ? <Txt size={13} weight="semibold" color={C.secondary} testID="photos-busy">Fotoğraflar yükleniyor…</Txt> : null}
            <Btn
              title={editing ? 'Kaydet' : 'Ekle'}
              testID={editing ? 'place-save' : 'place-add'}
              onPress={submit}
              disabled={busy || locating || photos.busy}
            />
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
