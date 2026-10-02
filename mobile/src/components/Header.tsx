import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { router, type Href } from 'expo-router';
import { C, HIT } from '../theme';
import { Icon } from './Icon';
import { Txt } from './ui';

export function goBack(fallback: Href): void {
  if (router.canGoBack()) router.back();
  else router.replace(fallback);
}

/** Nav row from CityList.dc.html: green "‹ Back" text button on the left, actions on the right. */
export function NavHeader({ backLabel, fallback, right }: { backLabel: string; fallback: Href; right?: ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingLeft: 8, paddingRight: 12, minHeight: HIT }}>
      <Pressable
        testID="back"
        accessibilityRole="button"
        accessibilityLabel={`Geri: ${backLabel}`}
        onPress={() => goBack(fallback)}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 2, minHeight: HIT, paddingHorizontal: 8 }}
      >
        <Icon name="back" size={22} color={C.greenDark} strokeWidth={2.4} />
        <Txt weight="semibold" size={16} color={C.greenDark}>{backLabel}</Txt>
      </Pressable>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>{right}</View>
    </View>
  );
}
