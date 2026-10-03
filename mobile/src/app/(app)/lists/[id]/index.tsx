import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { AddPlaceSheet, type NewPlace } from '../../../../components/AddPlaceSheet';
import { CategoryChips, type Filter } from '../../../../components/CategoryChips';
import { NavHeader } from '../../../../components/Header';
import { PlacesMap } from '../../../../components/PlacesMap';
import { PhotoThumbs } from '../../../../components/Photos';
import { PlanView } from '../../../../components/PlanView';
import type { LatLon, MapPlace } from '../../../../components/mapTypes';
import { Btn, CategoryIcon, ConfirmDialog, Empty, ErrorMsg, IconBtn, Loading, Screen, Segmented, Txt, webData } from '../../../../components/ui';
import { api, errMsg, toItemInput, type Category, type ListDetail, type ListItem, type SearchResult } from '../../../../lib/api';
import { detailsSummary } from '../../../../lib/details';
import { useAuth } from '../../../../lib/auth';
import { categoryInfo } from '../../../../lib/categories';
import { openInGoogleMaps } from '../../../../lib/maps';
import type { PlanPlace } from '../../../../lib/plan';
import { C } from '../../../../theme';

type Tab = 'list' | 'map' | 'plan';

/** City / list detail with Liste / Harita / Plan (CityList, CityMap, Plan .dc.html) — AC-MOB-3, 4, 11..17. */
export default function ListDetailScreen() {
  const { id, tab: tabParam } = useLocalSearchParams<{ id: string; tab?: string }>();
  const { user } = useAuth();
  const [list, setList] = useState<ListDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [adding, setAdding] = useState(false);
  // Place search on the map tab (AC-MOB-15/16): the picked result, and the one the add sheet is pre-filled with.
  const [searchPick, setSearchPick] = useState<SearchResult | null>(null);
  const [addInitial, setAddInitial] = useState<SearchResult | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // "Düzenle" (AC-MOB-24): index of the item open in the sheet in edit mode.
  const [editIdx, setEditIdx] = useState<number | null>(null);
  const tab: Tab = tabParam === 'map' || tabParam === 'plan' ? tabParam : 'list';

  const load = useCallback(() => {
    api.getList(id).then((l) => { setList(l); setError(null); }).catch((e) => setError(errMsg(e)));
  }, [id]);
  useFocusEffect(load);

  const mine = !!list && !!user && String(list.ownerId) === String(user.id);
  const items = useMemo(() => (list ? [...list.items].sort((a, b) => a.position - b.position) : []), [list]);
  const usedCats = useMemo(() => [...new Set(items.map((i) => i.category))] as Category[], [items]);
  const visible = filter === 'all' ? items : items.filter((i) => i.category === filter);
  const located = useMemo<MapPlace[]>(() => visible
    .filter((i) => i.lat !== null && i.lon !== null)
    .map((i) => ({ id: String(i.placeId), name: i.name, category: i.category, lat: i.lat as number, lon: i.lon as number, note: i.note, city: list?.city, provider: i.provider, providerId: i.providerId, googleMapsUrl: i.details?.googleMapsUrl })), [visible, list?.city]);
  const planPlaces = useMemo<PlanPlace[]>(() => items.map((i) => ({ id: String(i.placeId), name: i.name, category: i.category, lat: i.lat, lon: i.lon })), [items]);
  const center = useMemo<LatLon | null>(() => {
    const pts = items.filter((i) => i.lat !== null && i.lon !== null);
    if (!pts.length) return null;
    return { lat: pts.reduce((s, i) => s + (i.lat as number), 0) / pts.length, lon: pts.reduce((s, i) => s + (i.lon as number), 0) / pts.length };
  }, [items]);

  async function save(next: ReturnType<typeof toItemInput>[]) {
    if (!list) return;
    await api.putItems(list.id, next);
    const fresh = await api.getList(list.id);
    setList(fresh);
  }

  // Existing items keep their provider/providerId (PUT replaces the whole list); a search result brings its own.
  async function addPlace(p: NewPlace) {
    if (!list) return;
    const current = items.map((i) => toItemInput(list.city, i));
    await save([...current, toItemInput(list.city, {
      name: p.name, category: p.category, note: p.note || null, lat: p.lat, lon: p.lon,
      provider: p.provider, providerId: p.providerId, details: p.details,
    })]);
    setAdding(false);
    if (searchPick && p.providerId === searchPick.providerId && p.provider === searchPick.provider) setSearchPick(null);
  }

  function openAdd(initial: SearchResult | null) {
    setEditIdx(null);
    setAddInitial(initial);
    setAdding(true);
  }

  // Edit keeps every other item as is (with its provider identity and details) and replaces only this one.
  async function editPlace(p: NewPlace) {
    if (!list || editIdx === null) return;
    const old = items[editIdx];
    await save(items.map((i, k) => toItemInput(list.city, k === editIdx
      // Formda olmayan içe aktarma bağlantısı (googleMapsUrl) korunur.
      ? { ...old, category: p.category, note: p.note || null, details: old.details?.googleMapsUrl ? { ...p.details, googleMapsUrl: old.details.googleMapsUrl } : p.details }
      : i)));
    setAdding(false);
    setEditIdx(null);
  }
  const editItem: ListItem | null = editIdx !== null ? items[editIdx] ?? null : null;
  const isSaved = (r: SearchResult) => items.some((i) => i.provider === r.provider && i.providerId === r.providerId);

  async function removeItem(idx: number) {
    if (!list) return;
    setError(null);
    try { await save(items.filter((_, i) => i !== idx).map((i) => toItemInput(list.city, i))); } catch (e) { setError(errMsg(e)); }
  }

  async function removeList() {
    if (!list) return;
    try {
      await api.deleteList(list.id);
      setConfirmDelete(false);
      router.replace('/lists');
    } catch (e) { setConfirmDelete(false); setError(errMsg(e)); }
  }

  if (!list) {
    return (
      <Screen>
        <NavHeader backLabel="Listelerim" fallback="/lists" />
        {error ? <View style={{ padding: 20 }}><ErrorMsg message={error} /></View> : <Loading />}
      </Screen>
    );
  }

  return (
    <Screen>
      <NavHeader
        backLabel={mine ? 'Listelerim' : 'Keşfet'}
        fallback={mine ? '/lists' : '/discover'}
        right={mine ? (
          <>
            <IconBtn icon="share" label="Paylaşım ve görünürlük" color={C.greenDark} onPress={() => router.push(`/lists/${list.id}/share`)} testID="list-share" />
            <IconBtn icon="plus" label="Yer ekle" color={C.orangeText} iconSize={26} onPress={() => openAdd(null)} testID="place-add-open" />
          </>
        ) : null}
      />
      <View style={{ paddingHorizontal: 20, paddingTop: 4, paddingBottom: 12 }}>
        <Txt weight="extrabold" size={34} style={{ letterSpacing: -0.5, lineHeight: 38 }} accessibilityRole="header" testID="list-detail-city">{list.city}</Txt>
        <Txt size={14} color={C.secondary} style={{ marginTop: 4 }}>
          <Txt size={14} color={C.secondary} testID="list-detail-title">{list.title}</Txt>
          {` · @${list.ownerHandle} · ${items.length} yer · `}
          <Txt size={14} color={list.visibility === 'public' ? C.green : C.secondary} weight="semibold" testID="list-detail-visibility">{list.visibility === 'public' ? 'Herkese açık' : 'Özel'}</Txt>
        </Txt>
      </View>
      <View style={{ paddingHorizontal: 20 }}>
        <Segmented<Tab>
          label="Görünüm"
          value={tab}
          onChange={(t) => router.setParams({ tab: t })}
          options={[
            { key: 'list', label: 'Liste', testID: 'seg-list' },
            { key: 'map', label: 'Harita', testID: 'seg-map' },
            { key: 'plan', label: 'Plan', testID: 'seg-plan' },
          ]}
        />
      </View>
      {error ? <View style={{ paddingHorizontal: 20, paddingTop: 10 }}><ErrorMsg message={error} /></View> : null}

      {tab !== 'plan' && items.length > 0 ? <CategoryChips used={usedCats} value={filter} onChange={setFilter} total={items.length} /> : null}

      {tab === 'list' ? (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }}>
          {visible.length === 0 ? (
            <View style={{ gap: 12, paddingTop: 12 }}>
              <Empty text="Bu listede yer yok." testID="places-empty" />
              {mine ? <Btn title="Yer ekle" icon="plus" onPress={() => openAdd(null)} testID="place-add-empty" /> : null}
            </View>
          ) : null}
          <View accessibilityRole="list" testID="place-items">
            {visible.map((it, vi) => {
              const idx = items.indexOf(it);
              const summary = detailsSummary(it.details);
              return (
                <View
                  key={`${String(it.placeId)}-${idx}`}
                  testID="place-item"
                  {...webData({ category: it.category })}
                  style={{ paddingVertical: 12, borderBottomWidth: vi === visible.length - 1 ? 0 : 1, borderBottomColor: C.divider }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
                    <CategoryIcon category={it.category} />
                    <Pressable
                      testID="place-link"
                      accessibilityRole="link"
                      accessibilityLabel={`${it.name}, ${categoryInfo(it.category).title}`}
                      onPress={() => router.push(`/places/${it.placeId}`)}
                      style={{ flex: 1, minHeight: 44, justifyContent: 'center' }}
                    >
                      <Txt weight="bold" size={16} testID="place-item-name">{it.name}</Txt>
                      {it.note ? (
                        <Txt size={13} color={C.secondary} style={{ marginTop: 2 }} testID="place-item-note">{it.note}</Txt>
                      ) : (
                        <Txt size={13} color={C.secondary} style={{ marginTop: 2 }}>{categoryInfo(it.category).title}{it.lat === null ? ' · konumsuz' : ''}</Txt>
                      )}
                    </Pressable>
                    <IconBtn icon="pin" label={`${it.name} Google Maps'te aç`} color={C.greenDark} onPress={() => openInGoogleMaps({ ...it, city: list.city, googleMapsUrl: it.details?.googleMapsUrl })} testID="place-maps" iconSize={20} />
                    {mine ? <IconBtn icon="edit" label={`${it.name} düzenle`} color={C.greenDark} onPress={() => { setEditIdx(idx); setAddInitial(null); setAdding(true); }} testID="place-edit" iconSize={20} /> : null}
                    {mine ? <IconBtn icon="trash" label={`${it.name} yerini listeden çıkar`} color={C.secondary} onPress={() => removeItem(idx)} testID="place-remove" iconSize={20} /> : null}
                  </View>
                  {/* Detay özeti ve fotoğraflar satırın tam genişliğinde (sağdaki düğmeler metni daraltmasın). */}
                  {summary || it.details?.favorites?.length || it.details?.photos?.length ? (
                    <View style={{ paddingLeft: 58, gap: 4, marginTop: 2 }}>
                      {summary ? <Txt size={13} weight="semibold" color={C.greenDark} testID="place-item-summary">{summary}</Txt> : null}
                      {it.details?.favorites?.length ? (
                        <Txt size={12} color={C.orangeText} weight="semibold" numberOfLines={2} testID="place-item-favorites">Favoriler: {it.details.favorites.join(', ')}</Txt>
                      ) : null}
                      {it.details?.photos?.length ? <PhotoThumbs ids={it.details.photos} size={56} testID="place-item-photos" /> : null}
                    </View>
                  ) : null}
                </View>
              );
            })}
          </View>
          {mine ? (
            <View style={{ paddingTop: 28 }}>
              <Btn title="Listeyi sil" variant="danger" icon="trash" onPress={() => setConfirmDelete(true)} testID="list-delete" />
            </View>
          ) : null}
        </ScrollView>
      ) : null}

      {tab === 'map' ? (
        <View style={{ flex: 1 }}>
          <PlacesMap
            places={located}
            unlocated={visible.length - located.length}
            onOpenPlace={(pid) => router.push(`/places/${pid}`)}
            center={center}
            searchPick={searchPick}
            onSearchPick={setSearchPick}
            onAddPick={mine ? (r) => openAdd(r) : undefined}
            isSaved={isSaved}
            city={list.city}
          />
        </View>
      ) : null}

      {tab === 'plan' ? (
        <PlanView listId={list.id} places={planPlaces} onOpenDayMap={(day) => router.push(`/lists/${list.id}/day/${day}`)} />
      ) : null}

      <AddPlaceSheet
        visible={adding}
        onClose={() => { setAdding(false); setEditIdx(null); }}
        onSubmit={editItem ? editPlace : addPlace}
        center={center}
        initial={editItem ? null : addInitial}
        city={list.city}
        editItem={editItem}
      />
      <ConfirmDialog
        visible={confirmDelete}
        title="Listeyi sil"
        message="Bu liste ve içindeki yerler silinecek. Emin misin?"
        confirmLabel="Evet, sil"
        onConfirm={removeList}
        onCancel={() => setConfirmDelete(false)}
        testID="list-delete-dialog"
        confirmTestID="list-delete-confirm"
        cancelTestID="list-delete-cancel"
      />
    </Screen>
  );
}
