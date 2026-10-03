import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { dismissFailures, formatClock, useOffline } from '../lib/offlineStore';
import { C } from '../theme';
import { IconBtn, Txt } from './ui';

export const offlineBannerText = (lastSync: number | null): string => `Çevrimdışı · son güncelleme ${formatClock(lastSync)}`;

/**
 * Üst şerit (AC-OFF-1): "Çevrimdışı · son güncelleme 14:32" ve bekleyen değişiklik sayısı. Çevrimiçiyken gizli.
 * Güvenli alanın üst boşluğunu şerit kendisi alır.
 */
export function OfflineBanner() {
  const s = useOffline();
  const insets = useSafeAreaInsets();
  if (s.online) return null;
  return (
    <View
      testID="offline-banner"
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={{ backgroundColor: C.text, paddingTop: insets.top + 6, paddingBottom: 6, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}
    >
      <Txt weight="bold" size={13} color={C.white} testID="offline-banner-text">{offlineBannerText(s.lastSync)}</Txt>
      {s.pending ? <Txt weight="semibold" size={12} color={C.orange} testID="offline-pending">· {s.pending} değişiklik bekliyor</Txt> : null}
    </View>
  );
}

/** Gönderilemeyen değişiklikler (AC-OFF-2, kalıcı hata): hangisinin neden gitmediği; kapatılabilir. */
export function SyncFailures() {
  const s = useOffline();
  const insets = useSafeAreaInsets();
  if (!s.failures.length) return null;
  return (
    <View testID="sync-failures" accessibilityRole="alert" style={{ backgroundColor: C.dangerTint, borderBottomWidth: 1, borderBottomColor: C.border, paddingLeft: 16, paddingRight: 4, paddingTop: insets.top + 8, paddingBottom: 8, flexDirection: 'row', gap: 8 }}>
      <View style={{ flex: 1, gap: 4 }}>
        <Txt weight="bold" size={13} color={C.danger}>
          {s.failures.length === 1 ? 'Bir değişiklik gönderilemedi' : `${s.failures.length} değişiklik gönderilemedi`}
        </Txt>
        {s.failures.slice(-5).map((f) => (
          <Txt key={f.id} size={12} color={C.text} testID="sync-failure">{f.label} — {f.reason}</Txt>
        ))}
      </View>
      <IconBtn icon="close" label="Bildirimi kapat" color={C.danger} iconSize={18} onPress={() => { void dismissFailures(); }} testID="sync-failures-dismiss" />
    </View>
  );
}
