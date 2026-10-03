/**
 * Google Takeout içe aktarma (docs/ACCEPTANCE.md, "Google listelerini içe aktarma (IMP)"): saf fonksiyonlar.
 *
 * - "Kaydedilenler" (Saved): her liste için bir CSV, başlıklar `Title, Note, URL` (bazı sürümlerde `Tags, Comment`).
 *   Koordinat yoktur; yerler `/search/places` ile şehir merkezine yakın eşleştirilir.
 * - "Haritalar (yerleriniz)": yıldızlı yerler `Saved Places.json` (GeoJSON, koordinatlı).
 *
 * React Native'e bağımlı değildir (yalnızca gömülü şehir verisi): `npm run test:unit` ile Node'da test edilir.
 */
import type { Category, SearchResult } from './api';
import { findDestination, foldName, nearestCity, type Destination } from './destinations';

export interface ImportPlace {
  /** Google'daki ad (CSV `Title`, JSON `Title`/`name`). */
  name: string;
  /** CSV `Note` (+ `Comment`), JSON `Comment`; yoksa ''. */
  note: string;
  /** Geçerli (https, Google Maps alan adı, ≤500) bağlantı; yoksa undefined. */
  url?: string;
  address?: string;
  /** JSON'da ya da URL'de koordinat varsa; yoksa null (arama ile eşleştirilir). */
  lat: number | null;
  lon: number | null;
}

export interface ParsedFile {
  fileName: string;
  kind: 'csv' | 'json';
  /** Dosya adından liste adı ("Roma yemek.csv" -> "Roma yemek"). */
  listName: string;
  places: ImportPlace[];
  /** Adsız/okunamayan satırlar. */
  skipped: number;
  /** Dosya hiç okunamadıysa kullanıcıya gösterilecek mesaj. */
  error?: string;
}

// ---------- CSV ----------

/**
 * RFC 4180 benzeri CSV: tırnaklı alanlar, `""` kaçışı, alan içinde virgül ve yeni satır, CRLF/LF/CR, baştaki BOM.
 * Tamamen boş satırlar (`,,,` dahil) atlanır.
 */
export function parseCsv(text: string): string[][] {
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const endRow = () => {
    row.push(field);
    field = '';
    if (row.some((f) => f.trim() !== '')) rows.push(row);
    row = [];
  };
  while (i < s.length) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"' && field.trim() === '') { field = ''; inQuotes = true; i++; continue; }
    if (c === ',') { row.push(field); field = ''; i++; continue; }
    if (c === '\r') { endRow(); i += s[i + 1] === '\n' ? 2 : 1; continue; }
    if (c === '\n') { endRow(); i++; continue; }
    field += c; i++;
  }
  if (field !== '' || row.length) endRow();
  return rows;
}

const HEADER_ALIASES: Record<'title' | 'note' | 'url' | 'comment' | 'address', string[]> = {
  title: ['title', 'name', 'baslik', 'ad', 'isim', 'titulo', 'titolo', 'nombre', 'nome'],
  note: ['note', 'notes', 'not', 'notlar', 'nota', 'notas', 'note personali'],
  url: ['url', 'link', 'baglanti', 'google maps url', 'enlace', 'collegamento'],
  comment: ['comment', 'comments', 'yorum', 'comentario', 'commento'],
  address: ['address', 'adres', 'direccion', 'indirizzo'],
};

/** Kaydedilenler CSV'si -> yerler. Başlıklar büyük/küçük harf ve aksan duyarsız; `Title` yoksa hata. */
export function parseSavedListCsv(text: string): { places: ImportPlace[]; skipped: number; error?: string } {
  const rows = parseCsv(text);
  if (!rows.length) return { places: [], skipped: 0, error: 'Dosya boş.' };
  const header = rows[0].map((h) => foldName(h.trim()).replace(/\s+/g, ' '));
  const col = (k: keyof typeof HEADER_ALIASES) => header.findIndex((h) => HEADER_ALIASES[k].includes(h));
  const t = col('title');
  if (t < 0) return { places: [], skipped: 0, error: 'Başlık satırı bulunamadı (Title, Note, URL bekleniyordu).' };
  const n = col('note'), u = col('url'), cm = col('comment'), ad = col('address');
  const cell = (r: string[], k: number) => (k >= 0 && k < r.length ? r[k].trim() : '');
  const places: ImportPlace[] = [];
  let skipped = 0;
  for (const r of rows.slice(1)) {
    const rawUrl = cell(r, u);
    const url = normalizeGoogleMapsUrl(rawUrl);
    const name = cell(r, t) || (rawUrl ? nameFromGoogleUrl(rawUrl) : '');
    if (!name) { skipped++; continue; }
    const notes = [cell(r, n), cell(r, cm)].filter(Boolean);
    const coords = rawUrl ? coordsFromGoogleUrl(rawUrl) : null;
    const address = cell(r, ad);
    places.push({
      name: name.slice(0, 200), note: [...new Set(notes)].join(' · ').slice(0, 1000),
      ...(url ? { url } : {}), ...(address ? { address } : {}),
      lat: coords?.lat ?? null, lon: coords?.lon ?? null,
    });
  }
  return { places, skipped };
}

// ---------- GeoJSON (Saved Places.json) ----------

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (...vs: unknown[]): string => {
  for (const v of vs) if (typeof v === 'string' && v.trim()) return v.trim();
  return '';
};
const num = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v.trim()) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};
/** Geçerli ve [0,0] olmayan koordinat (Takeout konumsuz yerler için 0,0 yazar). */
export function validCoords(lat: number | null, lon: number | null): { lat: number; lon: number } | null {
  if (lat === null || lon === null) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  if (Math.abs(lat) < 1e-6 && Math.abs(lon) < 1e-6) return null;
  return { lat, lon };
}
/** Büyük/küçük harf duyarsız alan okuma (`Title` / `title`, `Location` / `location`). */
function prop(o: Obj | undefined, ...keys: string[]): unknown {
  if (!o) return undefined;
  for (const k of keys) if (o[k] !== undefined && o[k] !== null) return o[k];
  const lower = new Map(Object.keys(o).map((k) => [k.toLowerCase(), k]));
  for (const k of keys) {
    const real = lower.get(k.toLowerCase());
    if (real !== undefined && o[real] !== undefined && o[real] !== null) return o[real];
  }
  return undefined;
}

/**
 * `Saved Places.json` -> yerler. İki bilinen biçim:
 * yeni `{properties:{date, google_maps_url, location:{address, name, country_code}, Comment?}}` ve
 * eski `{properties:{Title, "Google Maps URL", Location:{Address, "Business Name", "Geo Coordinates":{Latitude, Longitude}}}}`.
 * Koordinat `geometry.coordinates` = [boylam, enlem]; [0,0] konumsuz sayılır.
 */
export function parseSavedPlacesJson(text: string): { places: ImportPlace[]; skipped: number; error?: string } {
  let data: unknown;
  try {
    data = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  } catch {
    return { places: [], skipped: 0, error: 'JSON okunamadı.' };
  }
  const features = Array.isArray(data) ? data : isObj(data) && Array.isArray(data.features) ? data.features : null;
  if (!features) return { places: [], skipped: 0, error: 'GeoJSON "features" bulunamadı.' };
  const places: ImportPlace[] = [];
  let skipped = 0;
  for (const f of features) {
    if (!isObj(f)) { skipped++; continue; }
    const p = isObj(f.properties) ? f.properties : {};
    const loc = isObj(prop(p, 'location')) ? (prop(p, 'location') as Obj) : undefined;
    const rawUrl = str(prop(p, 'google_maps_url', 'Google Maps URL', 'googleMapsUrl', 'url'));
    const url = normalizeGoogleMapsUrl(rawUrl);
    const address = str(prop(loc, 'address'), prop(p, 'address'));
    let lat: number | null = null, lon: number | null = null;
    const g = isObj(f.geometry) ? f.geometry : undefined;
    const coords = g && Array.isArray(g.coordinates) ? g.coordinates : null;
    if (coords && coords.length >= 2) { lon = num(coords[0]); lat = num(coords[1]); }
    if (!validCoords(lat, lon)) {
      const geo = loc && isObj(prop(loc, 'Geo Coordinates', 'geo_coordinates')) ? (prop(loc, 'Geo Coordinates', 'geo_coordinates') as Obj) : undefined;
      lat = num(prop(geo, 'Latitude', 'lat'));
      lon = num(prop(geo, 'Longitude', 'lon', 'lng'));
    }
    const ok = validCoords(lat, lon) ?? (rawUrl ? coordsFromGoogleUrl(rawUrl) : null);
    const name = str(prop(p, 'Title', 'name'), prop(loc, 'name', 'Business Name'), rawUrl ? nameFromGoogleUrl(rawUrl) : '',
      address.split(',')[0]);
    if (!name) { skipped++; continue; }
    const note = str(prop(p, 'Comment', 'note', 'Note', 'description'));
    places.push({
      name: name.slice(0, 200), note: note.slice(0, 1000), ...(url ? { url } : {}), ...(address ? { address } : {}),
      lat: ok?.lat ?? null, lon: ok?.lon ?? null,
    });
  }
  return { places, skipped };
}

// ---------- Dosya ----------

/** "Takeout/Kaydedilenler/Roma_yemek.csv" -> "Roma yemek". */
export function listNameFromFile(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? fileName;
  const name = base.replace(/\.(csv|json|geojson|txt)$/i, '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  return name || 'Google listesi';
}

/** Uzantıya (yoksa içeriğe) göre CSV ya da GeoJSON olarak okur. */
export function parseTakeoutFile(fileName: string, text: string): ParsedFile {
  const ext = /\.([a-z]+)$/i.exec(fileName)?.[1]?.toLowerCase();
  const head = text.replace(/^﻿/, '').trimStart();
  const json = ext === 'json' || ext === 'geojson' || (ext !== 'csv' && (head.startsWith('{') || head.startsWith('[')));
  const r = json ? parseSavedPlacesJson(text) : parseSavedListCsv(text);
  const error = r.error ?? (r.places.length ? undefined : 'Bu dosyada yer bulunamadı.');
  return { fileName, kind: json ? 'json' : 'csv', listName: listNameFromFile(fileName), places: r.places, skipped: r.skipped, ...(error ? { error } : {}) };
}

// ---------- Google Maps bağlantıları ----------

export const MAX_GOOGLE_MAPS_URL = 500;

/**
 * Sunucuyla aynı kural (details-core.ts `parseGoogleMapsUrl`): yalnızca https ve www.google.com/maps/…,
 * maps.google.com/…, goo.gl/maps/…, maps.app.goo.gl/…; en çok 500 karakter. Takeout'un eski `http://maps.google.com/?cid=`
 * bağlantıları https'e yükseltilir. Geçersizse undefined.
 */
export function normalizeGoogleMapsUrl(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  let s = raw.trim();
  if (!s || /\s/.test(s)) return undefined;
  if (/^http:\/\//i.test(s)) s = `https://${s.slice(7)}`;
  if (s.length > MAX_GOOGLE_MAPS_URL) return undefined;
  let u: URL;
  try { u = new URL(s); } catch { return undefined; }
  if (u.protocol !== 'https:' || u.username || u.password || u.port) return undefined;
  const host = u.hostname.toLowerCase();
  const path = u.pathname;
  const ok =
    (host === 'www.google.com' && (path === '/maps' || path.startsWith('/maps/'))) ||
    host === 'maps.google.com' ||
    (host === 'goo.gl' && path.startsWith('/maps/')) ||
    host === 'maps.app.goo.gl';
  return ok ? s : undefined;
}

/** `/maps/place/Roscioli+Salumeria/...` -> "Roscioli Salumeria" (CSV'de Title boşsa). */
export function nameFromGoogleUrl(url: string): string {
  const m = /\/maps\/place\/([^/?#]+)/.exec(url);
  if (!m) return '';
  try {
    const s = decodeURIComponent(m[1].replace(/\+/g, ' ')).trim();
    return /^-?\d+(\.\d+)?,\s*-?\d+(\.\d+)?$/.test(s) ? '' : s;
  } catch { return ''; }
}

/**
 * Bağlantıdaki kesin koordinat: `!3d<enlem>!4d<boylam>`, `/maps/search/<enlem>,<boylam>`, `?q=` / `query=` ile
 * koordinat (bırakılan iğneler). `@enlem,boylam` yalnızca harita görünümünün merkezi olduğu için kullanılmaz.
 */
export function coordsFromGoogleUrl(url: string): { lat: number; lon: number } | null {
  let s = url;
  try { s = decodeURIComponent(url); } catch { /* olduğu gibi */ }
  const pair = (a: string, b: string) => validCoords(Number(a), Number(b));
  const d = /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/.exec(s);
  if (d) return pair(d[1], d[2]);
  const re = /(?:\/maps\/search\/|\/maps\/place\/|[?&](?:q|query|ll)=)\s*(-?\d{1,2}(?:\.\d+)?)\s*,\s*\+?(-?\d{1,3}(?:\.\d+)?)(?=$|[/?&,#])/;
  const m = re.exec(s);
  return m ? pair(m[1], m[2]) : null;
}

// ---------- Liste adından şehir ve kategori ----------

/** Liste adlarında şehir sanılmaması gereken sık kelimeler (TR/EN/ES/IT). */
const STOPWORDS = new Set([
  'want', 'to', 'go', 'favorite', 'favorites', 'favourite', 'favourites', 'starred', 'saved', 'places', 'place', 'list', 'lists',
  'travel', 'plans', 'plan', 'my', 'the', 'and', 'of', 'in', 'for', 'best', 'top', 'must', 'see', 'visit', 'later', 'trip', 'eat',
  'liste', 'listem', 'listesi', 'yerler', 'yerleri', 'yer', 'favori', 'favoriler', 'gidilecek', 'gidilecekler', 'gitmek',
  'istediklerim', 'kaydedilenler', 'kayitli', 'yildizli', 'seyahat', 'planlari', 've', 'en', 'iyi', 'gezi',
  'quiero', 'ir', 'favoritos', 'sitios', 'lugares', 'guardados', 'viaje', 'de', 'del', 'la', 'el', 'los', 'las', 'y',
  'voglio', 'andare', 'preferiti', 'luoghi', 'salvati', 'viaggio', 'di', 'il', 'e', 'da',
  'default', 'new', 'yeni', 'nuevo', 'nuovo',
]);

type CatWords = { exact: string[]; prefix: string[] };
/** Liste adındaki tür kelimeleri (TR/EN/ES/IT); kısa kelimeler tam, uzunlar ön ek olarak eşleşir ("kahveciler", "museums"). */
const CATEGORY_WORDS: Record<Exclude<Category, 'other'>, CatWords> = {
  food: {
    exact: ['eat', 'eats', 'food', 'yemek', 'tapas', 'kebap', 'kebab', 'pizza', 'sushi', 'meze', 'comida', 'cibo', 'mangiare'],
    prefix: ['yemek', 'restoran', 'restaurant', 'ristorant', 'lokanta', 'trattori', 'osteri', 'pizzeri', 'meyhane', 'kahvalt', 'brunch',
      'dinner', 'lunch', 'burger', 'foodie', 'comida', 'restaurante', 'kebap', 'balikci', 'tapas', 'mutfak', 'cucina', 'street food'],
  },
  coffee: {
    exact: ['cafe', 'cafes', 'kafe', 'caffe', 'cafeler', 'kafeler'],
    prefix: ['kahve', 'coffee', 'cafeter', 'caffetter', 'pastane', 'patisser', 'pasticcer', 'bakery', 'firin', 'panader', 'gelato', 'dondurma'],
  },
  bar: {
    exact: ['bar', 'bars', 'barlar', 'bares', 'bari', 'pub', 'pubs', 'bira', 'beer', 'wine', 'vino', 'vinos', 'sarap', 'meyhane'],
    prefix: ['cocktail', 'kokteyl', 'cervecer', 'enotec', 'birrer', 'nightlife', 'gece hayat', 'tapas bar'],
  },
  historic: {
    exact: ['tarih', 'tarihi', 'antik', 'cami', 'camiler', 'kilise', 'saray', 'saraylar', 'sarayi'],
    prefix: ['tarihi', 'historic', 'history', 'histori', 'storic', 'monument', 'anit', 'ruin', 'oren', 'castle', 'kale',
      'palace', 'palaz', 'palac', 'iglesia', 'chiesa', 'church', 'cathedral', 'katedral', 'catedral'],
  },
  museum: {
    exact: ['muze', 'musei', 'museo', 'museos', 'galeri', 'art', 'arte', 'sanat'],
    prefix: ['muze', 'museum', 'museo', 'gallery', 'galler', 'sergi', 'exhibit'],
  },
  park: {
    exact: ['park', 'parks', 'parklar', 'parque', 'parques', 'parco', 'parchi', 'doga', 'nature', 'natura'],
    prefix: ['parkl', 'bahce', 'garden', 'jardin', 'giardin', 'hiking', 'trekking', 'yuruyus', 'hike', 'manzara', 'viewpoint', 'mirador', 'belvedere'],
  },
  beach: {
    exact: ['plaj', 'koy', 'koylar', 'playa', 'playas', 'spiaggia', 'spiagge', 'beach', 'beaches', 'deniz'],
    prefix: ['plaj', 'beach', 'playa', 'spiagg'],
  },
  hotel: {
    exact: ['otel', 'hotel', 'hotels', 'oteller', 'hostel', 'hostels', 'albergo', 'alberghi', 'hoteles', 'pansiyon', 'konaklama'],
    prefix: ['otel', 'hotel', 'konaklam', 'accommodat', 'alojamient', 'pansiyon', 'airbnb'],
  },
  airport: {
    exact: ['airport', 'airports', 'havalimani', 'havaalani', 'aeropuerto', 'aeroporto'],
    prefix: ['havalima', 'havaalan', 'airport', 'aeropuert', 'aeroport'],
  },
};

const PUNCT = /[\s!-/:-@[-^_{-~\u00a0-\u00bf\u00d7\u00f7\u2010-\u206f\u3000-\u303f\uff01-\uff0f]+/g;

/** Arama/karşılaştırma için: katlanmış (İ/ı/aksan), noktalama boşluk, kesme işaretleri silinir. */
export function foldText(s: string): string {
  // Unicode özellik kaçışları (\p{L}) her JS motorunda yok: noktalama açıkça listelenir; harfler (Latin dışı dahil) kalır.
  return foldName(s).replace(/['’‘`´]/g, '').replace(PUNCT, ' ').replace(/\s+/g, ' ').trim();
}
const words = (s: string): string[] => foldText(s).split(' ').filter(Boolean);

/**
 * Liste adındaki tür kelimesinden varsayılan kategori ("Roma yemek" -> food, "İstanbul kahve" -> coffee); yoksa null.
 * `city` verilirse onun kelimeleri yok sayılır ("Saraybosna" saray sanılmasın).
 */
export function guessCategory(listName: string, city?: string | null): Category | null {
  const skip = new Set(city ? words(city) : []);
  const ws = words(listName).filter((w) => !skip.has(w));
  const text = ws.join(' ');
  for (const [cat, { exact }] of Object.entries(CATEGORY_WORDS) as [Category, CatWords][]) {
    if (ws.some((w) => exact.includes(w))) return cat;
  }
  for (const [cat, { prefix }] of Object.entries(CATEGORY_WORDS) as [Category, CatWords][]) {
    if (prefix.some((p) => (p.includes(' ') ? text.includes(p) : ws.some((w) => w.length >= p.length && w.startsWith(p)))))
      return cat;
  }
  return null;
}

const isCategoryWord = (w: string) =>
  Object.values(CATEGORY_WORDS).some(({ exact, prefix }) => exact.includes(w) || prefix.some((p) => !p.includes(' ') && w.startsWith(p)));

/**
 * Liste adından şehir tahmini (gömülü şehir verisi, çevrimdışı): "Madrid" -> Madrid, "Roma yemek" -> Roma,
 * "İstanbul kahve" -> İstanbul, "New York pizza" -> New York; "Want to go" / "Favori yerler" -> null.
 * Uzun kelime grupları önce denenir; tek başına ülke adı yalnızca liste adının tamamıysa kabul edilir.
 */
export function guessCity(listName: string): Destination | null {
  const ws = words(listName);
  if (!ws.length) return null;
  for (let len = Math.min(4, ws.length); len >= 1; len--) {
    for (let i = 0; i + len <= ws.length; i++) {
      const gram = ws.slice(i, i + len);
      if (len === 1 && (gram[0].length < 3 || STOPWORDS.has(gram[0]) || isCategoryWord(gram[0]) || /^\d+$/.test(gram[0]))) continue;
      if (gram.every((w) => STOPWORDS.has(w))) continue;
      const d = findDestination(gram.join(' '));
      if (!d) continue;
      if (d.kind === 'city' || len === ws.length) return d;
    }
  }
  return null;
}

/** Adresten şehir: virgülle ayrılmış parçalar sondan başa (posta kodu atılır), ilk şehir eşleşmesi. */
export function guessCityFromAddress(address: string | undefined): Destination | null {
  if (!address) return null;
  const parts = address.split(',').map((p) => p.replace(/\d+/g, ' ').trim()).filter(Boolean);
  for (const part of parts.reverse()) {
    const d = guessCity(part);
    if (d && d.kind === 'city') return d;
  }
  return null;
}

// ---------- Eşleşme kalitesi ----------

/** Ad benzerliğinde yok sayılan genel kelimeler (tür kelimeleri, artikeller). */
const GENERIC = new Set([
  'the', 'a', 'an', 'and', 'of', 'la', 'el', 'il', 'lo', 'le', 'les', 'los', 'las', 'de', 'del', 'di', 'da', 'dei', 'della', 'y', 'e', 've',
  'restaurant', 'restaurante', 'ristorante', 'restoran', 'lokanta', 'trattoria', 'osteria', 'pizzeria', 'cafe', 'caffe', 'kafe', 'coffee',
  'bar', 'pub', 'hotel', 'otel', 'hostel', 'museum', 'museo', 'muze', 'muzesi', 'park', 'parki', 'beach', 'plaj', 'plaji', 'playa',
  'cerveceria', 'salumeria', 'enoteca', 'kahve', 'kahvecisi', 'evi', 'house', 'il', 'caffè',
]);

function lev1(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, diff = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++diff > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else { i++; j++; }
  }
  return diff + (a.length - i) + (b.length - j) <= 1;
}
const tokEq = (a: string, b: string) =>
  a === b || (Math.min(a.length, b.length) >= 4 && (a.startsWith(b) || b.startsWith(a))) || (Math.min(a.length, b.length) >= 5 && lev1(a, b));

function bigrams(s: string): Map<string, number> {
  const m = new Map<string, number>();
  for (let i = 0; i < s.length - 1; i++) { const g = s.slice(i, i + 2); m.set(g, (m.get(g) ?? 0) + 1); }
  return m;
}
function dice(a: string, b: string): number {
  if (a.length < 2 || b.length < 2) return a === b ? 1 : 0;
  const A = bigrams(a), B = bigrams(b);
  let inter = 0;
  for (const [g, n] of A) inter += Math.min(n, B.get(g) ?? 0);
  return (2 * inter) / (a.length - 1 + b.length - 1);
}

/**
 * Ad benzerliği 0..1 (katlanmış; tür kelimeleri ve artikeller yok sayılır). Aranan adın kelimelerinin sonuçta
 * bulunma oranı ağırlıklı (0.7), sonucun kelimelerinin aranan adda bulunma oranı (0.3); bitişik yazım/yazım hatası için
 * harf ikilisi (Dice) benzerliği de denenir.
 */
export function nameSimilarity(query: string, result: string): number {
  const qa = words(query), ra = words(result);
  if (!qa.length || !ra.length) return 0;
  if (qa.join(' ') === ra.join(' ')) return 1;
  const strip = (ws: string[]) => { const s = ws.filter((w) => !GENERIC.has(w)); return s.length ? s : ws; };
  const q = strip(qa), r = strip(ra);
  if (q.join(' ') === r.join(' ')) return 1;
  const qHit = q.filter((w) => r.some((x) => tokEq(w, x))).length / q.length;
  const rHit = r.filter((w) => q.some((x) => tokEq(w, x))).length / r.length;
  const tokens = 0.7 * qHit + 0.3 * rHit;
  const compact = 0.9 * dice(q.join(''), r.join(''));
  return Math.round(Math.max(tokens, compact) * 100) / 100;
}

/** Kuş uçuşu mesafe (km). */
export function distanceKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const r = Math.PI / 180;
  const h = Math.sin(((b.lat - a.lat) * r) / 2) ** 2
    + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(((b.lon - a.lon) * r) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

/** Şehir merkezine bundan uzak eşleşmeler "Kontrol et" olur (AC-MOB-34). */
export const FAR_KM = 50;
/** Bu ad benzerliğinin altı "Kontrol et" olur. */
export const LOW_SIMILARITY = 0.5;

export interface MatchQuality {
  similarity: number;
  /** Şehir merkezine uzaklık; merkez bilinmiyorsa null. */
  distanceKm: number | null;
  far: boolean;
  lowSimilarity: boolean;
  needsCheck: boolean;
}

export function matchQuality(query: string, r: Pick<SearchResult, 'name' | 'lat' | 'lon'>, centre: { lat: number; lon: number } | null): MatchQuality {
  const similarity = nameSimilarity(query, r.name);
  const d = centre && Number.isFinite(r.lat) && Number.isFinite(r.lon) ? distanceKm(centre, r) : null;
  const far = d !== null && d > FAR_KM;
  const lowSimilarity = similarity < LOW_SIMILARITY;
  return { similarity, distanceKm: d === null ? null : Math.round(d * 10) / 10, far, lowSimilarity, needsCheck: far || lowSimilarity };
}

/**
 * Sonuçlardan en iyisi: ad benzerliği yüksek ve şehir merkezine yakın olan (uzaklar cezalı). Sonuç yoksa null.
 */
export function pickBestMatch(query: string, results: Pick<SearchResult, 'name' | 'lat' | 'lon'>[], centre: { lat: number; lon: number } | null): { index: number; quality: MatchQuality } | null {
  let best: { index: number; quality: MatchQuality; score: number } | null = null;
  for (let index = 0; index < results.length; index++) {
    const quality = matchQuality(query, results[index], centre);
    const d = quality.distanceKm ?? 0;
    const score = quality.similarity - (quality.far ? 0.6 : Math.min(d, FAR_KM) / 250);
    if (!best || score > best.score + 1e-9) best = { index, quality, score };
  }
  return best ? { index: best.index, quality: best.quality } : null;
}

// ---------- JSON: şehre göre gruplama ----------

export interface PlaceGroup { city: Destination | null; places: ImportPlace[] }

/**
 * `Saved Places.json` dünyanın her yerinden yıldızlı yer içerir: koordinatlı yerler en yakın şehre (25 km içindeki en
 * kalabalık şehir), koordinatsızlar adresten tahmin edilen şehre göre gruplanır; şehri bulunamayanlar tek grupta
 * (şehir null) kalır. Gruplar yer sayısına göre azalan sırada.
 */
export function groupByCity(places: ImportPlace[]): PlaceGroup[] {
  const groups = new Map<string, PlaceGroup>();
  for (const p of places) {
    const c = p.lat !== null && p.lon !== null ? nearestCity(p.lat, p.lon) : guessCityFromAddress(p.address);
    const key = c ? `${c.countryCode}:${c.name}` : '';
    const g = groups.get(key) ?? { city: c, places: [] };
    g.places.push(p);
    groups.set(key, g);
  }
  return [...groups.values()].sort((a, b) => (a.city ? 0 : 1) - (b.city ? 0 : 1) || b.places.length - a.places.length);
}

// ---------- Kaydetme: tekrarlar ve 500 sınırı ----------

/** Liste başına en çok öğe (sunucu `PUT /lists/:id/items` sınırı). */
export const MAX_LIST_ITEMS = 500;

export interface KeyedItem { provider: string; providerId: string; name: string; lat?: number | null; lon?: number | null }

/** Aynı yer anahtarları: sağlayıcı kimliği ve ad + ~100 m koordinat (koordinatsızsa yalnızca ad). */
export function placeKeys(it: KeyedItem): string[] {
  const n = foldText(it.name);
  const loc = it.lat !== null && it.lat !== undefined && it.lon !== null && it.lon !== undefined
    ? `${it.lat.toFixed(3)},${it.lon.toFixed(3)}` : '-';
  return [`p:${it.provider}|${it.providerId}`, `n:${n}|${loc}`];
}

/** `existing` içinde ya da kendi içinde tekrar edenleri atar; `dupes` atılanların sayısı. */
export function dedupeItems<T extends KeyedItem>(existing: KeyedItem[], incoming: T[]): { items: T[]; dupes: number } {
  const seen = new Set(existing.flatMap(placeKeys));
  const items: T[] = [];
  let dupes = 0;
  for (const it of incoming) {
    const keys = placeKeys(it);
    if (keys.some((k) => seen.has(k))) { dupes++; continue; }
    keys.forEach((k) => seen.add(k));
    items.push(it);
  }
  return { items, dupes };
}

/**
 * Yeni öğeleri liste kapasitesine böler: ilk parça mevcut listeye (kalan yer kadar), kalanlar 500'lük yeni listelere.
 */
export function splitForCapacity<T>(existingCount: number, items: T[], max = MAX_LIST_ITEMS): { first: T[]; overflow: T[][] } {
  const room = Math.max(0, max - existingCount);
  const first = items.slice(0, room);
  const overflow: T[][] = [];
  for (let i = room; i < items.length; i += max) overflow.push(items.slice(i, i + max));
  return { first, overflow };
}

/** "3 liste, 87 yer; 5 yer konumsuz" (AC-MOB-35). */
export function importSummary(lists: number, places: number, unlocated: number, dupes = 0): string {
  let s = `${lists} liste, ${places} yer`;
  if (unlocated) s += `; ${unlocated} yer konumsuz`;
  if (dupes) s += ` (${dupes} yer zaten listedeydi)`;
  return s;
}
