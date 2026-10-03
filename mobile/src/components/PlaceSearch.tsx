import { useState, type ReactNode } from 'react';
import { ActivityIndicator, Keyboard, Platform, Pressable, ScrollView, TextInput, View, type StyleProp, type ViewStyle } from 'react-native';
import type { SearchResult } from '../lib/api';
import { categoryInfo } from '../lib/categories';
import { distanceMeters, formatDistance } from '../lib/plan';
import { SEARCH_MIN_CHARS, usePlaceSearch, type SearchState } from '../lib/usePlaceSearch';
import { C, F, HIT } from '../theme';
import { Icon } from './Icon';
import type { LatLon } from './mapTypes';
import { CategoryIcon, IconBtn, Txt, webData } from './ui';

export const SEARCH_EMPTY_TEXT = 'Sonuç yok';
export const SEARCH_ERROR_TEXT = 'Arama şu an yapılamıyor';

const shadow: ViewStyle = {
  shadowColor: '#17251E', shadowOpacity: 0.16, shadowRadius: 16, shadowOffset: { width: 0, height: 4 }, elevation: 6,
};

/** "650 m", "3,8 km", "1376 km" (whole kilometres when far away). */
export function distanceLabel(near: LatLon | null, r: LatLon): string | null {
  if (!near) return null;
  const m = distanceMeters(near, r);
  return m >= 100_000 ? `${Math.round(m / 1000)} km` : formatDistance(m);
}

/** One suggestion row: category icon in its tinted circle, name, address, distance. */
function ResultRow({ r, near, onPress, testID, last }: { r: SearchResult; near: LatLon | null; onPress: () => void; testID: string; last: boolean }) {
  const cat = categoryInfo(r.category);
  const dist = distanceLabel(near, r);
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={`${r.name}, ${cat.title}${r.address ? `, ${r.address}` : ''}${dist ? `, ${dist}` : ''}`}
      {...webData({ category: cat.key, providerId: r.providerId })}
      onPress={onPress}
      style={({ pressed }) => [
        { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 10, minHeight: HIT + 12 },
        last ? null : { borderBottomWidth: 1, borderBottomColor: C.divider },
        pressed ? { backgroundColor: C.greenSoft } : null,
      ]}
    >
      <CategoryIcon category={r.category} size={38} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt weight="bold" size={15} numberOfLines={1} testID={`${testID}-name`}>{r.name}</Txt>
        {r.address ? <Txt size={13} color={C.secondary} numberOfLines={1} testID={`${testID}-address`}>{r.address}</Txt> : null}
      </View>
      {dist ? <Txt weight="semibold" size={12} color={C.greenDark} testID={`${testID}-distance`}>{dist}</Txt> : null}
    </Pressable>
  );
}

/**
 * Suggestion list with loading / "Sonuç yok" / "Arama şu an yapılamıyor" states. `id` prefixes the testIDs:
 * `${id}-results`, `${id}-result`, `${id}-loading`, `${id}-empty`, `${id}-error`.
 */
export function SearchResultsPanel({ id, state, near, onSelect, emptyHint, errorHint, style, maxHeight = 320 }: {
  id: string; state: SearchState; near: LatLon | null; onSelect: (r: SearchResult) => void;
  emptyHint?: string; errorHint?: string; style?: StyleProp<ViewStyle>; maxHeight?: number;
}) {
  let body: ReactNode;
  if (state.status === 'error') {
    body = (
      <View testID={`${id}-error`} accessibilityRole="alert" style={{ padding: 14, gap: 2 }}>
        <Txt weight="bold" size={14} color={C.danger}>{SEARCH_ERROR_TEXT}</Txt>
        {errorHint ? <Txt size={13} color={C.secondary}>{errorHint}</Txt> : null}
      </View>
    );
  } else if (state.status === 'loading' && state.results.length === 0) {
    body = (
      <View testID={`${id}-loading`} accessibilityLabel="Aranıyor" style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14 }}>
        <ActivityIndicator color={C.green} />
        <Txt size={14} color={C.secondary}>Aranıyor…</Txt>
      </View>
    );
  } else if (state.status === 'done' && state.results.length === 0) {
    body = (
      <View testID={`${id}-empty`} style={{ padding: 14, gap: 2 }}>
        <Txt weight="bold" size={14} color={C.secondary}>{SEARCH_EMPTY_TEXT}</Txt>
        {emptyHint ? <Txt size={13} color={C.secondary}>{emptyHint}</Txt> : null}
      </View>
    );
  } else {
    body = (
      <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight }} nestedScrollEnabled>
        <View accessibilityRole="list" testID={`${id}-results`}>
          {state.results.map((r, i) => (
            <ResultRow
              key={`${r.provider}:${r.providerId}`}
              r={r}
              near={near}
              testID={`${id}-result`}
              last={i === state.results.length - 1}
              onPress={() => { Keyboard.dismiss(); onSelect(r); }}
            />
          ))}
        </View>
      </ScrollView>
    );
  }
  return (
    <View style={[{ backgroundColor: C.white, borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: C.divider }, style]}>
      {body}
    </View>
  );
}

/**
 * Floating "Google Maps-like" search bar for the map tab (AC-MOB-15): debounced suggestions in an overlay
 * (absolutely positioned under the bar, so the parent must not clip it),
 * selecting one dismisses the keyboard, closes the list and calls `onSelect`. testIDs: `place-search*`.
 */
export function PlaceSearchBar({ near, onSelect, onClear, onFocus, style, panelMaxHeight = 340 }: {
  near: LatLon | null; onSelect: (r: SearchResult) => void; onClear?: () => void; onFocus?: () => void;
  style?: StyleProp<ViewStyle>; panelMaxHeight?: number;
}) {
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const state = usePlaceSearch(text, near, open);
  const showPanel = open && text.trim().length >= SEARCH_MIN_CHARS && state.status !== 'idle';

  function clear() {
    setText('');
    setOpen(false);
    onClear?.();
  }

  return (
    <View testID="place-search" style={[{ zIndex: 10 }, style]}>
      <View style={[{ flexDirection: 'row', alignItems: 'center', backgroundColor: C.white, borderRadius: 16, paddingLeft: 14, minHeight: 52 }, shadow]}>
        <Icon name="search" size={20} color={C.green} strokeWidth={2.4} />
        <TextInput
          testID="place-search-input"
          value={text}
          onChangeText={(t) => { setText(t); setOpen(true); }}
          onFocus={() => { onFocus?.(); if (text.trim()) setOpen(true); }}
          placeholder="Yer ara: müze, kafe, adres…"
          placeholderTextColor={C.secondary}
          accessibilityLabel="Yer ara"
          returnKeyType="search"
          autoCorrect={false}
          onSubmitEditing={() => Keyboard.dismiss()}
          style={{ flex: 1, minHeight: 52, paddingHorizontal: 10, fontFamily: F.medium, fontSize: 16, color: C.text, ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as object : null) }}
        />
        {text ? (
          <IconBtn icon="close" label="Aramayı temizle" color={C.secondary} iconSize={18} onPress={clear} testID="place-search-clear" />
        ) : null}
      </View>
      {showPanel ? (
        <SearchResultsPanel
          id="place-search"
          state={state}
          near={near}
          maxHeight={panelMaxHeight}
          style={[{ position: 'absolute', top: 60, left: 0, right: 0 }, shadow]}
          onSelect={(r) => { setText(r.name); setOpen(false); onSelect(r); }}
        />
      ) : null}
    </View>
  );
}
