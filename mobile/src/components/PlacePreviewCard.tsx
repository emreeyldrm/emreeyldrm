import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, useWindowDimensions, View, type ViewStyle } from 'react-native';
import { api, errMsg, type Id, type PlaceComment, type PlaceDetail, type SearchResult } from '../lib/api';
import { categoryInfo } from '../lib/categories';
import { openInGoogleMaps } from '../lib/maps';
import type { TapState } from '../lib/useMapTap';
import { C, HIT } from '../theme';
import { CatGlyph, StarIcon } from './Icon';
import type { LatLon } from './mapTypes';
import { PhotoThumbs } from './Photos';
import { distanceLabel } from './PlaceSearch';
import { Avatar, Btn, IconBtn, Txt, fmtAvg, timeAgo, webData } from './ui';

export const TAP_LOADING_TEXT = 'Yakındaki yerler aranıyor…';
export const TAP_EMPTY_TEXT = 'Burada kayıtlı bir yer bulunamadı';
export const TAP_EMPTY_HINT = 'Biraz daha yakına dokunmayı dene ya da yerin adını yukarıdaki aramaya yaz.';
export const TAP_ERROR_TEXT = 'Yakındaki yerler alınamadı';
export const CARD_MAX_HEIGHT_RATIO = 0.55;
const PREVIEW_COMMENTS = 3;

const shadow: ViewStyle = {
  shadowColor: '#17251E', shadowOpacity: 0.16, shadowRadius: 16, shadowOffset: { width: 0, height: 4 }, elevation: 6,
};
const cardStyle: ViewStyle = { backgroundColor: C.white, borderRadius: 22, ...shadow };

const VIS_BADGE: Record<string, { label: string; bg: string; fg: string }> = {
  private: { label: 'Sadece ben', bg: '#EEF1EF', fg: '#55645C' },
  friends: { label: 'Arkadaşlar', bg: C.orangeTint, fg: C.orangeText },
  public: { label: 'Herkes', bg: C.greenCard, fg: C.greenDark },
};

type Social =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'done'; placeId: Id; detail: PlaceDetail; comments: PlaceComment[] };

/**
 * Haritada seçilen yerin alt kartı (AC-MOB-29/30): hem haritaya dokunarak bulunan yer hem de arama sonucu için aynı kart.
 * Gösterilince yer `POST /places/resolve` ile Voyage'daki kaydına bağlanır; sonra ortalama/puan sayısı ve son 3 yorum
 * yüklenir. "Puanla" listeye eklemeden anında kaydeder. testID'ler `search-card*` (AC-MOB-15 ile aynı).
 */
export function PlacePreviewCard({ result, near, city, onAdd, saved, onClose, onOpenPlace, others, onPickOther, closeLabel = 'Kartı kapat' }: {
  result: SearchResult;
  near: LatLon | null;
  /** Listenin şehri: yer ilk kez oluşturulurken kaydedilir ve Google Maps sorgusunda yedek olur. */
  city?: string | null;
  /** "Listeye ekle" (yalnızca liste sahibine). */
  onAdd?: () => void;
  saved?: boolean;
  onClose: () => void;
  /** "Tüm yorumlar": yer sayfası. */
  onOpenPlace: (placeId: string) => void;
  /** "Başka bir yer mi?": dokunulan noktanın yakınındaki diğer yerler. */
  others?: SearchResult[];
  onPickOther?: (r: SearchResult) => void;
  closeLabel?: string;
}) {
  const { height } = useWindowDimensions();
  const cat = categoryInfo(result.category);
  const dist = distanceLabel(near, result);
  const [social, setSocial] = useState<Social>({ status: 'loading' });
  const [rateError, setRateError] = useState<string | null>(null);
  const [rated, setRated] = useState(false);
  const [showOthers, setShowOthers] = useState(false);
  const identity = `${result.provider}:${result.providerId}`;

  const load = useCallback((signal: { cancelled: boolean }) => {
    setSocial({ status: 'loading' });
    api.resolvePlace(result, city)
      .then(async ({ placeId }) => {
        const [detail, comments] = await Promise.all([api.getPlace(placeId), api.comments(placeId)]);
        if (!signal.cancelled) setSocial({ status: 'done', placeId, detail, comments });
      })
      .catch((e) => { if (!signal.cancelled) setSocial({ status: 'error', message: errMsg(e) }); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity, city]);

  useEffect(() => {
    const signal = { cancelled: false };
    setRateError(null);
    setRated(false);
    setShowOthers(false);
    load(signal);
    return () => { signal.cancelled = true; };
  }, [load]);

  async function rate(n: number) {
    if (social.status !== 'done') return;
    const { placeId } = social;
    setRateError(null);
    // Anında görünür; sunucu yanıtıyla ortalama ve sayı güncellenir.
    setSocial({ ...social, detail: { ...social.detail, rating: { ...social.detail.rating, mine: n } } });
    try {
      await api.rate(placeId, n);
      const detail = await api.getPlace(placeId);
      setSocial((s) => (s.status === 'done' && s.placeId === placeId ? { ...s, detail } : s));
      setRated(true);
    } catch (e) {
      setRateError(`Puan kaydedilemedi: ${errMsg(e)}`);
      setSocial((s) => (s.status === 'done' && s.placeId === placeId ? { ...s, detail: social.detail } : s));
    }
  }

  const rating = social.status === 'done' ? social.detail.rating : null;
  const preview = social.status === 'done' ? social.comments.slice(0, PREVIEW_COMMENTS) : [];

  return (
    <View testID="search-card" {...webData({ category: cat.key, providerId: result.providerId })} style={[cardStyle, { maxHeight: Math.round(height * CARD_MAX_HEIGHT_RATIO), flexShrink: 1, overflow: 'hidden' }]}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingLeft: 16, paddingRight: 6, paddingTop: 12 }}>
        <View style={{ flex: 1, gap: 3, paddingTop: 4 }}>
          <Txt weight="extrabold" size={19} numberOfLines={2} testID="search-card-name">{result.name}</Txt>
          {result.address ? <Txt size={13} color={C.secondary} numberOfLines={2} testID="search-card-address">{result.address}</Txt> : null}
        </View>
        <IconBtn icon="close" label={closeLabel} onPress={onClose} color={C.secondary} testID="search-card-close" />
      </View>

      <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 16, paddingTop: 6, gap: 12 }} nestedScrollEnabled keyboardShouldPersistTaps="handled">
        <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <View testID="search-card-category" {...webData({ category: cat.key })} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: cat.tint, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 5 }}>
            <CatGlyph category={cat.key} size={14} color={cat.color} />
            <Txt weight="bold" size={12} color={cat.color}>{cat.title}</Txt>
          </View>
          {dist ? <Txt size={12} weight="semibold" color={C.greenDark} testID="search-card-distance">{dist}</Txt> : null}
          {rating ? (
            <View testID="search-card-rating" accessibilityLabel={`Voyage ortalaması ${fmtAvg(rating.avg)}, ${rating.count} puan`} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <StarIcon size={14} filled={rating.avg !== null} />
              <Txt weight="extrabold" size={13} testID="search-card-avg">{fmtAvg(rating.avg)}</Txt>
              <Txt size={12} color={C.secondary}>· <Txt size={12} color={C.secondary} testID="search-card-count">{rating.count}</Txt> puan</Txt>
            </View>
          ) : null}
        </View>

        {others && others.length && onPickOther ? (
          <View style={{ gap: 4 }}>
            <Pressable
              testID="search-card-others-toggle"
              accessibilityRole="button"
              aria-expanded={showOthers}
              accessibilityLabel={`Başka bir yer mi? Yakında ${others.length} yer daha`}
              onPress={() => setShowOthers(!showOthers)}
              style={{ minHeight: 36, justifyContent: 'center', alignSelf: 'flex-start' }}
            >
              <Txt weight="bold" size={13} color={C.orangeText}>Başka bir yer mi? ({others.length}) {showOthers ? '▴' : '▾'}</Txt>
            </Pressable>
            {showOthers ? (
              <View accessibilityRole="list" testID="search-card-others" style={{ borderRadius: 14, borderWidth: 1, borderColor: C.divider, overflow: 'hidden' }}>
                {others.map((o, i) => {
                  const oc = categoryInfo(o.category);
                  const od = distanceLabel(near, o);
                  return (
                    <Pressable
                      key={`${o.provider}:${o.providerId}`}
                      testID="search-card-other"
                      accessibilityRole="button"
                      accessibilityLabel={`${o.name}, ${oc.title}${od ? `, ${od}` : ''}`}
                      {...webData({ category: oc.key, providerId: o.providerId })}
                      onPress={() => onPickOther(o)}
                      style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, minHeight: HIT, backgroundColor: pressed ? C.greenSoft : C.white }, i ? { borderTopWidth: 1, borderTopColor: C.divider } : null]}
                    >
                      <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: oc.tint, alignItems: 'center', justifyContent: 'center' }}>
                        <CatGlyph category={oc.key} size={15} color={oc.color} />
                      </View>
                      <Txt weight="semibold" size={14} numberOfLines={1} style={{ flex: 1 }} testID="search-card-other-name">{o.name}</Txt>
                      {od ? <Txt size={12} color={C.secondary}>{od}</Txt> : null}
                    </Pressable>
                  );
                })}
              </View>
            ) : null}
          </View>
        ) : null}

        <View style={{ flexDirection: 'row', gap: 10 }}>
          {onAdd ? (
            <Btn
              title={saved ? 'Listede var' : 'Listeye ekle'}
              icon={saved ? 'check' : 'plus'}
              variant={saved ? 'soft' : 'primary'}
              disabled={saved}
              height={46}
              style={{ flex: 1 }}
              onPress={onAdd}
              testID="search-card-add"
            />
          ) : null}
          <Btn
            title="Google Maps'te aç" icon="pin" variant="outline" small height={46} style={{ flex: 1.3, minHeight: 46 }}
            onPress={() => openInGoogleMaps({ ...result, city })}
            testID="search-card-maps"
          />
        </View>

        {/* Puanla: listeye eklemeden anında kaydedilir. */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: C.greenCard, borderRadius: 14, paddingLeft: 14, paddingRight: 2 }}>
          <Txt weight="bold" size={14} color={C.greenDark} numberOfLines={1} style={{ flexShrink: 1 }} testID="search-card-rate-label">{rated ? 'Kaydedildi' : 'Puanla'}</Txt>
          <View style={{ flexDirection: 'row' }} accessibilityRole="radiogroup" accessibilityLabel="Puanla" testID="search-card-rate">
            {[1, 2, 3, 4, 5].map((n) => (
              <Pressable
                key={n}
                testID={`search-card-star-${n}`}
                accessibilityRole="radio"
                accessibilityLabel={`${n} yıldız ver`}
                aria-checked={rating?.mine === n}
                aria-disabled={!rating}
                disabled={!rating}
                onPress={() => rate(n)}
                style={{ width: 40, height: HIT, alignItems: 'center', justifyContent: 'center', opacity: rating ? 1 : 0.5 }}
              >
                <StarIcon size={24} filled={!!rating?.mine && n <= rating.mine} />
              </Pressable>
            ))}
          </View>
        </View>
        {rateError ? <Txt size={13} color={C.danger} weight="semibold" accessibilityRole="alert" testID="search-card-rate-error">{rateError}</Txt> : null}

        <View style={{ gap: 10 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Txt weight="extrabold" size={15} color={C.greenDark} accessibilityRole="header">Son yorumlar</Txt>
            <Pressable
              testID="search-card-all-comments"
              accessibilityRole="link"
              accessibilityLabel="Tüm yorumlar"
              aria-disabled={social.status !== 'done'}
              disabled={social.status !== 'done'}
              onPress={() => { if (social.status === 'done') onOpenPlace(String(social.placeId)); }}
              style={{ minHeight: HIT, justifyContent: 'center', paddingLeft: 8, opacity: social.status === 'done' ? 1 : 0.5 }}
            >
              <Txt weight="bold" size={13} color={C.green}>Tüm yorumlar ›</Txt>
            </Pressable>
          </View>
          {social.status === 'loading' ? (
            <View testID="search-card-loading" accessibilityLabel="Yükleniyor" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <ActivityIndicator color={C.green} size="small" />
              <Txt size={13} color={C.secondary}>Puanlar ve yorumlar yükleniyor…</Txt>
            </View>
          ) : social.status === 'error' ? (
            <View testID="search-card-error" accessibilityRole="alert" style={{ gap: 6 }}>
              <Txt size={13} color={C.danger} weight="semibold">Puan ve yorumlar yüklenemedi ({social.message}).</Txt>
              <Btn title="Tekrar dene" variant="soft" small icon="refresh" style={{ alignSelf: 'flex-start' }} onPress={() => load({ cancelled: false })} testID="search-card-retry" />
            </View>
          ) : preview.length === 0 ? (
            <Txt size={13} color={C.secondary} testID="search-card-comments-empty">Henüz yorum yok. İlk yorumu sen yaz.</Txt>
          ) : (
            <View style={{ gap: 12 }} testID="search-card-comments">
              {preview.map((c) => {
                const b = VIS_BADGE[c.visibility] ?? VIS_BADGE.public;
                return (
                  <View key={String(c.id)} testID="search-card-comment" style={{ flexDirection: 'row', gap: 10 }}>
                    <Avatar name={c.author} size={30} />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Txt weight="bold" size={13} numberOfLines={1} style={{ flexShrink: 1 }} testID="search-card-comment-author">@{c.author}</Txt>
                        <Txt size={11} color={C.secondary}>{timeAgo(c.createdAt)}</Txt>
                        <View style={{ backgroundColor: b.bg, borderRadius: 10, paddingHorizontal: 7, paddingVertical: 2, marginLeft: 'auto' }}>
                          <Txt weight="bold" size={10} color={b.fg} testID="search-card-comment-badge">{b.label}</Txt>
                        </View>
                      </View>
                      {c.body ? <Txt size={13} numberOfLines={3} style={{ lineHeight: 18, marginTop: 1 }} testID="search-card-comment-text">{c.body}</Txt> : null}
                      <PhotoThumbs ids={c.photos} size={44} testID="search-card-comment-photos" />
                    </View>
                  </View>
                );
              })}
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

/**
 * Haritaya dokununca alttaki kart (AC-MOB-28): aranırken, bulunamayınca ve hata olunca kısa bir durum kartı;
 * yer bulununca en yakın yer PlacePreviewCard ile, diğerleri "Başka bir yer mi?" altında.
 */
export function TapPreview({ tap, near, city, onChoose, onClose, onRetry, onAdd, isSaved, onOpenPlace }: {
  tap: TapState;
  near: LatLon | null;
  city?: string | null;
  onChoose: (index: number) => void;
  onClose: () => void;
  onRetry: () => void;
  onAdd?: (r: SearchResult) => void;
  isSaved?: (r: SearchResult) => boolean;
  onOpenPlace: (placeId: string) => void;
}) {
  const current = tap.status === 'done' ? tap.results[tap.index] : undefined;
  if (current) {
    const others = tap.results.filter((_, i) => i !== tap.index);
    return (
      <PlacePreviewCard
        result={current}
        near={near ?? tap.point}
        city={city}
        onAdd={onAdd ? () => onAdd(current) : undefined}
        saved={isSaved?.(current)}
        onClose={onClose}
        onOpenPlace={onOpenPlace}
        others={others}
        onPickOther={(r) => onChoose(tap.results.indexOf(r))}
      />
    );
  }
  return (
    <View testID="tap-card" style={[cardStyle, { padding: 16, flexDirection: 'row', alignItems: 'flex-start', gap: 10 }]}>
      <View style={{ flex: 1, gap: 6 }}>
        {tap.status === 'loading' ? (
          <View testID="tap-loading" accessibilityLabel={TAP_LOADING_TEXT} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: HIT }}>
            <ActivityIndicator color={C.green} />
            <Txt size={14} color={C.secondary}>{tap.poiName ? `${tap.poiName} aranıyor…` : TAP_LOADING_TEXT}</Txt>
          </View>
        ) : tap.status === 'offline' ? (
          <View testID="tap-offline" accessibilityRole="alert" style={{ gap: 4 }}>
            <Txt weight="bold" size={15}>Çevrimdışısın</Txt>
            <Txt size={13} color={C.secondary}>Haritaya dokunarak yer bulmak için internet bağlantısı gerekli.</Txt>
          </View>
        ) : tap.status === 'error' ? (
          <View testID="tap-error" accessibilityRole="alert" style={{ gap: 8 }}>
            <Txt weight="bold" size={15} color={C.danger}>{TAP_ERROR_TEXT}</Txt>
            <Btn title="Tekrar dene" variant="soft" small icon="refresh" style={{ alignSelf: 'flex-start' }} onPress={onRetry} testID="tap-retry" />
          </View>
        ) : (
          <View testID="tap-empty" style={{ gap: 4 }}>
            <Txt weight="bold" size={15}>{TAP_EMPTY_TEXT}</Txt>
            <Txt size={13} color={C.secondary}>{TAP_EMPTY_HINT}</Txt>
          </View>
        )}
      </View>
      <IconBtn icon="close" label="Kartı kapat" onPress={onClose} color={C.secondary} testID="tap-card-close" />
    </View>
  );
}
