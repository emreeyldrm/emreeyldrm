import { useCallback, useState } from 'react';
import { Pressable, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { CHAT_OFFLINE_MSG, FriendPickerSheet } from '../../../components/SendToFriend';
import { Avatar, Empty, ErrorMsg, IconBtn, LargeTitle, Screen, Scroll, Txt } from '../../../components/ui';
import { errMsg, isNetworkError, type SocialUser } from '../../../lib/api';
import { useAuth } from '../../../lib/auth';
import { badgeText, chatApi, LIST_POLL_MS, listTime, previewText, setUnreadFromList, type Conversation } from '../../../lib/chat';
import { useOffline } from '../../../lib/offlineStore';
import { C, HIT } from '../../../theme';

function ConversationRow({ c, me }: { c: Conversation; me: string | number | undefined }) {
  const handle = c.other.handle ?? 'kullanıcı';
  const unread = c.unread > 0;
  return (
    <Pressable
      testID="conversation-row"
      accessibilityRole="button"
      accessibilityLabel={`@${handle} ile sohbet${unread ? `, ${c.unread} okunmamış` : ''}`}
      onPress={() => router.push(`/chat/${c.id}`)}
      style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: HIT + 20, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.divider }, pressed ? { backgroundColor: C.greenSoft } : null]}
    >
      <Avatar name={handle} size={46} />
      <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Txt weight="extrabold" size={16} numberOfLines={1} style={{ flex: 1 }} testID="conversation-handle">@{handle}</Txt>
          {c.lastMessage ? <Txt size={12} color={unread ? C.orangeText : C.secondary} weight={unread ? 'bold' : 'regular'} testID="conversation-time">{listTime(c.lastMessage.createdAt)}</Txt> : null}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Txt size={14} numberOfLines={1} color={unread ? C.text : C.secondary} weight={unread ? 'semibold' : 'regular'} style={{ flex: 1 }} testID="conversation-preview">{previewText(c, me)}</Txt>
          {unread ? (
            <View testID="conversation-unread" accessibilityLabel={`${c.unread} okunmamış`} style={{ minWidth: 22, height: 22, borderRadius: 11, backgroundColor: C.orange, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center' }}>
              <Txt weight="extrabold" size={12} color={C.orangeOn}>{badgeText(c.unread)}</Txt>
            </View>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

/**
 * Mesajlar sekmesi (AC-MOB-40): sohbetler (karşı taraf, son mesaj, saat, okunmamış rozeti), son etkinliğe göre sıralı;
 * "Yeni sohbet" arkadaşlar arasından. Açıkken LIST_POLL_MS'de bir yenilenir; çevrimdışı son görülen liste gösterilir.
 */
export default function Messages() {
  const { user } = useAuth();
  const { online } = useOffline();
  const [list, setList] = useState<Conversation[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picker, setPicker] = useState(false);
  const [opening, setOpening] = useState(false);
  const [pickError, setPickError] = useState<string | null>(null);

  const load = useCallback(() => {
    chatApi.conversations()
      .then((l) => { setList(l); setError(null); if (online) setUnreadFromList(l); })
      .catch((e) => { if (!isNetworkError(e)) setError(errMsg(e)); else setList((cur) => cur ?? []); });
  }, [online]);

  useFocusEffect(useCallback(() => {
    load();
    const t = setInterval(load, LIST_POLL_MS);
    return () => clearInterval(t);
  }, [load]));

  async function start(u: SocialUser) {
    setOpening(true); setPickError(null);
    try {
      const { id } = await chatApi.open(u.handle);
      setPicker(false);
      router.push(`/chat/${id}`);
    } catch (e) { setPickError(errMsg(e)); } finally { setOpening(false); }
  }

  return (
    <Screen>
      <Scroll contentStyle={{ paddingTop: 24, gap: 12 }} testID="messages-screen">
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <LargeTitle>Mesajlar</LargeTitle>
          <IconBtn
            icon="plus" label="Yeni sohbet" bg={online ? C.orange : C.muted} color={C.orangeOn} size={46}
            onPress={() => { setPickError(null); setPicker(true); }} testID="chat-new"
          />
        </View>
        {online ? null : <View testID="chat-offline"><ErrorMsg message={CHAT_OFFLINE_MSG} /></View>}
        <ErrorMsg message={error} />
        {list === null ? null : list.length === 0 ? (
          <View testID="conversations-empty" style={{ backgroundColor: C.greenCard, borderRadius: 20, padding: 20, gap: 8 }}>
            <Txt weight="extrabold" size={17} color={C.greenDark}>Henüz sohbet yok</Txt>
            <Txt size={14} color={C.secondary}>Arkadaşlarına yaz, yer ve liste gönder. "+" ile yeni sohbet başlat.</Txt>
          </View>
        ) : (
          <View accessibilityRole="list" testID="conversation-list">
            {list.map((c) => <ConversationRow key={c.id} c={c} me={user?.id} />)}
          </View>
        )}
        {list && list.length ? <Empty text="Mesajlar kısa aralıklarla yenilenir; bildirimler henüz yok." /> : null}
      </Scroll>
      <FriendPickerSheet
        visible={picker}
        title="Yeni sohbet"
        onPick={start}
        onClose={() => setPicker(false)}
        busy={opening}
        error={pickError}
        testID="new-chat-sheet"
      />
    </Screen>
  );
}
