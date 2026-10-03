import { useCallback, useMemo, useState } from 'react';
import { View } from 'react-native';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { DayRouteMap } from '../../../../../components/DayRouteMap';
import { goBack } from '../../../../../components/Header';
import { daySummary, legLabels, useDayWalk, usePlan } from '../../../../../components/PlanView';
import { OpenStatusBadge } from '../../../../../components/OpenStatusBadge';
import type { RouteStop } from '../../../../../components/mapTypes';
import { Btn, ErrorMsg, Loading, Screen, Txt } from '../../../../../components/ui';
import { api, errMsg, type ListDetail } from '../../../../../lib/api';
import { googleDirectionsUrl, openUrl } from '../../../../../lib/maps';
import { budgetLine, computeBudget } from '../../../../../lib/budget';
import { formatDistance, toPlanPlace, totalDistance, type PlanPlace } from '../../../../../lib/plan';
import { categoryInfo } from '../../../../../lib/categories';
import { C } from '../../../../../theme';

/** Day route (DayMap.dc.html): numbered stops on the map + bottom sheet with legs and "Sırala". */
export default function DayMap() {
  const { id, day: dayParam } = useLocalSearchParams<{ id: string; day: string }>();
  const day = Math.max(1, Number(dayParam) || 1);
  const [list, setList] = useState<ListDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => { api.getList(id).then(setList).catch((e) => setError(errMsg(e))); }, [id]);
  useFocusEffect(load);

  const places = useMemo<PlanPlace[]>(() => (list?.items ?? []).map(toPlanPlace), [list]);
  const { plan, dayPlaces, sortDay } = usePlan(id, places);
  const items = plan ? dayPlaces(day) : [];
  const stops: RouteStop[] = items
    .map((p, i) => ({ ...p, n: i + 1 }))
    .filter((p): p is RouteStop => p.lat !== null && p.lon !== null);
  const directions = googleDirectionsUrl(stops);
  // PLN: yaya rotası (AC-MOB-43) ve günün bütçesi (AC-MOB-45).
  const route = useDayWalk(items);
  const legs = legLabels(items, route);
  const budget = budgetLine(computeBudget(items.map((p) => p.details)));

  return (
    <Screen edges={[]} style={{ backgroundColor: C.mapBg }}>
      <View style={{ flex: 1 }}>
        {list && plan ? <DayRouteMap stops={stops} /> : <Loading />}
        <View style={{ position: 'absolute', left: 16, top: 60 }}>
          <Btn title="Plan" icon="back" variant="outline" small onPress={() => goBack(`/lists/${id}?tab=plan`)} testID="back" style={{ borderWidth: 0, borderRadius: 22, shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 8, elevation: 4 }} accessibilityLabel="Geri: Plan" />
        </View>
      </View>
      <View style={{ backgroundColor: C.white, borderTopLeftRadius: 26, borderTopRightRadius: 26, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 34, gap: 12, shadowColor: '#000', shadowOpacity: 0.14, shadowRadius: 18, elevation: 8 }}>
        <View style={{ width: 40, height: 5, borderRadius: 3, backgroundColor: C.border, alignSelf: 'center' }} />
        <ErrorMsg message={error} />
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View style={{ flex: 1 }}>
            <Txt weight="extrabold" size={22} color={C.greenDark} accessibilityRole="header" testID="day-title">Gün {day}</Txt>
            <Txt size={13} color={C.secondary} testID="day-summary">{daySummary(items, route)}</Txt>
            {route.kind === 'walk' ? <Txt size={11} color={C.secondary} testID="day-straight">Kuş uçuşu {formatDistance(totalDistance(items))}</Txt> : null}
            {budget ? <Txt size={12} weight="semibold" color={C.orangeText} testID="day-budget">{budget}</Txt> : null}
          </View>
          {items.length > 1 ? <Btn title="Sırala" icon="sort" variant="orangeSoft" small onPress={() => sortDay(day)} testID="day-sort" /> : null}
        </View>
        <View style={{ gap: 8 }}>
          {items.map((p, i) => (
            <View key={p.id} testID="day-stop" style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 32 }}>
              <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: C.orange, alignItems: 'center', justifyContent: 'center' }}>
                <Txt weight="extrabold" size={13} color={C.orangeOn}>{i + 1}</Txt>
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Txt weight="semibold" size={15} testID="day-stop-name">{p.name}</Txt>
                <OpenStatusBadge placeId={p.id} lat={p.lat} lon={p.lon} small testID="day-stop-hours" />
              </View>
              <Txt size={12} color={C.secondary} testID="day-stop-leg">{i === 0 ? categoryInfo(p.category).title : p.lat === null || p.lon === null ? 'konumsuz' : legs[i] ?? (route.kind === 'loading' ? '…' : '')}</Txt>
            </View>
          ))}
        </View>
        {directions ? <Btn title="Google Maps'te rotayı başlat" variant="green" icon="navigate" onPress={() => openUrl(directions)} testID="day-directions" /> : null}
      </View>
    </Screen>
  );
}
