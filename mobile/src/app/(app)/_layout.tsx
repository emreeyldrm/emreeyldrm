import { useEffect } from 'react';
import { View } from 'react-native';
import { Redirect, Stack } from 'expo-router';
import { SafeAreaInsetsContext, useSafeAreaInsets } from 'react-native-safe-area-context';
import { OfflineBanner, SyncFailures } from '../../components/OfflineBanner';
import { Loading } from '../../components/ui';
import { useAuth } from '../../lib/auth';
import { useOffline } from '../../lib/offlineStore';
import { startSync } from '../../lib/sync';
import { C } from '../../theme';

/**
 * Every route in (app) requires a session; otherwise go to the login screen (AC-MOB-2).
 * Çevrimdışı şeridi ve gönderilemeyen değişiklikler bildirimi tüm ekranların üstündedir (AC-OFF-1/2);
 * eşitleme motoru oturum açıkken çalışır.
 */
export default function AppLayout() {
  const { user, loading } = useAuth();
  const offline = useOffline();
  const insets = useSafeAreaInsets();
  useEffect(() => (user ? startSync() : undefined), [user]);
  if (loading) return <Loading />;
  if (!user) return <Redirect href="/login" />;
  const topTaken = !offline.online;
  return (
    <View style={{ flex: 1, backgroundColor: C.white }}>
      <OfflineBanner />
      {/* Şerit üst güvenli alanı aldıysa alttaki ekranlar onu ikinci kez eklemesin. */}
      <SafeAreaInsetsContext.Provider value={topTaken ? { ...insets, top: 0 } : insets}>
        <SyncFailures />
        <View style={{ flex: 1 }}>
          <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: C.white } }} />
        </View>
      </SafeAreaInsetsContext.Provider>
    </View>
  );
}
