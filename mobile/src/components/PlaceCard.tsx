import { View } from 'react-native';
import { categoryInfo } from '../lib/categories';
import { openInGoogleMaps } from '../lib/maps';
import { C } from '../theme';
import { Btn, CategoryIcon, IconBtn, Txt } from './ui';
import type { MapPlace } from './mapTypes';

/** Bottom card for a selected map pin (CityMap.dc.html). */
export function PlaceCard({ place, onOpen, onClose }: { place: MapPlace; onOpen: () => void; onClose: () => void }) {
  const cat = categoryInfo(place.category);
  return (
    <View testID="map-card" style={{ backgroundColor: C.white, borderRadius: 22, padding: 16, gap: 14, shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 18, shadowOffset: { width: 0, height: 4 }, elevation: 6 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        <CategoryIcon category={place.category} />
        <View style={{ flex: 1 }}>
          <Txt weight="bold" size={17} testID="map-card-name">{place.name}</Txt>
          <Txt size={13} color={C.secondary}>{cat.title}{place.note ? ` · ${place.note}` : ''}</Txt>
        </View>
        <IconBtn icon="close" label="Kartı kapat" onPress={onClose} color={C.secondary} />
      </View>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Btn title="Google Maps'te aç" icon="pin" style={{ flex: 1 }} height={48} testID="map-card-maps" onPress={() => openInGoogleMaps(place)} />
        <IconBtn icon="chevron" label="Yer sayfasını aç" onPress={onOpen} round={false} size={48} bg={C.white} style={{ borderWidth: 1.5, borderColor: C.green }} testID="map-card-open" />
      </View>
    </View>
  );
}
