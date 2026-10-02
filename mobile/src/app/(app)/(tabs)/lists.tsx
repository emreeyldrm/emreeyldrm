import { useCallback, useState } from 'react';
import { Pressable, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Btn, Empty, ErrorMsg, Field, IconBtn, LargeTitle, Pill, Screen, Scroll, Txt } from '../../../components/ui';
import { DestinationField } from '../../../components/DestinationField';
import { api, errMsg, type ListSummary } from '../../../lib/api';
import { useAuth } from '../../../lib/auth';
import { C } from '../../../theme';

/** "Listelerim" (Main.dc.html): city cards, orange + to create a list (AC-MOB-3). */
export default function Lists() {
  const { user } = useAuth();
  const [lists, setLists] = useState<ListSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [city, setCity] = useState('');
  const [title, setTitle] = useState('');

  const load = useCallback(() => {
    api.myLists().then(setLists).catch((e) => setError(errMsg(e)));
  }, []);
  useFocusEffect(load);

  async function create() {
    setError(null);
    if (!city.trim() || !title.trim()) { setError('Şehir ve liste adı gerekli.'); return; }
    try {
      await api.createList(city.trim(), title.trim());
      setCity(''); setTitle(''); setCreating(false);
      load();
    } catch (e) { setError(errMsg(e)); }
  }

  const total = lists?.reduce((n, l) => n + l.itemCount, 0) ?? 0;
  const showForm = creating || (lists !== null && lists.length === 0);

  return (
    <Screen>
      <Scroll contentStyle={{ gap: 20, paddingTop: 24 }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' }}>
          <View style={{ flex: 1 }}>
            <LargeTitle>Listelerim</LargeTitle>
            <Txt size={14} color={C.secondary} style={{ marginTop: 6 }}>
              {lists ? `${lists.length} liste · ${total} kayıtlı yer` : 'Yükleniyor…'}
            </Txt>
            <Txt size={12} color={C.secondary} testID="current-handle">@{user?.handle}</Txt>
          </View>
          <IconBtn icon="plus" label="Liste oluştur" bg={C.orange} color={C.orangeOn} size={48} onPress={() => setCreating((v) => !v)} testID="list-new" />
        </View>

        {showForm ? (
          <View testID="list-create-form" style={{ backgroundColor: C.greenCard, borderRadius: 20, padding: 16, gap: 12 }}>
            <Txt weight="bold" size={17} color={C.greenDark}>Yeni liste</Txt>
            <DestinationField value={city} onChange={setCity} />
            <Field label="Liste adı" value={title} onChangeText={setTitle} placeholder="Örn. Yeme-içme rotası" testID="list-title" onSubmitEditing={create} />
            <Btn title="Oluştur" onPress={create} testID="list-create" />
          </View>
        ) : null}
        <ErrorMsg message={error} />

        {lists && lists.length === 0 ? <Empty text="Henüz listen yok. İlk şehrini ekle." testID="lists-empty" /> : null}
        <View style={{ gap: 14 }}>
          {lists?.map((l, i) => {
            const featured = i === 0;
            return (
              <Pressable
                key={String(l.id)}
                testID="list-card"
                accessibilityRole="button"
                accessibilityLabel={`${l.city}, ${l.title}, ${l.itemCount} yer`}
                onPress={() => router.push(`/lists/${l.id}`)}
                style={({ pressed }) => [
                  { borderRadius: 20, padding: 18, gap: 10, opacity: pressed ? 0.85 : 1 },
                  featured ? { backgroundColor: C.greenCard } : { backgroundColor: C.white, borderWidth: 1.5, borderColor: C.border },
                ]}
              >
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <Txt weight="bold" size={22} color={C.greenDark}>{l.city}</Txt>
                    <Txt size={13} color={C.secondary} style={{ marginTop: 2 }}>{l.title}</Txt>
                  </View>
                  <Pill text={`${l.itemCount} yer`} bg={featured ? C.white : C.greenCard} />
                </View>
                <Pill
                  text={l.visibility === 'public' ? 'Herkese açık' : 'Özel'}
                  icon={l.visibility === 'public' ? 'globe' : 'lock'}
                  bg={featured ? C.white : C.input}
                  color={l.visibility === 'public' ? C.green : C.secondary}
                />
              </Pressable>
            );
          })}
        </View>
      </Scroll>
    </Screen>
  );
}
