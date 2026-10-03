import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Keyboard, Pressable, RefreshControl, ScrollView, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { HeroCard, PlaceRow, TopChips, TrendCard, type TopFilter } from '../../../components/DiscoverCards';
import { Icon, StarIcon } from '../../../components/Icon';
import { Avatar, Empty, ErrorMsg, H2, IconBtn, LargeTitle, Pill, Screen, Txt, fmtAvg, styles } from '../../../components/ui';
import { api, errMsg, type DiscoverHome, type DiscoverList, type Id, type PlaceCard } from '../../../lib/api';
import { categoryInfo } from '../../../lib/categories';
import { nearestCity, searchDestinations, type Destination } from '../../../lib/destinations';
import { pickDefaultCity } from '../../../lib/discover';
import { locationIfGranted } from '../../../lib/useDeviceLocation';
import { C, F, HIT } from '../../../theme';

const LOCATION_WAIT_MS = 2500;

/** Konum izni zaten verilmişse en yakın şehir; izin penceresi açılmaz, en çok 2,5 sn beklenir. */
async function cityFromLocation(): Promise<string | null> {
  const loc = await Promise.race([
    locationIfGranted(),
    new Promise<null>((r) => setTimeout(() => r(null), LOCATION_WAIT_MS)),
  ]);
  return loc ? nearestCity(loc.lat, loc.lon)?.name ?? null : null;
}

/**
 * Keşfet (Discover.dc.html, AC-MOB-26/27): şehir seçici (varsayılan: konuma en yakın şehir, yoksa son listenin şehri,
 * yoksa İstanbul), "Haftanın restoranı", "Haftanın trendleri", "En çok beğenilenler" (kategori çipleri), "En çok aranan"
 * ve o şehrin popüler herkese açık listeleri (AC-MOB-4). Çekerek yenileme; web'de başlıktaki "Yenile" düğmesi.
 */
export default function Discover() {
  const [text, setText] = useState('');
  const [active, setActive] = useState('');
  const [focused, setFocused] = useState(false);
  const [home, setHome] = useState<DiscoverHome | null>(null);
  const [top, setTop] = useState<PlaceCard[] | null>(null);
  const [cat, setCat] = useState<TopFilter>('all');
  const [lists, setLists] = useState<DiscoverList[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const seq = useRef(0); // eski yanıtlar yenisinin üstüne yazmasın
  const catSeq = useRef(0);
  const touched = useRef(false); // kullanıcı şehir yazdıysa varsayılan şehir onu ezmez
  const blur = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async (city: string, category: TopFilter) => {
    const n = ++seq.current;
    catSeq.current++;
    setError(null);
    setLoading(true);
    const [h, l] = await Promise.allSettled([
      api.discoverHome(city, category === 'all' ? null : category),
      api.discover(city),
    ]);
    if (n !== seq.current) return;
    if (h.status === 'fulfilled') { setHome(h.value); setTop(h.value.topRated); } else setError(errMsg(h.reason));
    if (l.status === 'fulfilled') setLists(l.value); else setError(errMsg(l.reason));
    setLoading(false);
  }, []);

  const apply = useCallback((city: string) => {
    const c = city.trim();
    if (!c) return;
    touched.current = true;
    setText(c);
    setActive(c);
    setFocused(false);
    setCat('all');
    // Yeni şehir: eski şehrin verisi gösterilmesin (yükleniyor göstergesi).
    setHome(null);
    setTop(null);
    setLists(null);
    Keyboard.dismiss();
    void load(c, 'all');
  }, [load]);

  // Varsayılan şehir: izin penceresi açmadan konum, yoksa en son güncellenen listenin şehri, yoksa İstanbul.
  useEffect(() => {
    let alive = true;
    void (async () => {
      const near = await cityFromLocation();
      let last: string | null = null;
      if (!near) {
        try { last = (await api.myLists())[0]?.city ?? null; } catch { /* yoksa İstanbul */ }
      }
      if (!alive || touched.current) return;
      const c = pickDefaultCity(near, last);
      setText(c);
      setActive(c);
      void load(c, 'all');
    })();
    return () => { alive = false; };
  }, [load]);

  async function pickCategory(f: TopFilter) {
    setCat(f);
    const n = ++catSeq.current;
    try {
      const r = await api.discoverHome(active, f === 'all' ? null : f);
      if (n !== catSeq.current) return;
      setTop(r.topRated);
    } catch (e) { setError(errMsg(e)); }
  }

  async function refresh() {
    if (!active) return;
    setRefreshing(true);
    try { await load(active, cat); } finally { setRefreshing(false); }
  }

  const suggestions = useMemo<Destination[]>(
    () => (focused && text.trim() && text.trim() !== active
      ? searchDestinations(text, 10).filter((d) => d.kind === 'city').slice(0, 5)
      : []),
    [focused, text, active],
  );

  const open = (id: Id) => router.push(`/places/${id}`);
  const first = loading && !home;

  return (
    <Screen>
      <ScrollView
        testID="discover-scroll"
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 20, paddingTop: 24, paddingBottom: 40, gap: 14 }}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={C.green} colors={[C.green]} />}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <LargeTitle>Keşfet</LargeTitle>
          <IconBtn icon="refresh" label="Yenile" testID="discover-refresh" onPress={refresh} bg={C.greenCard} />
        </View>

        {/* Şehir seçici: yazdıkça (çevrimdışı) şehir önerir; listede olmayan şehir de yazılıp aranabilir. */}
        <View style={{ gap: 6, zIndex: 10 }}>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <View style={[styles.input, { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 0 }]}>
              <Icon name="pin" size={20} color={C.greenDark} strokeWidth={2.2} />
              <TextInput
                testID="discover-city"
                accessibilityLabel="Şehir"
                placeholder="Şehir seç ya da ara"
                placeholderTextColor={C.secondary}
                value={text}
                onChangeText={(t) => { touched.current = true; setText(t); }}
                onFocus={() => { if (blur.current) clearTimeout(blur.current); setFocused(true); }}
                onBlur={() => { blur.current = setTimeout(() => setFocused(false), 250); }}
                onSubmitEditing={() => apply(text)}
                selectTextOnFocus
                autoCorrect={false}
                returnKeyType="search"
                style={{ flex: 1, minHeight: HIT, fontFamily: F.semibold, fontSize: 15, color: C.text }}
              />
            </View>
            <IconBtn icon="search" label="Ara" bg={C.green} color={C.white} round={false} size={48} onPress={() => apply(text)} testID="discover-search" />
          </View>
          {suggestions.length ? (
            <View testID="discover-city-suggest" accessibilityRole="list" style={{ backgroundColor: C.white, borderRadius: 16, borderWidth: 1, borderColor: C.border, overflow: 'hidden' }}>
              {suggestions.map((d, i) => (
                <Pressable
                  key={`${d.countryCode}:${d.name}:${i}`}
                  testID="discover-city-option"
                  accessibilityRole="button"
                  accessibilityLabel={`${d.name}, ${d.detail}`}
                  onPress={() => apply(d.name)}
                  style={({ pressed }) => ({
                    minHeight: HIT + 4, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 6,
                    backgroundColor: pressed ? C.greenCard : C.white, borderTopWidth: i ? 1 : 0, borderTopColor: C.border,
                  })}
                >
                  <Icon name="pin" size={17} color={C.greenDark} strokeWidth={2.2} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Txt weight="bold" size={15} numberOfLines={1}>{d.name}</Txt>
                    <Txt size={12} color={C.secondary} numberOfLines={1}>{d.detail}</Txt>
                  </View>
                </Pressable>
              ))}
            </View>
          ) : null}
        </View>

        <ErrorMsg message={error} />
        {first ? <ActivityIndicator testID="discover-loading" color={C.green} style={{ paddingVertical: 24 }} /> : null}

        {home ? (
          <>
            <Section title="Haftanın restoranı" testID="sec-pow">
              {home.placeOfWeek
                ? <HeroCard card={home.placeOfWeek} onPress={() => open(home.placeOfWeek!.placeId)} />
                : <EmptyCard testID="pow-empty" text="Bu hafta öne çıkan bir restoran yok — beğendiğin restoranı puanla, haftanın restoranı o olsun." />}
            </Section>

            <Section title="Haftanın trendleri" testID="sec-trending">
              {home.trending.length ? (
                <ScrollView
                  horizontal
                  testID="trending-list"
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ gap: 12, paddingHorizontal: 20 }}
                  style={{ flexGrow: 0, marginHorizontal: -20 }}
                >
                  {home.trending.map((c, i) => <TrendCard key={String(c.placeId)} card={c} rank={i + 1} onPress={() => open(c.placeId)} />)}
                </ScrollView>
              ) : <EmptyCard testID="trending-empty" text="Bu hafta henüz trend yok — ilk puanı sen ver" />}
            </Section>

            <Section title="En çok beğenilenler" testID="sec-top">
              <TopChips counts={home.categoryCounts} value={cat} onChange={pickCategory} />
              {top?.length
                ? <View testID="top-list">{top.map((c) => <PlaceRow key={String(c.placeId)} card={c} kind="top" onPress={() => open(c.placeId)} />)}</View>
                : <Empty testID="top-empty" text={cat === 'all'
                  ? 'Henüz puanlanmış yer yok — gezdiğin yerlere puan ver.'
                  : `${categoryInfo(cat).title} kategorisinde puanlanmış yer yok.`} />}
            </Section>

            <Section title="En çok aranan" testID="sec-searched">
              {home.mostSearched.length
                ? <View testID="searched-list">{home.mostSearched.map((c) => <PlaceRow key={String(c.placeId)} card={c} kind="searched" onPress={() => open(c.placeId)} />)}</View>
                : <Empty testID="searched-empty" text="Bu hafta bu şehirde henüz bakılan ya da kaydedilen yer yok." />}
            </Section>
          </>
        ) : null}

        {lists ? (
          <Section title="Popüler listeler" testID="sec-lists">
            {lists.length === 0 ? <Empty text="Bu şehir için herkese açık liste yok." testID="discover-empty" /> : null}
            {lists.map((l) => (
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
          </Section>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

function Section({ title, testID, children }: { title: string; testID: string; children: ReactNode }) {
  return (
    <View testID={testID} style={{ gap: 12, paddingTop: 8 }}>
      <H2>{title}</H2>
      {children}
    </View>
  );
}

function EmptyCard({ text, testID }: { text: string; testID: string }) {
  return (
    <View testID={testID} style={{ backgroundColor: C.greenSoft, borderRadius: 18, borderWidth: 1, borderColor: C.divider, borderStyle: 'dashed', padding: 16 }}>
      <Txt size={14} color={C.secondary} style={{ lineHeight: 20 }}>{text}</Txt>
    </View>
  );
}
