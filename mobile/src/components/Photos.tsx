import { useState } from 'react';
import { ActivityIndicator, Image, Modal, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CAMERA_AVAILABLE, mediaSrc, type PhotoSlot, type PhotoUploads } from '../lib/media';
import { C, HIT } from '../theme';
import { Icon } from './Icon';
import { IconBtn, Txt, webData } from './ui';

/**
 * Editable photo strip (AC-MOB-23, AC-MOB-25): thumbnails with per-photo upload state and a remove button,
 * plus "Galeri" / "Kamera" (camera on native only). Used by the add-place sheet and the comment composer.
 */
export function PhotoPicker({ uploads, testID, size = 72, hideButtons }: {
  uploads: PhotoUploads; testID: string; size?: number; hideButtons?: boolean;
}) {
  const { slots, max, error } = uploads;
  const full = slots.length >= max;
  return (
    <View style={{ gap: 8 }} testID={testID}>
      {slots.length || !hideButtons ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12, alignItems: 'center', paddingTop: 12, paddingRight: 12 }} keyboardShouldPersistTaps="handled">
          {slots.map((s, i) => <EditableThumb key={s.key} slot={s} index={i} size={size} onRemove={() => uploads.remove(s.key)} testID={testID} />)}
          {!hideButtons && !full ? (
            <>
              <AddButton icon="image" label="Galeri" a11y="Galeriden fotoğraf ekle" size={size} onPress={() => uploads.add('library')} testID={`${testID}-add-library`} />
              {CAMERA_AVAILABLE ? (
                <AddButton icon="camera" label="Kamera" a11y="Kamerayla fotoğraf çek" size={size} onPress={() => uploads.add('camera')} testID={`${testID}-add-camera`} />
              ) : null}
            </>
          ) : null}
        </ScrollView>
      ) : null}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
        {error ? (
          <View accessibilityRole="alert" accessibilityLiveRegion="polite" testID={`${testID}-error`} style={{ flex: 1, backgroundColor: C.dangerTint, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6 }}>
            <Txt weight="semibold" size={13} color={C.danger}>{error}</Txt>
          </View>
        ) : <View style={{ flex: 1 }} />}
        {slots.length ? <Txt size={12} color={C.secondary} testID={`${testID}-count`}>{slots.length}/{max}</Txt> : null}
      </View>
    </View>
  );
}

function AddButton({ icon, label, a11y, size, onPress, testID }: { icon: 'image' | 'camera'; label: string; a11y: string; size: number; onPress: () => void; testID: string }) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      onPress={onPress}
      style={({ pressed }) => ({ width: size, height: size, minWidth: HIT, minHeight: HIT, borderRadius: 14, borderWidth: 1.5, borderStyle: 'dashed', borderColor: C.dash, backgroundColor: pressed ? C.greenCard : C.greenSoft, alignItems: 'center', justifyContent: 'center', gap: 2 })}
    >
      <Icon name={icon} size={22} color={C.greenDark} />
      <Txt weight="bold" size={11} color={C.greenDark}>{label}</Txt>
    </Pressable>
  );
}

function EditableThumb({ slot, index, size, onRemove, testID }: { slot: PhotoSlot; index: number; size: number; onRemove: () => void; testID: string }) {
  return (
    <View testID={`${testID}-thumb`} {...webData({ status: slot.status, mediaId: slot.id ?? '' })} style={{ width: size, height: size }}>
      <Image source={{ uri: slot.uri }} accessibilityLabel={`Fotoğraf ${index + 1}`} style={{ width: size, height: size, borderRadius: 14, backgroundColor: C.input }} resizeMode="cover" />
      {slot.status === 'uploading' ? (
        <View testID={`${testID}-uploading`} accessibilityLabel={`Yükleniyor %${Math.round(slot.progress * 100)}`} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: 14, backgroundColor: 'rgba(23,37,30,0.5)', alignItems: 'center', justifyContent: 'center', gap: 2 }}>
          <ActivityIndicator color={C.white} size="small" />
          <Txt weight="bold" size={11} color={C.white}>%{Math.round(slot.progress * 100)}</Txt>
        </View>
      ) : null}
      {slot.status === 'error' ? (
        <View testID={`${testID}-failed`} accessibilityLabel="Yüklenemedi" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: 14, backgroundColor: 'rgba(179,38,30,0.55)', alignItems: 'center', justifyContent: 'center' }}>
          <Txt weight="extrabold" size={20} color={C.white}>!</Txt>
        </View>
      ) : null}
      {/* 44pt dokunma alanı, küçük görünen daire. */}
      <Pressable
        testID={`${testID}-remove`}
        accessibilityRole="button"
        accessibilityLabel={`Fotoğraf ${index + 1} kaldır`}
        onPress={onRemove}
        style={{ position: 'absolute', top: -12, right: -12, width: HIT, height: HIT, alignItems: 'center', justifyContent: 'center' }}
      >
        <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: 'rgba(23,37,30,0.8)', borderWidth: 2, borderColor: C.white, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="close" size={12} color={C.white} strokeWidth={2.6} />
        </View>
      </Pressable>
    </View>
  );
}

/** Read-only thumbnails of saved photos (list rows, comments); tap opens the full-screen viewer. */
export function PhotoThumbs({ ids, size = 64, testID = 'photo-thumbs' }: { ids: string[] | undefined; size?: number; testID?: string }) {
  const [open, setOpen] = useState<number | null>(null);
  if (!ids?.length) return null;
  return (
    <>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} testID={testID} contentContainerStyle={{ gap: 8 }} style={{ marginTop: 8, flexGrow: 0 }}>
        {ids.map((id, i) => (
          <Pressable
            key={`${id}-${i}`}
            testID="photo-thumb"
            accessibilityRole="imagebutton"
            accessibilityLabel={`Fotoğraf ${i + 1}, büyüt`}
            onPress={() => setOpen(i)}
            style={{ width: Math.max(size, HIT), height: Math.max(size, HIT) }}
          >
            <Image source={{ uri: mediaSrc(id) }} style={{ width: Math.max(size, HIT), height: Math.max(size, HIT), borderRadius: 12, backgroundColor: C.input }} resizeMode="cover" />
          </Pressable>
        ))}
      </ScrollView>
      <PhotoViewer ids={ids} index={open} onIndex={setOpen} />
    </>
  );
}

/** Simple full-screen viewer: black backdrop, the image fitted to the screen, close and previous/next. */
export function PhotoViewer({ ids, index, onIndex }: { ids: string[]; index: number | null; onIndex: (i: number | null) => void }) {
  const insets = useSafeAreaInsets();
  if (index === null) return null;
  const i = Math.min(Math.max(index, 0), ids.length - 1);
  return (
    <Modal visible transparent={false} animationType="fade" onRequestClose={() => onIndex(null)}>
      <View testID="photo-viewer" accessibilityViewIsModal style={{ flex: 1, backgroundColor: '#000' }}>
        <Image testID="photo-viewer-image" source={{ uri: mediaSrc(ids[i]) }} accessibilityLabel={`Fotoğraf ${i + 1} / ${ids.length}`} style={{ flex: 1 }} resizeMode="contain" />
        <View style={{ position: 'absolute', top: insets.top + 8, left: 12, right: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Txt weight="bold" size={14} color={C.white} testID="photo-viewer-count">{i + 1} / {ids.length}</Txt>
          <IconBtn icon="close" label="Kapat" color={C.white} bg="rgba(255,255,255,0.18)" onPress={() => onIndex(null)} testID="photo-viewer-close" />
        </View>
        {ids.length > 1 ? (
          <View style={{ position: 'absolute', bottom: insets.bottom + 24, left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', gap: 24 }}>
            <IconBtn icon="back" label="Önceki fotoğraf" color={C.white} bg="rgba(255,255,255,0.18)" disabled={i === 0} onPress={() => onIndex(i - 1)} testID="photo-viewer-prev" style={{ opacity: i === 0 ? 0.4 : 1 }} />
            <IconBtn icon="chevron" label="Sonraki fotoğraf" color={C.white} bg="rgba(255,255,255,0.18)" disabled={i === ids.length - 1} onPress={() => onIndex(i + 1)} testID="photo-viewer-next" style={{ opacity: i === ids.length - 1 ? 0.4 : 1 }} />
          </View>
        ) : null}
      </View>
    </Modal>
  );
}
