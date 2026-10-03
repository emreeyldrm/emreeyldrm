import { useCallback, useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Avatar, Btn, ConfirmDialog, Empty, ErrorMsg, Field, IconBtn, InfoMsg, Pill, Txt } from './ui';
import { Icon } from './Icon';
import { collabApi, api, type Id, type ListMember, type SocialUser } from '../lib/api';
import { isOnline, useOffline } from '../lib/offlineStore';
import {
  addMemberError, copyAction, friendSuggestions, listActionError, MAX_MEMBERS, OFFLINE_COLLAB_MSG, permissions, type Role,
} from '../lib/collabCore';
import { C } from '../theme';

/**
 * "Listeyi kopyala" / "Kopyasını oluştur" (AC-MOB-37). Çevrimiçi işlem: çevrimdışıyken mesaj gösterilir, sıraya
 * alınmaz. Başarıda kullanıcı yeni (özel) kopyasına gider.
 */
export function CopyListButton({ listId, role, allowCopy, onError }: {
  listId: Id; role: Role; allowCopy: boolean; onError: (msg: string | null) => void;
}) {
  const [busy, setBusy] = useState(false);
  const action = copyAction(role, allowCopy);
  if (!action) return null;
  async function copy() {
    onError(null);
    if (!isOnline()) { onError(OFFLINE_COLLAB_MSG); return; }
    setBusy(true);
    try {
      const r = await collabApi.copyList(listId);
      router.push(`/lists/${r.id}`);
    } catch (e) {
      onError(listActionError(e, 'copy'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Btn
      title={busy ? 'Kopyalanıyor…' : action.label}
      icon="copy"
      variant="soft"
      small
      disabled={busy}
      onPress={copy}
      testID="list-copy"
      style={{ alignSelf: 'flex-start' }}
    />
  );
}

/** Üyenin kendini listeden çıkarması (AC-MOB-38): onaydan sonra Listelerim'e döner. */
export function LeaveListButton({ listId, userId, testID = 'list-leave', onError }: {
  listId: Id; userId: Id | null | undefined; testID?: string; onError: (msg: string | null) => void;
}) {
  const [confirm, setConfirm] = useState(false);
  async function leave() {
    setConfirm(false);
    onError(null);
    if (!isOnline()) { onError(OFFLINE_COLLAB_MSG); return; }
    if (userId === null || userId === undefined) return;
    try {
      await collabApi.removeMember(listId, userId);
      await collabApi.forgetList(listId);
      router.replace('/lists');
    } catch (e) {
      onError(listActionError(e, 'leave'));
    }
  }
  return (
    <>
      <Btn title="Listeden ayrıl" variant="danger" icon="logout" onPress={() => setConfirm(true)} testID={testID} />
      <ConfirmDialog
        visible={confirm}
        title="Listeden ayrıl"
        message="Bu ortak listeyi artık düzenleyemezsin; özel bir listeyse göremezsin de. Emin misin?"
        confirmLabel="Ayrıl"
        onConfirm={leave}
        onCancel={() => setConfirm(false)}
        testID="leave-dialog"
        confirmTestID="leave-confirm"
        cancelTestID="leave-cancel"
      />
    </>
  );
}

function MemberRow({ handle, sub, onRemove, isOwnerRow, last }: {
  handle: string; sub: string; onRemove?: () => void; isOwnerRow?: boolean; last?: boolean;
}) {
  return (
    <View
      testID={isOwnerRow ? 'member-owner' : 'member-row'}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderBottomWidth: last ? 0 : 1, borderBottomColor: C.divider }}
    >
      <Avatar name={handle} />
      <View style={{ flex: 1 }}>
        <Txt weight="bold" size={15} testID="member-handle">@{handle}</Txt>
        <Txt size={12} color={C.secondary}>{sub}</Txt>
      </View>
      {onRemove ? (
        <IconBtn icon="close" label={`@${handle} listeden çıkar`} color={C.secondary} onPress={onRemove} testID="member-remove" iconSize={20} />
      ) : null}
    </View>
  );
}

/**
 * "Birlikte düzenle" (AC-MOB-38): üyeler (handle, sahip için kaldır), sahip için arkadaşlar arasından arama ile
 * ekleme (yalnızca karşılıklı takip edilenler önerilir; yazılan kullanıcı adı doğrudan da eklenebilir), üye için
 * "Listeden ayrıl". Ekleme/çıkarma çevrimiçi işlemlerdir; çevrimdışıyken son görülen üye listesi gösterilir.
 */
export function MembersSection({ listId, ownerHandle, role, userId, onChanged }: {
  listId: Id; ownerHandle: string; role: Role; userId: Id | null | undefined; onChanged?: () => void;
}) {
  const perms = permissions(role);
  const { online } = useOffline();
  const [members, setMembers] = useState<ListMember[] | null>(null);
  const [people, setPeople] = useState<SocialUser[]>([]);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [removing, setRemoving] = useState<ListMember | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    collabApi.members(listId).then(setMembers).catch((e) => setError(listActionError(e, 'remove')));
    if (perms.isOwner) api.following().then(setPeople).catch(() => undefined);
  }, [listId, perms.isOwner]);
  useFocusEffect(load);

  // Arama: takip edilenler (GET /following) zaten tüm arkadaşları içerir; 2+ karakterde sunucu araması da birleştirilir.
  useEffect(() => {
    const t = query.trim().replace(/^@/, '').toLowerCase();
    if (!perms.isOwner || t.length < 2 || !online) return;
    let alive = true;
    const h = setTimeout(() => {
      api.searchUsers(t).then((found) => {
        if (!alive) return;
        setPeople((prev) => [...prev, ...found.filter((f) => !prev.some((p) => String(p.id) === String(f.id)))]);
      }).catch(() => undefined);
    }, 250);
    return () => { alive = false; clearTimeout(h); };
  }, [query, perms.isOwner, online]);

  const memberIds = useMemo(() => (members ?? []).map((m) => m.id), [members]);
  const suggestions = useMemo(() => friendSuggestions(people, memberIds, query).slice(0, 8), [people, memberIds, query]);
  const full = (members?.length ?? 0) >= MAX_MEMBERS;

  async function add(handle: string) {
    const h = handle.trim().replace(/^@/, '').toLowerCase();
    setError(null); setInfo(null);
    if (!h) { setError('Eklemek için bir kullanıcı adı yaz.'); return; }
    if (!isOnline()) { setError(OFFLINE_COLLAB_MSG); return; }
    setBusy(true);
    try {
      const m = await collabApi.addMember(listId, h);
      setMembers((prev) => (prev && prev.some((x) => String(x.id) === String(m.id)) ? prev : [...(prev ?? []), m]));
      setInfo(`@${m.handle} artık bu listeyi seninle birlikte düzenleyebilir.`);
      setQuery('');
      onChanged?.();
      load();
    } catch (e) {
      setError(addMemberError(e, h));
    } finally {
      setBusy(false);
    }
  }

  async function remove(m: ListMember) {
    setRemoving(null);
    setError(null); setInfo(null);
    if (!isOnline()) { setError(OFFLINE_COLLAB_MSG); return; }
    try {
      await collabApi.removeMember(listId, m.id);
      setMembers((prev) => (prev ?? []).filter((x) => String(x.id) !== String(m.id)));
      onChanged?.();
      load();
    } catch (e) {
      setError(listActionError(e, 'remove'));
    }
  }

  return (
    <View testID="collab-section" style={{ gap: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <Txt weight="extrabold" size={15} color={C.greenDark} accessibilityRole="header">Birlikte düzenle</Txt>
        {members ? <Pill text={`${members.length}/${MAX_MEMBERS} üye`} bg={C.greenCard} icon="people" testID="member-count" /> : null}
      </View>
      <Txt size={12} color={C.secondary} style={{ marginTop: -6 }}>
        {perms.isOwner
          ? 'Eklediğin arkadaşların yer ekleyip düzenleyebilir; listeyi silemez, görünürlüğü ve izinleri değiştiremez.'
          : 'Bu ortak listede yer ekleyip düzenleyebilirsin.'}
      </Txt>

      <View testID="member-list" style={{ borderWidth: 1.5, borderColor: C.border, borderRadius: 16, paddingHorizontal: 14 }}>
        <MemberRow handle={ownerHandle} sub="Sahip" isOwnerRow last={!members?.length} />
        {members === null ? <Empty text="Üyeler yükleniyor…" /> : null}
        {members?.map((m, i) => {
          const self = userId !== null && userId !== undefined && String(m.id) === String(userId);
          return (
            <MemberRow
              key={String(m.id)}
              handle={m.handle}
              sub={self ? 'Sen · düzenleyici' : 'Düzenleyici'}
              onRemove={perms.isOwner ? () => setRemoving(m) : undefined}
              last={i === members.length - 1}
            />
          );
        })}
      </View>
      {members && members.length === 0 && perms.isOwner ? (
        <Empty text="Henüz kimse yok. Bir arkadaşını ekle; birlikte yer ekleyip düzenleyin." testID="members-empty" />
      ) : null}

      {perms.isOwner ? (
        <View style={{ gap: 10 }}>
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-end' }}>
            <Field
              containerStyle={{ flex: 1 }}
              value={query}
              onChangeText={(t) => { setQuery(t); setError(null); setInfo(null); }}
              placeholder="Arkadaş ara (@kullanıcı)"
              accessibilityLabel="Üye eklemek için arkadaş ara"
              autoCapitalize="none"
              autoCorrect={false}
              testID="member-search"
              onSubmitEditing={() => add(query)}
              returnKeyType="done"
              editable={!full}
            />
            <Btn title="Ekle" variant="green" onPress={() => add(query)} disabled={busy || full || !query.trim()} testID="member-add" style={{ minHeight: 48 }} />
          </View>
          {!online ? <Txt size={12} color={C.secondary} testID="member-offline">{OFFLINE_COLLAB_MSG}</Txt> : null}
          {full ? <Txt size={12} color={C.secondary} testID="member-full">Bir listede en çok {MAX_MEMBERS} üye olabilir.</Txt> : null}
          {!full ? (
            <View testID="friend-suggestions" style={{ gap: 0 }}>
              <Txt size={12} weight="semibold" color={C.secondary}>{query.trim() ? 'Eşleşen arkadaşlar' : 'Arkadaşların'}</Txt>
              {suggestions.length === 0 ? (
                <Empty
                  text={query.trim() ? 'Eşleşen arkadaş yok. Yalnızca karşılıklı takipleştiğin kişiler eklenebilir.' : 'Eklenebilecek arkadaşın yok. Arkadaş = karşılıklı takip.'}
                  testID="friend-suggestions-empty"
                />
              ) : null}
              {suggestions.map((p) => (
                <View key={String(p.id)} testID="friend-suggestion" style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 }}>
                  <Avatar name={p.handle} size={32} />
                  <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Txt weight="bold" size={15}>@{p.handle}</Txt>
                    <Icon name="people" size={14} color={C.green} />
                  </View>
                  <Btn title="Ekle" small variant="outline" icon="plus" onPress={() => add(p.handle)} disabled={busy} testID="friend-add" accessibilityLabel={`@${p.handle} listeye ekle`} />
                </View>
              ))}
            </View>
          ) : null}
        </View>
      ) : null}

      <InfoMsg message={info} />
      <ErrorMsg message={error} />

      {perms.canLeave ? <LeaveListButton listId={listId} userId={userId} testID="share-leave" onError={setError} /> : null}

      <ConfirmDialog
        visible={removing !== null}
        title="Üyeyi çıkar"
        message={removing ? `@${removing.handle} bu listeyi artık düzenleyemeyecek.` : ''}
        confirmLabel="Çıkar"
        onConfirm={() => removing && remove(removing)}
        onCancel={() => setRemoving(null)}
        testID="member-remove-dialog"
        confirmTestID="member-remove-confirm"
        cancelTestID="member-remove-cancel"
      />
    </View>
  );
}
