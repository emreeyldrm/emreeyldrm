import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, View } from 'react-native';
import * as Location from 'expo-location';
import type { Category } from '../lib/api';
import { CATEGORIES } from '../lib/categories';
import { C, HIT } from '../theme';
import { CatGlyph } from './Icon';
import { LocationPicker } from './LocationPicker';
import { fmtCoord, type LatLon } from './mapTypes';
import { Btn, ErrorMsg, Field, IconBtn, Txt } from './ui';

export interface NewPlace { name: string; category: Category; note: string; lat: number | null; lon: number | null }
type LocMode = 'none' | 'map' | 'device';

/** "Yer ekle" bottom sheet: name, category, note and an optional location (map tap / device / none) — AC-MOB-3, AC-MOB-14. */
export function AddPlaceSheet({ visible, onClose, onSubmit, center }: {
  visible: boolean; onClose: () => void; onSubmit: (p: NewPlace) => Promise<void>; center: LatLon | null;
}) {
  const [name, setName] = useState('');
  const [category, setCategory] = useState<Category>('food');
  const [note, setNote] = useState('');
  const [mode, setMode] = useState<LocMode>('none');
  const [loc, setLoc] = useState<LatLon | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [locating, setLocating] = useState(false);

  useEffect(() => {
    if (visible) {
      setName(''); setNote(''); setCategory('food'); setMode('none'); setLoc(null); setError(null);
    }
  }, [visible]);

  async function locateDevice() {
    setMode('device');
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
      await onSubmit({ name: name.trim(), category, note: note.trim(), lat: withLoc?.lat ?? null, lon: withLoc?.lon ?? null });
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
          <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 8, gap: 14, paddingBottom: 34 }} keyboardShouldPersistTaps="handled">
            <Field label="Yer adı" value={name} onChangeText={setName} placeholder="Örn. Ayasofya" testID="place-name" autoFocus={Platform.OS === 'web'} />
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
                      accessibilityState={{ checked: on }}
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
                      accessibilityState={{ checked: on }}
                      onPress={() => chooseMode(m.key)}
                      style={{ minHeight: HIT, paddingHorizontal: 14, borderRadius: 22, justifyContent: 'center', backgroundColor: on ? C.green : C.greenCard }}
                    >
                      <Txt weight="bold" size={13} color={on ? C.white : C.greenDark}>{m.label}</Txt>
                    </Pressable>
                  );
                })}
              </View>
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
