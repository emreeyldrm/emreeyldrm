import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import type { Id } from '../lib/api';
import {
  formatDistance, loadPlan, MAX_DAYS, MIN_DAYS, nearestNeighborOrder, reconcilePlan, savePlan, totalDistance,
  type Plan, type PlanPlace,
} from '../lib/plan';
import { C, HIT } from '../theme';
import { Icon } from './Icon';
import { CategoryIcon, Empty, IconBtn, Loading, Scroll, Txt } from './ui';

export function daySummary(places: PlanPlace[]): string {
  if (places.length === 0) return 'Henüz durak yok';
  if (places.length === 1) return '1 durak';
  return `${places.length} durak · ${formatDistance(totalDistance(places))} · kuş uçuşu`;
}

/** Hook shared by the Plan tab and the day map: plan from AsyncStorage, reconciled with the list's places. */
export function usePlan(listId: Id, places: PlanPlace[]) {
  const [plan, setPlan] = useState<Plan | null>(null);
  const ids = useMemo(() => places.map((p) => p.id), [places]);

  useEffect(() => {
    let alive = true;
    loadPlan(listId).then((p) => { if (alive) setPlan(reconcilePlan(p, ids)); });
    return () => { alive = false; };
  }, [listId, ids]);

  const update = useCallback((fn: (p: Plan) => Plan) => {
    setPlan((prev) => {
      if (!prev) return prev;
      const next = fn(prev);
      void savePlan(listId, next);
      return next;
    });
  }, [listId]);

  const byId = useMemo(() => new Map(places.map((p) => [p.id, p])), [places]);
  const dayPlaces = useCallback((day: number): PlanPlace[] =>
    (plan?.days[String(day)] ?? []).map((id) => byId.get(id)).filter((p): p is PlanPlace => !!p), [plan, byId]);

  const sortDay = useCallback((day: number) => {
    update((p) => ({ ...p, days: { ...p.days, [String(day)]: nearestNeighborOrder(dayPlaces(day)).map((x) => x.id) } }));
  }, [update, dayPlaces]);

  return { plan, update, dayPlaces, sortDay };
}

/** Plan tab (Plan.dc.html): places assigned to days, ordered within a day, "Sırala" = nearest neighbour. */
export function PlanView({ listId, places, onOpenDayMap }: { listId: Id; places: PlanPlace[]; onOpenDayMap: (day: number) => void }) {
  const { plan, update, dayPlaces, sortDay } = usePlan(listId, places);
  const [picking, setPicking] = useState<number | null>(null);

  if (!plan) return <Loading />;

  const planned = new Set(Object.values(plan.days).flat());
  const unplanned = places.filter((p) => !planned.has(p.id));

  const setDay = (day: number, ids: string[]) => update((p) => ({ ...p, days: { ...p.days, [String(day)]: ids } }));
  const move = (day: number, idx: number, delta: number) => {
    const ids = [...(plan.days[String(day)] ?? [])];
    const j = idx + delta;
    if (j < 0 || j >= ids.length) return;
    [ids[idx], ids[j]] = [ids[j], ids[idx]];
    setDay(day, ids);
  };
  const remove = (day: number, id: string) => setDay(day, (plan.days[String(day)] ?? []).filter((x) => x !== id));
  const add = (day: number, id: string) => setDay(day, [...(plan.days[String(day)] ?? []), id]);
  const setDayCount = (n: number) => update((p) => {
    const dayCount = Math.min(MAX_DAYS, Math.max(MIN_DAYS, n));
    const days: Record<string, string[]> = {};
    for (const [d, ids] of Object.entries(p.days)) if (Number(d) <= dayCount) days[d] = ids;
    return { dayCount, days };
  });

  if (places.length === 0) {
    return <Scroll><Empty text="Plan yapmak için önce listeye yer ekle." testID="plan-empty" /></Scroll>;
  }

  return (
    <Scroll contentStyle={{ gap: 6, paddingTop: 12 }} testID="plan-view">
      {Array.from({ length: plan.dayCount }, (_, i) => i + 1).map((day) => {
        const items = dayPlaces(day);
        const located = items.filter((p) => p.lat !== null && p.lon !== null).length;
        return (
          <View key={day} testID={`plan-day-${day}`} style={{ gap: 6, paddingTop: day === 1 ? 6 : 22 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 8 }}>
              <View style={{ flex: 1 }}>
                <Txt weight="extrabold" size={20} color={C.greenDark} accessibilityRole="header">Gün {day}</Txt>
                <Txt size={12} color={C.secondary} testID={`plan-summary-${day}`}>{daySummary(items)}</Txt>
              </View>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {items.length > 1 ? (
                  <Pressable
                    testID={`plan-sort-${day}`}
                    accessibilityRole="button"
                    accessibilityLabel={`Gün ${day} sırala`}
                    onPress={() => sortDay(day)}
                    style={{ minHeight: HIT, paddingHorizontal: 12, borderRadius: 12, backgroundColor: C.orangeTint, flexDirection: 'row', alignItems: 'center', gap: 6 }}
                  >
                    <Icon name="sort" size={16} color={C.orangeText} strokeWidth={2.2} />
                    <Txt weight="bold" size={13} color={C.orangeText}>Sırala</Txt>
                  </Pressable>
                ) : null}
                {located > 0 ? (
                  <IconBtn icon="map" label={`Gün ${day} haritada gör`} round={false} bg={C.greenCard} testID={`plan-daymap-${day}`} onPress={() => onOpenDayMap(day)} iconSize={20} />
                ) : null}
              </View>
            </View>

            {items.map((p, idx) => (
              <View key={p.id} testID="plan-item" style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6, paddingLeft: 10, paddingRight: 2, backgroundColor: C.rowBg, borderRadius: 14 }}>
                <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: C.orange, alignItems: 'center', justifyContent: 'center' }}>
                  <Txt weight="extrabold" size={13} color={C.orangeOn} testID="plan-item-number">{idx + 1}</Txt>
                </View>
                <CategoryIcon category={p.category} size={36} />
                <Txt weight="bold" size={15} style={{ flex: 1, minWidth: 0 }} numberOfLines={2} testID="plan-item-name">{p.name}</Txt>
                <IconBtn icon="up" label={`${p.name} yukarı taşı`} disabled={idx === 0} style={idx === 0 ? { opacity: 0.3 } : null} onPress={() => move(day, idx, -1)} testID="plan-up" />
                <IconBtn icon="down" label={`${p.name} aşağı taşı`} disabled={idx === items.length - 1} style={idx === items.length - 1 ? { opacity: 0.3 } : null} onPress={() => move(day, idx, 1)} testID="plan-down" />
                <IconBtn icon="close" label={`${p.name} günden çıkar`} color={C.secondary} onPress={() => remove(day, p.id)} testID="plan-remove" />
              </View>
            ))}

            <Pressable
              testID={`plan-add-${day}`}
              accessibilityRole="button"
              aria-disabled={unplanned.length === 0} aria-expanded={picking === day}
              disabled={unplanned.length === 0}
              onPress={() => setPicking(picking === day ? null : day)}
              style={{ minHeight: HIT, borderRadius: 12, borderWidth: 1.5, borderStyle: 'dashed', borderColor: C.dash, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 2, opacity: unplanned.length === 0 ? 0.5 : 1 }}
            >
              <Icon name="plus" size={18} color={C.greenDark} strokeWidth={2.2} />
              <Txt weight="bold" size={14} color={C.greenDark}>Kayıtlı yerlerden ekle</Txt>
            </Pressable>
            {picking === day ? (
              <View style={{ gap: 6, paddingTop: 4 }} accessibilityLabel={`Gün ${day} için yer seç`}>
                {unplanned.map((p) => (
                  <Pressable
                    key={p.id}
                    testID="plan-pick"
                    accessibilityRole="button"
                    accessibilityLabel={`${p.name} yerini Gün ${day} planına ekle`}
                    onPress={() => { add(day, p.id); if (unplanned.length <= 1) setPicking(null); }}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: HIT, paddingHorizontal: 10, borderRadius: 12, backgroundColor: C.white, borderWidth: 1, borderColor: C.border }}
                  >
                    <CategoryIcon category={p.category} size={32} />
                    <Txt weight="semibold" size={14} style={{ flex: 1 }}>{p.name}</Txt>
                    <Icon name="plus" size={18} color={C.orangeText} />
                  </Pressable>
                ))}
              </View>
            ) : null}
          </View>
        );
      })}

      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 22, paddingVertical: 8, borderTopWidth: 1, borderTopColor: C.divider }}>
        <Txt weight="semibold" size={15} testID="plan-day-count">Gün sayısı: {plan.dayCount}</Txt>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <IconBtn icon="down" label="Gün sayısını azalt" bg={C.greenCard} round={false} disabled={plan.dayCount <= MIN_DAYS} onPress={() => setDayCount(plan.dayCount - 1)} testID="plan-days-dec" />
          <IconBtn icon="plus" label="Gün sayısını artır" bg={C.greenCard} round={false} disabled={plan.dayCount >= MAX_DAYS} onPress={() => setDayCount(plan.dayCount + 1)} testID="plan-days-inc" />
        </View>
      </View>
      <Txt size={12} color={C.secondary} testID="plan-unplanned">{unplanned.length} yer henüz plana eklenmedi · Plan bu cihazda saklanır.</Txt>
    </Scroll>
  );
}
