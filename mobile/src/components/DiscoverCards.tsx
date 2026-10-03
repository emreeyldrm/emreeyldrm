import { Pressable, ScrollView, View } from 'react-native';
import type { Category, PlaceCard } from '../lib/api';
import { CATEGORIES, categoryInfo } from '../lib/categories';
import { cardStats } from '../lib/discover';
import { C, HIT } from '../theme';
import { CatGlyph, Icon, StarIcon } from './Icon';
import { CategoryIcon, Txt, fmtAvg, webData } from './ui';

const label = (c: PlaceCard) => `${c.name}, ${categoryInfo(c.category).title}, ${cardStats(c)}`;

/** "Haftanın restoranı" büyük kartı (AC-MOB-26). */
export function HeroCard({ card, onPress }: { card: PlaceCard; onPress: () => void }) {
  const cat = categoryInfo(card.category);
  return (
    <Pressable
      testID="pow-card"
      accessibilityRole="button"
      accessibilityLabel={`Haftanın restoranı: ${label(card)}`}
      {...webData({ placeId: String(card.placeId) })}
      onPress={onPress}
      style={({ pressed }) => ({ backgroundColor: C.greenCard, borderRadius: 22, padding: 18, gap: 14, opacity: pressed ? 0.85 : 1 })}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.orange, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 6 }}>
          <Txt weight="bold" size={12} color={C.orangeOn}>Bu hafta zirvede</Txt>
        </View>
        <Txt weight="semibold" size={12} color={C.greenDark}>{`Trend puanı ${card.score}`}</Txt>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        <CategoryIcon category={card.category} size={60} />
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Txt weight="extrabold" size={22} style={{ lineHeight: 27 }} numberOfLines={2} testID="pow-name">{card.name}</Txt>
          <Txt size={13} color={C.secondary} numberOfLines={1}>{card.city ? `${cat.title} · ${card.city}` : cat.title}</Txt>
        </View>
        <Icon name="chevron" size={20} color={C.greenDark} />
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.white, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 10 }}>
        <StarIcon size={16} filled={card.avgStars !== null} />
        <Txt weight="bold" size={14} testID="pow-stats" style={{ flex: 1 }}>{cardStats(card)}</Txt>
      </View>
    </Pressable>
  );
}

/** "Haftanın trendleri" yatay kartı. */
export function TrendCard({ card, rank, onPress }: { card: PlaceCard; rank: number; onPress: () => void }) {
  const cat = categoryInfo(card.category);
  return (
    <Pressable
      testID="trend-card"
      accessibilityRole="button"
      accessibilityLabel={`${rank}. ${label(card)}`}
      {...webData({ placeId: String(card.placeId) })}
      onPress={onPress}
      style={({ pressed }) => ({
        width: 172, minHeight: 156, backgroundColor: C.white, borderRadius: 18, borderWidth: 1, borderColor: C.border,
        padding: 14, gap: 10, opacity: pressed ? 0.85 : 1,
      })}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <CategoryIcon category={card.category} size={40} />
        <Txt weight="extrabold" size={15} color={C.orangeText}>{`#${rank}`}</Txt>
      </View>
      <View style={{ gap: 3, flex: 1 }}>
        <Txt weight="bold" size={15} numberOfLines={2} style={{ lineHeight: 20 }} testID="trend-name">{card.name}</Txt>
        <Txt weight="semibold" size={12} color={cat.color}>{cat.title}</Txt>
      </View>
      <Txt size={12} color={C.secondary} testID="trend-stats" style={{ lineHeight: 16 }}>{cardStats(card)}</Txt>
    </Pressable>
  );
}

/** Dikey satır ("En çok beğenilenler", "En çok aranan"); Discover.dc.html "Yakındaki en iyi yerler" gibi. */
export function PlaceRow({ card, kind, onPress }: { card: PlaceCard; kind: 'top' | 'searched'; onPress: () => void }) {
  const cat = categoryInfo(card.category);
  return (
    <Pressable
      testID={`${kind}-row`}
      accessibilityRole="button"
      accessibilityLabel={label(card)}
      {...webData({ placeId: String(card.placeId) })}
      onPress={onPress}
      style={({ pressed }) => ({ minHeight: HIT + 16, flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 6, opacity: pressed ? 0.7 : 1 })}
    >
      <CategoryIcon category={card.category} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt weight="bold" size={16} numberOfLines={1} testID={`${kind}-name`}>{card.name}</Txt>
        <Txt size={13} color={C.secondary} style={{ marginTop: 2 }} testID={`${kind}-stats`} numberOfLines={2}>{`${cat.title} · ${cardStats(card, kind !== 'top')}`}</Txt>
      </View>
      {kind === 'top' ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <StarIcon size={15} filled={card.avgStars !== null} />
          <Txt weight="extrabold" size={15}>{fmtAvg(card.avgStars)}</Txt>
        </View>
      ) : (
        <View style={{ alignItems: 'flex-end' }}>
          <Txt weight="extrabold" size={15} color={C.greenDark}>{card.score}</Txt>
          <Txt size={11} color={C.secondary}>ilgi</Txt>
        </View>
      )}
    </Pressable>
  );
}

export type TopFilter = Category | 'all';

/** "En çok beğenilenler" kategori çipleri: Hepsi + sayısı 0'dan büyük kategoriler. */
export function TopChips({ counts, value, onChange }: {
  counts: Partial<Record<Category, number>>; value: TopFilter; onChange: (f: TopFilter) => void;
}) {
  const cats = CATEGORIES.filter((c) => (counts[c.key] ?? 0) > 0);
  if (!cats.length) return null;
  const allOn = value === 'all';
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      accessibilityLabel="Kategori"
      testID="top-chips"
      contentContainerStyle={{ gap: 8 }}
      style={{ flexGrow: 0 }}
    >
      <Pressable
        testID="top-chip-all"
        accessibilityRole="button"
        aria-selected={allOn}
        onPress={() => onChange('all')}
        style={{ minHeight: HIT, paddingHorizontal: 16, borderRadius: 22, backgroundColor: allOn ? C.green : C.greenCard, justifyContent: 'center' }}
      >
        <Txt weight="bold" size={13} color={allOn ? C.white : C.greenDark}>Hepsi</Txt>
      </Pressable>
      {cats.map((c) => {
        const on = value === c.key;
        return (
          <Pressable
            key={c.key}
            testID={`top-chip-${c.key}`}
            accessibilityRole="button"
            accessibilityLabel={`${c.title}, ${counts[c.key]} yer`}
            aria-selected={on}
            onPress={() => onChange(on ? 'all' : c.key)}
            style={{ minHeight: HIT, paddingLeft: 10, paddingRight: 14, borderRadius: 22, backgroundColor: on ? c.color : c.tint, flexDirection: 'row', alignItems: 'center', gap: 6 }}
          >
            <CatGlyph category={c.key} size={16} color={on ? C.white : c.color} />
            <Txt weight="bold" size={13} color={on ? C.white : c.color}>{c.title}</Txt>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
