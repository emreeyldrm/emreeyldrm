import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { Icon, StarIcon } from '../../../components/Icon';
import { Avatar, Empty, ErrorMsg, H2, IconBtn, LargeTitle, Pill, Screen, Scroll, Txt, fmtAvg, styles } from '../../../components/ui';
import { api, errMsg, type DiscoverList } from '../../../lib/api';
import { C, F, HIT } from '../../../theme';

/** Keşfet (Discover.dc.html): city search, quick city chips, popular public lists (AC-MOB-4). */
export default function Discover() {
  const [city, setCity] = useState('');
  const [active, setActive] = useState('');
  const [results, setResults] = useState<DiscoverList[] | null>(null);
  const [cities, setCities] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const search = useCallback(async (c: string) => {
    setError(null);
    setActive(c);
    try {
      const r = await api.discover(c);
      setResults(r);
      if (!c) setCities([...new Set(r.map((x) => x.city))].slice(0, 8));
    } catch (e) { setError(errMsg(e)); }
  }, []);

  useEffect(() => { void search(''); }, [search]);

  return (
    <Screen>
      <Scroll contentStyle={{ paddingTop: 24 }}>
        <LargeTitle>Keşfet</LargeTitle>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <View style={[styles.input, { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 0 }]}>
            <Icon name="search" size={20} color={C.secondary} strokeWidth={2.2} />
            <TextInput
              testID="discover-city"
              accessibilityLabel="Şehir ara"
              placeholder="Şehir ara"
              placeholderTextColor={C.secondary}
              value={city}
              onChangeText={setCity}
              onSubmitEditing={() => search(city.trim())}
              returnKeyType="search"
              style={{ flex: 1, minHeight: HIT, fontFamily: F.regular, fontSize: 15, color: C.text }}
            />
          </View>
          <IconBtn icon="search" label="Ara" bg={C.green} color={C.white} round={false} size={48} onPress={() => search(city.trim())} testID="discover-search" />
        </View>
        {cities.length ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }} style={{ flexGrow: 0 }}>
            {cities.map((c) => {
              const on = c.toLocaleLowerCase('tr') === active.toLocaleLowerCase('tr');
              return (
                <Pressable
                  key={c}
                  testID="discover-chip"
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  onPress={() => { setCity(on ? '' : c); void search(on ? '' : c); }}
                  style={{ minHeight: HIT, paddingHorizontal: 14, borderRadius: 22, justifyContent: 'center', backgroundColor: on ? C.green : C.greenCard }}
                >
                  <Txt weight="bold" size={13} color={on ? C.white : C.greenDark}>{c}</Txt>
                </Pressable>
              );
            })}
          </ScrollView>
        ) : null}

        <ErrorMsg message={error} />
        <View style={{ paddingTop: 6 }}>
          <H2>{active ? `${active} için listeler` : 'Popüler listeler'}</H2>
        </View>
        {results && results.length === 0 ? <Empty text="Bu şehir için herkese açık liste yok." testID="discover-empty" /> : null}
        {results?.map((l) => (
          <Pressable
            key={String(l.id)}
            testID="discover-card"
            accessibilityRole="button"
            accessibilityLabel={`${l.title}, @${l.ownerHandle}, ${l.city}, ${l.itemCount} yer`}
            onPress={() => router.push(`/lists/${l.id}`)}
            style={({ pressed }) => ({ backgroundColor: C.greenCard, borderRadius: 20, padding: 16, gap: 12, opacity: pressed ? 0.85 : 1 })}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Avatar name={l.ownerHandle} color={C.green} />
              <View style={{ flex: 1 }}>
                <Txt weight="bold" size={13}>@{l.ownerHandle}</Txt>
                <Txt size={12} color={C.secondary}>{l.city}</Txt>
              </View>
              <Pill text="Herkese açık" icon="globe" />
            </View>
            <Txt weight="extrabold" size={18} style={{ lineHeight: 23 }}>{l.title}</Txt>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                <StarIcon size={14} filled={l.avgStars !== null} />
                <Txt weight="bold" size={13}>{fmtAvg(l.avgStars)}</Txt>
              </View>
              <Txt size={13} color={C.secondary}>{l.itemCount} yer</Txt>
            </View>
          </Pressable>
        ))}
      </Scroll>
    </Screen>
  );
}
