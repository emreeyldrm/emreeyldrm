import { useEffect, useRef, useState } from 'react';
import { Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, TextInput, View } from 'react-native';
import * as Location from 'expo-location';
import type { Category, SearchResult } from '../lib/api';
import { CATEGORIES, categoryInfo } from '../lib/categories';
import { SEARCH_MIN_CHARS, usePlaceSearch } from '../lib/usePlaceSearch';
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
}
/** 'search' = location (and identity) taken from a search result. */
type LocMode = 'none' | 'map' | 'device' | 'search';

/** Delay before hiding name suggestions on blur, so a tap on a suggestion still lands. */
const BLUR_GRACE_MS = 250;

/**
 * "Yer ekle" bottom sheet: name (with search suggestions, AC-MOB-17), category, note and an optional location
 * (search result / map tap / device / none) — AC-MOB-3, AC-MOB-14, AC-MOB-16. `initial` pre-fills it from a
 * search result ("Listeye ekle" on the map card).
 */
export function AddPlaceSheet({ visible, onClose, onSubmit, center, initial }: {
  visible: boolean; onClose: () => void; onSubmit: (p: NewPlace) => Promise<void>; center: LatLon | null;
  initial?: SearchResult | null;
}) {
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

  useEffect(() => {
    if (visible) {
      setNote(''); setError(null);
      if (initial) {
        pick(initial);
      } else {
        setName(''); setCategory('food'); setMode('none'); setLoc(null); setPicked(null);
      }
    }
  }, [visible, initial]);
  useEffect(() => () => { if (blurTimer.current) clearTimeout(blurTimer.current); }, []);

  // Suggestions only while the name field has focus and the text is not the picked result's name.
  const suggest = visible && nameFocused && name.trim().length >= SEARCH_MIN_CHARS && name.trim() !== picked?.name;
  const search = usePlaceSearch(name, loc ?? center, suggest);

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
    setBusy(true);
    setError(null);
    try {
      const withLoc = mode !== 'none' && loc ? loc : null;
      const fromSearch = mode === 'search' && picked ? { provider: picked.provider, providerId: picked.providerId } : {};
      await onSubmit({ name: name.trim(), category, note: note.trim(), lat: withLoc?.lat ?? null, lon: withLoc?.lon ?? null, ...fromSearch });
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
            <Txt weight="extrabold" size={22} color={C.greenDark} accessibilityRole="header">Yer ekle</Txt>
            <IconBtn icon="close" label="Kapat" onPress={onClose} testID="place-cancel" />
          </View>
          {/* Sabit arama çubuğu: kaydırınca kaybolmaz. Hem arama hem yer adı alanıdır (AC-MOB-17). */}
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
            {suggest && search.status !== 'idle' ? (
              <SearchResultsPanel
                id="place-suggest"
                state={search}
                near={loc ?? center}
                maxHeight={260}
                onSelect={pick}
                emptyHint="Adı yazıp elle eklemeye devam edebilirsin."
                errorHint="Yeri elle ekleyebilirsin."
              />
            ) : null}
          </View>
          <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 8, gap: 14, paddingBottom: 34 }} keyboardShouldPersistTaps="handled">
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
            <ErrorMsg message={error} />
            <Btn title="Ekle" testID="place-add" onPress={submit} disabled={busy || locating} />
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
