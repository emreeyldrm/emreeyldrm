import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, ScrollView, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { DestinationField } from '../../components/DestinationField';
import { NavHeader } from '../../components/Header';
import { CatGlyph, Icon } from '../../components/Icon';
import { Btn, CategoryIcon, ErrorMsg, Field, H2, InfoMsg, LargeTitle, Screen, Txt, webData } from '../../components/ui';
import {
  api, errMsg, toItemInput, type Category, type Id, type ItemInput, type ListSummary, type SearchResult,
} from '../../lib/api';
import { CATEGORIES, categoryInfo } from '../../lib/categories';
import { findDestination, foldName } from '../../lib/destinations';
import { openUrl } from '../../lib/maps';
import { pickTextFiles } from '../../lib/pickFiles';
import { isOnline, useOffline } from '../../lib/offlineStore';
import {
  dedupeItems, groupByCity, guessCategory, guessCity, importSummary, matchQuality, parseTakeoutFile, pickBestMatch,
  splitForCapacity, type ImportPlace, type MatchQuality,
} from '../../lib/takeout';
import { C, HIT } from '../../theme';

/**
 * "Google'dan içe aktar" (docs/ACCEPTANCE.md IMP, AC-MOB-31..35): Takeout CSV / Saved Places.json seç ->
 * dosya başına önizleme (liste adı, şehir, varsayılan kategori, yeni/mevcut liste) -> eşleştirme ve gözden geçirme
 * (`/search/places`, aynı anda en çok 2 istek, iptal) -> içe aktar ve özet.
 */

type Step = 'intro' | 'preview' | 'match' | 'done';

interface Group {
  key: string;
  fileName: string;
  kind: 'csv' | 'json';
  listName: string;
  city: string;
  /** null = "Otomatik": yer başına arama sonucunun kategorisi. */
  category: Category | null;
  target: 'new' | 'existing';
  existingId: Id | null;
  include: boolean;
  places: ImportPlace[];
  skipped: number;
  error?: string;
  /** Eşleştirmenin yapıldığı şehir (şehir değişirse yeniden eşleştirilir). */
  matchedCity?: string;
}

interface Match {
  state: 'pending' | 'searching' | 'done' | 'error' | 'coords';
  results: SearchResult[];
  /** Seçilen sonuç; null = konumsuz eklenecek. */
  chosen: number | null;
  quality: MatchQuality | null;
  /** Kullanıcı kendisi seçti ya da onayladı ("Kontrol et" kalkar). */
  confirmed: boolean;
}

type Filter = 'all' | 'check' | 'none';
type Row =
  | { type: 'header'; key: string; group: Group }
  | { type: 'place'; key: string; group: Group; index: number };

const CONCURRENCY = 2;
const mkey = (g: Group, i: number) => `${g.key}#${i}`;

function badgeOf(m: Match | undefined): { label: string; tone: 'ok' | 'check' | 'none' | 'wait' } {
  if (!m || m.state === 'pending') return { label: 'Bekliyor', tone: 'wait' };
  if (m.state === 'searching') return { label: 'Aranıyor…', tone: 'wait' };
  if (m.state === 'coords') return { label: 'Konumlu', tone: 'ok' };
  if (m.chosen === null) return { label: 'Konumsuz', tone: 'none' };
  if (m.quality?.needsCheck && !m.confirmed) return { label: 'Kontrol et', tone: 'check' };
  return { label: 'Eşleşti', tone: 'ok' };
}
const TONE = {
  ok: { bg: C.greenCard, fg: C.greenDark },
  check: { bg: C.orangeTint, fg: C.orangeText },
  none: { bg: C.input, fg: C.secondary },
  wait: { bg: C.input, fg: C.secondary },
};

const IMPORT_OFFLINE_MSG = 'Çevrimdışısın: içe aktarma için internet bağlantısı gerekli.';

export default function ImportScreen() {
  const [step, setStep] = useState<Step>('intro');
  const [groups, setGroups] = useState<Group[]>([]);
  const [lists, setLists] = useState<ListSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);

  // Eşleşmeler büyük listelerde (300+) her istekte tüm ekranı yeniden çizmesin diye ref'te tutulur;
  // ekran en çok ~8 kez/sn güncellenir.
  const matches = useRef(new Map<string, Match>());
  const [version, setVersion] = useState(0);
  const bumpTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bump = useCallback((now = false) => {
    if (now) { if (bumpTimer.current) clearTimeout(bumpTimer.current); bumpTimer.current = null; setVersion((v) => v + 1); return; }
    if (bumpTimer.current) return;
    bumpTimer.current = setTimeout(() => { bumpTimer.current = null; setVersion((v) => v + 1); }, 120);
  }, []);
  const [running, setRunning] = useState(false);
  const cancelled = useRef(false);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; cancelled.current = true; if (bumpTimer.current) clearTimeout(bumpTimer.current); }, []);

  const [filter, setFilter] = useState<Filter>('all');
  const [open, setOpen] = useState<string | null>(null);
  const [committing, setCommitting] = useState(false);
  const [result, setResult] = useState<{ summary: string; lists: { id: Id; title: string; city: string }[] } | null>(null);

  // Çevrimdışı oluşturulmuş (henüz eşitlenmemiş) listelere içe aktarılmaz.
  useEffect(() => { api.myLists().then((ls) => setLists(ls.filter((l) => !l.pending))).catch(() => setLists([])); }, []);
  // İçe aktarma arama ve kaydetme için sunucu gerektirir (AC-OFF-4).
  const { online } = useOffline();

  // ---------- Dosyalar ----------
  async function pick() {
    setError(null);
    setReading(true);
    try {
      const files = await pickTextFiles();
      if (!files) return;
      const next: Group[] = [];
      for (const f of files) {
        const parsed = parseTakeoutFile(f.name, f.text);
        const base = { fileName: f.name, kind: parsed.kind, skipped: parsed.skipped, error: parsed.error };
        const groupsOf = parsed.kind === 'json' && !parsed.error
          ? groupByCity(parsed.places).map((g) => ({ city: g.city?.name ?? '', places: g.places }))
          : [{ city: guessCity(parsed.listName)?.name ?? '', places: parsed.places }];
        groupsOf.forEach((g, gi) => {
          const same = lists.find((l) => foldName(l.title.trim()) === foldName(parsed.listName.trim())
            && (!g.city || foldName(l.city) === foldName(g.city)));
          next.push({
            ...base, key: `${Date.now().toString(36)}-${next.length}-${gi}`, listName: parsed.listName, city: g.city,
            category: guessCategory(parsed.listName, g.city), target: same ? 'existing' : 'new', existingId: same?.id ?? null,
            include: !parsed.error, places: g.places, skipped: gi === 0 ? parsed.skipped : 0,
          });
        });
      }
      setGroups((old) => [...old, ...next]);
      setStep('preview');
    } catch (e) {
      setError(`Dosya okunamadı: ${errMsg(e)}`);
    } finally {
      setReading(false);
    }
  }

  const update = (key: string, patch: Partial<Group>) => setGroups((gs) => gs.map((g) => (g.key === key ? { ...g, ...patch } : g)));
  const included = useMemo(() => groups.filter((g) => g.include), [groups]);

  function validate(): string | null {
    if (!included.length) return 'İçe aktarılacak dosya seçilmedi.';
    for (const g of included) {
      if (!g.listName.trim()) return `${g.fileName}: liste adı gerekli.`;
      if (g.target === 'new' && !g.city.trim()) return `${g.listName}: şehir gerekli.`;
      if (g.target === 'existing' && g.existingId === null) return `${g.listName}: eklenecek listeyi seç.`;
    }
    return null;
  }

  // ---------- Eşleştirme (AC-MOB-34) ----------
  const cityOf = (g: Group) => (g.target === 'existing' ? lists.find((l) => String(l.id) === String(g.existingId))?.city ?? g.city : g.city).trim();
  const centreOf = (g: Group) => { const d = findDestination(cityOf(g)); return d ? { lat: d.lat, lon: d.lon } : null; };

  async function matchOne(g: Group, i: number) {
    const p = g.places[i];
    const k = mkey(g, i);
    const centre = centreOf(g);
    matches.current.set(k, { state: 'searching', results: [], chosen: null, quality: null, confirmed: false });
    bump();
    try {
      const q = centre ? p.name : `${p.name} ${cityOf(g)}`.trim();
      const results = await api.searchPlaces(q.slice(0, 200), centre);
      const best = pickBestMatch(p.name, results, centre);
      matches.current.set(k, { state: 'done', results, chosen: best?.index ?? null, quality: best?.quality ?? null, confirmed: false });
    } catch {
      matches.current.set(k, { state: 'error', results: [], chosen: null, quality: null, confirmed: false });
    }
    bump();
  }

  async function runMatching(gs: Group[]) {
    const queue: [Group, number][] = [];
    for (const g of gs) {
      g.places.forEach((p, i) => {
        const k = mkey(g, i);
        const m = matches.current.get(k);
        if (p.lat !== null && p.lon !== null) { matches.current.set(k, { state: 'coords', results: [], chosen: null, quality: null, confirmed: true }); return; }
        if (!m || m.state === 'pending' || m.state === 'searching' || m.state === 'error') {
          matches.current.set(k, { state: 'pending', results: [], chosen: null, quality: null, confirmed: false });
          queue.push([g, i]);
        }
      });
    }
    bump(true);
    cancelled.current = false;
    setRunning(true);
    let next = 0;
    const worker = async () => {
      while (!cancelled.current && next < queue.length) {
        const [g, i] = queue[next++];
        await matchOne(g, i);
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    if (!mounted.current) return;
    setRunning(false);
    bump(true);
  }

  function startMatching() {
    if (!isOnline()) { setError(IMPORT_OFFLINE_MSG); return; }
    const v = validate();
    if (v) { setError(v); return; }
    setError(null);
    // Şehri değişen grupların eşleşmeleri sıfırlanır.
    const gs = included.map((g) => {
      const city = cityOf(g);
      if (g.matchedCity !== undefined && g.matchedCity !== city) g.places.forEach((_, i) => matches.current.delete(mkey(g, i)));
      return { ...g, matchedCity: city };
    });
    setGroups((all) => all.map((g) => gs.find((x) => x.key === g.key) ?? g));
    setStep('match');
    setFilter('all');
    void runMatching(gs);
  }

  function cancel() { cancelled.current = true; }

  function choose(g: Group, i: number, chosen: number | null) {
    const k = mkey(g, i);
    const m = matches.current.get(k);
    if (!m) return;
    const centre = centreOf(g);
    const r = chosen === null ? null : m.results[chosen];
    matches.current.set(k, { ...m, chosen, quality: r ? matchQuality(g.places[i].name, r, centre) : null, confirmed: true });
    setOpen(null);
    bump(true);
  }

  async function research(g: Group, i: number, q: string) {
    const k = mkey(g, i);
    const centre = centreOf(g);
    if (q.trim().length < 2) return;
    try {
      const results = await api.searchPlaces(q.trim(), centre);
      const best = pickBestMatch(q, results, centre);
      matches.current.set(k, { state: 'done', results, chosen: best?.index ?? null, quality: best ? matchQuality(g.places[i].name, results[best.index], centre) : null, confirmed: false });
    } catch {
      matches.current.set(k, { ...(matches.current.get(k) as Match), state: 'error', results: [] });
    }
    bump(true);
  }

  // ---------- Sayılar ----------
  const counts = useMemo(() => {
    let total = 0, searchable = 0, finished = 0, check = 0, none = 0;
    for (const g of included) {
      g.places.forEach((p, i) => {
        total++;
        const m = matches.current.get(mkey(g, i));
        if (m?.state !== 'coords') searchable++;
        if (m && (m.state === 'done' || m.state === 'error')) finished++;
        const b = badgeOf(m);
        if (b.tone === 'check') check++;
        if (b.tone === 'none') none++;
      });
    }
    return { total, searchable, finished, check, none };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [included, version]);

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    for (const g of included) {
      out.push({ type: 'header', key: `h-${g.key}`, group: g });
      g.places.forEach((_, i) => {
        // Açık (düzenlenen) satır süzgeçten çıksa da görünür kalır.
        if (filter !== 'all' && mkey(g, i) !== open) {
          const t = badgeOf(matches.current.get(mkey(g, i))).tone;
          if (filter === 'check' ? t !== 'check' : t !== 'none') return;
        }
        out.push({ type: 'place', key: mkey(g, i), group: g, index: i });
      });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [included, filter, version, open]);

  // ---------- İçe aktar (AC-MOB-35) ----------
  function buildItems(g: Group, city: string): ItemInput[] {
    return g.places.map((p, i) => {
      const m = matches.current.get(mkey(g, i));
      const r = m && m.state !== 'coords' && m.chosen !== null ? m.results[m.chosen] : null;
      const category: Category = g.category ?? r?.category ?? 'other';
      const it = toItemInput(city, r
        ? { name: r.name, lat: r.lat, lon: r.lon, category, note: p.note || null, provider: r.provider, providerId: r.providerId }
        : { name: p.name, lat: p.lat, lon: p.lon, category, note: p.note || null });
      if (p.url) it.details = { googleMapsUrl: p.url };
      return it;
    });
  }

  async function commit() {
    if (!isOnline()) { setError(IMPORT_OFFLINE_MSG); return; }
    setCommitting(true);
    setError(null);
    cancelled.current = true;
    const touched: { id: Id; title: string; city: string }[] = [];
    let added = 0, unlocated = 0, dupes = 0;
    const createChunks = async (title: string, city: string, chunks: ItemInput[][], startN: number) => {
      for (let c = 0; c < chunks.length; c++) {
        const t = startN + c > 1 ? `${title} (${startN + c})` : title;
        const { id } = await api.createList(city, t.slice(0, 200));
        await api.putItems(id, chunks[c]);
        touched.push({ id, title: t, city });
      }
    };
    try {
      for (const g of included) {
        if (g.target === 'existing' && g.existingId !== null) {
          const list = await api.getList(g.existingId);
          const existing = [...list.items].sort((a, b) => a.position - b.position).map((i) => toItemInput(list.city, i));
          const r = dedupeItems(existing, buildItems(g, list.city));
          dupes += r.dupes;
          const { first, overflow } = splitForCapacity(existing.length, r.items);
          if (first.length) await api.putItems(list.id, [...existing, ...first]);
          touched.push({ id: list.id, title: list.title, city: list.city });
          await createChunks(list.title, list.city, overflow, 2);
          for (const it of r.items) { added++; if (it.lat === undefined) unlocated++; }
        } else {
          const city = g.city.trim();
          const r = dedupeItems([], buildItems(g, city));
          dupes += r.dupes;
          const { first, overflow } = splitForCapacity(0, r.items);
          await createChunks(g.listName.trim(), city, [first, ...overflow], 1);
          for (const it of r.items) { added++; if (it.lat === undefined) unlocated++; }
        }
      }
      const unique = touched.filter((l, i) => touched.findIndex((x) => String(x.id) === String(l.id)) === i);
      setResult({ summary: importSummary(unique.length, added, unlocated, dupes), lists: unique });
      setStep('done');
    } catch (e) {
      setError(`İçe aktarma tamamlanamadı: ${errMsg(e)}${touched.length ? ` (${touched.length} liste kaydedildi)` : ''}`);
    } finally {
      setCommitting(false);
    }
  }

  // ---------- Görünüm ----------
  const header = (
    <NavHeader backLabel="Listelerim" fallback="/lists" />
  );

  if (step === 'intro') {
    return (
      <Screen>
        {header}
        <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 4, gap: 16, paddingBottom: 40 }} testID="import-intro">
          <LargeTitle>Google'dan içe aktar</LargeTitle>
          <Txt size={15} color={C.secondary} style={{ lineHeight: 21 }}>
            Google Haritalar'daki kayıtlı listelerini (her şehir ya da tür için bir liste) Voyage listelerine taşı.
          </Txt>
          <View testID="import-howto" style={{ backgroundColor: C.greenSoft, borderRadius: 20, padding: 16, gap: 12, borderWidth: 1, borderColor: C.border }}>
            <Txt weight="bold" size={16} color={C.greenDark}>Takeout nasıl alınır?</Txt>
            {[
              <>
                <Txt size={14} color={C.text}>Tarayıcıda </Txt>
                <Txt size={14} weight="bold" color={C.green} onPress={() => openUrl('https://takeout.google.com/')} testID="import-takeout-link" accessibilityRole="link">takeout.google.com</Txt>
                <Txt size={14} color={C.text}> adresini aç ve "Tümünün seçimini kaldır"a dokun.</Txt>
              </>,
              <Txt size={14}>"<Txt size={14} weight="bold">Kaydedilenler</Txt>" (listelerin) ve/veya "<Txt size={14} weight="bold">Haritalar (yerleriniz)</Txt>" (yıldızlı yerler) seç.</Txt>,
              <Txt size={14}>"Dışa aktarma oluştur"a dokun; hazır olunca gelen e-postadaki .zip dosyasını indir.</Txt>,
              <Txt size={14}>Dosyalar uygulamasında zip'e dokunup aç: her liste bir <Txt size={14} weight="bold">.csv</Txt>, yıldızlı yerler <Txt size={14} weight="bold">Saved Places.json</Txt>.</Txt>,
              <Txt size={14}>Aşağıdan bu dosyaları seç (birden çok seçebilirsin).</Txt>,
            ].map((body, i) => (
              <View key={i} style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
                <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: C.green, alignItems: 'center', justifyContent: 'center' }}>
                  <Txt weight="bold" size={13} color={C.white}>{i + 1}</Txt>
                </View>
                <Txt size={14} style={{ flex: 1, lineHeight: 20 }}>{body}</Txt>
              </View>
            ))}
          </View>
          <InfoMsg message="Kaydedilenler dosyalarında koordinat yoktur: yerler listenin şehrinde aranıp eşleştirilir; sonuçları içe aktarmadan önce gözden geçirirsin." />
          {online ? null : <View testID="import-offline"><ErrorMsg message={IMPORT_OFFLINE_MSG} /></View>}
          <ErrorMsg message={error} />
          <Btn title={reading ? 'Okunuyor…' : 'Dosya seç'} icon="plus" onPress={pick} disabled={reading || !online} testID="import-pick" />
        </ScrollView>
      </Screen>
    );
  }

  if (step === 'preview') {
    return (
      <Screen>
        {header}
        <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 4, gap: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled" testID="import-preview">
          <LargeTitle>Önizleme</LargeTitle>
          <Txt size={14} color={C.secondary}>{`${groups.length} liste · ${groups.reduce((n, g) => n + g.places.length, 0)} yer`}</Txt>
          {groups.map((g) => (
            <PreviewCard key={g.key} group={g} lists={lists} onChange={(patch) => update(g.key, patch)} />
          ))}
          <ErrorMsg message={error} />
          <Btn title="Dosya ekle" variant="outline" icon="plus" onPress={pick} disabled={reading} testID="import-pick-more" />
          <Btn title={`Eşleştir ve gözden geçir (${included.reduce((n, g) => n + g.places.length, 0)} yer)`} icon="search" onPress={startMatching} disabled={!included.length} testID="import-match-start" />
        </ScrollView>
      </Screen>
    );
  }

  if (step === 'done' && result) {
    return (
      <Screen>
        <NavHeader backLabel="Listelerim" fallback="/lists" />
        <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 4, gap: 16 }} testID="import-done">
          <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: C.greenCard, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="check" size={34} color={C.green} strokeWidth={2.6} />
          </View>
          <LargeTitle>İçe aktarıldı</LargeTitle>
          <Txt weight="bold" size={18} color={C.greenDark} testID="import-summary">{result.summary}</Txt>
          <View style={{ gap: 10 }}>
            {result.lists.map((l) => (
              <Pressable
                key={String(l.id)}
                testID="import-done-list"
                accessibilityRole="button"
                onPress={() => router.push(`/lists/${l.id}`)}
                style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 16, borderWidth: 1.5, borderColor: C.border, backgroundColor: pressed ? C.greenSoft : C.white })}
              >
                <View style={{ flex: 1 }}>
                  <Txt weight="bold" size={17} color={C.greenDark}>{l.city}</Txt>
                  <Txt size={13} color={C.secondary}>{l.title}</Txt>
                </View>
                <Icon name="chevron" size={20} color={C.greenDark} />
              </Pressable>
            ))}
          </View>
          <Btn title="Listelerime dön" variant="green" onPress={() => router.replace('/lists')} testID="import-finish" />
        </ScrollView>
      </Screen>
    );
  }

  // step === 'match'
  const pct = counts.searchable ? Math.round((counts.finished / counts.searchable) * 100) : 100;
  const pendingLeft = counts.searchable - counts.finished;
  return (
    <Screen>
      <NavHeader backLabel="Listelerim" fallback="/lists" />
      <View style={{ paddingHorizontal: 20, gap: 10, paddingBottom: 8 }}>
        <Txt weight="extrabold" size={28} style={{ letterSpacing: -0.4 }} accessibilityRole="header">Gözden geçir</Txt>
        <View testID="import-progress" accessibilityRole="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} {...webData({ done: String(!running) })} style={{ gap: 6 }}>
          <View style={{ height: 8, borderRadius: 4, backgroundColor: C.input, overflow: 'hidden' }}>
            <View style={{ width: `${pct}%`, height: 8, borderRadius: 4, backgroundColor: C.green }} />
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 36 }}>
            <Txt size={13} color={C.secondary} testID="import-progress-text">
              {running ? `Eşleştiriliyor… ${counts.finished} / ${counts.searchable}` : pendingLeft > 0 ? `Durduruldu · ${counts.finished} / ${counts.searchable}` : `Eşleştirme bitti · ${counts.total} yer`}
            </Txt>
            {running ? (
              <Btn title="İptal" small variant="danger" onPress={cancel} testID="import-cancel" />
            ) : pendingLeft > 0 ? (
              <Btn title="Devam et" small variant="soft" onPress={() => void runMatching(included)} testID="import-resume" />
            ) : null}
          </View>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }} style={{ flexGrow: 0 }}>
          {([['all', `Hepsi (${counts.total})`], ['check', `Kontrol et (${counts.check})`], ['none', `Konumsuz (${counts.none})`]] as [Filter, string][]).map(([k, label]) => {
            const on = filter === k;
            return (
              <Pressable key={k} testID={`import-filter-${k}`} accessibilityRole="button" aria-selected={on} onPress={() => setFilter(k)}
                style={{ minHeight: 40, paddingHorizontal: 14, borderRadius: 20, justifyContent: 'center', backgroundColor: on ? C.green : k === 'check' ? C.orangeTint : C.greenCard }}>
                <Txt weight="bold" size={13} color={on ? C.white : k === 'check' ? C.orangeText : C.greenDark}>{label}</Txt>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
      <FlatList
        testID="import-rows"
        data={rows}
        keyExtractor={(r) => r.key}
        extraData={`${version}-${open}`}
        initialNumToRender={30}
        maxToRenderPerBatch={30}
        windowSize={11}
        style={{ flex: 1 }}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24 }}
        renderItem={({ item }) => item.type === 'header' ? (
          <View testID="import-group-header" style={{ paddingTop: 16, paddingBottom: 6, flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
            <H2>{cityOf(item.group) || 'Şehir yok'}</H2>
            <Txt size={13} color={C.secondary} numberOfLines={1} style={{ flex: 1 }}>{`${item.group.target === 'existing' ? lists.find((l) => String(l.id) === String(item.group.existingId))?.title ?? item.group.listName : item.group.listName} · ${item.group.places.length} yer`}</Txt>
          </View>
        ) : (
          <PlaceRow
            group={item.group}
            place={item.group.places[item.index]}
            match={matches.current.get(item.key)}
            open={open === item.key}
            onToggle={() => setOpen(open === item.key ? null : item.key)}
            onChoose={(c) => choose(item.group, item.index, c)}
            onResearch={(q) => research(item.group, item.index, q)}
          />
        )}
      />
      <View style={{ paddingHorizontal: 20, paddingTop: 10, paddingBottom: 16, borderTopWidth: 1, borderTopColor: C.divider, gap: 8, backgroundColor: C.white }}>
        <ErrorMsg message={error} />
        {!running && counts.check > 0 ? (
          <Txt size={12} color={C.orangeText} weight="semibold" testID="import-check-hint">
            {`${counts.check} yer "Kontrol et" durumunda: dokunup düzeltebilir ya da olduğu gibi ekleyebilirsin.`}
          </Txt>
        ) : null}
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Btn title="Geri" variant="outline" onPress={() => { cancel(); setStep('preview'); }} disabled={committing} testID="import-back" style={{ flex: 1 }} />
          <Btn title={committing ? 'Kaydediliyor…' : `İçe aktar (${counts.total})`} icon="check" onPress={commit} disabled={committing || running} testID="import-commit" style={{ flex: 2 }} />
        </View>
      </View>
    </Screen>
  );
}

// ---------- Önizleme kartı (AC-MOB-33) ----------
function PreviewCard({ group: g, lists, onChange }: { group: Group; lists: ListSummary[]; onChange: (p: Partial<Group>) => void }) {
  const located = g.places.filter((p) => p.lat !== null).length;
  return (
    <View testID="import-file" {...webData({ file: g.fileName })} style={{ borderRadius: 20, borderWidth: 1.5, borderColor: g.include ? C.border : C.divider, backgroundColor: g.include ? C.white : C.rowBg, padding: 16, gap: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: C.greenCard, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={g.kind === 'json' ? 'pin' : 'listPin'} size={20} color={C.greenDark} strokeWidth={2.2} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Txt weight="bold" size={15} numberOfLines={1} testID="import-file-name">{g.fileName}</Txt>
          <Txt size={12} color={C.secondary} testID="import-file-count">
            {`${g.places.length} yer`}{located ? ` · ${located} konumlu` : ''}{g.skipped ? ` · ${g.skipped} satır atlandı` : ''}
          </Txt>
        </View>
        {!g.error ? (
          <Pressable testID="import-include" accessibilityRole="checkbox" aria-checked={g.include} accessibilityLabel={`${g.listName} içe aktarılsın`} onPress={() => onChange({ include: !g.include })}
            style={{ width: HIT, height: HIT, alignItems: 'center', justifyContent: 'center' }}>
            <View style={{ width: 26, height: 26, borderRadius: 8, borderWidth: 2, borderColor: C.green, backgroundColor: g.include ? C.green : C.white, alignItems: 'center', justifyContent: 'center' }}>
              {g.include ? <Icon name="check" size={16} color={C.white} strokeWidth={3} /> : null}
            </View>
          </Pressable>
        ) : null}
      </View>
      {g.error ? <ErrorMsg message={g.error} /> : null}
      {g.include ? (
        <>
          <Field label="Liste adı" value={g.listName} onChangeText={(t) => onChange({ listName: t })} testID="import-list-name" />
          <DestinationField value={g.city} onChange={(t) => onChange({ city: t })} testID="import-city" />
          <View style={{ gap: 6 }}>
            <Txt weight="semibold" size={13} color={C.secondary}>Varsayılan kategori</Txt>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }} testID="import-cats">
              <Pressable testID="import-cat-auto" accessibilityRole="radio" aria-checked={g.category === null} onPress={() => onChange({ category: null })}
                style={{ minHeight: 40, paddingHorizontal: 12, borderRadius: 20, justifyContent: 'center', backgroundColor: g.category === null ? C.green : C.greenCard }}>
                <Txt weight="bold" size={13} color={g.category === null ? C.white : C.greenDark}>Otomatik</Txt>
              </Pressable>
              {CATEGORIES.map((c) => {
                const on = g.category === c.key;
                return (
                  <Pressable key={c.key} testID={`import-cat-${c.key}`} accessibilityRole="radio" aria-checked={on} accessibilityLabel={c.title} onPress={() => onChange({ category: c.key })}
                    style={{ minHeight: 40, paddingLeft: 10, paddingRight: 12, borderRadius: 20, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: on ? c.color : c.tint }}>
                    <CatGlyph category={c.key} size={15} color={on ? C.white : c.color} />
                    <Txt weight="bold" size={13} color={on ? C.white : c.color}>{c.title}</Txt>
                  </Pressable>
                );
              })}
            </ScrollView>
            <Txt size={12} color={C.secondary}>{g.category === null ? 'Her yerin kategorisi arama sonucundan gelir.' : `Tüm yerler "${categoryInfo(g.category).title}" olarak eklenir.`}</Txt>
          </View>
          <View style={{ flexDirection: 'row', gap: 8 }} accessibilityRole="radiogroup">
            {([['new', 'Yeni liste'], ['existing', 'Mevcut listeye ekle']] as const).map(([k, label]) => {
              const on = g.target === k;
              return (
                <Pressable key={k} testID={`import-target-${k}`} accessibilityRole="radio" aria-checked={on} disabled={k === 'existing' && !lists.length}
                  onPress={() => onChange({ target: k, existingId: k === 'existing' ? g.existingId ?? lists[0]?.id ?? null : g.existingId })}
                  style={{ flex: 1, minHeight: HIT, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? C.green : C.input, opacity: k === 'existing' && !lists.length ? 0.5 : 1 }}>
                  <Txt weight="bold" size={13} color={on ? C.white : C.secondary}>{label}</Txt>
                </Pressable>
              );
            })}
          </View>
          {g.target === 'existing' ? (
            <View style={{ gap: 6 }}>
              {lists.map((l) => {
                const on = String(l.id) === String(g.existingId);
                return (
                  <Pressable key={String(l.id)} testID="import-existing-option" accessibilityRole="radio" aria-checked={on} onPress={() => onChange({ existingId: l.id })}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: HIT, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1.5, borderColor: on ? C.green : C.border, backgroundColor: on ? C.greenSoft : C.white }}>
                    <Txt weight="bold" size={14} color={C.greenDark}>{l.city}</Txt>
                    <Txt size={13} color={C.secondary} numberOfLines={1} style={{ flex: 1 }}>{`${l.title} · ${l.itemCount} yer`}</Txt>
                    {on ? <Icon name="check" size={18} color={C.green} strokeWidth={2.6} /> : null}
                  </Pressable>
                );
              })}
            </View>
          ) : null}
        </>
      ) : null}
    </View>
  );
}

// ---------- Eşleşme satırı (AC-MOB-34) ----------
function PlaceRow({ group, place, match, open, onToggle, onChoose, onResearch }: {
  group: Group; place: ImportPlace; match: Match | undefined; open: boolean;
  onToggle: () => void; onChoose: (c: number | null) => void; onResearch: (q: string) => void;
}) {
  const badge = badgeOf(match);
  const tone = TONE[badge.tone];
  const r = match && match.chosen !== null ? match.results[match.chosen] : null;
  const category: Category = group.category ?? r?.category ?? 'other';
  const [q, setQ] = useState(place.name);
  const canPick = !!match && (match.state === 'done' || match.state === 'error');
  let line: string;
  if (match?.state === 'coords') line = place.address || 'Koordinatlı yer (aramasız eklenir)';
  else if (r) line = [r.name, r.address].filter(Boolean).join(' · ');
  else if (match?.state === 'error') line = 'Arama yapılamadı · konumsuz eklenecek';
  else if (match?.state === 'done') line = match.results.length ? 'Konumsuz eklenecek' : 'Bulunamadı · konumsuz eklenecek';
  else line = 'Eşleşme bekleniyor';
  const why = r && match?.quality && badge.tone === 'check'
    ? [match.quality.far && match.quality.distanceKm !== null ? `şehir merkezine ${Math.round(match.quality.distanceKm)} km` : null, match.quality.lowSimilarity ? 'ad farklı' : null].filter(Boolean).join(' · ')
    : '';
  return (
    <View testID="import-row" {...webData({ status: badge.tone, name: place.name })} style={{ borderBottomWidth: 1, borderBottomColor: C.divider, paddingVertical: 10 }}>
      <Pressable onPress={canPick ? onToggle : undefined} accessibilityRole="button" aria-expanded={open} accessibilityLabel={`${place.name}: ${badge.label}`}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: HIT }}>
        <CategoryIcon category={category} size={40} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Txt weight="bold" size={15} numberOfLines={1} testID="import-row-name">{place.name}</Txt>
          <Txt size={12} color={r ? C.text : C.secondary} numberOfLines={2} testID="import-row-match">{r ? '→ ' : ''}{line}</Txt>
          {why ? <Txt size={12} weight="semibold" color={C.orangeText} testID="import-row-why">{why}</Txt> : null}
        </View>
        <View testID="import-row-badge" style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12, backgroundColor: tone.bg }}>
          <Txt weight="bold" size={12} color={tone.fg}>{badge.label}</Txt>
        </View>
      </Pressable>
      {open && match ? (
        <View testID="import-alts" style={{ marginTop: 8, marginLeft: 52, gap: 6 }}>
          {match.results.map((alt, i) => {
            const on = match.chosen === i;
            return (
              <Pressable key={`${alt.provider}:${alt.providerId}`} testID="import-alt" accessibilityRole="radio" aria-checked={on} onPress={() => onChoose(i)}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: HIT, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12, borderWidth: 1.5, borderColor: on ? C.green : C.border, backgroundColor: on ? C.greenSoft : C.white }}>
                <CatGlyph category={alt.category} size={16} color={categoryInfo(alt.category).color} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Txt weight="bold" size={14} numberOfLines={1} testID="import-alt-name">{alt.name}</Txt>
                  <Txt size={12} color={C.secondary} numberOfLines={1}>{alt.address}</Txt>
                </View>
                {on ? <Icon name="check" size={18} color={C.green} strokeWidth={2.6} /> : null}
              </Pressable>
            );
          })}
          <Pressable testID="import-alt-none" accessibilityRole="radio" aria-checked={match.chosen === null} onPress={() => onChoose(null)}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: HIT, paddingHorizontal: 10, borderRadius: 12, borderWidth: 1.5, borderColor: match.chosen === null ? C.green : C.border, borderStyle: 'dashed' }}>
            <Icon name="close" size={16} color={C.secondary} />
            <Txt weight="bold" size={14} color={C.secondary}>Konumsuz ekle</Txt>
          </Pressable>
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
            <TextInput value={q} onChangeText={setQ} placeholder="Başka bir adla ara" placeholderTextColor={C.secondary} testID="import-research-input"
              onSubmitEditing={() => onResearch(q)} accessibilityLabel="Başka bir adla ara"
              style={{ flex: 1, minHeight: HIT, borderRadius: 12, backgroundColor: C.input, paddingHorizontal: 12, fontSize: 14, color: C.text }} />
            <Btn title="Ara" small icon="search" variant="soft" onPress={() => onResearch(q)} testID="import-research" />
          </View>
        </View>
      ) : null}
    </View>
  );
}
