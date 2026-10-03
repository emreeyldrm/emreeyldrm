import { useEffect, useState, type ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { api, errMsg, type Id, type SocialUser } from '../lib/api';
import { friendsOf, sendToFriend, type AttachmentType } from '../lib/chat';
import { useOffline } from '../lib/offlineStore';
import { C, HIT } from '../theme';
import { Avatar, Btn, ErrorMsg, Field, IconBtn, InfoMsg, Loading, Txt } from './ui';

/** Mesajlaşma yalnızca çevrimiçi: gönderimler sıraya alınmaz (MSG). */
export const CHAT_OFFLINE_MSG = 'Çevrimdışısın. Mesaj göndermek için internet bağlantısı gerekli.';
export const NO_FRIENDS_MSG = 'Henüz arkadaşın yok. Mesajlaşmak için Arkadaşlar sayfasından karşılıklı takipleşin.';

/**
 * Alttan açılan arkadaş seçici (AC-MOB-40 "Yeni sohbet", AC-MOB-42 "Mesajla gönder"): yalnızca karşılıklı takip
 * edilenler, ada göre süzülebilir. `children` seçicinin üstüne (ör. not alanı) eklenir.
 */
export function FriendPickerSheet({ visible, title, onPick, onClose, busy, error, info, children, testID = 'friend-picker' }: {
  visible: boolean;
  title: string;
  onPick: (u: SocialUser) => void;
  onClose: () => void;
  busy?: boolean;
  error?: string | null;
  info?: ReactNode;
  children?: ReactNode;
  testID?: string;
}) {
  const { online } = useOffline();
  const [friends, setFriends] = useState<SocialUser[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [q, setQ] = useState('');

  useEffect(() => {
    if (!visible) return;
    setQ(''); setLoadError(null);
    api.following().then((f) => setFriends(friendsOf(f))).catch((e) => { setFriends([]); setLoadError(errMsg(e)); });
  }, [visible]);

  const shown = (friends ?? []).filter((f) => f.handle.includes(q.trim().toLowerCase().replace(/^@/, '')));

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(23,37,30,0.4)' }}>
        <View testID={testID} accessibilityViewIsModal style={{ backgroundColor: C.white, borderTopLeftRadius: 26, borderTopRightRadius: 26, maxHeight: '85%', paddingBottom: 24 }}>
          <View style={{ width: 40, height: 5, borderRadius: 3, backgroundColor: C.border, alignSelf: 'center', marginTop: 10 }} />
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 6 }}>
            <Txt weight="extrabold" size={22} color={C.greenDark} accessibilityRole="header" style={{ flexShrink: 1 }}>{title}</Txt>
            <IconBtn icon="close" label="Kapat" onPress={onClose} testID={`${testID}-close`} />
          </View>
          <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 8, gap: 12 }} keyboardShouldPersistTaps="handled">
            {info}
            {online ? null : <View testID="chat-offline"><ErrorMsg message={CHAT_OFFLINE_MSG} /></View>}
            <ErrorMsg message={error ?? loadError} />
            {children}
            {friends === null ? <Loading /> : friends.length === 0 ? (
              <View style={{ gap: 10 }}>
                <Txt size={14} color={C.secondary} testID="friend-picker-empty">{NO_FRIENDS_MSG}</Txt>
                <Btn title="Arkadaşlar" variant="soft" icon="people" small style={{ alignSelf: 'flex-start' }} onPress={() => { onClose(); router.push('/friends'); }} testID="friend-picker-friends" />
              </View>
            ) : (
              <>
                {friends.length > 6 ? (
                  <Field value={q} onChangeText={setQ} placeholder="Arkadaş ara" accessibilityLabel="Arkadaş ara" autoCapitalize="none" autoCorrect={false} testID="friend-picker-search" />
                ) : null}
                <View accessibilityRole="list">
                  {shown.map((f) => (
                    <Pressable
                      key={String(f.id)}
                      testID="friend-option"
                      accessibilityRole="button"
                      accessibilityLabel={`@${f.handle}`}
                      aria-disabled={!online || !!busy}
                      disabled={!online || !!busy}
                      onPress={() => onPick(f)}
                      style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: HIT + 8, borderBottomWidth: 1, borderBottomColor: C.divider, opacity: !online || busy ? 0.5 : 1 }, pressed ? { backgroundColor: C.greenSoft } : null]}
                    >
                      <Avatar name={f.handle} />
                      <Txt weight="bold" size={15} style={{ flex: 1 }}>@{f.handle}</Txt>
                      <Txt weight="bold" size={13} color={C.orangeText}>Seç</Txt>
                    </Pressable>
                  ))}
                </View>
              </>
            )}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/**
 * "Mesajla gönder" (AC-MOB-42): yer ya da listeyi, isteğe bağlı bir notla, seçilen arkadaşa mesaj olarak gönderir.
 * Yer sayfası, yer kartı ve liste paylaşım ekranı kullanır. Liste paylaşım ekranına bağlamak için tek satır:
 *   <SendToFriendButton attachment={{ type: 'list', id: list.id }} />
 */
export function SendToFriendButton({ attachment, label = 'Mesajla gönder', compact, testID = 'send-to-friend' }: {
  attachment: { type: AttachmentType; id: Id };
  label?: string;
  /** Simge düğmesi (dar kartlar için). */
  compact?: boolean;
  testID?: string;
}) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<{ handle: string; conversationId: number } | null>(null);
  const { online } = useOffline();
  const what = attachment.type === 'place' ? 'Yeri' : 'Listeyi';

  function show() {
    setNote(''); setError(null); setSent(null); setOpen(true);
  }

  async function pick(u: SocialUser) {
    if (!online) { setError(CHAT_OFFLINE_MSG); return; }
    setBusy(true); setError(null);
    try {
      const conversationId = await sendToFriend(u.handle, attachment, note);
      setSent({ handle: u.handle, conversationId });
      setNote('');
    } catch (e) { setError(errMsg(e)); } finally { setBusy(false); }
  }

  return (
    <>
      {compact ? (
        <IconBtn icon="send" label={label} bg={C.orangeTint} color={C.orangeText} round={false} size={46} onPress={show} testID={testID} />
      ) : (
        <Btn title={label} icon="send" variant="orangeSoft" height={46} onPress={show} testID={testID} />
      )}
      <FriendPickerSheet
        visible={open}
        title={`${what} mesajla gönder`}
        onPick={pick}
        onClose={() => setOpen(false)}
        busy={busy}
        error={error}
        testID="send-sheet"
        info={sent ? (
          <View testID="send-done" style={{ gap: 8 }}>
            <InfoMsg message={`@${sent.handle} kişisine gönderildi.`} />
            <Btn title="Sohbete git" variant="green" small icon="chat" style={{ alignSelf: 'flex-start' }} onPress={() => { setOpen(false); router.push(`/chat/${sent.conversationId}`); }} testID="send-open-chat" />
          </View>
        ) : null}
      >
        <Field value={note} onChangeText={setNote} placeholder="Not ekle (isteğe bağlı)" accessibilityLabel="Not" maxLength={2000} testID="send-note" />
      </FriendPickerSheet>
    </>
  );
}
