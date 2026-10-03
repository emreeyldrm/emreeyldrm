import { nearestCity } from './destinations';

/**
 * Yerin saat dilimi (AC-MOB-44), ucuz yoldan: gömülü şehir verisinden (GeoNames) koordinata en yakın şehrin ülkesi,
 * o ülke TEK saat dilimliyse onun IANA adı. Birden çok saat dilimli ülkelerde (ABD, Rusya, Brezilya, Kanada,
 * Avustralya, Meksika, Endonezya, Kazakistan …) ve bilinmeyen ülkelerde null döner: rozet o zaman cihaz saatini
 * kullanır (yer sayfasında "cihaz saatine göre" notu çıkar).
 */
export const COUNTRY_TZ: Record<string, string> = {
  TR: 'Europe/Istanbul', CY: 'Asia/Nicosia', GR: 'Europe/Athens', BG: 'Europe/Sofia', RO: 'Europe/Bucharest',
  IT: 'Europe/Rome', VA: 'Europe/Vatican', SM: 'Europe/San_Marino', MT: 'Europe/Malta', FR: 'Europe/Paris',
  MC: 'Europe/Monaco', ES: 'Europe/Madrid', AD: 'Europe/Andorra', DE: 'Europe/Berlin', AT: 'Europe/Vienna',
  CH: 'Europe/Zurich', LI: 'Europe/Vaduz', NL: 'Europe/Amsterdam', BE: 'Europe/Brussels', LU: 'Europe/Luxembourg',
  GB: 'Europe/London', IE: 'Europe/Dublin', IS: 'Atlantic/Reykjavik', DK: 'Europe/Copenhagen', NO: 'Europe/Oslo',
  SE: 'Europe/Stockholm', FI: 'Europe/Helsinki', EE: 'Europe/Tallinn', LV: 'Europe/Riga', LT: 'Europe/Vilnius',
  PL: 'Europe/Warsaw', CZ: 'Europe/Prague', SK: 'Europe/Bratislava', HU: 'Europe/Budapest', SI: 'Europe/Ljubljana',
  HR: 'Europe/Zagreb', BA: 'Europe/Sarajevo', RS: 'Europe/Belgrade', ME: 'Europe/Podgorica', XK: 'Europe/Belgrade',
  MK: 'Europe/Skopje', AL: 'Europe/Tirane', MD: 'Europe/Chisinau', UA: 'Europe/Kyiv', BY: 'Europe/Minsk',
  GE: 'Asia/Tbilisi', AM: 'Asia/Yerevan', AZ: 'Asia/Baku', IL: 'Asia/Jerusalem', PS: 'Asia/Hebron',
  JO: 'Asia/Amman', LB: 'Asia/Beirut', SY: 'Asia/Damascus', IQ: 'Asia/Baghdad', IR: 'Asia/Tehran',
  SA: 'Asia/Riyadh', AE: 'Asia/Dubai', QA: 'Asia/Qatar', BH: 'Asia/Bahrain', KW: 'Asia/Kuwait', OM: 'Asia/Muscat',
  EG: 'Africa/Cairo', MA: 'Africa/Casablanca', TN: 'Africa/Tunis', DZ: 'Africa/Algiers', LY: 'Africa/Tripoli',
  ZA: 'Africa/Johannesburg', KE: 'Africa/Nairobi', TZ: 'Africa/Dar_es_Salaam', UZ: 'Asia/Tashkent',
  KG: 'Asia/Bishkek', TM: 'Asia/Ashgabat', TJ: 'Asia/Dushanbe', AF: 'Asia/Kabul', PK: 'Asia/Karachi',
  IN: 'Asia/Kolkata', LK: 'Asia/Colombo', NP: 'Asia/Kathmandu', BD: 'Asia/Dhaka', TH: 'Asia/Bangkok',
  VN: 'Asia/Ho_Chi_Minh', KH: 'Asia/Phnom_Penh', LA: 'Asia/Vientiane', MM: 'Asia/Yangon', MY: 'Asia/Kuala_Lumpur',
  SG: 'Asia/Singapore', PH: 'Asia/Manila', CN: 'Asia/Shanghai', HK: 'Asia/Hong_Kong', MO: 'Asia/Macau',
  TW: 'Asia/Taipei', KR: 'Asia/Seoul', JP: 'Asia/Tokyo', NZ: 'Pacific/Auckland', PT: 'Europe/Lisbon',
  AR: 'America/Argentina/Buenos_Aires', CL: 'America/Santiago', CO: 'America/Bogota', PE: 'America/Lima',
  UY: 'America/Montevideo', CR: 'America/Costa_Rica', PA: 'America/Panama', CU: 'America/Havana',
  DO: 'America/Santo_Domingo', JM: 'America/Jamaica',
};

const cache = new Map<string, string | null>();

/** Koordinatın saat dilimi (IANA) ya da null (bilinmiyor / çok saat dilimli ülke). */
export function placeTimeZone(lat: number | null | undefined, lon: number | null | undefined): string | null {
  if (typeof lat !== 'number' || typeof lon !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const k = `${lat.toFixed(2)},${lon.toFixed(2)}`;
  if (cache.has(k)) return cache.get(k) ?? null;
  let tz: string | null = null;
  try {
    const cc = nearestCity(lat, lon)?.countryCode?.split('-')[0];
    tz = (cc && COUNTRY_TZ[cc]) || null;
  } catch { tz = null; }
  cache.set(k, tz);
  return tz;
}
