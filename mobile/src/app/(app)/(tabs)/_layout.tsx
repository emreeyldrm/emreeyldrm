import { Tabs, type BottomTabBarProps } from 'expo-router/js-tabs';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon, type IconName } from '../../../components/Icon';
import { Txt } from '../../../components/ui';
import { C } from '../../../theme';

const TABS: { name: string; label: string; icon: IconName; disabled?: boolean }[] = [
  { name: 'discover', label: 'Keşfet', icon: 'compass' },
  { name: 'lists', label: 'Listelerim', icon: 'listPin' },
  { name: 'messages', label: 'Mesajlar', icon: 'chat', disabled: true },
  { name: 'profile', label: 'Profil', icon: 'user' },
];

/** Bottom tab bar from Discover.dc.html: Keşfet / Listelerim / Mesajlar (Yakında, disabled) / Profil (AC-MOB-10). */
function TabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const current = state.routes[state.index]?.name;
  return (
    <View
      accessibilityRole="tablist"
      testID="tab-bar"
      style={{ flexDirection: 'row', borderTopWidth: 1, borderTopColor: C.divider, backgroundColor: C.white, paddingTop: 8, paddingBottom: Math.max(insets.bottom, 8), paddingHorizontal: 8 }}
    >
      {TABS.map((t) => {
        const on = current === t.name;
        const color = t.disabled ? C.muted : on ? C.greenDark : C.tabInactive;
        return (
          <Pressable
            key={t.name}
            testID={`tab-${t.name}`}
            accessibilityRole="tab"
            accessibilityLabel={t.disabled ? `${t.label}, yakında` : t.label}
            accessibilityState={{ selected: on, disabled: !!t.disabled }}
            disabled={t.disabled}
            onPress={() => {
              if (t.disabled) return;
              const route = state.routes.find((r) => r.name === t.name);
              const event = navigation.emit({ type: 'tabPress', target: route?.key ?? t.name, canPreventDefault: true });
              if (!on && !event.defaultPrevented) navigation.navigate(t.name);
            }}
            style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 3, minHeight: 48 }}
          >
            <Icon name={t.icon} size={26} color={color} strokeWidth={on ? 2.2 : 2} />
            <Txt weight={on ? 'bold' : 'semibold'} size={11} color={color}>{t.label}</Txt>
            {t.disabled ? (
              <View style={{ position: 'absolute', top: -2, right: 6, backgroundColor: C.orangeTint, borderRadius: 8, paddingHorizontal: 5, paddingVertical: 1 }}>
                <Txt weight="bold" size={9} color={C.orangeText}>Yakında</Txt>
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

export default function TabsLayout() {
  return (
    <Tabs tabBar={(props) => <TabBar {...props} />} screenOptions={{ headerShown: false }} initialRouteName="lists">
      <Tabs.Screen name="discover" options={{ title: 'Keşfet' }} />
      <Tabs.Screen name="lists" options={{ title: 'Listelerim' }} />
      <Tabs.Screen name="messages" options={{ title: 'Mesajlar' }} />
      <Tabs.Screen name="profile" options={{ title: 'Profil' }} />
    </Tabs>
  );
}
