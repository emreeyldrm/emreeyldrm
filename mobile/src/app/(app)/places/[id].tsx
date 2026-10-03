import { useCallback, useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, TextInput, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { goBack } from '../../../components/Header';
import { CatGlyph, Icon, StarIcon } from '../../../components/Icon';
import { PhotoPicker, PhotoThumbs } from '../../../components/Photos';
import { Avatar, Btn, ErrorMsg, IconBtn, InfoMsg, Loading, PendingBadge, Screen, Txt, fmtAvg, timeAgo, webData } from '../../../components/ui';
import { api, errMsg, isPendingId, type CommentVisibility, type Id, type PlaceComment, type PlaceDetail } from '../../../lib/api';
import { useDataVersion } from '../../../lib/offlineStore';
import { runOrQueue, tempId } from '../../../lib/sync';
import { useAuth } from '../../../lib/auth';
import { categoryInfo } from '../../../lib/categories';
import { openInGoogleMaps } from '../../../lib/maps';
import { MAX_COMMENT_PHOTOS } from '../../../lib/details';
import { CAMERA_AVAILABLE, usePhotoUploads } from '../../../lib/media';
import { C, F, HIT } from '../../../theme';

const VIS: { key: CommentVisibility; label: string }[] = [
  { key: 'private', label: 'Sadece ben' },
  { key: 'friends', label: 'Arkadaşlar' },
  { key: 'public', label: 'Herkes' },
];
const visLabel = (v: string) => VIS.find((x) => x.key === v)?.label ?? v;
const BADGE: Record<CommentVisibility, { bg: string; fg: string }> = {
  private: { bg: '#EEF1EF', fg: '#55645C' },
  friends: { bg: C.orangeTint, fg: C.orangeText },
  public: { bg: C.greenCard, fg: C.greenDark },
};

/** Place page (PlaceReviews.dc.html): rating, distribution, "Senin puanın", comments with visibility — AC-MOB-5, 6, 8, 13. */
export default function PlaceScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const [place, setPlace] = useState<PlaceDetail | null>(null);
  const [comments, setComments] = useState<PlaceComment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [body, setBody] = useState('');
  const [vis, setVis] = useState<CommentVisibility>('public');
  const [menuFor, setMenuFor] = useState<Id | null>(null);
  const [sending, setSending] = useState(false);
  // Yorum fotoğrafları (AC-MOB-25): en çok 4, gönderilmeden önce yüklenir.
  const photos = usePhotoUploads(MAX_COMMENT_PHOTOS);
  const [photoMenu, setPhotoMenu] = useState(false);

  // Çevrimdışı: önbellekteki yer ve yorumlar + bekleyen puan/yorumlar (AC-OFF-1/2); sıra değişince yeniden yüklenir.
  const version = useDataVersion();
  const loadPlace = useCallback(() => { api.getPlace(id).then(setPlace).catch((e) => setError(errMsg(e))); }, [id, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const loadComments = useCallback(() => { api.comments(id).then(setComments).catch((e) => setError(errMsg(e))); }, [id, version]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { loadPlace(); loadComments(); }, [loadPlace, loadComments]);

  async function rate(n: number) {
    setError(null);
    try {
      await runOrQueue({ type: 'rate', placeId: String(id), stars: n, placeName: place?.place.name }, () => api.rate(id, n));
      loadPlace();
    } catch (e) { setError(errMsg(e)); }
  }

  async function post() {
    setError(null);
    if (photos.busy) { setError('Fotoğraflar yükleniyor, biraz bekle.'); return; }
    if (!body.trim() && !photos.ids.length) { setError('Yorum boş olamaz.'); return; }
    setSending(true);
    try {
      const text = body.trim();
      await runOrQueue(
        { type: 'comment', placeId: String(id), tempId: tempId(), body: text, visibility: vis, photos: photos.ids, placeName: place?.place.name },
        () => api.addComment(id, text, vis, photos.ids),
      );
      setBody('');
      photos.reset();
      loadComments();
    } catch (e) { setError(errMsg(e)); } finally { setSending(false); }
  }

  function addPhoto(source: 'library' | 'camera') {
    setPhotoMenu(false);
    void photos.add(source);
  }

  async function act(fn: () => Promise<unknown>, msg?: string) {
    setMenuFor(null); setError(null); setInfo(null);
    try { await fn(); if (msg) setInfo(msg); loadComments(); } catch (e) { setError(errMsg(e)); }
  }

  if (!place) {
    return (
      <Screen>
        <View style={{ padding: 16 }}><IconBtn icon="back" label="Geri" onPress={() => goBack('/lists')} testID="back" /></View>
        {error ? <View style={{ padding: 20 }}><ErrorMsg message={error} /></View> : <Loading />}
      </Screen>
    );
  }

  const { rating } = place;
  const cat = categoryInfo(place.place.category);
  const total = Math.max(1, rating.count);
  const dist = (n: number) => rating.distribution.find((d) => d.stars === n)?.n ?? 0;

  return (
    <Screen edges={[]}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 24 }} keyboardShouldPersistTaps="handled">
          <View style={{ height: 150 + insets.top, backgroundColor: cat.tint }}>
            <IconBtn icon="back" label="Geri" bg={C.white} onPress={() => goBack('/lists')} testID="back" style={{ position: 'absolute', left: 16, top: insets.top + 16, shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 8, elevation: 3 }} />
            <View
              testID="category-icon"
              accessibilityRole="image"
              accessibilityLabel={cat.title}
              {...webData({ category: cat.key })}
              style={{ position: 'absolute', right: 20, bottom: -26, width: 56, height: 56, borderRadius: 28, backgroundColor: cat.color, borderWidth: 4, borderColor: C.white, alignItems: 'center', justifyContent: 'center' }}
            >
              <CatGlyph category={cat.key} size={26} color={C.white} />
            </View>
          </View>

          <View style={{ paddingHorizontal: 20, paddingTop: 16, gap: 14 }}>
            <View>
              <Txt weight="extrabold" size={26} style={{ letterSpacing: -0.3, paddingRight: 64 }} accessibilityRole="header" testID="place-title">{place.place.name}</Txt>
              <Txt size={14} color={C.secondary} style={{ marginTop: 3 }}>{cat.title}{place.place.city ? ` · ${place.place.city}` : ''}</Txt>
            </View>

            <View style={{ flexDirection: 'row', gap: 20, alignItems: 'center' }}>
              <View style={{ alignItems: 'center' }}>
                <Txt weight="extrabold" size={44} style={{ lineHeight: 48 }} testID="rating-avg">{fmtAvg(rating.avg)}</Txt>
                <View style={{ flexDirection: 'row', gap: 2, marginTop: 6 }}>
                  {[1, 2, 3, 4, 5].map((n) => <StarIcon key={n} size={14} filled={rating.avg !== null && n <= Math.round(rating.avg)} />)}
                </View>
                <Txt size={12} color={C.secondary} style={{ marginTop: 4 }}>
                  <Txt size={12} color={C.secondary} testID="rating-count">{rating.count}</Txt> puan
                </Txt>
              </View>
              <View style={{ flex: 1, gap: 5 }} testID="rating-distribution" accessibilityLabel="Puan dağılımı">
                {[5, 4, 3, 2, 1].map((n) => (
                  <View key={n} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }} accessibilityLabel={`${n} yıldız: ${dist(n)}`}>
                    <Txt size={11} color={C.secondary}>{n}</Txt>
                    <View style={{ flex: 1, height: 6, borderRadius: 3, backgroundColor: C.divider }}>
                      <View style={{ width: `${Math.round((dist(n) / total) * 100)}%`, height: 6, borderRadius: 3, backgroundColor: C.orange }} />
                    </View>
                  </View>
                ))}
              </View>
            </View>

            <Btn title="Google Maps'te aç" variant="outline" icon="pin" height={46} onPress={() => openInGoogleMaps(place.place)} testID="place-maps" />

            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: C.greenCard, borderRadius: 14, paddingLeft: 14, paddingRight: 4, paddingVertical: 2 }}>
              <View style={{ gap: 2 }}>
                <Txt weight="bold" size={14} color={C.greenDark}>Senin puanın</Txt>
                {rating.pending ? <PendingBadge testID="rating-pending" /> : null}
              </View>
              <View style={{ flexDirection: 'row' }} accessibilityRole="radiogroup" accessibilityLabel="Puan ver" testID="rating-stars">
                {[1, 2, 3, 4, 5].map((n) => (
                  <Pressable
                    key={n}
                    testID={`star-${n}`}
                    accessibilityRole="radio"
                    accessibilityLabel={`${n} yıldız ver`}
                    aria-checked={rating.mine === n}
                    onPress={() => rate(n)}
                    style={{ width: HIT, height: HIT, alignItems: 'center', justifyContent: 'center' }}
                  >
                    <StarIcon size={26} filled={rating.mine !== null && n <= rating.mine} />
                  </Pressable>
                ))}
              </View>
            </View>

            <Txt weight="extrabold" size={17} color={C.greenDark} accessibilityRole="header">Yorumlar</Txt>
            <ErrorMsg message={error} />
            <InfoMsg message={info} />
            {comments.length === 0 ? <Txt size={14} color={C.secondary} testID="comments-empty">Henüz yorum yok.</Txt> : null}
            <View style={{ gap: 14 }} testID="comments">
              {comments.map((c) => {
                const own = !!user && String(c.authorId) === String(user.id);
                const b = BADGE[c.visibility] ?? BADGE.public;
                const open = menuFor === c.id;
                return (
                  <View key={String(c.id)} testID="comment" style={{ flexDirection: 'row', gap: 12 }}>
                    <Avatar name={c.author} />
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Txt weight="bold" size={13} style={{ flex: 1 }}>@{c.author}</Txt>
                        <Txt size={12} color={C.secondary}>{timeAgo(c.createdAt)}</Txt>
                        <View style={{ backgroundColor: b.bg, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 }}>
                          <Txt weight="bold" size={11} color={b.fg} testID="comment-badge">{visLabel(c.visibility)}</Txt>
                        </View>
                        {c.pending ? null : <IconBtn icon="more" label="Yorum menüsü" color={C.secondary} iconSize={18} onPress={() => setMenuFor(open ? null : c.id)} testID="comment-menu" aria-expanded={open} />}
                      </View>
                      {c.pending || isPendingId(c.id) ? <PendingBadge style={{ marginTop: 4 }} /> : null}
                      {c.body ? <Txt size={14} style={{ lineHeight: 20, marginTop: 1 }} testID="comment-text">{c.body}</Txt> : null}
                      <PhotoThumbs ids={c.photos} size={72} testID="comment-photos" />
                      {open ? (
                        <View accessibilityRole="menu" style={{ marginTop: 8, alignSelf: 'flex-start', backgroundColor: C.white, borderRadius: 14, borderWidth: 1, borderColor: C.border, overflow: 'hidden', minWidth: 180 }}>
                          {own ? (
                            <MenuItem label="Sil" danger testID="comment-delete" onPress={() => act(() => api.deleteComment(c.id), 'Yorum silindi.')} />
                          ) : (
                            <>
                              <MenuItem label="Şikayet et" testID="comment-report" onPress={() => act(() => api.report('comment', c.id, 'Uygunsuz içerik'), 'Şikayetin alındı.')} />
                              <MenuItem label="Engelle" danger testID="comment-block" onPress={() => act(() => api.block(c.authorId), `@${c.author} engellendi.`)} />
                            </>
                          )}
                        </View>
                      ) : null}
                    </View>
                  </View>
                );
              })}
            </View>
          </View>
        </ScrollView>

        <View style={{ borderTopWidth: 1, borderTopColor: C.divider, paddingHorizontal: 20, paddingTop: 10, paddingBottom: Math.max(insets.bottom, 12), gap: 8 }} testID="comment-form">
          <View style={{ gap: 6 }}>
            <Txt size={12} weight="semibold" color={C.secondary}>Kimler görebilir?</Txt>
            <View accessibilityRole="radiogroup" accessibilityLabel="Kimler görebilir?" style={{ flexDirection: 'row', gap: 6 }} testID="comment-visibility">
              {VIS.map((v) => {
                const on = v.key === vis;
                return (
                  <Pressable
                    key={v.key}
                    testID={`comment-vis-${v.key}`}
                    accessibilityRole="radio"
                    accessibilityLabel={v.label}
                    aria-checked={on}
                    onPress={() => setVis(v.key)}
                    style={{ minHeight: HIT, flex: 1, paddingHorizontal: 8, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? C.green : C.input }}
                  >
                    <Txt weight="bold" size={12} color={on ? C.white : C.secondary}>{v.label}</Txt>
                  </Pressable>
                );
              })}
            </View>
          </View>
          {photos.slots.length || photos.error ? <PhotoPicker uploads={photos} testID="comment-photo-strip" size={60} hideButtons /> : null}
          {photoMenu ? (
            <View accessibilityRole="menu" testID="comment-photo-menu" style={{ flexDirection: 'row', gap: 8 }}>
              <Btn small variant="soft" icon="image" title="Galeriden seç" onPress={() => addPhoto('library')} testID="comment-photo-library" style={{ flex: 1 }} />
              <Btn small variant="soft" icon="camera" title="Kamera" onPress={() => addPhoto('camera')} testID="comment-photo-camera" style={{ flex: 1 }} />
            </View>
          ) : null}
          <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
            <Pressable
              testID="comment-photo"
              accessibilityRole="button"
              accessibilityLabel={`Fotoğraf ekle (en çok ${MAX_COMMENT_PHOTOS})`}
              aria-disabled={photos.slots.length >= MAX_COMMENT_PHOTOS}
              disabled={photos.slots.length >= MAX_COMMENT_PHOTOS}
              // Web'de kamera yok: doğrudan galeri (dosya seçici) açılır.
              onPress={() => (CAMERA_AVAILABLE ? setPhotoMenu(!photoMenu) : addPhoto('library'))}
              style={{ width: 46, height: 46, borderRadius: 23, backgroundColor: C.greenCard, alignItems: 'center', justifyContent: 'center', opacity: photos.slots.length >= MAX_COMMENT_PHOTOS ? 0.4 : 1 }}
            >
              <Icon name="image" size={20} color={C.greenDark} strokeWidth={2.2} />
            </Pressable>
            <TextInput
              testID="comment-body"
              accessibilityLabel="Yorumun"
              placeholder="Yorum yaz..."
              placeholderTextColor={C.secondary}
              value={body}
              onChangeText={setBody}
              maxLength={1000}
              multiline
              style={{ flex: 1, minHeight: 46, maxHeight: 120, borderRadius: 23, backgroundColor: C.input, paddingHorizontal: 16, paddingTop: 13, paddingBottom: 13, fontFamily: F.regular, fontSize: 14, color: C.text }}
            />
            <Pressable
              testID="comment-submit"
              accessibilityRole="button"
              accessibilityLabel={photos.busy ? 'Fotoğraflar yükleniyor' : 'Yorumu gönder'}
              aria-disabled={sending || photos.busy}
              disabled={sending || photos.busy}
              onPress={post}
              style={{ width: 46, height: 46, borderRadius: 23, backgroundColor: C.green, alignItems: 'center', justifyContent: 'center', opacity: sending || photos.busy ? 0.5 : 1 }}
            >
              <Icon name="send" size={20} color={C.white} strokeWidth={2.2} />
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

function MenuItem({ label, onPress, danger, testID }: { label: string; onPress: () => void; danger?: boolean; testID: string }) {
  return (
    <Pressable testID={testID} accessibilityRole="menuitem" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => ({ minHeight: HIT, paddingHorizontal: 16, justifyContent: 'center', backgroundColor: pressed ? C.input : C.white })}>
      <Txt weight="semibold" size={14} color={danger ? C.danger : C.text}>{label}</Txt>
    </Pressable>
  );
}
