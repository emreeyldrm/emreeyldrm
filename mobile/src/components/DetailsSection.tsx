import { useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import type { Category } from '../lib/api';
import {
  autoRecommendation, COMMON_CURRENCIES, compactDetails, hasService, MAX_FAVORITE_LENGTH, MAX_FAVORITES, MAX_SPEND,
  parseAmount, fmtAmount, RECOMMENDATION_LABEL, takeoutReason, WAIT_RANGES,
  type PlaceDetails, type Recommendation, type WaitRange,
} from '../lib/details';
import type { PhotoUploads } from '../lib/media';
import { C, F, HIT } from '../theme';
import { Icon } from './Icon';
import { PhotoPicker } from './Photos';
import { Txt } from './ui';

/** Form state of the "Detaylar" section; turned into `details` with `draftToDetails`. */
export interface DetailsDraft {
  dineIn: boolean;
  takeout: boolean;
  waitDineIn?: WaitRange;
  waitTakeout?: WaitRange;
  /** The user's own choice; null = follow the automatic suggestion (AC-MOB-22). */
  recManual: Recommendation | null;
  spendText: string;
  currency: string;
  favorites: string[];
}

export function draftFromDetails(d: PlaceDetails | undefined | null, defaultCurrency: string): DetailsDraft {
  const base = { dineIn: !!d?.dineIn, takeout: !!d?.takeout, waitDineIn: d?.waitDineIn, waitTakeout: d?.waitTakeout };
  const auto = autoRecommendation(base);
  return {
    ...base,
    recManual: d?.recommendation && d.recommendation !== auto ? d.recommendation : null,
    spendText: typeof d?.spendPerPerson === 'number' ? fmtAmount(d.spendPerPerson) : '',
    currency: d?.currency ?? defaultCurrency,
    favorites: d?.favorites ?? [],
  };
}

export const effectiveRecommendation = (d: DetailsDraft): Recommendation | null => d.recManual ?? autoRecommendation(d);

/** Draft -> `details` for the API, or a Turkish error. Service fields are kept only for food/coffee/bar. */
export function draftToDetails(d: DetailsDraft, category: Category, photos: string[]): { details: PlaceDetails } | { error: string } {
  const amount = parseAmount(d.spendText);
  if (amount !== null && (Number.isNaN(amount) || amount < 0 || amount > MAX_SPEND))
    return { error: 'Kişi başı tutar 0 ile 100.000 arasında bir sayı olmalı.' };
  const out: PlaceDetails = { photos };
  if (amount !== null) { out.spendPerPerson = amount; out.currency = d.currency; }
  if (hasService(category)) {
    if (d.dineIn) { out.dineIn = true; out.waitDineIn = d.waitDineIn; }
    if (d.takeout) { out.takeout = true; out.waitTakeout = d.waitTakeout; }
    if (d.dineIn || d.takeout) out.recommendation = effectiveRecommendation(d) ?? undefined;
    out.favorites = d.favorites;
  }
  return { details: compactDetails(out) };
}

const waitId = (w: WaitRange) => w.replace('+', 'plus');

function Chip({ label, on, onPress, testID, role = 'radio', a11y }: {
  label: string; on: boolean; onPress: () => void; testID: string; role?: 'radio' | 'checkbox'; a11y?: string;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole={role}
      accessibilityLabel={a11y ?? label}
      aria-checked={on}
      onPress={onPress}
      style={{ minHeight: HIT, paddingHorizontal: 14, borderRadius: 22, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: on ? C.green : C.greenCard }}
    >
      {role === 'checkbox' ? <Icon name={on ? 'check' : 'plus'} size={14} color={on ? C.white : C.greenDark} strokeWidth={2.6} /> : null}
      <Txt weight="bold" size={13} color={on ? C.white : C.greenDark}>{label}</Txt>
    </Pressable>
  );
}

const Label = ({ children }: { children: string }) => <Txt weight="semibold" size={13} color={C.secondary}>{children}</Txt>;

/**
 * "Detaylar" (AC-MOB-21..23): service (Masada / Paket) with wait ranges, "Önerim", favourite dishes as tags
 * (food/coffee/bar only), average spend per person with currency, and up to 6 photos.
 */
export function DetailsSection({ category, draft, onChange, photos, open, onToggle }: {
  category: Category; draft: DetailsDraft; onChange: (d: DetailsDraft) => void; photos: PhotoUploads;
  open: boolean; onToggle: () => void;
}) {
  const [fav, setFav] = useState('');
  const [currencyOpen, setCurrencyOpen] = useState(false);
  const set = (p: Partial<DetailsDraft>) => onChange({ ...draft, ...p });
  const service = hasService(category);
  const rec = effectiveRecommendation(draft);
  const autoTakeout = !draft.recManual && rec === 'takeout';

  function addFavorite() {
    const t = fav.trim().slice(0, MAX_FAVORITE_LENGTH);
    if (!t) return;
    if (draft.favorites.length >= MAX_FAVORITES) return;
    if (!draft.favorites.some((f) => f.toLocaleLowerCase('tr') === t.toLocaleLowerCase('tr'))) set({ favorites: [...draft.favorites, t] });
    setFav('');
  }

  const currencies = COMMON_CURRENCIES.includes(draft.currency) ? COMMON_CURRENCIES : [draft.currency, ...COMMON_CURRENCIES];

  return (
    <View style={{ gap: 12, backgroundColor: C.greenSoft, borderRadius: 18, padding: 14 }}>
      <Pressable
        testID="details-toggle"
        accessibilityRole="button"
        aria-expanded={open}
        accessibilityLabel="Detaylar"
        onPress={onToggle}
        style={{ minHeight: HIT, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
      >
        <View>
          <Txt weight="extrabold" size={16} color={C.greenDark}>Detaylar</Txt>
          <Txt size={12} color={C.secondary}>{service ? 'Servis, bekleme, favoriler, harcama, fotoğraf' : 'Harcama ve fotoğraf'}</Txt>
        </View>
        <Icon name={open ? 'up' : 'down'} size={20} color={C.greenDark} />
      </Pressable>

      {open ? (
        <View testID="details-section" style={{ gap: 14 }}>
          {service ? (
            <>
              <View style={{ gap: 6 }}>
                <Label>Servis</Label>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <Chip role="checkbox" label="Masada" a11y="Masada servis var" on={draft.dineIn} onPress={() => set({ dineIn: !draft.dineIn })} testID="svc-dine-in" />
                  <Chip role="checkbox" label="Paket" a11y="Paket servis var" on={draft.takeout} onPress={() => set({ takeout: !draft.takeout })} testID="svc-takeout" />
                </View>
              </View>
              {([['dineIn', 'waitDineIn', 'Masada bekleme', 'wait-dine-in'], ['takeout', 'waitTakeout', 'Paket bekleme', 'wait-takeout']] as const).map(([flag, key, title, tid]) =>
                draft[flag] ? (
                  <View key={key} style={{ gap: 6 }}>
                    <Label>{title}</Label>
                    <View accessibilityRole="radiogroup" accessibilityLabel={title} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                      {WAIT_RANGES.map((w) => (
                        <Chip key={w} label={`${w} dk`} a11y={`${title} ${w} dakika`} on={draft[key] === w} onPress={() => set({ [key]: draft[key] === w ? undefined : w })} testID={`${tid}-${waitId(w)}`} />
                      ))}
                    </View>
                  </View>
                ) : null)}
              {draft.dineIn || draft.takeout ? (
                <View style={{ gap: 6 }}>
                  <Label>Önerim</Label>
                  <View accessibilityRole="radiogroup" accessibilityLabel="Önerim" style={{ flexDirection: 'row', backgroundColor: C.input, borderRadius: 12, padding: 3, gap: 2 }}>
                    {(['dine_in', 'takeout', 'either'] as const).map((r) => {
                      const on = rec === r;
                      return (
                        <Pressable
                          key={r}
                          testID={`rec-${r}`}
                          accessibilityRole="radio"
                          aria-checked={on}
                          accessibilityLabel={RECOMMENDATION_LABEL[r]}
                          onPress={() => set({ recManual: r })}
                          style={{ flex: 1, minHeight: HIT, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? C.green : 'transparent' }}
                        >
                          <Txt weight={on ? 'bold' : 'semibold'} size={13} color={on ? C.white : C.secondary}>{RECOMMENDATION_LABEL[r]}</Txt>
                        </Pressable>
                      );
                    })}
                  </View>
                  {autoTakeout ? (
                    <View testID="rec-reason" accessibilityLiveRegion="polite" style={{ flexDirection: 'row', gap: 8, alignItems: 'center', backgroundColor: C.orangeTint, borderRadius: 12, padding: 10 }}>
                      <Txt weight="semibold" size={13} color={C.orangeText} style={{ flex: 1 }}>{takeoutReason(draft.waitDineIn)}</Txt>
                    </View>
                  ) : null}
                </View>
              ) : null}
              <View style={{ gap: 6 }}>
                <Label>Favori yiyecekler</Label>
                {draft.favorites.length ? (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }} testID="fav-tags">
                    {draft.favorites.map((f, i) => (
                      <View key={`${f}-${i}`} testID="fav-tag" style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: C.orangeTint, borderRadius: 18, paddingLeft: 12 }}>
                        <Txt weight="bold" size={13} color={C.orangeOn}>{f}</Txt>
                        <Pressable
                          testID="fav-remove"
                          accessibilityRole="button"
                          accessibilityLabel={`${f} sil`}
                          onPress={() => set({ favorites: draft.favorites.filter((_, j) => j !== i) })}
                          style={{ width: 36, height: HIT, alignItems: 'center', justifyContent: 'center' }}
                        >
                          <Icon name="close" size={14} color={C.orangeText} strokeWidth={2.6} />
                        </Pressable>
                      </View>
                    ))}
                  </View>
                ) : null}
                {draft.favorites.length < MAX_FAVORITES ? (
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <TextInput
                      testID="fav-input"
                      value={fav}
                      onChangeText={setFav}
                      onSubmitEditing={addFavorite}
                      blurOnSubmit={false}
                      returnKeyType="done"
                      maxLength={MAX_FAVORITE_LENGTH}
                      placeholder="Örn. Lahmacun"
                      placeholderTextColor={C.secondary}
                      accessibilityLabel="Favori yiyecek"
                      style={{ flex: 1, minHeight: HIT, borderRadius: 14, backgroundColor: C.input, paddingHorizontal: 14, fontFamily: F.regular, fontSize: 15, color: C.text }}
                    />
                    <Pressable testID="fav-add" accessibilityRole="button" accessibilityLabel="Favori ekle" onPress={addFavorite} style={{ minHeight: HIT, paddingHorizontal: 16, borderRadius: 14, backgroundColor: C.green, alignItems: 'center', justifyContent: 'center' }}>
                      <Txt weight="bold" size={14} color={C.white}>Ekle</Txt>
                    </Pressable>
                  </View>
                ) : <Txt size={12} color={C.secondary}>En çok {MAX_FAVORITES} favori eklenebilir.</Txt>}
              </View>
            </>
          ) : null}

          <View style={{ gap: 6 }}>
            <Label>Kişi başı ortalama</Label>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TextInput
                testID="spend-amount"
                value={draft.spendText}
                onChangeText={(t) => set({ spendText: t.replace(/[^0-9.,]/g, '') })}
                keyboardType="decimal-pad"
                placeholder="Örn. 12"
                placeholderTextColor={C.secondary}
                accessibilityLabel="Kişi başı ortalama tutar"
                style={{ flex: 1, minHeight: HIT, borderRadius: 14, backgroundColor: C.input, paddingHorizontal: 14, fontFamily: F.regular, fontSize: 15, color: C.text }}
              />
              <Pressable
                testID="spend-currency"
                accessibilityRole="button"
                accessibilityLabel={`Para birimi ${draft.currency}, değiştir`}
                aria-expanded={currencyOpen}
                onPress={() => setCurrencyOpen(!currencyOpen)}
                style={{ minHeight: HIT, minWidth: 84, paddingHorizontal: 12, borderRadius: 14, backgroundColor: C.greenCard, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 }}
              >
                <Txt weight="bold" size={14} color={C.greenDark}>{draft.currency}</Txt>
                <Icon name={currencyOpen ? 'up' : 'down'} size={14} color={C.greenDark} />
              </Pressable>
            </View>
            {currencyOpen ? (
              <View accessibilityRole="radiogroup" accessibilityLabel="Para birimi" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {currencies.map((c) => (
                  <Chip key={c} label={c} on={draft.currency === c} onPress={() => { set({ currency: c }); setCurrencyOpen(false); }} testID={`currency-${c}`} />
                ))}
              </View>
            ) : null}
          </View>

          <View style={{ gap: 6 }}>
            <Label>{`Fotoğraflar (en çok ${photos.max})`}</Label>
            <PhotoPicker uploads={photos} testID="place-photos" />
          </View>
        </View>
      ) : null}
    </View>
  );
}
