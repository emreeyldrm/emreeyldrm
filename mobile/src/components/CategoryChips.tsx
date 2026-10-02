import { Pressable, ScrollView } from 'react-native';
import type { Category } from '../lib/api';
import { CATEGORIES } from '../lib/categories';
import { C } from '../theme';
import { CatGlyph } from './Icon';
import { Txt, webData } from './ui';

export type Filter = Category | 'all';

/** Horizontal filter chips: "Hepsi" + used categories, tint background + dark icon (CityList.dc.html). */
export function CategoryChips({ used, value, onChange, total }: { used: Category[]; value: Filter; onChange: (f: Filter) => void; total: number }) {
  const cats = CATEGORIES.filter((c) => used.includes(c.key));
  const allOn = value === 'all';
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      accessibilityLabel="Kategori filtresi"
      testID="category-filters"
      contentContainerStyle={{ gap: 8, paddingHorizontal: 20, paddingVertical: 10 }}
      style={{ flexGrow: 0 }}
    >
      <Pressable
        testID="filter-all"
        accessibilityRole="button"
        aria-selected={allOn}
        {...webData({ pressed: String(allOn) })}
        onPress={() => onChange('all')}
        style={{ minHeight: 44, paddingHorizontal: 14, borderRadius: 22, backgroundColor: allOn ? C.green : C.greenCard, justifyContent: 'center' }}
      >
        <Txt weight="bold" size={13} color={allOn ? C.white : C.greenDark}>Hepsi ({total})</Txt>
      </Pressable>
      {cats.map((c) => {
        const on = value === c.key;
        return (
          <Pressable
            key={c.key}
            testID={`filter-${c.key}`}
            accessibilityRole="button"
            accessibilityLabel={c.title}
            aria-selected={on}
            onPress={() => onChange(on ? 'all' : c.key)}
            style={{ minHeight: 44, paddingLeft: 10, paddingRight: 14, borderRadius: 22, backgroundColor: on ? c.color : c.tint, flexDirection: 'row', alignItems: 'center', gap: 6 }}
          >
            <CatGlyph category={c.key} size={16} color={on ? C.white : c.color} />
            <Txt weight="bold" size={13} color={on ? C.white : c.color}>{c.title}</Txt>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
