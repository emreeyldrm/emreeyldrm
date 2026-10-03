import { useEffect, useState } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import type { Id } from '../lib/api';
import { localClock, openBadge, type BadgeTone } from '../lib/openingHours';
import { usePlaceHours } from '../lib/planApi';
import { placeTimeZone } from '../lib/placeTime';
import { C } from '../theme';
import { Txt } from './ui';

const TONE: Record<BadgeTone, { bg: string; fg: string; dot: string }> = {
  open: { bg: C.greenCard, fg: C.greenDark, dot: C.green },
  soon: { bg: C.orangeTint, fg: C.orangeText, dot: C.orange },
  closed: { bg: '#EEF1EF', fg: '#55645C', dot: '#8A9990' },
};

/** Dakikada bir yenilenen "şimdi". */
function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

/**
 * "Açık · 23:00'te kapanır" / "Kapanmasına 30 dk" / "Kapalı · 09:00'da açılır" rozeti (AC-MOB-44). Saatler
 * `GET /places/:id/hours`'tan (OSM opening_hours metni) gelir ve yerin saat dilimine göre hesaplanır; saat dilimi
 * bilinmiyorsa cihaz saati kullanılır (`showZoneNote` ile "cihaz saatine göre" yazılır). Saat yoksa hiçbir şey çizmez.
 */
export function OpenStatusBadge({ placeId, lat, lon, small, showZoneNote, style, testID = 'open-badge' }: {
  placeId: Id | null | undefined; lat: number | null; lon: number | null; small?: boolean; showZoneNote?: boolean;
  style?: StyleProp<ViewStyle>; testID?: string;
}) {
  const hours = usePlaceHours(placeId);
  const now = useNow();
  if (!hours) return null;
  const tz = placeTimeZone(lat, lon);
  const clock = localClock(now, tz);
  const badge = openBadge(hours, clock);
  if (!badge) return null;
  const t = TONE[badge.tone];
  return (
    <View style={[{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }, style]}>
      <View
        testID={testID}
        accessibilityLabel={badge.text}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start', backgroundColor: t.bg, borderRadius: 10, paddingHorizontal: small ? 7 : 10, paddingVertical: small ? 2 : 5 }}
      >
        <View style={{ width: small ? 6 : 7, height: small ? 6 : 7, borderRadius: 4, backgroundColor: t.dot }} />
        <Txt weight="bold" size={small ? 11 : 13} color={t.fg}>{badge.text}</Txt>
      </View>
      {showZoneNote && !clock.zoned ? <Txt size={11} color={C.secondary} testID={`${testID}-device-time`}>cihaz saatine göre</Txt> : null}
    </View>
  );
}
