import { useCallback, useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, TextInput, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { goBack } from '../../../components/Header';
import { CatGlyph, Icon } from '../../../components/Icon';
import { CHAT_OFFLINE_MSG } from '../../../components/SendToFriend';
import { Avatar, ErrorMsg, IconBtn, Loading, Txt, webData } from '../../../components/ui';
import { api, errMsg, isNetworkError, isPendingId, type ListSummary } from '../../../lib/api';
import { useAuth } from '../../../lib/auth';
import { categoryInfo } from '../../../lib/categories';
import {
  attachmentHref, bubbleTime, CHAT_POLL_MS, chatApi, dayLabel, lastMessageId, MAX_BODY, mergeMessages, needsDaySeparator,
  refreshUnread, type ChatAttachment, type ChatMessage, type ConversationInfo,
} from '../../../lib/chat';
import { useOffline } from '../../../lib/offlineStore';
import { C, F, HIT } from '../../../theme';

/** Ek kartı (Chat.dc.html): liste yeşil başlıklı, yer kategori simgeli; dokununca ilgili ekran açılır. */
function AttachmentCard({ a, mine }: { a: ChatAttachment; mine: boolean }) {
  const open = () => router.push(attachmentHref(a) as never);
  const align = { alignSelf: mine ? 'flex-end' : 'flex-start' } as const;
  const frame = { width: 270, maxWidth: '86%', borderWidth: 1.5, borderColor: C.border, borderRadius: 18, overflow: 'hidden', backgroundColor: C.white } as const;
  if (a.type === 'list') {
    const hidden = a.subtitle === null;
    return (
      <Pressable testID="chat-attachment" {...webData({ type: 'list', id: String(a.id) })} accessibilityRole="link" accessibilityLabel={`Liste: ${a.title}. Listeyi aç`} onPress={open} style={[frame, align]}>
        <View style={{ backgroundColor: C.greenCard, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: C.white, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name={hidden ? 'lock' : 'listPin'} size={20} color={C.green} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Txt weight="extrabold" size={15} numberOfLines={2} testID="chat-attachment-title">{a.title}</Txt>
            {a.subtitle ? <Txt size={12} color={C.secondary} testID="chat-attachment-subtitle">{a.subtitle}</Txt> : null}
          </View>
        </View>
        <View style={{ paddingHorizontal: 14, paddingVertical: 10, flexDirection: 'row', justifyContent: 'space-between' }}>
          <Txt weight="bold" size={13} color={C.orangeText}>Listeyi aç</Txt>
          {hidden ? <Txt weight="semibold" size={13} color={C.secondary}>Görme iznin yok</Txt> : null}
        </View>
      </Pressable>
    );
  }
  const cat = categoryInfo(a.category ?? 'other');
  return (
    <Pressable testID="chat-attachment" {...webData({ type: 'place', id: String(a.id) })} accessibilityRole="link" accessibilityLabel={`Yer: ${a.title}. Yeri aç`} onPress={open} style={[frame, align]}>
      <View style={{ paddingHorizontal: 14, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: cat.tint, alignItems: 'center', justifyContent: 'center' }}>
          <CatGlyph category={cat.key} size={20} color={cat.color} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Txt weight="extrabold" size={15} numberOfLines={2} testID="chat-attachment-title">{a.title}</Txt>
          <Txt size={12} color={C.secondary} testID="chat-attachment-subtitle">{[cat.title, a.subtitle].filter(Boolean).join(' · ')}</Txt>
        </View>
        <Icon name="chevron" size={18} color={C.secondary} />
      </View>
    </Pressable>
  );
}

function Bubble({ m, mine }: { m: ChatMessage; mine: boolean }) {
  return (
    <View testID="chat-message" {...webData({ mine: mine ? '1' : '0' })} style={{ gap: 4, alignItems: mine ? 'flex-end' : 'flex-start' }}>
      {m.body ? (
        <View style={{ maxWidth: '78%', backgroundColor: mine ? C.green : C.input, borderRadius: 18, borderBottomRightRadius: mine ? 4 : 18, borderBottomLeftRadius: mine ? 18 : 4, paddingHorizontal: 14, paddingVertical: 10 }}>
          <Txt size={15} color={mine ? C.white : C.text} style={{ lineHeight: 21 }} testID="chat-bubble-text">{m.body}</Txt>
        </View>
      ) : null}
      {m.attachment ? <AttachmentCard a={m.attachment} mine={mine} /> : null}
      <Txt size={11} color={C.secondary}>{bubbleTime(m.createdAt)}</Txt>
    </View>
  );
}

/**
 * Sohbet ekranı (AC-MOB-41, Chat.dc.html): baloncuklar, gönderme, açıkken CHAT_POLL_MS'de bir yenileme (yalnızca
 * `after` ile yeniler), okundu işaretleme; ekler kart olarak görünür. "📍" düğmesi kendi listelerinden birini ekler.
 * Çevrimdışı: son görülen mesajlar önbellekten, gönderim kapalı (sıraya alınmaz).
 */
export default function ChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const { online } = useOffline();
  const insets = useSafeAreaInsets();
  const [info, setInfo] = useState<ConversationInfo | null>(null);
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const [myLists, setMyLists] = useState<ListSummary[] | null>(null);
  const scroll = useRef<ScrollView>(null);
  const latest = useRef<ChatMessage[]>([]);
  const me = user?.id;
  const mine = (m: ChatMessage) => String(m.senderId) === String(me);

  const apply = useCallback((next: ChatMessage[]) => {
    latest.current = next;
    setMessages(next);
    void chatApi.remember(id, next);
  }, [id]);

  const markRead = useCallback(() => {
    chatApi.read(id).then(() => refreshUnread()).catch(() => undefined);
  }, [id]);

  // İlk yükleme: başlık bilgisi + son 50 mesaj (önbellekli), sonra okundu.
  useEffect(() => {
    let cancelled = false;
    latest.current = [];
    setMessages(null); setInfo(null); setError(null);
    chatApi.info(id).then((i) => { if (!cancelled) setInfo(i); }).catch((e) => { if (!cancelled && !isNetworkError(e)) setError(errMsg(e)); });
    chatApi.latest(id)
      .then((list) => { if (cancelled) return; latest.current = list; setMessages(list); markRead(); })
      .catch((e) => { if (!cancelled) { setMessages([]); setError(errMsg(e)); } });
    return () => { cancelled = true; };
  }, [id, markRead]);

  // Açıkken yoklama: yalnızca yeni mesajlar; karşıdan mesaj geldiyse okundu işaretle.
  const poll = useCallback(async () => {
    const after = lastMessageId(latest.current);
    if (after === null && !latest.current.length && messages === null) return;
    try {
      const fresh = after === null ? await chatApi.latest(id) : await chatApi.after(id, after);
      if (!fresh.length) return;
      apply(mergeMessages(latest.current, fresh));
      if (fresh.some((m) => String(m.senderId) !== String(me))) markRead();
    } catch { /* çevrimdışı/geçici hata: bir sonraki turda tekrar */ }
  }, [id, me, apply, markRead, messages]);

  useFocusEffect(useCallback(() => {
    const t = setInterval(() => { if (online) void poll(); }, CHAT_POLL_MS);
    return () => clearInterval(t);
  }, [poll, online]));

  useEffect(() => {
    const t = setTimeout(() => scroll.current?.scrollToEnd({ animated: false }), 50);
    return () => clearTimeout(t);
  }, [messages?.length]);

  async function send(attachment?: { type: 'list'; id: string | number }) {
    const body = text.trim();
    if (!online) { setError(CHAT_OFFLINE_MSG); return; }
    if (!body && !attachment) return;
    setSending(true); setError(null);
    try {
      const m = await chatApi.send(id, attachment ? '' : body, attachment ?? null);
      if (!attachment) setText('');
      apply(mergeMessages(latest.current, [m]));
    } catch (e) { setError(errMsg(e)); } finally { setSending(false); }
  }

  function openAttach() {
    if (!online) { setError(CHAT_OFFLINE_MSG); return; }
    setAttachOpen(true);
    api.myLists().then((l) => setMyLists(l.filter((x) => !isPendingId(x.id)))).catch((e) => { setMyLists([]); setError(errMsg(e)); });
  }

  const handle = info?.other.handle ?? '';
  const canSend = online && info?.canSend !== false;

  return (
    <View style={{ flex: 1, backgroundColor: C.white }}>
      <View style={{ paddingTop: insets.top + 6, paddingLeft: 8, paddingRight: 12, paddingBottom: 8, flexDirection: 'row', alignItems: 'center', gap: 6, borderBottomWidth: 1, borderBottomColor: C.divider }}>
        <IconBtn icon="back" label="Geri" onPress={() => goBack('/messages')} testID="back" />
        <Avatar name={handle || '?'} size={38} color={C.green} />
        <View style={{ flex: 1 }}>
          <Txt weight="extrabold" size={16} testID="chat-header-handle">{handle ? `@${handle}` : ' '}</Txt>
          <Txt size={12} color={C.secondary}>{info ? (info.canSend ? 'Arkadaş' : 'Mesaj gönderilemez') : ' '}</Txt>
        </View>
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {messages === null ? <Loading /> : (
          <ScrollView ref={scroll} testID="chat-messages" style={{ flex: 1 }} contentContainerStyle={{ padding: 20, gap: 12 }} keyboardShouldPersistTaps="handled">
            {messages.length === 0 ? (
              <Txt size={14} color={C.secondary} style={{ alignSelf: 'center', textAlign: 'center' }} testID="chat-empty">Henüz mesaj yok. İlk mesajı sen yaz ya da bir liste gönder.</Txt>
            ) : null}
            {messages.map((m, i) => (
              <View key={m.id} style={{ gap: 12 }}>
                {needsDaySeparator(messages[i - 1], m) ? <Txt size={12} color={C.secondary} style={{ alignSelf: 'center' }}>{dayLabel(m.createdAt)}</Txt> : null}
                <Bubble m={m} mine={mine(m)} />
              </View>
            ))}
          </ScrollView>
        )}

        <View style={{ paddingHorizontal: 16, paddingTop: 8 }}>
          {!online ? <View testID="chat-offline"><ErrorMsg message={CHAT_OFFLINE_MSG} /></View> : null}
          {online && info && !info.canSend ? (
            <View testID="chat-cannot-send"><ErrorMsg message="Bu kişiye artık mesaj gönderemezsin (arkadaş değilsiniz ya da engel var). Eski mesajlar okunabilir." /></View>
          ) : null}
          <ErrorMsg message={error} />
        </View>
        <View style={{ paddingHorizontal: 16, paddingTop: 10, paddingBottom: Math.max(insets.bottom, 12) + 6, borderTopWidth: 1, borderTopColor: C.divider, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <IconBtn icon="pin" label="Liste ekle" bg={C.orangeTint} color={C.orangeText} size={46} disabled={!canSend} onPress={openAttach} testID="chat-attach" />
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder="Mesaj yaz..."
            placeholderTextColor={C.secondary}
            accessibilityLabel="Mesaj"
            maxLength={MAX_BODY}
            multiline
            editable={canSend}
            testID="chat-input"
            onSubmitEditing={() => void send()}
            style={{ flex: 1, minHeight: 46, maxHeight: 120, borderRadius: 23, backgroundColor: C.input, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12, fontFamily: F.regular, fontSize: 15, color: C.text }}
          />
          <IconBtn icon="send" label="Gönder" bg={canSend && text.trim() ? C.green : C.muted} color={C.white} size={46} iconSize={20} disabled={!canSend || sending || !text.trim()} onPress={() => void send()} testID="chat-send" />
        </View>
      </KeyboardAvoidingView>

      <Modal visible={attachOpen} transparent animationType="slide" onRequestClose={() => setAttachOpen(false)}>
        <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(23,37,30,0.4)' }}>
          <View testID="chat-attach-sheet" accessibilityViewIsModal style={{ backgroundColor: C.white, borderTopLeftRadius: 26, borderTopRightRadius: 26, maxHeight: '75%', paddingBottom: 24 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 14 }}>
              <Txt weight="extrabold" size={22} color={C.greenDark} accessibilityRole="header">Liste gönder</Txt>
              <IconBtn icon="close" label="Kapat" onPress={() => setAttachOpen(false)} testID="chat-attach-close" />
            </View>
            <Txt size={13} color={C.secondary} style={{ paddingHorizontal: 20 }}>Yer göndermek için yer sayfasında "Mesajla gönder"i kullan.</Txt>
            <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 8 }}>
              {myLists === null ? <Loading /> : myLists.length === 0 ? <Txt size={14} color={C.secondary}>Henüz listen yok.</Txt> : myLists.map((l) => (
                <Pressable
                  key={String(l.id)}
                  testID="chat-attach-list"
                  accessibilityRole="button"
                  accessibilityLabel={`${l.title} listesini gönder`}
                  onPress={() => { setAttachOpen(false); void send({ type: 'list', id: l.id }); }}
                  style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: HIT + 8, borderBottomWidth: 1, borderBottomColor: C.divider }, pressed ? { backgroundColor: C.greenSoft } : null]}
                >
                  <Icon name={l.visibility === 'public' ? 'globe' : 'lock'} size={18} color={C.green} />
                  <View style={{ flex: 1 }}>
                    <Txt weight="bold" size={15} numberOfLines={1}>{l.title}</Txt>
                    <Txt size={12} color={C.secondary}>{l.city} · {l.itemCount} yer</Txt>
                  </View>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}
