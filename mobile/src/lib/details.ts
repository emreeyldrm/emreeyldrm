import type { Category } from './api';
import { findDestination } from './destinations';

/** Liste öğesi detayları (docs/ACCEPTANCE.md, DET). Sunucu aynı alanları doğrular (details-core.ts). */
export const WAIT_RANGES = ['0-10', '10-20', '20-30', '30-45', '45+'] as const;
export type WaitRange = (typeof WAIT_RANGES)[number];
export type Recommendation = 'dine_in' | 'takeout' | 'either';

export interface PlaceDetails {
  dineIn?: boolean;
  takeout?: boolean;
  waitDineIn?: WaitRange;
  waitTakeout?: WaitRange;
  recommendation?: Recommendation;
  spendPerPerson?: number;
  currency?: string;
  favorites?: string[];
  photos?: string[];
  /** Google Maps bağlantısı (Takeout içe aktarma, IMP); yalnızca https Google Maps adresleri. */
  googleMapsUrl?: string;
}

export const MAX_PLACE_PHOTOS = 6;
export const MAX_COMMENT_PHOTOS = 4;
export const MAX_FAVORITES = 10;
export const MAX_FAVORITE_LENGTH = 60;
export const MAX_SPEND = 100_000;

/** Servis, bekleme ve favori yiyecekler yalnızca yeme-içme yerleri için (AC-MOB-21). */
export const hasService = (c: Category): boolean => c === 'food' || c === 'coffee' || c === 'bar';

/** Bu bekleme aralığında masada oturmak yerine paket önerilir (AC-MOB-22). */
export const isLongWait = (w: WaitRange | undefined): boolean => w === '30-45' || w === '45+';

/** Masada bekleme 30 dk ve üstü ve paket varsa otomatik öneri "Paket"; yoksa öneri yok. */
export function autoRecommendation(d: Pick<PlaceDetails, 'dineIn' | 'takeout' | 'waitDineIn'>): Recommendation | null {
  return d.dineIn && d.takeout && isLongWait(d.waitDineIn) ? 'takeout' : null;
}

export const takeoutReason = (w: WaitRange | undefined): string =>
  `Masada ${w ?? '30-45'} dk bekleme var, paket almak daha mantıklı`;

export const RECOMMENDATION_LABEL: Record<Recommendation, string> = {
  dine_in: 'Masada', takeout: 'Paket', either: 'İkisi de olur',
};

// ---------- Para birimi ----------
const EURO = ['AT', 'BE', 'CY', 'DE', 'EE', 'ES', 'FI', 'FR', 'GR', 'HR', 'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PT', 'SI', 'SK',
  'AD', 'MC', 'SM', 'VA', 'ME', 'XK'];
/** Ülke kodu (ISO 3166-1; "GB-ENG" gibi bölgeler ülkeye indirgenir) -> para birimi (ISO 4217). */
const COUNTRY_CURRENCY: Record<string, string> = {
  ...Object.fromEntries(EURO.map((c) => [c, 'EUR'])),
  TR: 'TRY', GB: 'GBP', US: 'USD', CH: 'CHF', LI: 'CHF', JP: 'JPY', CN: 'CNY', KR: 'KRW', TH: 'THB', VN: 'VND', ID: 'IDR',
  MY: 'MYR', SG: 'SGD', IN: 'INR', AE: 'AED', SA: 'SAR', QA: 'QAR', EG: 'EGP', MA: 'MAD', TN: 'TND', GE: 'GEL', AZ: 'AZN',
  RU: 'RUB', UA: 'UAH', PL: 'PLN', CZ: 'CZK', HU: 'HUF', RO: 'RON', BG: 'BGN', RS: 'RSD', BA: 'BAM', AL: 'ALL', MK: 'MKD',
  DK: 'DKK', SE: 'SEK', NO: 'NOK', IS: 'ISK', CA: 'CAD', MX: 'MXN', BR: 'BRL', AR: 'ARS', CL: 'CLP', CO: 'COP', PE: 'PEN',
  AU: 'AUD', NZ: 'NZD', ZA: 'ZAR', IL: 'ILS', JO: 'JOD', LB: 'LBP', HK: 'HKD', TW: 'TWD', PH: 'PHP',
};
export const DEFAULT_CURRENCY = 'TRY';
/** Para birimi seçicide gösterilen yaygın birimler. */
export const COMMON_CURRENCIES = ['TRY', 'EUR', 'USD', 'GBP', 'CHF', 'JPY'];
const SYMBOL: Record<string, string> = { TRY: '₺', EUR: '€', USD: '$', GBP: '£', JPY: '¥', CNY: '¥', KRW: '₩', INR: '₹', THB: '฿' };
export const currencySymbol = (c: string): string => SYMBOL[c] ?? c;

export const currencyForCountry = (countryCode: string | null | undefined): string =>
  (countryCode && COUNTRY_CURRENCY[countryCode.split('-')[0].toUpperCase()]) || DEFAULT_CURRENCY;

/** Listenin şehrinden varsayılan para birimi (gömülü şehir verisi; bulunamazsa TRY). */
export function currencyForCity(city: string | null | undefined): string {
  if (!city) return DEFAULT_CURRENCY;
  try { return currencyForCountry(findDestination(city)?.countryCode); } catch { return DEFAULT_CURRENCY; }
}

/** "12,5" / "12.5" -> 12.5; boş -> null; geçersiz -> NaN. */
export function parseAmount(text: string): number | null {
  const t = text.trim().replace(/\s/g, '').replace(',', '.');
  if (!t) return null;
  return /^\d+(\.\d+)?$/.test(t) ? Number(t) : NaN;
}
export const fmtAmount = (n: number): string =>
  (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0$/, '')).replace('.', ',');

// ---------- Özet (AC-MOB-24) ----------
/** "Paket önerilir · Masada 30-45 dk · Paket 0-10 dk · ~12 €" */
export function detailsSummary(d: PlaceDetails | null | undefined): string {
  if (!d) return '';
  const parts: string[] = [];
  if (d.recommendation === 'takeout') parts.push('Paket önerilir');
  else if (d.recommendation === 'dine_in') parts.push('Masada önerilir');
  else if (d.recommendation === 'either') parts.push('Masada ya da paket');
  if (d.dineIn) parts.push(d.waitDineIn ? `Masada ${d.waitDineIn} dk` : 'Masada');
  if (d.takeout) parts.push(d.waitTakeout ? `Paket ${d.waitTakeout} dk` : 'Paket');
  if (typeof d.spendPerPerson === 'number') parts.push(`~${fmtAmount(d.spendPerPerson)} ${currencySymbol(d.currency ?? DEFAULT_CURRENCY)}`);
  return parts.join(' · ');
}

/** Boş alanları atar; sunucuya giden biçim. */
export function compactDetails(d: PlaceDetails): PlaceDetails {
  const out: PlaceDetails = {};
  for (const [k, v] of Object.entries(d) as [keyof PlaceDetails, unknown][]) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    (out as Record<string, unknown>)[k] = v;
  }
  return out;
}
