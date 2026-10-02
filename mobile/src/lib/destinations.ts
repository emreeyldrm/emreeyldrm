/**
 * Çevrimdışı şehir/ülke arama (Yeni liste "Şehir" alanı). Veri: src/data/places-index.json
 * (GeoNames, scripts/build-cities.mjs ile üretilir). Türkçe, İngilizce ve yerel adların hepsiyle eşleşir;
 * büyük/küçük harf ve aksan duyarsızdır (İ/I/ı/i aynı sayılır: "ist" ve "Ist" İstanbul'u bulur).
 */
export interface Destination {
  kind: 'city' | 'country';
  name: string;       // gösterilen (Türkçe) ad
  detail: string;     // ör. "İtalya · Rome" ya da "Ülke · Spain"
  countryCode: string;
  lat: number;
  lon: number;
  population: number;
}

type CountryRow = [string, string, string, number, number, number];
type CityRow = [string, string, number, number, number, ...string[]];
interface Entry extends Destination { keys: string[] }

const MARKS = /[̀-ͯ]/g;
const FALLBACK: Record<string, string> = { ş: 's', ğ: 'g', ç: 'c', ö: 'o', ü: 'u', â: 'a', î: 'i', û: 'u', é: 'e', è: 'e', á: 'a', à: 'a', ó: 'o', í: 'i', ú: 'u', ñ: 'n' };

/** Arama anahtarı: İ/I/ı -> i, küçük harf, aksansız. */
export function foldName(s: string): string {
  const lower = s.replace(/[İIı]/g, 'i').toLowerCase();
  if (typeof lower.normalize === 'function') return lower.normalize('NFD').replace(MARKS, '');
  return lower.replace(/[şğçöüâîûéèáàóíúñ]/g, (c) => FALLBACK[c] ?? c);
}

let index: Entry[] | null = null;

function load(): Entry[] {
  if (index) return index;
  // Büyük dosya: yalnızca ilk aramada yüklenir.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const data = require('../data/places-index.json') as { countries: CountryRow[]; cities: CityRow[] };
  const countryTr = new Map<string, string>();
  const entries: Entry[] = [];
  for (const [code, tr, en, lat, lon, pop] of data.countries) {
    countryTr.set(code, tr);
    const region = code.includes('-');
    entries.push({
      kind: 'country', name: tr, detail: `${region ? 'Bölge' : 'Ülke'}${en !== tr ? ` · ${en}` : ''}`, countryCode: code,
      lat, lon, population: region ? pop * 0.5 : pop, keys: [...new Set([foldName(tr), foldName(en)])],
    });
  }
  for (const [name, cc, lat, lon, pop, ...others] of data.cities) {
    const country = countryTr.get(cc) ?? cc;
    entries.push({
      kind: 'city', name, detail: others[0] ? `${country} · ${others[0]}` : country, countryCode: cc,
      lat, lon, population: pop, keys: [...new Set([name, ...others].map(foldName))],
    });
  }
  index = entries;
  return entries;
}

/** 0 = adın tamamı, 1 = adın başı, 2 = bir kelimenin başı, 3 = içinde (3+ harf); eşleşmezse -1. */
function score(keys: string[], q: string): number {
  let best = -1;
  for (const k of keys) if (k === q) return 0;
  for (const k of keys) {
    if (k.startsWith(q)) return 1;
    if (best !== 2 && (k.includes(` ${q}`) || k.includes(`-${q}`))) best = 2;
    else if (best === -1 && q.length >= 3 && k.includes(q)) best = 3;
  }
  return best;
}

/** Türkiye'deki küçük yerler (Kaş, Göreme) öne çıksın diye nüfus ağırlığı. */
const rank = (e: Entry) => (e.kind === 'city' && e.countryCode === 'TR' ? e.population * 10 : e.population);

/** Yazılan metne uyan şehir ve ülkeler: önce baştan eşleşenler, sonra nüfusa göre. */
export function searchDestinations(query: string, limit = 8): Destination[] {
  const q = foldName(query.trim());
  if (!q) return [];
  const hits: { e: Entry; s: number }[] = [];
  for (const e of load()) {
    const s = score(e.keys, q);
    if (s >= 0) hits.push({ e, s });
  }
  hits.sort((a, b) => a.s - b.s || rank(b.e) - rank(a.e));
  return hits.slice(0, limit).map(({ e }) => ({
    kind: e.kind, name: e.name, detail: e.detail, countryCode: e.countryCode, lat: e.lat, lon: e.lon, population: e.population,
  }));
}

/** Liste şehrinin koordinatı ("Roma'ya göre ara" için): adı tam eşleşen en kalabalık şehir, yoksa ülke. */
export function findDestination(name: string): Destination | null {
  const q = foldName(name.trim());
  if (!q) return null;
  let best: Entry | null = null;
  for (const e of load()) {
    if (!e.keys.includes(q)) continue;
    if (!best || (e.kind === 'city' && best.kind !== 'city') || (e.kind === best.kind && e.population > best.population)) best = e;
  }
  return best ? { kind: best.kind, name: best.name, detail: best.detail, countryCode: best.countryCode, lat: best.lat, lon: best.lon, population: best.population } : null;
}
