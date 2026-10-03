import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { Icon, type IconName } from '../../../components/Icon';
import { Avatar, ConfirmDialog, ErrorMsg, LargeTitle, Screen, Scroll, Txt } from '../../../components/ui';
import { api, errMsg } from '../../../lib/api';
import { useAuth } from '../../../lib/auth';
import { C, HIT } from '../../../theme';

function Row({ icon, label, onPress, testID, danger }: { icon: IconName; label: string; onPress: () => void; testID: string; danger?: boolean }) {
  const color = danger ? C.danger : C.greenDark;
  return (
    <Pressable testID={testID} accessibilityRole="button" onPress={onPress} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: HIT + 8, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: C.divider, opacity: pressed ? 0.7 : 1 })}>
      <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: danger ? C.dangerTint : C.greenCard, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} size={20} color={color} />
      </View>
      <Txt weight="semibold" size={15} color={danger ? C.danger : C.text} style={{ flex: 1 }}>{label}</Txt>
      {!danger ? <Icon name="chevron" size={18} color={C.secondary} /> : null}
    </Pressable>
  );
}

/** Profil: friends, logout, account deletion with confirmation (AC-MOB-1, AC-MOB-9). */
export default function Profile() {
  const { user, signOut } = useAuth();
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function logout() {
    await signOut();
    router.replace('/login');
  }

  async function deleteAccount() {
    setError(null);
    try {
      await api.deleteMe();
      setConfirm(false);
      await signOut({ deleted: true });
      router.replace('/login');
    } catch (e) {
      setConfirm(false);
      setError(errMsg(e));
    }
  }

  return (
    <Screen>
      <Scroll contentStyle={{ paddingTop: 24, gap: 20 }}>
        <LargeTitle>Profil</LargeTitle>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: C.greenCard, borderRadius: 20, padding: 16 }}>
          <Avatar name={user?.handle ?? '?'} size={56} color={C.green} />
          <View style={{ flex: 1 }}>
            <Txt weight="extrabold" size={20} color={C.greenDark} testID="profile-handle">@{user?.handle}</Txt>
            <Txt size={13} color={C.secondary} testID="profile-email">{user?.email}</Txt>
          </View>
        </View>
        <ErrorMsg message={error} />
        <View>
          <Row icon="people" label="Arkadaşlar" onPress={() => router.push('/friends')} testID="profile-friends" />
          <Row icon="logout" label="Çıkış yap" onPress={logout} testID="logout" />
          <Row icon="trash" label="Hesabı sil" onPress={() => setConfirm(true)} testID="delete-account" danger />
        </View>
        <Txt size={12} color={C.secondary} style={{ textAlign: 'center' }} testID="app-version">
          Sürüm {process.env.EXPO_PUBLIC_GIT_SHA ?? 'geliştirme'}
        </Txt>
      </Scroll>
      <ConfirmDialog
        visible={confirm}
        title="Hesabı sil"
        message="Hesabın, listelerin, puanların, yorumların ve takiplerin kalıcı olarak silinecek. Bu işlem geri alınamaz."
        confirmLabel="Evet, sil"
        onConfirm={deleteAccount}
        onCancel={() => setConfirm(false)}
        testID="delete-dialog"
        confirmTestID="delete-confirm"
        cancelTestID="delete-cancel"
      />
    </Screen>
  );
}
