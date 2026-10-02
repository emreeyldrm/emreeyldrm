import { ScrollView, View } from 'react-native';
import { categoryInfo } from '../lib/categories';
import { C } from '../theme';
import { Empty, Txt, webData } from './ui';
import { fmtCoord, type RouteStop } from './mapTypes';

/** Web fallback for the day route map: numbered stops with coordinates, in route order. */
export function DayRouteMap({ stops }: { stops: RouteStop[] }) {
  return (
    <ScrollView testID="day-map" style={{ flex: 1, backgroundColor: C.mapBg }} contentContainerStyle={{ padding: 16, paddingTop: 120, gap: 8 }}>
      <Txt weight="bold" size={14} color={C.greenDark} accessibilityRole="header">Rota (web): {stops.length} konumlu durak</Txt>
      {stops.length === 0 ? <Empty text="Bu günde konumlu durak yok." /> : null}
      {stops.map((s) => (
        <View key={s.id} testID="route-stop" {...webData({ category: s.category })} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: categoryInfo(s.category).color, borderWidth: 3, borderColor: C.white, alignItems: 'center', justifyContent: 'center' }}>
            <Txt weight="extrabold" size={14} color={C.white}>{s.n}</Txt>
          </View>
          <Txt weight="semibold" size={14} style={{ flex: 1 }}>{s.name}</Txt>
          <Txt size={12} color={C.secondary}>{fmtCoord(s)}</Txt>
        </View>
      ))}
    </ScrollView>
  );
}
