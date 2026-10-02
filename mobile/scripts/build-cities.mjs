// Gömülü şehir ve ülke listesini üretir: src/data/places-index.json
// Kaynak: GeoNames (CC BY 4.0), npm paketi `all-the-cities` üzerinden; ülke adları Node'un Intl verisinden.
// Çalıştırma:  npm i --no-save all-the-cities && node scripts/build-cities.mjs
//
// Biçim:
//   countries: [[kod, trAd, enAd, enlem, boylam, nüfus], ...]
//   cities:    [[gösterilecekAd, ülkeKodu, enlem, boylam, nüfus, ...aranabilirDiğerAdlar], ...]
// Gösterilecek ad Türkçe yaygın addır (yoksa GeoNames adı); diğer adlar İngilizce/yerel yazımlardır.
import { writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const all = require('all-the-cities');

const MIN_POP = 15000;      // dünya geneli
const MIN_POP_TR = 1000;    // Türkiye: küçük turistik yerler de (Kaş, Göreme...)

// GeoNames adı -> { tr: Türkçe yaygın ad, en: İngilizce ad }. GeoNames adı bazen İngilizce (Rome), bazen yerel (Köln).
const ALIASES = {
  'Istanbul|TR': { tr: 'İstanbul' }, 'İnegol|TR': { tr: 'İnegöl' },
  'Rome|IT': { tr: 'Roma' }, 'Milan|IT': { tr: 'Milano' }, 'Naples|IT': { tr: 'Napoli' }, 'Turin|IT': { tr: 'Torino' },
  'Venice|IT': { tr: 'Venedik' }, 'Florence|IT': { tr: 'Floransa' }, 'Genoa|IT': { tr: 'Cenova' },
  'Padova|IT': { en: 'Padua' }, 'Siracusa|IT': { en: 'Syracuse' },
  'Athens|GR': { tr: 'Atina' }, 'Thessaloníki|GR': { tr: 'Selanik', en: 'Thessaloniki' }, 'Ródos|GR': { tr: 'Rodos', en: 'Rhodes' },
  'Irákleion|GR': { tr: 'Kandiye', en: 'Heraklion' }, 'Mytilene|GR': { tr: 'Midilli' }, 'Chios|GR': { tr: 'Sakız' },
  'Corfu|GR': { tr: 'Korfu' }, 'Alexandroupoli|GR': { tr: 'Dedeağaç' }, 'Komotiní|GR': { tr: 'Gümülcine', en: 'Komotini' },
  'Xánthi|GR': { tr: 'İskeçe', en: 'Xanthi' }, 'Ioánnina|GR': { tr: 'Yanya', en: 'Ioannina' }, 'Lárisa|GR': { tr: 'Yenişehir', en: 'Larissa' },
  'London|GB': { tr: 'Londra' }, 'Edinburgh|GB': { tr: 'Edinburg' },
  'Strasbourg|FR': { tr: 'Strazburg' }, 'Marseille|FR': { tr: 'Marsilya' },
  'Brussels|BE': { tr: 'Brüksel' }, 'Antwerpen|BE': { tr: 'Anvers', en: 'Antwerp' },
  'Vienna|AT': { tr: 'Viyana' },
  'Munich|DE': { tr: 'Münih' }, 'Köln|DE': { en: 'Cologne' }, 'Nürnberg|DE': { en: 'Nuremberg' }, 'Hannover|DE': { en: 'Hanover' },
  'Genève|CH': { tr: 'Cenevre', en: 'Geneva' }, 'Zürich|CH': { tr: 'Zürih', en: 'Zurich' },
  'Lisbon|PT': { tr: 'Lizbon' },
  'Sevilla|ES': { en: 'Seville' }, 'Barcelona|ES': { tr: 'Barselona' }, 'Zaragoza|ES': { en: 'Saragossa' },
  'Prague|CZ': { tr: 'Prag' }, 'Warsaw|PL': { tr: 'Varşova' }, 'Kraków|PL': { tr: 'Krakov', en: 'Krakow' },
  'Budapest|HU': { tr: 'Budapeşte' }, 'Bucharest|RO': { tr: 'Bükreş' }, 'Constanţa|RO': { tr: 'Köstence', en: 'Constanta' },
  'Sofia|BG': { tr: 'Sofya' }, 'Plovdiv|BG': { tr: 'Filibe' }, 'Kardzhali|BG': { tr: 'Kırcaali' }, 'Shumen|BG': { tr: 'Şumnu' },
  'Belgrade|RS': { tr: 'Belgrad' }, 'Niš|RS': { tr: 'Niş', en: 'Nis' },
  'Sarajevo|BA': { tr: 'Saraybosna' }, 'Skopje|MK': { tr: 'Üsküp' }, 'Ohrid|MK': { tr: 'Ohri' }, 'Bitola|MK': { tr: 'Manastır' },
  'Tirana|AL': { tr: 'Tiran' }, 'Durrës|AL': { tr: 'Dıraç', en: 'Durres' }, 'Shkodër|AL': { tr: 'İşkodra', en: 'Shkoder' },
  'Pristina|XK': { tr: 'Priştine' }, 'Ljubljana|SI': { tr: 'Lübliyana' },
  'Nicosia|CY': { tr: 'Lefkoşa' }, 'Famagusta|CY': { tr: 'Gazimağusa' }, 'Kyrenia|CY': { tr: 'Girne' },
  'Larnaca|CY': { tr: 'Larnaka' }, 'Limassol|CY': { tr: 'Leymosun' }, 'Paphos|CY': { tr: 'Baf' },
  'Copenhagen|DK': { tr: 'Kopenhag' }, 'Stockholm|SE': { tr: 'Stokholm' }, 'Göteborg|SE': { en: 'Gothenburg' },
  'The Hague|NL': { tr: 'Lahey' },
  'Moscow|RU': { tr: 'Moskova' }, 'Saint Petersburg|RU': { tr: 'St. Petersburg' },
  'Kyiv|UA': { tr: 'Kiev' }, 'Simferopol|UA': { tr: 'Akmescit' },
  'Tbilisi|GE': { tr: 'Tiflis' }, 'Batumi|GE': { tr: 'Batum' }, 'Yerevan|AM': { tr: 'Erivan' }, 'Baku|AZ': { tr: 'Bakü' }, 'Ganja|AZ': { tr: 'Gence' },
  'Tehran|IR': { tr: 'Tahran' }, 'Tabriz|IR': { tr: 'Tebriz' }, 'Isfahan|IR': { tr: 'İsfahan' }, 'Shiraz|IR': { tr: 'Şiraz' },
  'Baghdad|IQ': { tr: 'Bağdat' }, 'Mosul|IQ': { tr: 'Musul' }, 'Kirkuk|IQ': { tr: 'Kerkük' }, 'Basrah|IQ': { tr: 'Basra' },
  'Damascus|SY': { tr: 'Şam' }, 'Aleppo|SY': { tr: 'Halep' }, 'Beirut|LB': { tr: 'Beyrut' },
  'Jerusalem|IL': { tr: 'Kudüs' }, 'Gaza|PS': { tr: 'Gazze' },
  'Mecca|SA': { tr: 'Mekke' }, 'Medina|SA': { tr: 'Medine' }, 'Riyadh|SA': { tr: 'Riyad' }, 'Jeddah|SA': { tr: 'Cidde' },
  'Abu Dhabi|AE': { tr: 'Abu Dabi' }, 'Kuwait City|KW': { tr: 'Kuveyt' }, 'Muscat|OM': { tr: 'Maskat' },
  'Cairo|EG': { tr: 'Kahire' }, 'Alexandria|EG': { tr: 'İskenderiye' }, 'Tunis|TN': { tr: 'Tunus' }, 'Algiers|DZ': { tr: 'Cezayir' },
  'Casablanca|MA': { tr: 'Kazablanka' }, 'Marrakesh|MA': { tr: 'Marakeş' }, 'Fès|MA': { tr: 'Fas', en: 'Fez' }, 'Tripoli|LY': { tr: 'Trablus' },
  'Tashkent|UZ': { tr: 'Taşkent' }, 'Samarkand|UZ': { tr: 'Semerkant' }, 'Bukhara|UZ': { tr: 'Buhara' },
  'Almaty|KZ': { tr: 'Almatı' }, 'Nur-Sultan|KZ': { tr: 'Astana', en: 'Astana' },
  'Bishkek|KG': { tr: 'Bişkek' }, 'Ashgabat|TM': { tr: 'Aşkabat' }, 'Kabul|AF': { tr: 'Kabil' },
  'Beijing|CN': { tr: 'Pekin' }, 'Shanghai|CN': { tr: 'Şanghay' }, 'Seoul|KR': { tr: 'Seul' },
  'Singapore|SG': { tr: 'Singapur' }, 'Mexico City|MX': { tr: 'Meksiko' }, 'New York City|US': { tr: 'New York' },
};

// ISO ülkesi olmayan ama sık aranan bölgeler.
const EXTRA_COUNTRIES = [
  ['GB-ENG', 'İngiltere', 'England', 52.36, -1.17],
  ['GB-SCT', 'İskoçya', 'Scotland', 56.49, -4.2],
  ['GB-WLS', 'Galler', 'Wales', 52.13, -3.78],
  ['GB-NIR', 'Kuzey İrlanda', 'Northern Ireland', 54.61, -6.69],
];

const trNames = new Intl.DisplayNames(['tr'], { type: 'region' });
const enNames = new Intl.DisplayNames(['en'], { type: 'region' });

const best = new Map();
for (const c of all) {
  if (c.population < (c.country === 'TR' ? MIN_POP_TR : MIN_POP)) continue;
  const key = `${c.name}|${c.country}`;
  const prev = best.get(key);
  if (!prev || prev.population < c.population) best.set(key, c);
}

const cities = [];
const agg = new Map(); // ülke -> nüfus ağırlıklı merkez
for (const [key, c] of best) {
  const alias = ALIASES[key] ?? {};
  const display = alias.tr ?? c.name;
  const [lon, lat] = c.loc.coordinates;
  const others = [...new Set([c.name, alias.en, c.altName].filter((n) => n && n !== display))];
  cities.push([display, c.country, +lat.toFixed(2), +lon.toFixed(2), c.population, ...others]);
  const a = agg.get(c.country) ?? { w: 0, lat: 0, lon: 0 };
  a.w += c.population; a.lat += lat * c.population; a.lon += lon * c.population;
  agg.set(c.country, a);
}
cities.sort((a, b) => b[4] - a[4]);

const countries = [...agg].map(([cc, a]) => [cc, trNames.of(cc) ?? cc, enNames.of(cc) ?? cc,
  +(a.lat / a.w).toFixed(2), +(a.lon / a.w).toFixed(2), a.w]);
for (const [cc, tr, en, lat, lon] of EXTRA_COUNTRIES) countries.push([cc, tr, en, lat, lon, agg.get('GB')?.w ?? 0]);
countries.sort((a, b) => b[5] - a[5]);

const missing = Object.keys(ALIASES).filter((k) => !best.has(k));
if (missing.length) console.warn('Eşleşmeyen adlar:', missing.join(', '));
mkdirSync(new URL('../src/data/', import.meta.url), { recursive: true });
writeFileSync(new URL('../src/data/places-index.json', import.meta.url), JSON.stringify({ countries, cities }));
console.log(`${cities.length} şehir (${cities.filter((c) => c[1] === 'TR').length} Türkiye), ${countries.length} ülke/bölge`);
