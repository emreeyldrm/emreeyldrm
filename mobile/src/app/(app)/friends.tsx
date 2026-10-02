import { useCallback, useState } from 'react';
import { View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { NavHeader } from '../../components/Header';
import { Avatar, Btn, Empty, ErrorMsg, Field, H2, IconBtn, LargeTitle, Pill, Screen, Scroll, Txt } from '../../components/ui';
import { api, errMsg, type SocialUser } from '../../lib/api';
import { C } from '../../theme';

function UserRow({ u, onFollow, onUnfollow }: { u: SocialUser; onFollow: () => void; onUnfollow: () => void }) {
  const friend = u.following && u.followsMe;
  return (
    <View testID="user-row" style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.divider }}>
      <Avatar name={u.handle} />
      <View style={{ flex: 1, gap: 4 }}>
        <Txt weight="bold" size={15}>@{u.handle}</Txt>
        <View style={{ flexDirection: 'row', gap: 6 }}>
          {friend ? <Pill testID="friend-badge" text="Arkadaş" bg={C.greenCard} color={C.greenDark} icon="people" /> : null}
          {!friend && u.followsMe ? <Pill text="Seni takip ediyor" bg={C.input} color={C.secondary} /> : null}
        </View>
      </View>
      {u.following ? (
        <Btn title="Takibi bırak" variant="outline" small onPress={onUnfollow} testID="unfollow" accessibilityLabel={`@${u.handle} takibi bırak`} />
      ) : (
        <Btn title="Takip et" small onPress={onFollow} testID="follow" accessibilityLabel={`@${u.handle} takip et`} />
      )}
    </View>
  );
}

/** Arkadaşlar: search by handle, follow/unfollow, "Arkadaş" badge when mutual (AC-MOB-7). */
export default function Friends() {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<SocialUser[] | null>(null);
  const [following, setFollowing] = useState<SocialUser[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [lastQ, setLastQ] = useState('');

  const loadFollowing = useCallback(() => { api.following().then(setFollowing).catch((e) => setError(errMsg(e))); }, []);
  useFocusEffect(loadFollowing);

  async function search(term = q) {
    setError(null);
    const t = term.trim().toLowerCase();
    if (t.length < 2) { setError('En az 2 karakter yaz.'); return; }
    setLastQ(t);
    try { setResults(await api.searchUsers(t)); } catch (e) { setError(errMsg(e)); }
  }

  async function act(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
      loadFollowing();
      if (lastQ) setResults(await api.searchUsers(lastQ));
    } catch (e) { setError(errMsg(e)); }
  }

  return (
    <Screen>
      <NavHeader backLabel="Profil" fallback="/profile" />
      <Scroll contentStyle={{ paddingTop: 4, gap: 16 }}>
        <LargeTitle>Arkadaşlar</LargeTitle>
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-end' }}>
          <Field containerStyle={{ flex: 1 }} value={q} onChangeText={setQ} placeholder="Kullanıcı adı ara" accessibilityLabel="Kullanıcı ara" autoCapitalize="none" autoCorrect={false} testID="user-search" onSubmitEditing={() => search()} returnKeyType="search" />
          <IconBtn icon="search" label="Ara" bg={C.green} color={C.white} round={false} size={48} onPress={() => search()} testID="user-search-submit" />
        </View>
        <ErrorMsg message={error} />
        {results ? (
          <View testID="search-results">
            <H2>Sonuçlar</H2>
            {results.length === 0 ? <Empty text="Kimse bulunamadı." testID="search-empty" /> : null}
            {results.map((u) => (
              <UserRow key={String(u.id)} u={u} onFollow={() => act(() => api.follow(u.id))} onUnfollow={() => act(() => api.unfollow(u.id))} />
            ))}
          </View>
        ) : null}
        <View testID="following-list">
          <H2>Takip ettiklerin</H2>
          {following.length === 0 ? <Empty text="Henüz kimseyi takip etmiyorsun." testID="following-empty" /> : null}
          {following.map((u) => (
            <UserRow key={String(u.id)} u={u} onFollow={() => act(() => api.follow(u.id))} onUnfollow={() => act(() => api.unfollow(u.id))} />
          ))}
        </View>
        <Txt size={12} color={C.secondary}>Karşılıklı takip edince "Arkadaş" olursunuz; "Arkadaşlar" yorumlarını birbirinizin görebilirsiniz.</Txt>
      </Scroll>
    </Screen>
  );
}
