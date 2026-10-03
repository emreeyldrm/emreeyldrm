import { useCallback, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { goBack } from '../../../../components/Header';
import { Icon, type IconName } from '../../../../components/Icon';
import { Btn, ErrorMsg, Loading, Screen, Scroll, SwitchRow, Txt } from '../../../../components/ui';
import { api, errMsg, isPendingId, type ListDetail, type ListVisibility } from '../../../../lib/api';
import { useAuth } from '../../../../lib/auth';
import { listRole, permissions } from '../../../../lib/collabCore';
import { MembersSection } from '../../../../components/Collab';
import { SendToFriendButton } from '../../../../components/SendToFriend';
import { C } from '../../../../theme';

function RadioCard({ title, sub, icon, tint, color, on, disabled, onPress, testID }: {
  title: string; sub: string; icon: IconName; tint: string; color: string; on: boolean; disabled?: boolean; onPress?: () => void; testID: string;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="radio"
      accessibilityLabel={`${title}, ${sub}`}
      aria-checked={on} aria-disabled={!!disabled}
      disabled={disabled}
      onPress={onPress}
      style={{
        flexDirection: 'row', alignItems: 'center', gap: 14, borderRadius: 16, padding: 14, minHeight: 68,
        borderWidth: on ? 2 : 1.5, borderColor: on ? C.green : C.border, backgroundColor: on ? C.greenSoft : C.white, opacity: disabled ? 0.55 : 1,
      }}
    >
      <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: tint, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} size={20} color={color} />
      </View>
      <View style={{ flex: 1 }}>
        <Txt weight="bold" size={15}>{title}</Txt>
        <Txt size={12} color={C.secondary} style={{ marginTop: 2 }}>{sub}</Txt>
      </View>
      {on ? (
        <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: C.green, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="check" size={14} color={C.white} strokeWidth={3} />
        </View>
      ) : (
        <View style={{ width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: C.muted }} />
      )}
    </Pressable>
  );
}

/**
 * List sharing / visibility (ListShare.dc.html) — AC-MOB-4. "Arkadaşlar" is disabled (Yakında); "Mesajla gönder" sends the list to a friend.
 * "Birlikte düzenle" (AC-MOB-38): sahip üyeleri yönetir; üye (editor) yalnızca üyeleri görür ve listeden ayrılabilir,
 * görünürlük ve izin denetimlerini görmez (AC-MOB-39).
 */
export default function ListShare() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const [list, setList] = useState<ListDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => { api.getList(id).then(setList).catch((e) => setError(errMsg(e))); }, [id]);
  useFocusEffect(load);

  async function patch(p: Partial<{ visibility: ListVisibility; allowCopy: boolean; allowComments: boolean }>) {
    if (!list) return;
    setError(null);
    const prev = list;
    setList({ ...list, ...p });
    try { await api.patchList(list.id, p); } catch (e) { setList(prev); setError(errMsg(e)); }
  }

  if (!list) return <Screen>{error ? <View style={{ padding: 20 }}><ErrorMsg message={error} /></View> : <Loading />}</Screen>;
  const role = listRole(list, user?.id);
  const perms = permissions(role);
  const members = list.memberCount ?? 0;

  return (
    <Screen>
      <Scroll contentStyle={{ paddingTop: 24, gap: 18 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <View style={{ flex: 1 }}>
            <Txt size={13} color={C.secondary}>{list.city}</Txt>
            <Txt weight="extrabold" size={26} style={{ letterSpacing: -0.3 }} accessibilityRole="header" testID="share-title">{list.title}</Txt>
          </View>
          <Btn title="Bitti" variant="soft" small onPress={() => goBack(`/lists/${list.id}`)} testID="share-done" />
        </View>

        {perms.isOwner ? (
          <>
            <Txt weight="extrabold" size={15} color={C.greenDark} accessibilityRole="header">Kim görebilir?</Txt>
            <View accessibilityRole="radiogroup" accessibilityLabel="Görünürlük" style={{ gap: 10 }} testID="visibility-toggle">
              <RadioCard testID="visibility-private" title="Özel" sub={members > 0 ? 'Sen ve listenin üyeleri' : 'Sadece sen'} icon="lock" tint="#EEF1EF" color="#55645C" on={list.visibility === 'private'} onPress={() => patch({ visibility: 'private' })} />
              <RadioCard testID="visibility-friends" title="Arkadaşlar" sub="Yakında" icon="people" tint={C.orangeTint} color={C.orangeText} on={false} disabled />
              <RadioCard testID="visibility-public" title="Herkese açık" sub="Keşfet'te görünür, herkes yorum yapabilir" icon="globe" tint={C.greenCard} color={C.green} on={list.visibility === 'public'} onPress={() => patch({ visibility: 'public' })} />
            </View>

            <View>
              <SwitchRow on={list.allowCopy} label="Başkaları kopyalayabilsin" sub="Kendi listesine ekleyebilir" onChange={() => patch({ allowCopy: !list.allowCopy })} testID="toggle-allow-copy" />
              <SwitchRow on={list.allowComments} label="Yorumlara izin ver" sub="Liste ve yerler altında" onChange={() => patch({ allowComments: !list.allowComments })} testID="toggle-allow-comments" last />
            </View>
          </>
        ) : null}

        {perms.canSeeMembers && !isPendingId(list.id) ? (
          <MembersSection listId={list.id} ownerHandle={list.ownerHandle} role={role} userId={user?.id} onChanged={load} />
        ) : null}
        {!perms.canSeeMembers ? (
          <Txt size={14} color={C.secondary} testID="share-not-member">Bu listenin paylaşım ayarlarını yalnızca sahibi ve üyeleri görebilir.</Txt>
        ) : null}
        <ErrorMsg message={error} />
        {/* Listeyi bir arkadaşa mesajla gönder (MSG, AC-MOB-42). Çevrimdışı oluşturulmuş liste önce eşitlenmeli. */}
        {!isPendingId(list.id) ? <SendToFriendButton attachment={{ type: 'list', id: list.id }} testID="share-message" /> : null}
      </Scroll>
    </Screen>
  );
}
